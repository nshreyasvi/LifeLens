"""Sliding-window buffer: turns a frame stream into fixed-length clips for V-JEPA 2."""

from __future__ import annotations

from collections import deque
from collections.abc import Iterable, Iterator
from dataclasses import dataclass

import numpy as np


@dataclass
class Window:
    t_start: float
    t_end: float
    timestamps: np.ndarray  # (N,)
    frames: np.ndarray  # (N, H, W, 3) uint8


class FrameRing:
    """Keeps the last `window_s` seconds of frames and emits a Window every `stride_s`.

    Frames should arrive at a steady rate (`fps`), which sets the clip length:
    window_s=2.0 at fps=8 gives 16-frame clips (8 V-JEPA tubelets of 2 frames).
    """

    def __init__(self, window_s: float = 2.0, stride_s: float = 0.5, fps: float = 8.0):
        self.window_s = window_s
        self.stride_s = stride_s
        self.fps = fps
        self.n_frames = int(round(window_s * fps))
        if self.n_frames % 2:
            self.n_frames += 1  # V-JEPA tubelet size is 2 frames
        self._buf: deque[tuple[float, np.ndarray]] = deque(maxlen=self.n_frames)
        self._next_emit: float | None = None

    def push(self, t: float, frame: np.ndarray) -> Window | None:
        self._buf.append((t, frame))
        if len(self._buf) < self.n_frames:
            return None
        if self._next_emit is None:
            self._next_emit = t
        if t + 1e-6 < self._next_emit:
            return None
        self._next_emit = t + self.stride_s
        ts = np.array([x[0] for x in self._buf])
        frames = np.stack([x[1] for x in self._buf])
        return Window(float(ts[0]), float(ts[-1]), ts, frames)

    def windows(self, stream: Iterable[tuple[float, np.ndarray]]) -> Iterator[Window]:
        for t, f in stream:
            w = self.push(t, f)
            if w is not None:
                yield w
