"""Video readers. Frames are yielded as (timestamp_s, HxWx3 uint8 RGB)."""

from __future__ import annotations

import time
from collections.abc import Iterator
from dataclasses import dataclass

import av
import numpy as np


@dataclass
class Crop:
    """Pixel crop applied before resizing. `side_by_side.mp4` uses Crop(0, 0, 1120, 720)
    to keep only the ego-video half."""

    x: int
    y: int
    w: int
    h: int


def read_video(
    path: str,
    target_fps: float | None = None,
    crop: Crop | None = None,
    max_side: int | None = 320,
    realtime: bool = False,
) -> Iterator[tuple[float, np.ndarray]]:
    """Decode `path`, optionally resample to `target_fps`, crop and downscale.

    realtime=True paces output at wall-clock speed to simulate a live camera.
    """
    container = av.open(path)
    stream = container.streams.video[0]
    stream.thread_type = "AUTO"
    next_t = 0.0
    wall0 = time.perf_counter()
    for frame in container.decode(stream):
        t = float(frame.pts * stream.time_base) if frame.pts is not None else next_t
        if target_fps is not None and t + 1e-6 < next_t:
            continue
        if crop is None and max_side is not None and max(frame.width, frame.height) > max_side:
            # scale inside swscale: ~4x faster than converting a full 4K frame to RGB first
            s = max_side / max(frame.width, frame.height)
            img = frame.to_ndarray(width=round(frame.width * s), height=round(frame.height * s), format="rgb24")
        else:
            img = frame.to_ndarray(format="rgb24")
            if crop is not None:
                img = img[crop.y : crop.y + crop.h, crop.x : crop.x + crop.w]
            if max_side is not None:
                img = _resize_max_side(img, max_side)
        if realtime:
            delay = t - (time.perf_counter() - wall0)
            if delay > 0:
                time.sleep(delay)
        yield t, img
        if target_fps is not None:
            next_t += 1.0 / target_fps
    container.close()


def probe(path: str) -> dict:
    with av.open(path) as c:
        s = c.streams.video[0]
        return {
            "width": s.codec_context.width,
            "height": s.codec_context.height,
            "fps": float(s.average_rate) if s.average_rate else None,
            "duration_s": float(c.duration / av.time_base) if c.duration else None,
            "frames": s.frames,
        }


def _resize_max_side(img: np.ndarray, max_side: int) -> np.ndarray:
    h, w = img.shape[:2]
    scale = max_side / max(h, w)
    if scale >= 1.0:
        return img
    nh, nw = int(round(h * scale)), int(round(w * scale))
    frame = av.VideoFrame.from_ndarray(img, format="rgb24").reformat(width=nw, height=nh)
    return frame.to_ndarray(format="rgb24")
