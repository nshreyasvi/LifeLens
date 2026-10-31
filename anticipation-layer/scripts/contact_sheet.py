"""Grid of timestamped thumbnails (one every N seconds) for labelling a video by eye.

    python scripts/contact_sheet.py omniegodb/gopro/office_640.mp4 --every 5 --out runs/office/sheet.png
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import numpy as np
from PIL import Image, ImageDraw

from anticipation.io.video_source import read_video


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("video")
    ap.add_argument("--every", type=float, default=5.0)
    ap.add_argument("--offset", type=float, default=2.5, help="sample the middle of each slot")
    ap.add_argument("--cols", type=int, default=8)
    ap.add_argument("--width", type=int, default=240)
    ap.add_argument("--start", type=float, default=0.0)
    ap.add_argument("--end", type=float, default=float("inf"))
    ap.add_argument("--out", required=True)
    args = ap.parse_args()

    thumbs, next_t = [], args.start + args.offset
    for t, img in read_video(args.video, max_side=args.width):
        if t > args.end:
            break
        if t + 1e-6 < next_t:
            continue
        im = Image.fromarray(img)
        d = ImageDraw.Draw(im)
        s0 = next_t - args.offset
        label = f"{s0:.0f}s" if args.every < 2 else f"{s0:.0f}-{s0 + args.every:.0f}s"
        d.rectangle([0, 0, 8 * len(label) + 6, 16], fill=(0, 0, 0))
        d.text((3, 2), label, fill=(255, 255, 0))
        thumbs.append(np.asarray(im))
        next_t += args.every
    h, w = thumbs[0].shape[:2]
    rows = (len(thumbs) + args.cols - 1) // args.cols
    sheet = np.zeros((rows * h, args.cols * w, 3), np.uint8)
    for i, th in enumerate(thumbs):
        r, c = divmod(i, args.cols)
        sheet[r * h : r * h + th.shape[0], c * w : c * w + th.shape[1]] = th
    Path(args.out).parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(sheet).save(args.out)
    print(f"{len(thumbs)} thumbnails -> {args.out}")


if __name__ == "__main__":
    main()
