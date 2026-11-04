"""Routine review from Meta Muse Spark for one processed recording, compared with earlier recordings.

python -m director.routine_tips examples/exercising --history examples/stretching examples/eating

Reads <run>/insights.json (totals and the posture log: Muse's posture bouts with its caption of them) and
<run>/narration_muse.json (Muse's captions) when present; for each history run, its totals and what it shows the person
doing. Muse answers a JSON review, written into
<run>/insights.json as "report" (and its first three changes as "suggestions"). The key is read only from
director/.env, as for the slow loop.
"""

from __future__ import annotations

import argparse
import csv
import json
import os
from pathlib import Path

from .model_client import _extract_json, _muse

KEYS = ('summary', 'what_they_did', 'posture_and_movement', 'compared_with_history', 'improvements', 'went_well',
        'caveats')
PROMPT = """You give movement feedback on one recording of a person's day. It was filmed by a camera on their head.
LifeLens turned it into a 3D body estimate. Meta Muse Spark described frames of the video every 5 s and named a posture
for each 5 s (walking, standing, sitting, crouching, bending, arms raised) from a 3D body frame and a head-camera frame;
it can be wrong. The walking distance comes from the 3D body. Other recordings follow; they may be of other people, so compare routines,
not the person.

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
Posture bouts and what Muse saw:
{log}
Muse's captions every 5 s:
{captions}
{frames}

OTHER RECORDINGS
{history}"""


def clock(s: float) -> str:
    return f'{int(s // 60)}:{int(s % 60):02d}'


def totals_line(total: dict) -> str:
    m = total.get('minutes', {})
    parts = ', '.join(f'{k} {v} min' for k, v in m.items() if v)
    return (f"Recorded {total.get('duration_min')} min: {parts}. Walked {total.get('walking_distance_m')} m, "
            f"{total.get('sit_stand_transitions')} sit-downs, longest sit {total.get('longest_sitting_min')} min, "
            f"bent over {total.get('bent_over_min')} min.")


def build_prompt(run: Path, history: list[Path]) -> str:
    report = json.loads((run / 'insights.json').read_text(encoding='utf-8'))
    total = report['total']
    caps = run / 'narration_muse.json'
    captions = '\n'.join(f"{clock(c['start_s'])} {c['text']}" for c in json.loads(caps.read_text(encoding='utf-8'))
                         if not c['text'].startswith('[')) if caps.exists() else 'none'
    earlier = []
    for h in history:
        t = json.loads((h / 'insights.json').read_text(encoding='utf-8'))['total']
        earlier.append(f"- {h.name}: {totals_line(t)} What they did: {did(h)}")
    seen = frames_of(run)
    frames = (f"The images are this recording's 3D body (legs estimated) at {', '.join(clock(t) for t, _ in seen)}, "
              'in order: use them for posture and movement.') if seen else ''
    return PROMPT.format(name=run.name, duration=f"{total.get('duration_min')} min", totals=totals_line(total),
                         log=report.get('log', ''), captions=captions, frames=frames,
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
    parser.add_argument('run', help='Processed recording: insights.json and activity.csv.')
    parser.add_argument('--history', nargs='*', default=[], help='Earlier processed recordings to compare with.')
    parser.add_argument('--person', default='', help="The wearer, e.g. '178 cm, 75 kg, 30 years old': for the coaching.")
    a = parser.parse_args(argv)
    run, history = Path(a.run), [Path(h) for h in a.history]
    prompt = build_prompt(run, history) + (f'\n\nAbout the person: {a.person}.' if a.person else '')
    review = parse(_muse(prompt, max_calls=1, images=[j for _, j in frames_of(run)] or None))
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
