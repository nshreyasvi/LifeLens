"""How well do frozen V-JEPA embeddings recognise activities and catch changes?

labels.json: [{"t0": 0, "t1": 12.5, "label": "walking"}, ...]. Time not covered by a
segment (e.g. sitting down) is unlabelled and never scored.

Activity, two held-out protocols (prototype bank = class means of V-JEPA embeddings):
  strict   leave-one-segment-out: a whole segment is classified by a bank built from all
           other segments. Classes that occur in only one segment cannot be tested here.
  chunked  the timeline is cut into --chunk s blocks; each block is classified by a bank
           built from windows that do not overlap it (plus a --guard s margin). Tests every
           class, but neighbouring blocks share the same scene: the optimistic number.
Only windows lying fully inside one segment are scored. Baseline: majority class.

Transitions: each label change (including across an unlabelled gap) is caught if
`transition.is_change` fires between the end of the old segment and --delay s after the
start of the new one.

Writes <run>/frames_heldout.jsonl (activity = chunked held-out prediction, so demo renders
show honest labels) and <run>/activity_eval.json. Optional --bank saves a bank from all labels.

    python scripts/eval_activity.py runs/office data/labels/S04_office_3.json --bank models/office_bank.npz
"""

from __future__ import annotations

import argparse
import json
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import numpy as np

from anticipation.heads.activity import PrototypeBank, descriptor


def heldout_predict(pooled, t_end, labels, scored, units, guard, window):
    """units: list of (t0, t1). Windows ending inside a unit are classified by a bank built
    from scored windows that do not overlap the unit's time span (plus `guard` s)."""
    pred = np.array([""] * len(t_end), dtype=object)
    conf = np.zeros(len(t_end))
    top3: list = [[] for _ in t_end]
    for t0, t1 in units:
        test = (t_end > t0) & (t_end <= t1)
        if not test.any():
            continue
        train = scored & ((t_end <= t0 - window - guard) | (t_end - window >= t1 + guard))
        bank = PrototypeBank()
        for j in np.where(train)[0]:
            bank.add(labels[j], pooled[j])
        for j in np.where(test)[0]:
            pred[j], conf[j], top3[j] = bank.classify(pooled[j])
    return pred, conf, top3


