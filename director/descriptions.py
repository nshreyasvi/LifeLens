from __future__ import annotations

import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any


@dataclass(frozen=True)
class DamDescription:
    source: str
    start_s: float
    end_s: float
    text: str


@dataclass(frozen=True)
class DamSelection:
    source: str
    start_s: float
    end_s: float
    text: str
    reason: str


_SENTENCE = re.compile(r"(?<=[.!?])\s+")
_UNRELIABLE_BODY_PART = re.compile(
    r"\b(?:arms?|hands?|fingers?|feet|foot|legs?|knees?|limbs?)\b", re.IGNORECASE
)
_PERSON = re.compile(r"\b(?:person|figure|humanoid|performer|individual|wearer)\b", re.IGNORECASE)
_MOTION_OR_POSTURE = re.compile(
    r"\b(?:walk\w*|stand\w*|sit\w*|move\w*|motion|still\w*|rise\w*|turn\w*|posture|lean\w*)\b",
    re.IGNORECASE,
)
_INCOMPLETE_ENDING = re.compile(
    r"\b(?:and|or|with|of|in|to|at|by|from|the|a|an|its|their|which|that|as|while|when|"
    r"who|whom|whose|is|are|was|were|be|being|been|has|have|had|including|into|on|over|"
    r"under|toward|towards|for|but|because|if|than|then|through|during|upon)$",
    re.IGNORECASE,
)


def load_dam_descriptions(clip_dir: str | Path) -> list[DamDescription]:
    """Load only the inspected DAM list shape: [{start_s, end_s, text}, ...]."""
    directory = Path(clip_dir)
    records: list[DamDescription] = []
    for filename in ("dam_ego.json", "dam_pose.json", "dam_both.json"):
        path = directory / filename
        if not path.is_file():
            continue
        value: Any = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(value, list):
            continue
        source = path.stem.removeprefix("dam_")
        for row in value:
            if not isinstance(row, dict):
                continue
            try:
                start_s = float(row["start_s"])
                end_s = float(row["end_s"])
                text = row["text"]
            except (KeyError, TypeError, ValueError, OverflowError):
                continue
            if isinstance(text, str) and end_s > start_s:
                records.append(DamDescription(source, start_s, end_s, text))
    return records


def select_dam_description(records: list[DamDescription], time_s: float) -> DamSelection:
    matching = [record for record in records if record.start_s <= time_s < record.end_s]
    candidates: list[tuple[int, int, DamDescription, str]] = []
    source_order = {"both": 0, "pose": 1, "ego": 2}
    for record in matching:
        for sentence in _SENTENCE.split(" ".join(record.text.split())):
            clean = sentence.strip()
            if not clean or _UNRELIABLE_BODY_PART.search(clean):
                continue
            if clean[-1] not in ".!?" or _INCOMPLETE_ENDING.search(clean.rstrip(".!? ")):
                continue
            if not _PERSON.search(clean) or not _MOTION_OR_POSTURE.search(clean):
                continue
            word_count = len(clean.split())
            if word_count <= 35:
                candidates.append((word_count, source_order.get(record.source, 9), record, clean))
    if not candidates:
        return DamSelection(
            source="none", start_s=time_s, end_s=time_s,
            text="No short performer-motion description was available for this window.",
            reason="Ignored camera-object text and descriptions mentioning uncertain limbs.",
        )
    _, _, record, sentence = min(candidates, key=lambda item: (item[0], item[1]))
    return DamSelection(
        source=record.source, start_s=record.start_s, end_s=record.end_s, text=sentence,
        reason=("Selected the shortest performer-motion sentence without arm, hand, leg, knee, "
                "or foot wording; camera-object-only sentences were not useful here."),
    )
