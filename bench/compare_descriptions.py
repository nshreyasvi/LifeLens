"""
Compare the video descriptions (Qwen narration, Describe Anything on ego / pose / both) per 5 s window against
OmniEgoDB's motion capture: does a description name the wearer's posture, and is it the right one? Also: does it name an
activity, or only appearance, how long and how repetitive is it.

conda activate mhr && python bench/compare_descriptions.py [--old_dam DIR]

Reference posture per window: the majority of insights.py's per-second labels computed on the Xsens skeleton, with the
same rules as for our body. Keyword matching decides what a description names (POSTURE, ACTIVITY, APPEARANCE below), so
a paraphrase outside the lists counts as naming nothing. --old_dam DIR (DIR/<run>/dam_<source>.json from an earlier run)
adds how often two DAM runs on near-identical input name the same postures.
"""

import argparse
import json
import os
import re
import sys
import tempfile
from collections import Counter

import numpy as np

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
sys.path.insert(0, os.path.join(ROOT, 'pipeline'))
from insights import label_seconds  # noqa: E402
from render import pose_series  # noqa: E402

RUNS = (('office', 'S03_office_1'), ('outdoor', 'S04_outdoor_1'), ('robothome', 'S03_robothome_1'))
SOURCES = (('Qwen narration', 'narration.json'), ('DAM ego', 'dam_ego.json'), ('DAM pose', 'dam_pose.json'),
           ('DAM both', 'dam_both.json'))
POSTURE = {'walking': r'\b(walk\w*|strid\w*|strolling|pacing|stepp\w*)\b',
           'standing': r'\b(stand\w*|stood|upright)\b',
           'sitting': r'\b(sit|sits|sitting|seated|sat)\b',
           'crouching': r'\b(crouch\w*|squat\w*|kneel\w*|knelt)\b',
           'bending': r'\b(bend\w*|bent|lean(s|ing|ed)?|stoop\w*|bow(s|ing|ed)?)\b',
           'arms raised': r'\b(rais\w*\s+(\w+\s+)?arms?|arms?\s+(raised|up|overhead)|reach\w*\s+up)\b'}
ACTIVITY = (r'\b(open\w*|clos(e|es|ing)|pick\w*|pour\w*|hold\w*|held|put\w*|plac(e|es|ing)|watering|waters|cook\w*|'
            r'wash\w*|carr(y|ies|ying)|push\w*|press\w*|turn\w*|grab\w*|tak(e|es|ing)|took|cut\w*|stir\w*|wip(e|es|ing)|'
            r'clean\w*|typ(e|es|ing)|fill\w*|drink\w*|eat\w*|adjust\w*|throw\w*|fold\w*|hang\w*|lift\w*|drop\w*|'
            r'touch\w*|operat\w*|scoop\w*|reach\w*)\b')      # postures excluded: those are counted separately
APPEARANCE = (r'\b(white|black|gr[ae]y|silver|blue|red|green|yellow|brown|beige|pink|light-colored|dark|wooden|wood|'
              r'metal\w*|plastic|glass|fabric|textured?|glossy|matte|shiny|sleek|rectangular|cylindrical|round)\b')


def gt_seconds(seq: str) -> list:
    """Per-second posture labels from the Xsens skeleton, by the same rules (insights.label_seconds) as our body."""
    gt = np.load(f'{ROOT}/omniegodb/gopro/{seq}/gt.npz', allow_pickle=True)
    n = list(gt['segment_names'])
    P = lambda s: gt['segments'][:, n.index(s), :3, 3]
    J = np.repeat(P('Pelvis')[:, None], 22, 1)      # the SMPL-H joint slots the rules read, from segment origins
    for k, s in ((1, 'LeftUpperLeg'), (2, 'RightUpperLeg'), (4, 'LeftLowerLeg'), (5, 'RightLowerLeg'), (7, 'LeftFoot'),
                 (8, 'RightFoot'), (12, 'Neck'), (16, 'LeftUpperArm'), (17, 'RightUpperArm'), (18, 'LeftForeArm'),
                 (19, 'RightForeArm'), (20, 'LeftHand'), (21, 'RightHand')):
        J[:, k] = P(s)
    J[..., 2] -= np.percentile(np.minimum(P('LeftToe')[:, 2], P('RightToe')[:, 2]), 5) - 0.03   # toe origin ~3 cm up
    with tempfile.TemporaryDirectory() as d:
        os.makedirs(f'{d}/kinematics')
        np.save(f'{d}/kinematics/joints_world.npy', J.astype(np.float32))
        s = pose_series(J)
        np.savetxt(f'{d}/pose_timeseries.csv', np.column_stack([np.arange(len(J)) / 30] + list(s.values())),
                   delimiter=',', fmt='%.4f', header=','.join(['time_s'] + list(s)), comments='')
        return label_seconds(d)


