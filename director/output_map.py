from __future__ import annotations

from datetime import timedelta
from typing import Any

from .features import energy_word
from .schemas import ScreenMessage

# All output field names live here, including the front-end's original sample keys.
OUTPUT_FIELDS = {
    "id": "id",
    "time": "time",
    "energy": "energy",
    "screen_action": "action",
    "music_tempo": "music_tempo",
    "phase": "phase",
    "cue": "cue",
    "intensity": "intensity",
    "color": "color",
    "zone": "zone",
    "mood": "mood",
    "source": "source",
    "reason": "reason",
    "log": "log",
    "speed": "speed",
    "posture_label": "posture_label",
    "prediction_event": "prediction_event",
    "prediction_prob": "prediction_prob",
    "scene": "scene",
    "stem": "stem",
    "shader": "shader",
    "model_summary": "model_summary",
    "model_decision": "model_decision",
}

LEGACY_ACTION = {"dim": "dim", "blackout": "dim", "flash": "flash_light", "color": "change_color"}
ZONE_COLORS = {"A": "#3977FF", "B": "#9A55E8", "C": "#FF6347"}


def make_message(
    *, msg_id: int, time_s: float, energy: float, phase: str, cue: str, intensity: float,
    zone: str, mood: str, bpm: int, source: str, reason: str, color: str | None = None,
    scene: str = "wash", stem: str = "ambient", shader: str = "soft_glow",
    model_summary: str = "", model_decision: str = "",
) -> dict[str, Any]:
    color = color or ZONE_COLORS.get(zone, ZONE_COLORS["A"])
    clock = str(timedelta(seconds=max(0, int(time_s))))
    if "." not in clock:
        clock = f"{clock}.{int((time_s % 1) * 1000):03d}"
    payload = {
        OUTPUT_FIELDS["id"]: msg_id,
        OUTPUT_FIELDS["time"]: clock,
        OUTPUT_FIELDS["energy"]: energy_word(energy),
        OUTPUT_FIELDS["screen_action"]: LEGACY_ACTION[cue],
        OUTPUT_FIELDS["music_tempo"]: max(60, min(180, int(bpm))),
        OUTPUT_FIELDS["phase"]: phase,
        OUTPUT_FIELDS["cue"]: cue,
        OUTPUT_FIELDS["intensity"]: max(0.0, min(1.0, round(float(intensity), 3))),
        OUTPUT_FIELDS["color"]: color,
        OUTPUT_FIELDS["zone"]: zone,
        OUTPUT_FIELDS["mood"]: mood,
        OUTPUT_FIELDS["source"]: source,
        OUTPUT_FIELDS["reason"]: reason,
        OUTPUT_FIELDS["log"]: reason,
        OUTPUT_FIELDS["speed"]: 0.0,
        OUTPUT_FIELDS["posture_label"]: "unknown",
        OUTPUT_FIELDS["prediction_event"]: "none",
        OUTPUT_FIELDS["prediction_prob"]: 0.0,
        OUTPUT_FIELDS["scene"]: scene,
        OUTPUT_FIELDS["stem"]: stem,
        OUTPUT_FIELDS["shader"]: shader,
        OUTPUT_FIELDS["model_summary"]: model_summary,
        OUTPUT_FIELDS["model_decision"]: model_decision,
    }
    return ScreenMessage.model_validate(payload).model_dump()

