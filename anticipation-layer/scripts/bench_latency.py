"""M0 gate: can V-JEPA 2 run in the slow loop on this GPU?

    python scripts/bench_latency.py --frames 16 --dtype fp16 fp32 --runs 5
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import numpy as np
import torch

from anticipation.encoders.video_vjepa import DEFAULT_MODEL, VJEPA2Encoder


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default=DEFAULT_MODEL)
    ap.add_argument("--frames", type=int, nargs="+", default=[8, 16])
    ap.add_argument("--dtype", nargs="+", default=["fp16", "fp32"])
    ap.add_argument("--runs", type=int, default=5)
    args = ap.parse_args()

    dev = torch.cuda.get_device_name(0) if torch.cuda.is_available() else "CPU"
    print(f"device: {dev}  torch {torch.__version__}  model {args.model}")
    rng = np.random.default_rng(0)
    for dtype in args.dtype:
        try:
            enc = VJEPA2Encoder(args.model, dtype=dtype)
        except Exception as e:  # noqa: BLE001
            print(f"[{dtype}] load failed: {e}")
            continue
        for n in args.frames:
            frames = rng.integers(0, 255, (n, 256, 256, 3), dtype=np.uint8)
            if torch.cuda.is_available():
                torch.cuda.reset_peak_memory_stats()
            try:
                enc.encode(frames)  # warm-up
                lat = [enc.encode(frames).latency_ms for _ in range(args.runs)]
                mem = torch.cuda.max_memory_allocated() / 2**20 if torch.cuda.is_available() else 0
                print(f"[{dtype}] {n:3d} frames: {np.median(lat):7.1f} ms median "
                      f"(min {min(lat):.1f})  peak VRAM {mem:.0f} MiB  -> max {1000/np.median(lat):.2f} Hz")
            except FloatingPointError as e:
                print(f"[{dtype}] {n:3d} frames: NaN output -> {e}")
            except torch.cuda.OutOfMemoryError:
                print(f"[{dtype}] {n:3d} frames: OUT OF MEMORY")
                torch.cuda.empty_cache()
        del enc
        torch.cuda.empty_cache()


if __name__ == "__main__":
    main()
