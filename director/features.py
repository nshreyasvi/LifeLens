from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable
import math

STILL_SPEED_M_S = 0.08


def is_still_speed(speed_m_s: float, threshold_m_s: float = STILL_SPEED_M_S) -> bool:
    """Use one speed comparison for the director's stillness checks."""
    return speed_m_s <= threshold_m_s


def energy_word(energy: float) -> str:
    """Map normalized director energy to the screen's shared low/medium/high words."""
    if energy < 0.34:
        return "low"
    if energy < 0.68:
        return "medium"
    return "high"


@dataclass(frozen=True)
class FrameFeatures:
    time_s: float
    zone: str
    energy: float
    speed_m_s: float
    pelvis_height_m: float
    trunk_lean: float
    posture_label: str
    narration: str
    floor_x: float
    floor_y: float

    @property
    def energy_word(self) -> str:
        return energy_word(self.energy)


def _distance(a: tuple[float, float], b: tuple[float, float]) -> float:
    return math.hypot(a[0] - b[0], a[1] - b[1])


def fit_zones(points: Iterable[tuple[float, float]], iterations: int = 50) -> list[tuple[float, float]]:
    """Fit three deterministic k-means centers to pelvis floor positions."""
    values = list(points)
    if not values:
        raise ValueError("clip has no pelvis floor positions")
    # Farthest-point seeding is repeatable and does not need a numeric library.
    centers = [values[0]]
    while len(centers) < min(3, len(values)):
        candidate = max(values, key=lambda p: min(_distance(p, c) for c in centers))
        centers.append(candidate)
    if len(centers) < 3:
        centers += [centers[-1]] * (3 - len(centers))
    for _ in range(iterations):
        groups: list[list[tuple[float, float]]] = [[], [], []]
        for point in values:
            idx = min(range(3), key=lambda i: _distance(point, centers[i]))
            groups[idx].append(point)
        updated = [
            (sum(x for x, _ in group) / len(group), sum(y for _, y in group) / len(group))
            if group else centers[i]
            for i, group in enumerate(groups)
        ]
        if max(_distance(a, b) for a, b in zip(centers, updated)) < 1e-6:
            centers = updated
            break
        centers = updated
    # Stable human labels: A, B, C from left to right in the clip's floor plane.
    return sorted(centers, key=lambda point: (point[0], point[1]))


def zone_for(point: tuple[float, float], centers: list[tuple[float, float]]) -> str:
    idx = min(range(len(centers)), key=lambda i: _distance(point, centers[i]))
    return "ABC"[idx]

