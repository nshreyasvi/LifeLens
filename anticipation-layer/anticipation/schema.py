"""AnticipationFrame: the contract between the Anticipation Layer (Member A) and the
orchestrator (Member B). One frame is emitted per sliding window (~2 Hz)."""

from __future__ import annotations

import base64
import json
from dataclasses import asdict, dataclass, field

import numpy as np

SCHEMA_VERSION = "1.1"  # 1.1: kinematics.phase


@dataclass
class Activity:
    label: str = "unknown"
    conf: float = 0.0
    top3: list[tuple[str, float]] = field(default_factory=list)


@dataclass
class Kinematics:
    energy: float = 0.0  # normalised 0..1 movement energy
    velocity: float = 0.0  # mean joint speed (m/s) or motion proxy
    cadence_hz: float = 0.0  # dominant movement rhythm
    source: str = "video"  # "pose" when 3D joints were available, else "video"
    phase: str = "calm"  # "calm" | "build" | "peak" | "release" | "steady" (see energy_phase)


@dataclass
class Transition:
    score: float = 0.0  # 0..1, how different this window is from recent context
    is_change: bool = False


@dataclass
class Anticipation:
    event: str = "energy_peak"
    eta_ms: int | None = None  # None = no event expected within horizon
    prob: float = 0.0
    method: str = "trend"  # "rhythm" | "trend" (heuristics) or "learned" (GRU)


@dataclass
class AnticipationFrame:
    t_start: float
    t_end: float
    latency_ms: float = 0.0
    source: str = "video"
    activity: Activity = field(default_factory=Activity)
    kinematics: Kinematics = field(default_factory=Kinematics)
    transition: Transition = field(default_factory=Transition)
    anticipation: Anticipation = field(default_factory=Anticipation)
    embedding: np.ndarray | None = None
    version: str = SCHEMA_VERSION

    def to_dict(self, include_embedding: bool = True) -> dict:
        d = asdict(self)
        emb = d.pop("embedding")
        d["activity"]["top3"] = [[k, round(float(v), 4)] for k, v in self.activity.top3]
        if include_embedding and emb is not None:
            arr = np.asarray(emb, dtype=np.float16)
            d["embedding"] = {
                "dim": int(arr.shape[0]),
                "dtype": "float16",
                "b64": base64.b64encode(arr.tobytes()).decode("ascii"),
            }
        else:
            d["embedding"] = None
        return _round_floats(d)

    def to_json(self, include_embedding: bool = True) -> str:
        return json.dumps(self.to_dict(include_embedding))


def decode_embedding(payload: dict) -> np.ndarray:
    """Helper for consumers (Member B) to turn the b64 field back into a vector."""
    raw = base64.b64decode(payload["b64"])
    return np.frombuffer(raw, dtype=payload.get("dtype", "float16")).astype(np.float32)


def _round_floats(obj, nd: int = 4):
    if isinstance(obj, float):
        return round(obj, nd)
    if isinstance(obj, dict):
        return {k: _round_floats(v, nd) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_round_floats(v, nd) for v in obj]
    return obj