def named(text: str) -> set:
    return {k for k, rx in POSTURE.items() if re.search(rx, text.lower())}


def first_named(text: str) -> str:
    """The posture named first: a single answer, so naming several postures earns no extra hits."""
    hits = {k: m.start() for k, rx in POSTURE.items() if (m := re.search(rx, text.lower()))}
    return min(hits, key=hits.get) if hits else ''


def majority(labels: list, start: float, window: float = 5.0) -> str:
    return Counter(labels[int(start):int(start + window)]).most_common(1)[0][0]


def main(a):
    rows = {name: [] for name, _ in SOURCES + (('pose numbers (our body)', None), ('always "standing"', None))}
    examples = []
    for run, seq in RUNS:
        ref, ours = gt_seconds(seq), label_seconds(f'{ROOT}/runs/{run}')
        texts = {name: {d['start_s']: d['text'] for d in json.load(open(f'{ROOT}/runs/{run}/{f}'))}
                 for name, f in SOURCES if os.path.exists(f'{ROOT}/runs/{run}/{f}')}
        for start in sorted(texts['Qwen narration']):
            if start + 1 > len(ref):
                continue
            truth = majority(ref, start)
            for name, by_start in texts.items():
                if start in by_start:
                    t = by_start[start]
                    rows[name].append((truth, named(t), bool(re.search(ACTIVITY, t.lower())),
                                       bool(re.search(APPEARANCE, t.lower())), len(t.split()), t, first_named(t)))
            rows['pose numbers (our body)'].append((truth, {majority(ours, start)}, False, False, 0, '',
                                                    majority(ours, start)))
            rows['always "standing"'].append((truth, {'standing'}, False, False, 0, '', 'standing'))
            if run == 'robothome' and start in (30.0, 65.0, 130.0, 210.0) or run == 'office' and start == 30.0:
                examples.append((f'{run} {start:.0f} s', truth, {n: texts[n].get(start, '') for n in texts}))

    print(f'Windows of 5 s: {len(rows["Qwen narration"])} across {", ".join(r for r, _ in RUNS)}. '
          f'Reference postures: {dict(Counter(r[0] for r in rows["Qwen narration"]))}\n')
    print('| Source | names a posture | names several | right posture, of those | right posture, all windows | '
          'first named right, all windows | names an activity | names appearance | words | distinct texts |\n'
          '|---|---|---|---|---|---|---|---|---|---|')
    for name, r in rows.items():
        said = [x for x in r if x[1]]
        right = [x for x in said if x[0] in x[1]]     # right when the reference posture is among those named
        text = name not in ('pose numbers (our body)', 'always "standing"')
        print(f'| {name} | {len(said) / len(r):.0%} | {np.mean([len(x[1]) > 1 for x in r]):.0%} | '
              f'{len(right) / max(len(said), 1):.0%} | {len(right) / len(r):.0%} | '
              f'{np.mean([x[0] == x[6] for x in r]):.0%} | '
              + (f'{np.mean([x[2] for x in r]):.0%} | {np.mean([x[3] for x in r]):.0%} | '
                 f'{np.mean([x[4] for x in r]):.0f} | {len({x[5] for x in r}) / len(r):.0%} |' if text else '– | – | – | – |'))

    if a.old_dam:
        print('\nDAM run to run (old vs new, same windows): windows naming the same set of postures')
        for _, f in SOURCES[1:]:
            same, total = 0, 0
            for run, _ in RUNS:
                old_f = f'{a.old_dam}/{run}/{f}'
                if not os.path.exists(old_f):
                    continue
                old_d, new_d = json.load(open(old_f)), json.load(open(f'{ROOT}/runs/{run}/{f}'))
                if old_d == new_d:          # this source was not re-run
                    continue
                old = {d['start_s']: named(d['text']) for d in old_d}
                new = {d['start_s']: named(d['text']) for d in new_d}
                common = old.keys() & new.keys()
                same += sum(old[s] == new[s] for s in common)
                total += len(common)
            print(f'  {f}: {same / max(total, 1):.0%} of {total}')

    print('\n| Window | Motion capture | ' + ' | '.join(n for n, _ in SOURCES) + ' |\n|---|---|' + '---|' * len(SOURCES))
    for where, truth, t in examples:
        cut = lambda s: ' '.join(s.split()[:18]) + (' …' if len(s.split()) > 18 else '')
        print(f'| {where} | {truth} | ' + ' | '.join(cut(t.get(n, '')).replace('|', '/') for n, _ in SOURCES) + ' |')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--old_dam', default=None, help='Folder with an earlier run\'s DAM outputs: <run>/dam_*.json.')
    main(parser.parse_args())
