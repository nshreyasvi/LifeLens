"""Decode a big camera file once into a small proxy (default 640 px, 15 fps, H.264).

4K HEVC decodes at ~50 fps on a laptop CPU; every later run (pipeline, show render)
reads the proxy instead. 640 px is also close to what a glasses live stream delivers.

    python scripts/make_proxy.py omniegodb/gopro/office.MP4 omniegodb/gopro/office_640.mp4
"""

from __future__ import annotations

import argparse
import sys
import time
from fractions import Fraction
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import av

from anticipation.io.video_source import probe, read_video


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("src")
    ap.add_argument("dst")
    ap.add_argument("--fps", type=int, default=15)
    ap.add_argument("--max-side", type=int, default=640)
    ap.add_argument("--crf", type=int, default=23)
    args = ap.parse_args()

    info = probe(args.src)
    print(f"source: {info}")
    out = av.open(args.dst, mode="w")
    stream = None
    t0, n = time.perf_counter(), 0
    for t, img in read_video(args.src, target_fps=args.fps, max_side=args.max_side):
        if stream is None:
            h, w = img.shape[:2]
            stream = out.add_stream("libx264", rate=args.fps)
            stream.width, stream.height = w - w % 2, h - h % 2
            stream.pix_fmt = "yuv420p"
            stream.time_base = Fraction(1, args.fps)
            stream.options = {"crf": str(args.crf), "preset": "veryfast"}
        frame = av.VideoFrame.from_ndarray(img[: stream.height, : stream.width], format="rgb24")
        frame.pts = n
        for pkt in stream.encode(frame):
            out.mux(pkt)
        n += 1
        if n % (args.fps * 30) == 0:
            print(f"  {t:6.1f} s  ({n / (time.perf_counter() - t0):.0f} frames/s)")
    for pkt in stream.encode():
        out.mux(pkt)
    out.close()
    print(f"wrote {args.dst}: {n} frames, {stream.width}x{stream.height} @ {args.fps} fps "
          f"in {time.perf_counter() - t0:.0f} s")


if __name__ == "__main__":
    main()
