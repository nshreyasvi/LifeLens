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


def both(rule_label: str, muse_label: str) -> str:
    """The posture where the rules and Muse name the same one; 'unknown' where they differ (two sources can't vote)."""
    return rule_label if rule_label == muse_label else 'unknown'


def run_sources(run: str) -> dict:
    """Per-second labels of every source for one run, preserving existing mocap reference if present."""
    existing = json.load(open(f'{run}/postures.json', encoding='utf-8')) if os.path.exists(f'{run}/postures.json') else {}
    rules = [r['label'] for r in csv.DictReader(open(f'{run}/activity.csv', encoding='utf-8'))]
    n = len(rules)
    muse_path = f'{run}/posture_muse.json'
    out = {'rules': rules}
    if os.path.exists(muse_path):      # Muse's own labels only: 'unknown' where it gave none, never the rules' label
        out['muse'] = per_second(json.load(open(muse_path, encoding='utf-8')), n)
        out['combined'] = [both(r, m) for r, m in zip(rules, out['muse'])]
    mocap = existing.get('labels', {}).get('mocap')
    result = {'seconds': n, 'labels': out}
    if mocap and len(mocap) >= n:
        mocap = mocap[:n]
        out['mocap'] = mocap
        # mocap = the same rules on the motion-capture skeleton: it shares their thresholds, so it favors them
        result['agreement'] = {k: round(sum(a == b for a, b in zip(out[k], mocap)) / len(mocap), 3) for k in SOURCES if k in out}
        result['agreement']['always_standing'] = round(mocap.count('standing') / len(mocap), 3)
    # no motion capture (your own recordings): no agreement score, there is nothing to compare with
    return result


def main(argv):
    targets = argv or [os.path.join('examples', d) for d in sorted(os.listdir('examples'))]
    for run in targets:
        if os.path.isdir(run) and os.path.exists(f'{run}/activity.csv'):
            json.dump(run_sources(run), open(f'{run}/postures.json', 'w', encoding='utf-8'), separators=(',', ':'))
            print(run, 'written')


if __name__ == '__main__':
    main(sys.argv[1:])
