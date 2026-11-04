"""Posture labels from Meta Muse Spark: one label per 5 s window of a processed clip, from frames only.

python -m director.posture_muse examples/exercising examples/eating

For each clip: Muse sees two images per 5 s window, the rendered 3D body and the head camera at the window's middle
(<clip>/frames/body_<start>.jpg and pov_<start>.jpg, made by pipeline/body_frames.py), 4 windows per call, and answers
one label per window; writes <clip>/posture_muse.json [{start_s, end_s, label}]. Muse gets no numbers and no text
about the body: the measured numbers are for the lights, the songs and the reps. The same six labels as
pipeline/insights.py's rules. The Muse key is read only from director/.env.
"""

from __future__ import annotations

import argparse
import csv
import json
import re
from pathlib import Path

from .model_client import _muse

LABELS = ('walking', 'standing', 'sitting', 'crouching', 'bending', 'arms raised')
WINDOW_S = 5.0
CHUNK = 3  # windows per Muse call (two images each); 8 images timed out at 120 s
PROMPT = """You label the body posture of a person filmed by a camera on their head. For each window below there are
two images, in this order: the person's 3D body, reconstructed by LifeLens from that camera (its legs are estimated:
the camera never sees them), and the head camera itself, both at the window's middle.
Pick the one posture that fits each window best, from: {labels}.
Answer with exactly one line per window, "<window number>: <posture>", and nothing else.

{rows}"""


def clock(s: float) -> str:
    return f'{int(s // 60)}:{int(s % 60):02d}'


def windows(clip: Path) -> list[dict]:
    times = [float(r['time_s']) for r in csv.DictReader(open(clip / 'pose_timeseries.csv', encoding='utf-8'))]
    out = []
    for w in range(int(times[-1] // WINDOW_S) + (times[-1] % WINDOW_S >= 1)):
        start, end = w * WINDOW_S, min((w + 1) * WINDOW_S, round(times[-1] + 1 / 30, 2))
        out.append({'start_s': start, 'end_s': end, 'frame': clip / 'frames' / f'body_{int(start):04d}.jpg',
                    'pov': clip / 'frames' / f'pov_{int(start):04d}.jpg'})
    return out


def build_prompt(ws: list[dict]) -> str:
    rows = '\n'.join(f"{i + 1}. {clock(w['start_s'])}-{clock(w['end_s'])}: images {2 * i + 1} and {2 * i + 2}"
                     for i, w in enumerate(ws))
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
    parser.add_argument('clips', nargs='+', help='Processed clip folders (pose_timeseries.csv, frames/, narration_muse.json).')
    a = parser.parse_args(argv)
    for clip in map(Path, a.clips):
        ws = windows(clip)
        missing = [f.name for w in ws for f in (w['frame'], w['pov']) if not f.exists()]
        if missing:
            raise SystemExit(f'{clip}: frames missing ({missing[0]}...): run pipeline/body_frames.py --run {clip} first')
        labels = []
        for i in range(0, len(ws), CHUNK):
            part = ws[i:i + CHUNK]
            images = [f.read_bytes() for w in part for f in (w['frame'], w['pov'])]
            for attempt in range(3):              # Muse can time out on image-heavy calls: try again
                try:
                    labels += parse(_muse(build_prompt(part), max_calls=10 ** 6, images=images), len(part))
                    break
                except RuntimeError as err:
                    if attempt == 2:
                        raise SystemExit(f'{clip.name}: Muse did not answer windows {i + 1}-{i + len(part)}: {err}')
        out = [{'start_s': w['start_s'], 'end_s': w['end_s'], 'label': lab} for w, lab in zip(ws, labels)]
        (clip / 'posture_muse.json').write_text(json.dumps(out, indent=1), encoding='utf-8')
        print(f"{clip.name}: {len(ws)} windows, {labels.count('unknown')} unanswered:", ' '.join(labels))


if __name__ == '__main__':
    main()
