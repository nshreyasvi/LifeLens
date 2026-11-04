"""Routine review from Meta Muse Spark for one processed recording, compared with earlier recordings.

python -m director.routine_tips examples/robothome --history examples/office examples/outdoor

Reads <run>/insights.json (totals and the posture log: posture bouts with Qwen's narration of them),
<run>/postures.json (posture from the rules, Muse and Qwen) and <run>/narration_muse.json (Muse's captions) when
present; for each history run, its totals and what it shows the person doing. Muse answers a JSON review, written into
<run>/insights.json as "report" (and its first three changes as "suggestions"). The key is read only from
director/.env, as for the slow loop.
"""

from __future__ import annotations

import argparse
import csv
import json
import os
from collections import Counter
from pathlib import Path

from .model_client import _extract_json, _muse

KEYS = ('summary', 'what_they_did', 'posture_and_movement', 'compared_with_history', 'improvements', 'went_well',
        'caveats')
PROMPT = """You review one recording of a person's day for them, as a movement and daily-routine coach. It was filmed
by a camera on their head. LifeLens turned it into a 3D body estimate: a posture every second (walking, standing,
sitting, crouching, bending, arms raised) and the walking distance. Two models described the video every 5 s (Qwen3-VL
from the video, Meta Muse Spark from frames); either can be wrong. Earlier recordings of the same person follow.

Write a detailed, specific review as one JSON object with exactly these keys:
- "summary": 2-3 sentences on what this recording shows.
- "what_they_did": 5-8 strings in time order, each "m:ss-m:ss: what they did (posture)".
- "posture_and_movement": 3-5 observations, each with the numbers it rests on (minutes per posture, longest sit,
  distance, sit-downs, bending).
- "compared_with_history": 2-4 observations naming the earlier recordings they compare with.
- "improvements": 4-6 objects {{"change": short instruction starting with a verb, "why": the moment or number in this
  recording that calls for it, "how": a concrete way to do it during these exact activities}}.
- "went_well": 2-3 strings.
- "caveats": 1-2 strings on what the data cannot tell (model mistakes, a 3D estimate of legs that the camera never sees).
Rules: use only numbers and moments that appear below; no medical diagnosis or treatment; plain words; answer with the
JSON object only.

THIS RECORDING ({name}, {duration})
{totals}
Posture by source (share of the recording): {shares}
Posture bouts and what Qwen saw:
{log}
Muse's captions every 5 s:
{captions}

EARLIER RECORDINGS
{history}"""


def clock(s: float) -> str:
    return f'{int(s // 60)}:{int(s % 60):02d}'


def totals_line(total: dict) -> str:
    m = total.get('minutes', {})
    parts = ', '.join(f'{k} {v} min' for k, v in m.items() if v)
    return (f"Recorded {total.get('duration_min')} min: {parts}. Walked {total.get('walking_distance_m')} m, "
            f"{total.get('sit_stand_transitions')} sit-downs, longest sit {total.get('longest_sitting_min')} min, "
            f"bent over {total.get('bent_over_min')} min.")


def shares(run: Path) -> str:
    path = run / 'postures.json'
    if not path.exists():
        return 'rules only'
    labels = json.loads(path.read_text(encoding='utf-8'))['labels']
    out = []
    for src in ('rules', 'muse', 'qwen'):
        c = Counter(labels[src])
        out.append(f"{src}: " + ', '.join(f'{k} {round(100 * v / len(labels[src]))}%' for k, v in c.most_common() if k != 'unknown'))
    return '; '.join(out)


def did(run: Path, limit: int = 8) -> str:
    """What the narration shows, as distinct lines with their start time."""
    seen, out = set(), []
    for r in csv.DictReader(open(run / 'activity.csv', encoding='utf-8')):
        text = r['narration'].strip()
        if text and text not in seen:
            seen.add(text)
            out.append(f"{clock(int(r['second']))} {text}")
    step = max(1, len(out) // limit)
    return '; '.join(out[::step][:limit])


def build_prompt(run: Path, history: list[Path]) -> str:
    report = json.loads((run / 'insights.json').read_text(encoding='utf-8'))
    total = report['total']
    caps = run / 'narration_muse.json'
    captions = '\n'.join(f"{clock(c['start_s'])} {c['text']}" for c in json.loads(caps.read_text(encoding='utf-8'))
                         if not c['text'].startswith('[')) if caps.exists() else 'none'
    earlier = []
    for h in history:
        t = json.loads((h / 'insights.json').read_text(encoding='utf-8'))['total']
        earlier.append(f"- {h.name}: {totals_line(t)} Posture by source: {shares(h)}. What they did: {did(h)}")
    return PROMPT.format(name=run.name, duration=f"{total.get('duration_min')} min", totals=totals_line(total),
                         shares=shares(run), log=report.get('log', ''), captions=captions,
                         history='\n'.join(earlier) or 'none')


def parse(text: str) -> dict:
    review = _extract_json(text)
    missing = [k for k in KEYS if k not in review]
    if missing:
        raise ValueError(f'Muse review is missing {missing}')
    review['improvements'] = [i for i in review['improvements'] if isinstance(i, dict) and i.get('change')]
    if not review['improvements']:
        raise ValueError('Muse review has no usable improvements')
    return review


def main(argv: list[str] | None = None) -> dict:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument('run', help='Processed recording: insights.json, activity.csv (postures.json optional).')
    parser.add_argument('--history', nargs='*', default=[], help='Earlier processed recordings to compare with.')
    a = parser.parse_args(argv)
    run, history = Path(a.run), [Path(h) for h in a.history]
    prompt = build_prompt(run, history)
    review = parse(_muse(prompt, max_calls=1))
    review.update(provider='Meta Muse Spark', model=os.getenv('MUSE_MODEL', 'muse-spark-1.3'),
                  history=[h.name for h in history], prompt=prompt)  # the page shows what Muse read
    path = run / 'insights.json'
    report = json.loads(path.read_text(encoding='utf-8'))
    report['report'] = review
    report['suggestions'] = {'lines': [i['change'] for i in review['improvements'][:3]], 'provider': 'Meta Muse Spark',
                             'model': review['model'], 'earlier_days': len(history), 'sample_days': 0}
    path.write_text(json.dumps(report, indent=2), encoding='utf-8')
    print(review['summary'])
    return report


if __name__ == '__main__':
    main()
