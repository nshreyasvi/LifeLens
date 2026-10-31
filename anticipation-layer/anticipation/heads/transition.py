"""Detects activity/scene changes as jumps in V-JEPA embedding space."""

from __future__ import annotations

import math

import numpy as np


class TransitionDetector:
    """Compares each window embedding with an EMA of recent context.

    score: 0..1 (sigmoid of the z-scored cosine distance)
    is_change: z > z_thresh, at most once every `min_gap` windows
    """

    def __init__(self, ema: float = 0.7, z_thresh: float = 2.0, min_gap: int = 3, warmup: int = 4):
        self.ema = ema
        self.z_thresh = z_thresh
        self.min_gap = min_gap
        self.warmup = warmup
        self._ctx: np.ndarray | None = None
        self._dists: list[float] = []
        self._since_change = min_gap

    def update(self, emb: np.ndarray) -> tuple[float, bool, float]:
        """Returns (score, is_change, raw cosine distance)."""
        e = emb / (np.linalg.norm(emb) + 1e-8)
        if self._ctx is None:
            self._ctx = e
            return 0.0, False, 0.0
        dist = float(1.0 - np.dot(e, self._ctx / (np.linalg.norm(self._ctx) + 1e-8)))
        hist = self._dists[-50:]
        self._dists.append(dist)
        self._ctx = self.ema * self._ctx + (1 - self.ema) * e
        self._since_change += 1
        if len(hist) < self.warmup:
            return 0.0, False, dist
        mu, sd = float(np.mean(hist)), float(np.std(hist)) + 1e-6
        z = (dist - mu) / sd
        score = 1.0 / (1.0 + math.exp(-(z - self.z_thresh / 2)))
        is_change = z > self.z_thresh and self._since_change >= self.min_gap
        if is_change:
            self._since_change = 0
        return score, is_change, dist
