"""Compresses 1024-d V-JEPA descriptors to a compact vector for the orchestrator."""

from __future__ import annotations

import numpy as np


class Projector:
    """PCA when fitted; otherwise block-average pooling (works with no data)."""

    def __init__(self, out_dim: int = 64):
        self.out_dim = out_dim
        self.mean: np.ndarray | None = None
        self.components: np.ndarray | None = None  # (out_dim, D)

    def fit(self, X: np.ndarray) -> Projector:
        X = np.asarray(X, dtype=np.float32)
        k = min(self.out_dim, X.shape[0], X.shape[1])
        self.mean = X.mean(axis=0)
        _, _, vt = np.linalg.svd(X - self.mean, full_matrices=False)
        self.components = vt[:k]
        return self

    def __call__(self, x: np.ndarray) -> np.ndarray:
        x = np.asarray(x, dtype=np.float32)
        if self.components is not None:
            return (x - self.mean) @ self.components.T
        d = x.shape[-1] - x.shape[-1] % self.out_dim
        return x[..., :d].reshape(*x.shape[:-1], self.out_dim, -1).mean(axis=-1)

    def save(self, path: str) -> None:
        np.savez(path, mean=self.mean, components=self.components, out_dim=self.out_dim)

    @classmethod
    def load(cls, path: str) -> Projector:
        d = np.load(path, allow_pickle=False)
        p = cls(int(d["out_dim"]))
        p.mean, p.components = d["mean"], d["components"]
        return p
