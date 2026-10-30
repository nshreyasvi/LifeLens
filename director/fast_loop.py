from __future__ import annotations

from collections import deque
from dataclasses import dataclass
from typing import Any

from .features import FrameFeatures, is_still_speed
from .output_map import ZONE_COLORS, make_message
from .schemas import Prediction

BASE_FREEZE_THRESHOLD = 0.70
MAX_FREEZE_THRESHOLD = 0.80
THRESHOLD_RECOVERY_S = 10.0


@dataclass
class PendingCheck:
    deadline_s: float
    restore_intensity: float


class FastLoop:
    def __init__(self, predictor: Any, *, bpm: int = 90, mood: str = "curious"):
        self.predictor = predictor
        self.bpm = bpm
        self.mood = mood
        self.intensity = 0.0
        self.base_threshold = BASE_FREEZE_THRESHOLD
        self.threshold = self.base_threshold
        self.last_cancel_s: float | None = None
        self.pending: PendingCheck | None = None
        self.msg_id = 0
        self.last_zone: str | None = None
        self.last_scene_change_s = -100.0
        self.active_slow_color: str | None = None
        self.scene = "wash"
        self.stem = "ambient"
        self.shader = "soft_glow"
        self.last_prediction: dict[str, Any] = {"event": "none", "prob": 0.0, "eta_ms": 0}
        self.flash_until_s: float | None = None
        self.last_flash_s = float("-inf")
        self.speed_history: deque[tuple[float, float]] = deque()
        self.locked_until_moving = False
        self.blackout_active = False
        self.blackout_restore_intensity = 0.0

    def _still_fraction(self, now: float) -> float:
        values = [speed for ts, speed in self.speed_history if now - 0.5 <= ts <= now]
        return sum(is_still_speed(v) for v in values) / len(values) if values else 0.0

    def _new_message(self, f: FrameFeatures, *, phase: str, cue: str, source: str,
                     reason: str, intensity: float | None = None, color: str | None = None) -> dict[str, Any]:
        self.msg_id += 1
        target = self.intensity if intensity is None else intensity
        # Cap ordinary per-message changes; blackout is the explicit fire exception.
        if cue != "blackout":
            max_jump = 0.20 if phase == "prearm" else 0.04
            target = max(self.intensity - max_jump, min(self.intensity + max_jump, target))
        self.intensity = max(0.0, min(1.0, target))
        return make_message(msg_id=self.msg_id, time_s=f.time_s, energy=f.energy, phase=phase,
                            cue=cue, intensity=self.intensity, zone=f.zone, mood=self.mood,
                            bpm=self.bpm, source=source, reason=reason, color=color,
                            scene=self.scene, stem=self.stem, shader=self.shader)

    def slow_message(self, features: FrameFeatures, state: Any) -> dict[str, Any]:
        """Publish a validated slow update; throttle color scene changes to 4 seconds."""
        self.mood = state.mood
        self.bpm = state.bpm
        self.scene = state.scene
        self.stem = state.stem
        self.shader = state.shader
        color_change_allowed = features.time_s - self.last_scene_change_s >= 4.0
        cue = "color" if color_change_allowed else "dim"
        if cue == "color":
            self.last_scene_change_s = features.time_s
            self.active_slow_color = state.color
        return self._new_message(features, phase="set", cue=cue, source="slow",
                                 reason=state.reason, intensity=self.intensity,
                                 color=self.active_slow_color or ZONE_COLORS[features.zone])

    def step(self, features: FrameFeatures) -> tuple[dict[str, Any], list[str]]:
        """Synchronous per-frame state step; no model, socket, or disk calls."""
        t = features.time_s
        if (self.last_cancel_s is not None
                and t - self.last_cancel_s >= THRESHOLD_RECOVERY_S):
            self.threshold = self.base_threshold
            self.last_cancel_s = None
        self.speed_history.append((t, features.speed_m_s))
        while self.speed_history and self.speed_history[0][0] < t - 1.1:
            self.speed_history.popleft()
        logs: list[str] = []
        if self.locked_until_moving and features.speed_m_s > 0.15:
            self.locked_until_moving = False

        # A pending freeze-detection check is evaluated at its one-second deadline.
        if self.pending and t >= self.pending.deadline_s:
            still = self._still_fraction(t) >= 0.70
            if still:
                reason = "The performer settled; the stage blacks out."
                self.blackout_active = True
                self.blackout_restore_intensity = self.pending.restore_intensity
                msg = self._new_message(features, phase="fire", cue="blackout", source="fast",
                                        reason=reason, intensity=0.0)
                logs.append("check: settled · BLACKOUT")
            else:
                self.threshold = min(MAX_FREEZE_THRESHOLD,
                                     round(self.threshold + 0.05, 2))
                self.last_cancel_s = t
                reason = "The performer kept moving; the false trigger was canceled and the threshold rose."
                msg = self._new_message(features, phase="cancel", cue="dim", source="fast",
                                        reason=reason, intensity=self.pending.restore_intensity)
                logs.append("check: still moving · cancel (false trigger; threshold +0.05)")
                notify_cancel = getattr(self.predictor, "on_cancel", None)
                if callable(notify_cancel):
                    notify_cancel(t)
            self.pending = None
            self.locked_until_moving = True
            return msg, logs

        if self.blackout_active:
            if features.speed_m_s > 0.15:
                self.blackout_active = False
                msg = self._new_message(
                    features, phase="set", cue="dim", source="fast",
                    reason="The performer moved again; the stage light returns.",
                    intensity=self.blackout_restore_intensity,
                )
                return msg, logs
            msg = self._new_message(
                features, phase="set", cue="blackout", source="fast",
                reason="The performer remains settled; the blackout holds until movement resumes.",
                intensity=0.0,
            )
            return msg, logs

        if self.flash_until_s is not None:
            if t < self.flash_until_s:
                return self._new_message(features, phase="set", cue="flash", source="fast",
                                         reason="Energy peaked; a brief stage flash is active.",
                                         intensity=self.intensity, color="#FFFFFF"), logs
            self.flash_until_s = None
            restore_color = self.active_slow_color or ZONE_COLORS[features.zone]
            self.last_scene_change_s = t
            self.last_zone = features.zone
            return self._new_message(features, phase="set", cue="color", source="fast",
                                     reason="The brief energy flash ended; the zone color returns.",
                                     intensity=self.intensity, color=restore_color), logs

        if self.pending:
            # Keep the pre-dim visible throughout the one-second verification window.
            msg = self._new_message(features, phase="prearm", cue="dim", source="fast",
                                    reason="I am checking whether the performer has settled.",
                                    intensity=self.intensity)
            return msg, logs

        prediction = Prediction.model_validate(self.predictor.predict(features))
        self.last_prediction = prediction.model_dump()
        if prediction.event == "energy_peak" and prediction.prob > self.threshold and t - self.last_flash_s >= 1.0:
            self.last_flash_s = t
            self.flash_until_s = t + 0.2
            msg = self._new_message(features, phase="set", cue="flash", source="fast",
                                    reason="Energy peaked; a brief stage flash is active.",
                                    intensity=self.intensity, color="#FFFFFF")
            return msg, logs
        if prediction.event == "freeze" and prediction.prob > self.threshold and not self.pending and not self.locked_until_moving:
            old = self.intensity
            reason = "A stop was detected; the lights pre-dim while I check for a freeze."
            msg = self._new_message(features, phase="prearm", cue="dim", source="fast",
                                    reason=reason, intensity=old * 0.8)
            self.pending = PendingCheck(deadline_s=t + 1.0, restore_intensity=old)
            logs.append("freeze detection: stop detected · pre-arm")
            return msg, logs

        zone_changed = self.last_zone is not None and features.zone != self.last_zone
        if zone_changed:
            self.last_scene_change_s = t
            reason = f"The performer moved into zone {features.zone}; the stage color follows."
            msg = self._new_message(features, phase="set", cue="color", source="fast",
                                    reason=reason, color=ZONE_COLORS[features.zone])
        else:
            target = features.energy
            # Smoothing gate prevents slow color/mood state from chattering.
            if t - self.last_scene_change_s >= 4.0:
                self.intensity += max(-0.04, min(0.04, target - self.intensity))
            reason = f"Energy is {features.energy_word}; the level follows the performer."
            msg = self._new_message(features, phase="set", cue="dim", source="fast",
                                    reason=reason, intensity=self.intensity)
        self.last_zone = features.zone
        return msg, logs

