from __future__ import annotations

import unicodedata
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


class Prediction(BaseModel):
    model_config = ConfigDict(extra="ignore")

    event: Literal["freeze", "energy_peak", "none"] = "none"
    prob: float = Field(default=0.0, ge=0.0, le=1.0)
    eta_ms: int = Field(default=0, ge=0)


class SlowSuggestion(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    mood: Literal["calm", "curious", "joyful", "tense", "powerful"]
    scene: Literal["wash", "spotlight", "silhouette", "color_field"]
    bpm: int = Field(ge=60, le=180)
    stem: Literal["ambient", "pulse", "percussion", "drone"]
    shader: Literal["soft_glow", "grain", "ripple", "none"]
    color: str = Field(pattern=r"^#[0-9A-Fa-f]{6}$")
    reason: str = Field(min_length=1, max_length=180)

    @field_validator("reason")
    @classmethod
    def short_plain_reason(cls, value: str) -> str:
        value = " ".join(value.split())
        if any(unicodedata.category(char) in {"Cc", "Cf"} for char in value):
            raise ValueError("reason must not contain control or formatting characters")
        if any(mark in value for mark in ("[", "]", "<", ">")):
            raise ValueError("reason must be plain human-readable text")
        if len(value.split()) > 16 or value.count(".") > 1:
            raise ValueError("reason must be one short sentence")
        if value[-1] not in ".!?":
            value += "."
        return value


class ScreenMessage(BaseModel):
    """The front-end's sample fields plus director fields."""

    id: int
    time: str
    energy: Literal["low", "medium", "high"]
    action: Literal["dim", "change_color", "flash_light"]
    music_tempo: int = Field(ge=60, le=180)
    phase: Literal["prearm", "fire", "cancel", "set", "end"]
    cue: Literal["dim", "blackout", "flash", "color"]
    intensity: float = Field(ge=0.0, le=1.0)
    color: str = Field(pattern=r"^#[0-9A-Fa-f]{6}$")
    zone: Literal["A", "B", "C"]
    mood: str
    source: Literal["fast", "slow"]
    reason: str
    log: str
    speed: float = 0.0
    posture_label: str = "unknown"
    prediction_event: Literal["freeze", "energy_peak", "none"] = "none"
    prediction_prob: float = Field(default=0.0, ge=0.0, le=1.0)
    scene: Literal["wash", "spotlight", "silhouette", "color_field"] = "wash"
    stem: Literal["ambient", "pulse", "percussion", "drone"] = "ambient"
    shader: Literal["soft_glow", "grain", "ripple", "none"] = "soft_glow"
    model_summary: str = Field(default="", max_length=1000)
    model_decision: str = Field(default="", max_length=200)

