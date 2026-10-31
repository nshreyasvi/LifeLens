"""Movement features from 3D joints (preferred) or from ego-video motion (fallback).

Energy follows Ek = 1/2 * sum(v^2) with unit mass per joint, averaged over joints.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np


@dataclass
class KinFeatures:
    t: np.ndarray  # (M,) timestamps of the energy series
    energy: np.ndarray  # (M,) raw per-frame energy
    velocity: float  # mean speed over the window
    cadence_hz: float  # dominant rhythm, 0 if none
    source: str  # "pose" | "video"


def pose_features(t: np.ndarray, joints: np.ndarray) -> KinFeatures:
    """t: (T,), joints: (T, J, 3) metres."""
    if len(t) < 3:
        return KinFeatures(t, np.zeros(len(t)), 0.0, 0.0, "pose")
    dt = np.diff(t)[:, None, None]
    vel = np.diff(joints, axis=0) / np.maximum(dt, 1e-6)  # (T-1, J, 3)
    speed = np.linalg.norm(vel, axis=-1)  # (T-1, J)
    energy = 0.5 * (speed**2).mean(axis=1)
    tm = 0.5 * (t[1:] + t[:-1])
    return KinFeatures(tm, energy, float(speed.mean()), dominant_frequency(tm, energy), "pose")


def video_motion_features(t: np.ndarray, frames: np.ndarray, size: int = 64) -> KinFeatures:
    """Cheap motion proxy: mean absolute grey-level change between consecutive frames.
    For an ego camera this mostly measures head/body motion."""
    grey = frames[..., :3].astype(np.float32) @ np.array([0.299, 0.587, 0.114], np.float32)
    h, w = grey.shape[1:]
    sy, sx = max(h // size, 1), max(w // size, 1)
    small = grey[:, ::sy, ::sx] / 255.0
    diff = np.abs(np.diff(small, axis=0)).mean(axis=(1, 2))  # (N-1,)
    dt = np.maximum(np.diff(t), 1e-6)
    rate = diff / dt
    energy = 0.5 * rate**2
    tm = 0.5 * (t[1:] + t[:-1])
    return KinFeatures(tm, energy, float(rate.mean()), dominant_frequency(tm, energy), "video")


def dominant_frequency(t: np.ndarray, x: np.ndarray, fmin: float = 0.5, fmax: float = 4.0, pad: int = 4) -> float:
    """Strongest periodicity in [fmin, fmax] Hz; 0 if the signal is flat or too short.
    Zero-padding (`pad`x) interpolates the spectrum so the peak isn't snapped to 1/duration steps."""
    if len(x) < 8 or np.allclose(x, x[0]):
        return 0.0
    fs = 1.0 / np.median(np.diff(t))
    x = x - x.mean()
    n = pad * len(x)
    spec = np.abs(np.fft.rfft(x * np.hanning(len(x)), n=n))
    freqs = np.fft.rfftfreq(n, 1.0 / fs)
    band = (freqs >= fmin) & (freqs <= min(fmax, fs / 2))
    if not band.any() or spec[band].max() < 1e-9:
        return 0.0
    i = int(np.argmax(spec[band]))
    if i == 0 or i == band.sum() - 1:
        return 0.0  # maximum on the band edge = low-frequency drift leaking in, not a rhythm
    return float(freqs[band][i])


PHASES = ("calm", "build", "peak", "release", "steady")


def energy_phase(energy: float, slope: float, calm: float = 0.12, high: float = 0.45, ramp: float = 0.6) -> str:
    """Show-language summary of the energy curve, for lighting cues.

    energy: window energy 0..1; slope: d(energy)/dt over the last 0.5 s (1/s).
    Describes the curve only; upcoming hits are in `anticipation`. Defaults come from the
    energy percentiles of one office clip (video source); retune on performance footage.
    """
    if energy < calm and abs(slope) < ramp:
        return "calm"
    if energy >= high and slope > -ramp:
        return "peak"
    if slope > ramp:
        return "build"
    if slope < -ramp:
        return "release"
    return "steady"


class RunningNormalizer:
    """Maps raw energy to 0..1 against a slowly decaying running peak, so the output
    adapts to each performer and camera without calibration."""

    def __init__(self, decay: float = 0.995, floor: float = 1e-6):
        self.decay = decay
        self.peak = floor

    def __call__(self, value: float) -> float:
        self.peak = max(self.peak * self.decay, value)
        return float(min(value / self.peak, 1.0))
