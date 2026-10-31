"""Loader for Shrey's OmniEgoCap output.

Expected `.npz` keys (agreed contract, adjust here when the real file arrives):
    joints : (T, J, 3) float, metres, world frame (y-up)
    t      : (T,) float seconds   -- or --   fps : scalar
    joint_names (optional) : (J,) str
SMPL-X parameter files must be converted to joints first (smplx forward pass).
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np


@dataclass
class PoseSequence:
    t: np.ndarray  # (T,)
    joints: np.ndarray  # (T, J, 3)
    joint_names: list[str] | None = None

    @property
    def fps(self) -> float:
        return float(1.0 / np.median(np.diff(self.t))) if len(self.t) > 1 else 0.0

    def slice(self, t0: float, t1: float) -> PoseSequence:
        m = (self.t >= t0) & (self.t <= t1)
        names = self.joint_names
        return PoseSequence(self.t[m], self.joints[m], names)


def load_pose(path: str) -> PoseSequence:
    # No pickle: pose files come from teammates; save joint_names as a str array, not objects.
    data = np.load(path, allow_pickle=False)
    joints = np.asarray(data["joints"], dtype=np.float32)
    if joints.ndim != 3 or joints.shape[-1] != 3:
        raise ValueError(f"joints must be (T, J, 3), got {joints.shape}")
    if "t" in data:
        t = np.asarray(data["t"], dtype=np.float64)
    elif "fps" in data:
        t = np.arange(len(joints)) / float(data["fps"])
    else:
        raise ValueError("pose file needs either 't' or 'fps'")
    names = [str(n) for n in data["joint_names"]] if "joint_names" in data else None
    return PoseSequence(t, joints, names)
