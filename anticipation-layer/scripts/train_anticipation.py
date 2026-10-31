"""Train the learned anticipator from one or more runs (scripts/run.py outputs).

Labels are self-supervised: peaks are found in each run's own energy curve, and a
window is positive for horizon h if a peak follows its end within h seconds.

    python scripts/train_anticipation.py runs/s1 runs/s2 --out models/anticipation.pt

Reports lead time: for every true peak, how early the model first fired.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import numpy as np
import torch
from torch import nn

from anticipation.heads.anticipation import HORIZONS_S, AnticipationGRU, find_peaks, peak_labels


def load_run(d: Path):
    x = np.load(d / "extras.npz", allow_pickle=False)
    peaks = find_peaks(x["energy_t"], x["energy"])
    return x["features"].astype(np.float32), peak_labels(x["t_end"], peaks), x["t_end"], peaks


def lead_times(t_end: np.ndarray, fired: np.ndarray, peaks: np.ndarray, max_lead: float = 1.0) -> list[float]:
    leads = []
    for p in peaks:
        m = fired & (t_end < p) & (t_end >= p - max_lead)
        if m.any():
            leads.append(float(p - t_end[m].min()))
    return leads


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("runs", nargs="+")
    ap.add_argument("--out", default="models/anticipation.pt")
    ap.add_argument("--epochs", type=int, default=300)
    ap.add_argument("--hidden", type=int, default=64)
    ap.add_argument("--val-frac", type=float, default=0.25)
    args = ap.parse_args()

    runs = [load_run(Path(r)) for r in args.runs]
    X_all = np.concatenate([r[0] for r in runs])
    mean, std = X_all.mean(0), X_all.std(0) + 1e-6
    print(f"{len(runs)} runs, {len(X_all)} windows, {sum(len(r[3]) for r in runs)} peaks, feat dim {X_all.shape[1]}")

    # time-ordered split inside each run: train on the start, validate on the end
    tr, va = [], []
    for X, Y, t, pk in runs:
        k = int(len(X) * (1 - args.val_frac))
        tr.append((X[:k], Y[:k]))
        va.append((X[k:], Y[k:], t[k:], pk[pk > t[k]] if k < len(t) else pk[:0]))

    model = AnticipationGRU(X_all.shape[1], args.hidden, len(HORIZONS_S))
    opt = torch.optim.AdamW(model.parameters(), lr=3e-3, weight_decay=1e-3)
    pos = np.concatenate([y for _, y in tr]).mean(0)
    loss_fn = nn.BCEWithLogitsLoss(pos_weight=torch.tensor((1 - pos) / np.maximum(pos, 1e-3), dtype=torch.float32))

    def tens(X):
        return torch.from_numpy((X - mean) / std).float()[None]

    for ep in range(args.epochs):
        model.train()
        opt.zero_grad()
        loss = sum(loss_fn(model(tens(X))[0], torch.from_numpy(Y)) for X, Y in tr if len(X))
        loss.backward()
        opt.step()
        if ep % 50 == 0 or ep == args.epochs - 1:
            print(f"epoch {ep:4d} loss {loss.item():.4f}")

    model.eval()
    all_leads, tp, fp, n_peaks = [], 0, 0, 0
    with torch.no_grad():
        for X, Y, t, pk in va:
            if not len(X):
                continue
            p = torch.sigmoid(model(tens(X))[0]).numpy()
            fired = (p >= 0.5).any(axis=1)
            all_leads += lead_times(t, fired, pk)
            tp += int((fired & (Y.max(1) > 0)).sum())
            fp += int((fired & (Y.max(1) == 0)).sum())
            n_peaks += len(pk)
    prec = tp / max(tp + fp, 1)
    print(f"\nvalidation: {len(all_leads)}/{n_peaks} peaks anticipated, window precision {prec:.2f}")
    if all_leads:
        print(f"lead time: median {np.median(all_leads)*1000:.0f} ms, mean {np.mean(all_leads)*1000:.0f} ms")

    Path(args.out).parent.mkdir(parents=True, exist_ok=True)
    torch.save(
        {
            "state_dict": model.state_dict(),
            "in_dim": int(X_all.shape[1]),
            "hidden": args.hidden,
            "horizons": list(HORIZONS_S),
            "feat_mean": torch.from_numpy(mean),
            "feat_std": torch.from_numpy(std),
            "threshold": 0.5,
        },
        args.out,
    )
    print(f"saved {args.out}")


if __name__ == "__main__":
    main()
