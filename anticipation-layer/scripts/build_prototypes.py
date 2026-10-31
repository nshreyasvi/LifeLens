"""Build the few-shot activity bank (and fit the PCA projector) from labelled clips.

labels.json:
    [{"video": "clips/spin1.mp4", "label": "dance_spin"},
     {"video": "session.mp4", "label": "walk", "t0": 4.0, "t1": 9.0, "crop": [0, 0, 1120, 720]}]

    python scripts/build_prototypes.py labels.json --out models/
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import numpy as np

from anticipation.encoders.video_vjepa import VJEPA2Encoder
from anticipation.engine import _subsample
from anticipation.heads.activity import PrototypeBank, descriptor
from anticipation.io.frame_ring import FrameRing
from anticipation.io.video_source import Crop, read_video
from anticipation.projection import Projector


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("labels")
    ap.add_argument("--out", default="models")
    ap.add_argument("--fps", type=float, default=8.0)
    ap.add_argument("--dtype", default="auto")
    args = ap.parse_args()

    items = json.loads(Path(args.labels).read_text())
    enc = VJEPA2Encoder(dtype=args.dtype)
    bank, all_emb = PrototypeBank(), []
    for it in items:
        crop = Crop(*it["crop"]) if it.get("crop") else None
        t0, t1 = it.get("t0", 0.0), it.get("t1", float("inf"))
        ring = FrameRing(2.0, 1.0, args.fps)
        stream = ((t, f) for t, f in read_video(it["video"], args.fps, crop) if t0 <= t <= t1)
        n = 0
        for w in ring.windows(stream):
            emb = enc.encode(_subsample(w.frames, 8))  # same clip as engine default
            bank.add(it["label"], descriptor(emb.pooled, emb.dynamic))
            all_emb.append(emb.pooled)
            n += 1
        print(f"{it['label']:<14} {n:3d} windows  <- {it['video']}")

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    bank.save(str(out / "prototypes.npz"))
    Projector(64).fit(np.stack(all_emb)).save(str(out / "projector.npz"))
    print(f"saved {out/'prototypes.npz'} ({len(bank)} labels) and {out/'projector.npz'}")


if __name__ == "__main__":
    main()
