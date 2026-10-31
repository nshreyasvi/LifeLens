"""Few-shot activity recognition: nearest prototype in V-JEPA embedding space.

Build a bank from a handful of labelled clips (scripts/build_prototypes.py); no training.
"""

from __future__ import annotations

import numpy as np


class PrototypeBank:
    def __init__(self, temperature: float = 0.05):
        self.temperature = temperature
        self._sums: dict[str, np.ndarray] = {}
        self._counts: dict[str, int] = {}

    def __len__(self) -> int:
        return len(self._sums)

    def add(self, label: str, emb: np.ndarray) -> None:
        e = _unit(emb)
        self._sums[label] = self._sums.get(label, 0) + e
        self._counts[label] = self._counts.get(label, 0) + 1

    def classify(self, emb: np.ndarray) -> tuple[str, float, list[tuple[str, float]]]:
        if not self._sums:
            return "unknown", 0.0, []
        labels = list(self._sums)
        protos = np.stack([_unit(self._sums[k]) for k in labels])
        if protos.shape[1] != np.shape(emb)[-1]:
            raise ValueError(f"bank has {protos.shape[1]}-d prototypes, got {np.shape(emb)[-1]}-d "
                             "descriptor: rebuild it with scripts/build_prototypes.py")
        sims = protos @ _unit(emb)
        logits = sims / self.temperature
        p = np.exp(logits - logits.max())
        p /= p.sum()
        order = np.argsort(-p)
        top = [(labels[i], float(p[i])) for i in order[:3]]
        return top[0][0], top[0][1], top

    def save(self, path: str) -> None:
        labels = list(self._sums)
        np.savez(
            path,
            labels=np.array(labels, dtype=str),
            sums=np.stack([self._sums[k] for k in labels]),
            counts=np.array([self._counts[k] for k in labels]),
        )

    @classmethod
    def load(cls, path: str, temperature: float = 0.05) -> PrototypeBank:
        data = np.load(path, allow_pickle=False)
        bank = cls(temperature)
        for label, s, c in zip(data["labels"], data["sums"], data["counts"]):
            bank._sums[str(label)] = s
            bank._counts[str(label)] = int(c)
        return bank


def descriptor(pooled: np.ndarray, dynamic: np.ndarray | None = None) -> np.ndarray:
    """Activity descriptor: appearance (pooled) + motion (dynamic) V-JEPA features, each
    unit-normalised so neither dominates. Banks must be built and queried with the same form."""
    if dynamic is None:
        return _unit(pooled)
    return np.concatenate([_unit(pooled), _unit(dynamic)])


def _unit(x: np.ndarray) -> np.ndarray:
    x = np.asarray(x, dtype=np.float32)
    return x / (np.linalg.norm(x) + 1e-8)
