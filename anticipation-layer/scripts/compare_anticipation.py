"""Does V-JEPA help predict energy peaks? Head-to-head on one or more runs.

Contenders, all scored on the same held-out windows:
  always       - fire on every window (precision = base rate; the floor to beat)
  heuristic    - what the engine emitted live (rhythm -> parabola), read from frames.jsonl
  gru:kin      - learned, kinematics only (energy, velocity, cadence, slope)
  gru:vjepa    - learned, V-JEPA embedding only (PCA of the pooled 1024-d vector)
  gru:kin+vjepa- learned, both
  gru:kin+dyn  - learned, kinematics + V-JEPA motion features (PCA of `dynamic`), if saved

Evaluation: blocked K-fold over time (each block is validation once, the rest trains),
repeated over seeds. A window "fires" if any horizon prob >= 0.5. Metrics:
  recall     - share of true peaks that had a firing window up to 1 s before them
  precision  - share of firing windows followed by a peak within 1 s
  lead       - median time from first firing window to the peak
  fa/min     - firing windows with no peak in the next 1 s, per minute

    python scripts/compare_anticipation.py runs/office --out runs/office/compare.json
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import numpy as np
import torch
from torch import nn

from anticipation.heads.anticipation import HORIZONS_S, AnticipationGRU, find_peaks, peak_labels

N_KIN = 4  # window_features() ends with [energy, velocity, cadence, slope]


def load(d: Path) -> dict:
    x = np.load(d / "extras.npz", allow_pickle=False)
    rows = [json.loads(line) for line in (d / "frames.jsonl").read_text().splitlines()]
    t = x["t_end"]
    peaks = find_peaks(x["energy_t"], x["energy"])
    heur = np.array([r["anticipation"]["eta_ms"] is not None and r["anticipation"]["prob"] >= 0.5 for r in rows])
    if len(x["pooled"]) != len(t):
        raise SystemExit(f"{d}: no V-JEPA embeddings (run without --no-vjepa)")
    dyn = x["dynamic"] if "dynamic" in x.files and len(x["dynamic"]) == len(t) else None
    return {"t": t, "kin": x["features"][:, -N_KIN:], "pooled": x["pooled"], "dynamic": dyn, "peaks": peaks,
            "Y": peak_labels(t, peaks), "heur": heur, "name": d.name}


def pca_fit(X: np.ndarray, k: int):
    mu = X.mean(0)
    _, _, vt = np.linalg.svd(X - mu, full_matrices=False)
    return mu, vt[:k]


def metrics(t, fired, Y, peaks, block_peaks) -> dict:
    hit_any = Y.max(1) > 0
    leads = []
    for p in block_peaks:
        m = fired & (t < p) & (t >= p - 1.0)
        if m.any():
            leads.append(float(p - t[m].min()))
    dur_min = max((t[-1] - t[0]) / 60.0, 1e-6) if len(t) > 1 else 1e-6
    return {
        "peaks": len(block_peaks),
        "hits": len(leads),
        "tp_win": int((fired & hit_any).sum()),
        "fired": int(fired.sum()),
        "fa": int((fired & ~hit_any).sum()),
        "pos_win": int(hit_any.sum()),
        "windows": len(t),
        "minutes": dur_min,
        "leads": leads,
    }


def summarise(parts: list[dict]) -> dict:
    s = {k: sum(p[k] for p in parts) for k in ("peaks", "hits", "tp_win", "fired", "fa", "pos_win", "windows", "minutes")}
    leads = [x for p in parts for x in p["leads"]]
    rec = s["hits"] / max(s["peaks"], 1)
    prec = s["tp_win"] / max(s["fired"], 1)
    return {
        "recall": rec,
        "precision": prec,
        "f1": 2 * rec * prec / max(rec + prec, 1e-9),
        "lead_ms": float(np.median(leads) * 1000) if leads else None,
        "fa_per_min": s["fa"] / s["minutes"],
        "base_rate": s["pos_win"] / max(s["windows"], 1),
        "peaks": s["peaks"],
    }


def train_gru(seqs, dim, seed, epochs, hidden):
    torch.manual_seed(seed)
    model = AnticipationGRU(dim, hidden, len(HORIZONS_S))
    opt = torch.optim.AdamW(model.parameters(), lr=3e-3, weight_decay=1e-2)
    pos = np.concatenate([y for _, y in seqs]).mean(0)
    loss_fn = nn.BCEWithLogitsLoss(pos_weight=torch.tensor((1 - pos) / np.maximum(pos, 1e-3), dtype=torch.float32))
    for _ in range(epochs):
        opt.zero_grad()
        loss = sum(loss_fn(model(torch.from_numpy(X)[None])[0], torch.from_numpy(Y)) for X, Y in seqs if len(X) > 1)
        loss.backward()
        opt.step()
    return model.eval()


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("runs", nargs="+")
    ap.add_argument("--folds", type=int, default=4)
    ap.add_argument("--seeds", type=int, default=3)
    ap.add_argument("--pca", type=int, default=16, help="V-JEPA dims kept (PCA fitted on training blocks only)")
    ap.add_argument("--epochs", type=int, default=150)
    ap.add_argument("--hidden", type=int, default=32)
    ap.add_argument("--out")
    args = ap.parse_args()

    runs = [load(Path(r)) for r in args.runs]
    kinds = ["kin", "vjepa", "kin+vjepa"] + (["kin+dyn"] if all(r["dynamic"] is not None for r in runs) else [])
    parts: dict[str, list] = {"always": [], "heuristic": [], **{f"gru:{k}": [] for k in kinds}}

    for run in runs:
        n = len(run["t"])
        edges = np.linspace(0, n, args.folds + 1).astype(int)
        for f in range(args.folds):
            va = np.arange(edges[f], edges[f + 1])
            tr_blocks = [np.arange(edges[g], edges[g + 1]) for g in range(args.folds) if g != f]
            t, Y = run["t"][va], run["Y"][va]
            bp = run["peaks"][(run["peaks"] > t[0]) & (run["peaks"] <= t[-1] + 1.0)]
            parts["always"].append(metrics(t, np.ones(len(va), bool), Y, run["peaks"], bp))
            parts["heuristic"].append(metrics(t, run["heur"][va], Y, run["peaks"], bp))

            tr_idx = np.concatenate(tr_blocks)
            mu, comps = pca_fit(run["pooled"][tr_idx], args.pca)
            emb = (run["pooled"] - mu) @ comps.T
            feats = {"kin": run["kin"], "vjepa": emb, "kin+vjepa": np.concatenate([run["kin"], emb], 1)}
            if "kin+dyn" in kinds:
                mu_d, comps_d = pca_fit(run["dynamic"][tr_idx], args.pca)
                feats["kin+dyn"] = np.concatenate([run["kin"], (run["dynamic"] - mu_d) @ comps_d.T], 1)
            for k in kinds:
                F = feats[k].astype(np.float32)
                m, s = F[tr_idx].mean(0), F[tr_idx].std(0) + 1e-6
                F = (F - m) / s
                seqs = [(F[b], run["Y"][b]) for b in tr_blocks]
                for seed in range(args.seeds):
                    model = train_gru(seqs, F.shape[1], seed, args.epochs, args.hidden)
                    with torch.no_grad():
                        p = torch.sigmoid(model(torch.from_numpy(F[va])[None])[0]).numpy()
                    parts[f"gru:{k}"].append(metrics(t, (p >= 0.5).any(1), Y, run["peaks"], bp))

    res = {name: summarise(p) for name, p in parts.items()}
    total_peaks = sum(len(r["peaks"]) for r in runs)
    minutes = sum((r["t"][-1] - r["t"][0]) / 60 for r in runs)
    print(f"\n{len(runs)} run(s), {minutes:.1f} min, {total_peaks} energy peaks, "
          f"{args.folds}-fold blocked CV x {args.seeds} seeds (GRU rows)")
    print(f"base rate: {res['always']['base_rate']:.0%} of windows have a peak within 1 s\n")
    print(f"{'model':<16}{'recall':>8}{'precision':>11}{'F1':>7}{'lead ms':>9}{'false/min':>11}")
    for name, r in res.items():
        lead = f"{r['lead_ms']:.0f}" if r["lead_ms"] is not None else "-"
        print(f"{name:<16}{r['recall']:>8.2f}{r['precision']:>11.2f}{r['f1']:>7.2f}{lead:>9}{r['fa_per_min']:>11.1f}")
    if args.out:
        Path(args.out).write_text(json.dumps({"runs": [r["name"] for r in runs], "folds": args.folds,
                                              "seeds": args.seeds, "pca": args.pca, "results": res}, indent=2))
        print(f"\nsaved {args.out}")


if __name__ == "__main__":
    main()
