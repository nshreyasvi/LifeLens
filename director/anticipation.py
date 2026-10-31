from __future__ import annotations

from collections import deque
from math import isfinite
from typing import Any, Protocol

from .features import STILL_SPEED_M_S, is_still_speed
from .schemas import Prediction


class Predictor(Protocol):
    def predict(self, features: Any) -> dict[str, Any]: ...


class StubPredictor:
    """Local speed stand-in: report freeze detection after a sustained stop from movement."""

    def __init__(self, *, still_speed_m_s: float = STILL_SPEED_M_S, still_for_s: float = 0.8,
                 moving_speed_m_s: float = 0.25, moving_lookback_s: float = 4.0,
                 cancel_cooldown_s: float = 3.0):
        self.still_speed_m_s = still_speed_m_s
        self.still_for_s = still_for_s
        self.moving_speed_m_s = moving_speed_m_s
        self.moving_lookback_s = moving_lookback_s
        self.cancel_cooldown_s = cancel_cooldown_s
        self.last_moving_s: float | None = None
        self.still_since_s: float | None = None
        self.event_sent_for_still = False
        self.cooldown_until_s = float("-inf")

    def on_cancel(self, time_s: float) -> None:
        self.cooldown_until_s = max(self.cooldown_until_s, time_s + self.cancel_cooldown_s)

    def predict(self, features: Any) -> dict[str, Any]:
        t = float(features.time_s if hasattr(features, "time_s") else features["time_s"])
        speed = float(features.speed_m_s if hasattr(features, "speed_m_s") else features["speed_m_s"])
        if not isfinite(t) or not isfinite(speed) or speed < 0:
            return Prediction().model_dump()
        if speed >= self.moving_speed_m_s:
            self.last_moving_s = t
        if is_still_speed(speed, self.still_speed_m_s):
            if self.still_since_s is None:
                self.still_since_s = t
                self.event_sent_for_still = False
        else:
            self.still_since_s = None
            self.event_sent_for_still = False
        was_moving = (self.last_moving_s is not None and self.still_since_s is not None
                      and self.last_moving_s < self.still_since_s
                      and self.still_since_s - self.last_moving_s <= self.moving_lookback_s)
        sustained = (self.still_since_s is not None and
                     t - self.still_since_s >= self.still_for_s)
        if (was_moving and sustained and not self.event_sent_for_still
                and t >= self.cooldown_until_s):
            self.event_sent_for_still = True
            return Prediction(event="freeze", prob=0.82, eta_ms=1000).model_dump()
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
