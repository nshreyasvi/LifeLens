"""Posture labels from Meta Muse Spark: one label per 5 s window of a processed clip, from the 3D body's numbers.

python -m director.posture_muse examples/office examples/outdoor examples/robothome

For each clip: one Muse call with a table of its 5 s windows (median walking speed, pelvis height as a share of the
standing height, knee flexion, trunk lean, from pose_timeseries.csv; plus the Qwen narration from narration.json).
Muse answers one label per window; writes <clip>/posture_muse.json [{start_s, end_s, label}]. The same six labels
as pipeline/insights.py's rules, which stay the offline fallback. The Muse key is read only from director/.env.
"""

from __future__ import annotations

import argparse
import csv
import json
import re
from pathlib import Path
from statistics import median

from .model_client import _muse

LABELS = ('walking', 'standing', 'sitting', 'crouching', 'bending', 'arms raised')
WINDOW_S = 5.0
CHUNK = 20  # windows per Muse call
PROMPT = """You label the body posture of a person filmed by a camera on their head. For each 5 s window below you get
numbers measured on a 3D body estimate of the person (medians over the window):
- speed: pelvis walking speed in m/s
- hip: pelvis height as a share of the person's standing pelvis height (1.0 = standing tall)
- knee: knee flexion in degrees (0 = straight leg)
- lean: trunk lean from vertical in degrees
and a short description of the video from a small video model (it can be wrong).
Pick the one posture that fits each window best, from: {labels}.
Answer with exactly one line per window, "<window number>: <posture>", and nothing else.

{rows}"""


def windows(clip: Path) -> list[dict]:
    rows = list(csv.DictReader(open(clip / 'pose_timeseries.csv', encoding='utf-8')))
    stand = sorted(float(r['pelvis_height_m']) for r in rows)[int(0.95 * (len(rows) - 1))]   # standing pelvis height
    narr_file = clip / 'narration_muse.json' if (clip / 'narration_muse.json').exists() else clip / 'narration.json'
    said = {round(n['start_s']): n['text'] for n in json.load(open(narr_file, encoding='utf-8'))} if narr_file.exists() else {}
    out: dict[int, list[dict]] = {}
    for r in rows:
        out.setdefault(int(float(r['time_s']) // WINDOW_S), []).append(r)
    result = []
    for w, rs in sorted(out.items()):
        def med(*cols: str) -> float:
            return median(sum(float(r[c]) for c in cols) / len(cols) for r in rs)
        result.append({'start_s': w * WINDOW_S, 'end_s': round(float(rs[-1]['time_s']) + 1 / 30, 2),
                       'speed': med('speed_m_s'), 'hip': med('pelvis_height_m') / stand, 'knee': med('knee_l', 'knee_r'),
                       'lean': med('trunk_lean'), 'said': said.get(round(w * WINDOW_S), '')})
    return result


def build_prompt(ws: list[dict]) -> str:
    rows = '\n'.join(f"{i + 1}. speed {w['speed']:.2f}, hip {w['hip']:.2f}, knee {w['knee']:.0f}, lean {w['lean']:.0f}; "
                     f"video: {w['said'] or 'no description'}" for i, w in enumerate(ws))
    return PROMPT.format(labels=', '.join(LABELS), rows=rows)


def parse(text: str, n: int) -> list[str]:
    """Labels by window number; a window the reply skips or mislabels is 'unknown'."""
    labels = ['unknown'] * n
    for m in re.finditer(r'^\s*(\d+)\s*[:.)-]\s*([a-z ]+?)\s*$', text.lower(), re.M):
        i, label = int(m.group(1)) - 1, m.group(2).strip()
        if 0 <= i < n and label in LABELS:
            labels[i] = label
    return labels


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument('clips', nargs='+', help='Processed clip folders (pose_timeseries.csv, narration.json).')
    a = parser.parse_args(argv)
    for clip in map(Path, a.clips):
        ws = windows(clip)
        labels = []
        for i in range(0, len(ws), CHUNK):     # long clips in parts: one 54-window prompt timed out
            part = ws[i:i + CHUNK]
            labels += parse(_muse(build_prompt(part), max_calls=10 ** 6), len(part))
        out = [{'start_s': w['start_s'], 'end_s': w['end_s'], 'label': lab} for w, lab in zip(ws, labels)]
        (clip / 'posture_muse.json').write_text(json.dumps(out, indent=1), encoding='utf-8')
        print(f"{clip.name}: {len(ws)} windows, {labels.count('unknown')} unanswered:", ' '.join(labels))


if __name__ == '__main__':
    main()
