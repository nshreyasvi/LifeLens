"""
Posture per second from 3D body rules and Meta Muse Spark, for the Routine view.

python bench/posture_sources.py runs/mine    # writes <run>/postures.json
"""

import csv
import json
import os
import sys
from collections import Counter

SOURCES = ('rules', 'muse', 'combined')


def per_second(windows: list, n: int) -> list:
    """Spread 5 s window labels over the clip's seconds."""
    out = ['unknown'] * n
    for w in windows:
        for s in range(int(w['start_s']), min(int(round(w['end_s'])), n)):
            out[s] = w['label']
    return out


def combine(rule_label: str, muse_label: str) -> str:
    return muse_label if muse_label and muse_label != 'unknown' and muse_label == rule_label else rule_label


def run_sources(run: str) -> dict:
    """Per-second labels of every source for one run, preserving existing mocap reference if present."""
    existing = json.load(open(f'{run}/postures.json', encoding='utf-8')) if os.path.exists(f'{run}/postures.json') else {}
    rules = [r['label'] for r in csv.DictReader(open(f'{run}/activity.csv', encoding='utf-8'))]
    n = len(rules)
    muse_path = f'{run}/posture_muse.json'
    muse = per_second(json.load(open(muse_path, encoding='utf-8')), n) if os.path.exists(muse_path) else rules
    out = {
        'rules': rules,
        'muse': [m if m != 'unknown' else r for r, m in zip(rules, muse)],
        'combined': [combine(r, m) for r, m in zip(rules, muse)],
    }
    mocap = existing.get('labels', {}).get('mocap')
    result = {'seconds': n, 'labels': out}
    if mocap and len(mocap) >= n:
        mocap = mocap[:n]
        out['mocap'] = mocap
        result['agreement'] = {k: round(sum(a == b for a, b in zip(out[k], mocap)) / len(mocap), 3) for k in SOURCES}
        result['agreement']['always_standing'] = round(mocap.count('standing') / len(mocap), 3)
    else:
        # Agreement between Muse Spark and 3D body rules when no external mocap exists
        agree = round(sum(a == b for a, b in zip(out['muse'], out['rules'])) / max(n, 1), 3)
        result['agreement'] = {'rules': 1.0, 'muse': agree, 'combined': 1.0,
                               'always_standing': round(rules.count('standing') / max(n, 1), 3)}
    return result


def main(argv):
    targets = argv or ['examples/office', 'examples/outdoor']
    for run in targets:
        if os.path.isdir(run) and os.path.exists(f'{run}/activity.csv'):
            json.dump(run_sources(run), open(f'{run}/postures.json', 'w', encoding='utf-8'), separators=(',', ':'))
            print(run, 'written')


if __name__ == '__main__':
    main(sys.argv[1:])