def report(name, pred, labels, mask, classes):
    m = mask & (pred != "")
    acc = float((pred[m] == labels[m]).mean())
    per = {c: float((pred[m & (labels == c)] == c).mean()) for c in classes if (m & (labels == c)).any()}
    print(f"  {name:<34}{acc:>6.0%}   balanced {np.mean(list(per.values())):.0%}   ({m.sum()} windows)")
    return acc, per, m


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("run")
    ap.add_argument("labels")
    ap.add_argument("--window", type=float, default=2.0)
    ap.add_argument("--chunk", type=float, default=10.0)
    ap.add_argument("--guard", type=float, default=2.0)
    ap.add_argument("--delay", type=float, default=2.5)
    ap.add_argument("--desc", default="both", choices=["pooled", "dynamic", "both"],
                    help="descriptor for frames_heldout.jsonl and --bank (all available ones are reported)")
    ap.add_argument("--bank")
    args = ap.parse_args()

    run = Path(args.run)
    x = np.load(run / "extras.npz", allow_pickle=False)
    t_end = x["t_end"]
    descs = {"pooled": np.stack([descriptor(p) for p in x["pooled"]])}
    if "dynamic" in x.files and len(x["dynamic"]) == len(t_end):
        descs["dynamic"] = np.stack([descriptor(d) for d in x["dynamic"]])
        descs["both"] = np.stack([descriptor(p, d) for p, d in zip(x["pooled"], x["dynamic"])])
    if args.desc not in descs:
        raise SystemExit(f"--desc {args.desc}: this run has no dynamic features (re-run scripts/run.py)")
    rows = [json.loads(line) for line in (run / "frames.jsonl").read_text().splitlines()]
    segs = sorted(json.loads(Path(args.labels).read_text()), key=lambda s: s["t0"])

    def seg_of(t: float) -> int:
        for i, s in enumerate(segs):
            if s["t0"] <= t < s["t1"]:
                return i
        return -1

    a = np.array([seg_of(t - args.window + 1e-3) for t in t_end])
    b = np.array([seg_of(t - 1e-3) for t in t_end])
    scored = (a == b) & (a >= 0)
    labels = np.array([segs[i]["label"] if i >= 0 else "" for i in a], dtype=object)
    counts = Counter(labels[scored])
    classes = sorted(counts)
    maj_label, maj_n = counts.most_common(1)[0]
    print(f"activity: {scored.sum()} scored windows, {len(segs)} segments, classes "
          + ", ".join(f"{c} ({n})" for c, n in counts.items()))

    strict_units = [(s["t0"], s["t1"]) for s in segs]
    edges = np.arange(0.0, t_end[-1] + args.chunk, args.chunk)
    chunk_units = list(zip(edges[:-1], edges[1:]))  # blocked over the whole timeline, gaps included

    seg_count = Counter(s["label"] for s in segs)
    multi = np.array([seg_count[l] >= 2 for l in labels])
    print(f"  majority class ('{maj_label}')                         {maj_n / scored.sum():>5.0%}")
    results = {}
    for name, D in descs.items():
        p_s, _, _ = heldout_predict(D, t_end, labels, scored, strict_units, 0.0, args.window)
        p_c, c_c, t_c = heldout_predict(D, t_end, labels, scored, chunk_units, args.guard, args.window)
        acc_s, per_s, _ = report(f"{name:<8} strict (leave-segment-out)*", p_s, labels, scored & multi, classes)
        acc_c, per_c, _ = report(f"{name:<8} chunked ({args.chunk:.0f} s, {args.guard:.0f} s guard)", p_c, labels,
                                 scored, classes)
        results[name] = {"strict_accuracy": acc_s, "strict_per_class": per_s, "chunked_accuracy": acc_c,
                         "chunked_per_class": per_c, "pred": p_c, "conf": c_c, "top3": t_c}
    print("  * only classes seen in >= 2 segments: "
          + ", ".join(c for c in classes if seg_count[c] >= 2))
    sel = results[args.desc]
    p_chunk, c_chunk, t_chunk = sel["pred"], sel["conf"], sel["top3"]
    m_c = scored & (p_chunk != "")
    print(f"  chunked confusion, '{args.desc}' descriptor (rows = truth):")
    print("  " + " " * 13 + "".join(f"{c[:10]:>11}" for c in classes))
    for c in classes:
        m = m_c & (labels == c)
        print(f"  {c[:12]:<13}" + "".join(f"{int((p_chunk[m] == d).sum()):>11}" for d in classes))

    # transitions over label changes (gap-aware)
    spans = []
    for i in range(1, len(segs)):
        if segs[i]["label"] != segs[i - 1]["label"]:
            spans.append((segs[i - 1]["t1"], segs[i]["t0"] + args.delay))
    changes = np.array([r["t_end"] for r in rows if r["transition"]["is_change"]])
    caught = sum(1 for s0, s1 in spans if ((changes >= s0) & (changes <= s1)).any())
    near = np.array([any(s0 <= c <= s1 for s0, s1 in spans) for c in changes])
    covered = sum(s1 - s0 for s0, s1 in spans) / (t_end[-1] - t_end[0])
    print(f"\ntransitions: {len(spans)} label changes, {len(changes)} detected scene changes")
    print(f"  caught {caught}/{len(spans)}; precision {near.mean() if len(changes) else 0:.0%} "
          f"(random firing at the same rate: ~{covered:.0%})")

    with open(run / "frames_heldout.jsonl", "w") as f:
        for j, r in enumerate(rows):
            r = dict(r)
            if p_chunk[j]:  # every window, labelled or not, gets its held-out prediction
                r["activity"] = {"label": p_chunk[j], "conf": round(float(c_chunk[j]), 4),
                                 "top3": [[k, round(float(v), 4)] for k, v in t_chunk[j]]}
            f.write(json.dumps(r) + "\n")
    (run / "activity_eval.json").write_text(json.dumps({
        "classes": dict(counts), "majority": maj_n / int(scored.sum()),
        "descriptors": {k: {kk: vv for kk, vv in v.items() if kk not in ("pred", "conf", "top3")}
                        for k, v in results.items()},
        "label_changes": len(spans), "caught": caught, "detected_changes": len(changes),
        "change_precision": float(near.mean()) if len(changes) else 0.0, "chance_precision": covered}, indent=2))
    print(f"\nwrote {run / 'frames_heldout.jsonl'} (activity from '{args.desc}' descriptor)")

    if args.bank:
        bank = PrototypeBank()
        for j in np.where(scored)[0]:
            bank.add(labels[j], descs[args.desc][j])
        Path(args.bank).parent.mkdir(parents=True, exist_ok=True)
        bank.save(args.bank)
        print(f"saved bank ({len(bank)} labels) -> {args.bank}")


if __name__ == "__main__":
    main()
