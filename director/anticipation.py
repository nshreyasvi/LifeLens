from __future__ import annotations

from collections import deque
from math import isfinite
from typing import Any, Protocol

from .features import STILL_SPEED_M_S, is_still_speed
from .schemas import Prediction


class Predictor(Protocol):
    def predict(self, features: Any) -> dict[str, Any]: ...


class FreezePredictor:
    """Freeze detection from the whole 3D body, against the person's own movement (no fixed score):
    moving level = the 80th percentile of whole-body motion (wrists, ankles, pelvis) over the previous 4 s;
    drop = how far the motion of the last 0.3 s fell below that level; still = how long it has stayed under a quarter
    of it. Score = drop x min(1, still / 0.8 s). The fast loop pre-arms when the score passes its threshold, which rises
    after each false trigger."""

    def __init__(self, *, lookback_s: float = 4.0, recent_s: float = 0.3, still_fraction: float = 0.25,
                 full_after_s: float = 0.8, report_from: float = 0.5, cancel_cooldown_s: float = 3.0):
        self.lookback_s, self.recent_s = lookback_s, recent_s
        self.still_fraction, self.full_after_s, self.report_from = still_fraction, full_after_s, report_from
        self.cancel_cooldown_s = cancel_cooldown_s
        self.history: deque[tuple[float, float]] = deque()
        self.still_since_s: float | None = None
        self.cooldown_until_s = float("-inf")

    def on_cancel(self, time_s: float) -> None:
        self.cooldown_until_s = max(self.cooldown_until_s, time_s + self.cancel_cooldown_s)

    def predict(self, features: Any) -> dict[str, Any]:
        get = (lambda k: getattr(features, k)) if hasattr(features, "time_s") else features.__getitem__
        t, motion = float(get("time_s")), float(get("motion"))
        if not isfinite(t) or not isfinite(motion) or motion < 0:
            return Prediction().model_dump()
        self.history.append((t, motion))
        while self.history and self.history[0][0] < t - self.lookback_s - self.recent_s:
            self.history.popleft()
        before = sorted(m for s, m in self.history if s < t - self.recent_s)
        recent = [m for s, m in self.history if s >= t - self.recent_s]
        if len(before) < 10 or not recent:
            return Prediction().model_dump()
        level = before[int(0.8 * (len(before) - 1))]
        now = sum(recent) / len(recent)
        if level <= 1e-6:                    # no movement to freeze from
            self.still_since_s = None
            return Prediction().model_dump()
        if now < self.still_fraction * level:
            self.still_since_s = t if self.still_since_s is None else self.still_since_s
        else:
            self.still_since_s = None
        held = 0.0 if self.still_since_s is None else t - self.still_since_s
        prob = max(0.0, 1.0 - now / level) * min(1.0, held / self.full_after_s)
        if prob >= self.report_from and t >= self.cooldown_until_s:
            return Prediction(event="freeze", prob=round(prob, 3), eta_ms=1000).model_dump()
        return Prediction().model_dump()


class EnergyOnlyPredictor:
    """Conservative fallback for absent upstream fields; it never uses pose speed."""

    def __init__(self, *, peak_level: float = 0.75, rise_by: float = 0.25,
                 lookback_s: float = 0.5, cooldown_s: float = 2.0):
        self.peak_level = peak_level
        self.rise_by = rise_by
        self.lookback_s = lookback_s
        self.cooldown_s = cooldown_s
        self.samples: deque[tuple[float, float]] = deque()
        self.last_event_s = float("-inf")

    def predict(self, features: Any) -> dict[str, Any]:
        t = float(features.time_s if hasattr(features, "time_s") else features["time_s"])
        energy = float(features.energy if hasattr(features, "energy") else features["energy"])
        if not isfinite(t) or not isfinite(energy):
            return Prediction().model_dump()
        self.samples.append((t, energy))
        while self.samples and self.samples[0][0] < t - self.lookback_s:
            self.samples.popleft()
        previous = [value for stamp, value in self.samples if t - self.lookback_s <= stamp < t]
        baseline = sum(previous) / len(previous) if previous else energy
        if (energy >= self.peak_level and energy - baseline >= self.rise_by
                and t - self.last_event_s >= self.cooldown_s):
            self.last_event_s = t
            return Prediction(event="energy_peak", prob=0.75, eta_ms=0).model_dump()
        return Prediction().model_dump()


class AnticipationWebSocketPredictor:
    """Tolerant parser; missing or weak upstream output falls back to energy only."""

    def __init__(self, energy_fallback: Predictor | None = None):
        self.energy_fallback = energy_fallback or EnergyOnlyPredictor()

    def parse(self, payload: Any, features: Any) -> dict[str, Any]:
        try:
            if not isinstance(payload, dict):
                return self.energy_fallback.predict(features)
            anticipation = payload.get("anticipation") or {}
            activity = payload.get("activity") or {}
            if not isinstance(anticipation, dict) or not isinstance(activity, dict):
                return self.energy_fallback.predict(features)
            conf = float(activity.get("conf", 0.0))
            raw = Prediction(
                event=anticipation.get("event", "none"),
                prob=anticipation.get("prob", 0.0),
                eta_ms=anticipation.get("eta_ms", 0),
            )
            if not isfinite(conf) or conf < 0.5 or raw.prob < 0.5:
                return self.energy_fallback.predict(features)
            return raw.model_dump()
        except (AttributeError, TypeError, ValueError, OverflowError):
            return self.energy_fallback.predict(features)

    def predict(self, features: Any, payload: Any = None) -> dict[str, Any]:
        return self.parse(payload or {}, features)
