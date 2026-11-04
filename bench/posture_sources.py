"""
Posture per second from four sources, and how often each agrees with the motion capture, for the Routine tab.

conda activate mhr && python bench/posture_sources.py              # the three demos: each <clip>/postures.json + examples/day
conda activate mhr && python bench/posture_sources.py runs/mine    # any processed run (no motion capture: no agreement)

    rules     pipeline/insights.py's thresholds on the 3D body (the run's activity.csv)
    muse      Meta Muse Spark, one label per 5 s from the body's numbers and the narration (director/posture_muse.py)
    qwen      Qwen3-VL-2B, one label per 5 s from the head-camera video (pipeline/describe.py --ask posture)
    combined  per second, the label at least two of the three give; when all three differ, the rules' label
    mocap     the reference, OmniEgoDB demos only: the same rules on the motion-capture skeleton
              (bench/compare_descriptions.py). It shares the rules' thresholds, so it favors them: agreement is not
              accuracy.
"""

import csv
import json
import os
import sys
from collections import Counter

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
sys.path.insert(0, os.path.dirname(__file__))
from compare_descriptions import RUNS, gt_seconds  # noqa: E402

SOURCES = ('rules', 'muse', 'qwen', 'combined')


def per_second(windows: list, n: int) -> list:
    """Spread 5 s window labels over the clip's seconds."""
    out = ['unknown'] * n
    for w in windows:
        for s in range(int(w['start_s']), min(int(round(w['end_s'])), n)):
            out[s] = w['label']
    return out


def vote(*labels: str) -> str:
    label, count = Counter(labels).most_common(1)[0]
    return label if count >= 2 else labels[0]      # labels[0]: the rules


def run_sources(run: str, seq: str | None) -> dict:
    """Per-second labels of every source for one run, and their agreement with the motion capture if there is one."""
    rules = [r['label'] for r in csv.DictReader(open(f'{run}/activity.csv', encoding='utf-8'))]
    n = len(rules)
    load = lambda name: per_second(json.load(open(f'{run}/{name}')), n) if os.path.exists(f'{run}/{name}') else rules
    out = {'rules': rules, 'muse': load('posture_muse.json'), 'qwen': load('posture_qwen.json')}
    out['combined'] = [vote(*t) for t in zip(out['rules'], out['muse'], out['qwen'])]
    result = {'seconds': n, 'labels': out}
    if seq:
        mocap = gt_seconds(seq)[:n]
        out['mocap'] = mocap
        result['agreement'] = {k: round(sum(a == b for a, b in zip(out[k], mocap)) / len(mocap), 3) for k in SOURCES}
        result['agreement']['always_standing'] = round(mocap.count('standing') / len(mocap), 3)
    return result


def main(argv):
    if argv:
        for run in argv:
            json.dump(run_sources(run, None), open(f'{run}/postures.json', 'w'), separators=(',', ':'))
            print(run, 'written')
        return
    clips, hits, total = {}, Counter(), 0
    for run, seq in RUNS:
        r = run_sources(f'{ROOT}/examples/{run}', seq)
        for base in (f'{ROOT}/examples/{run}', f'{ROOT}/runs/{run}'):
            if os.path.isdir(base):
                json.dump(r, open(f'{base}/postures.json', 'w'), separators=(',', ':'))
        clips[run] = r['labels']
        for k in SOURCES:
            hits[k] += r['agreement'][k] * r['seconds']
        hits['always_standing'] += r['agreement']['always_standing'] * r['seconds']
        total += r['seconds']
        print(run, r['agreement'])
    agreement = {k: round(v / total, 3) for k, v in hits.items()}
    out = {'_comment': __doc__.strip().splitlines()[0], 'seconds': total, 'agreement': agreement, 'clips': clips}
    json.dump(out, open(f'{ROOT}/examples/day/postures.json', 'w'), separators=(',', ':'))
    print(f'{total} s; agreement with motion capture:', agreement)


if __name__ == '__main__':
    main(sys.argv[1:])
