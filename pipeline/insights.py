"""
Daily-activity insights from one or more processed recordings (one clip each, in the order given): the posture each
second, how the time splits, sit-downs and walking distance.

python pipeline/insights.py runs/x                                   # one clip: writes into runs/x
python pipeline/insights.py runs/a runs/b runs/c --out runs/day       # a day of clips: one report

The posture is Meta Muse Spark's: director/posture_muse.py labels each 5 s window from a frame of the 3D body and a
frame of the head camera (posture_muse.json), and every second of the window takes that label; 'unknown' where Muse
gave none. Walking distance comes from the 3D body's pelvis speed.

Writes activity.csv (second, clip, label, Muse caption), insights.json (minutes per label, sit-downs, longest sitting
bout, walking distance, time bent over, and the log Muse's review reads), insights.md and activity.png (a timeline band
per clip). Meta Muse Spark's review is added afterwards by `python -m director.routine_tips <out>`.
"""

import argparse
import json
import os
import time

import numpy as np
from PIL import Image, ImageDraw, ImageFont

FPS = 30
LABELS = ('walking', 'standing', 'sitting', 'crouching', 'bending', 'arms raised', 'unknown')
COLORS = ((44, 160, 44), (180, 180, 180), (31, 119, 180), (148, 103, 189), (214, 39, 40), (255, 127, 14), (235, 235, 235))


def label_seconds(run: str) -> list:
    """One posture label per second: Meta Muse Spark's label for the 5 s window the second falls in."""
    n = len(np.genfromtxt(f'{run}/pose_timeseries.csv', delimiter=',', names=True)) // FPS
    labels = ['unknown'] * n
    path = f'{run}/posture_muse.json'
    for w in json.load(open(path, encoding='utf-8')) if os.path.exists(path) else []:
        for s in range(int(w['start_s']), min(int(round(w['end_s'])), n)):
            labels[s] = w['label'] if w['label'] in LABELS else 'unknown'
    return labels


def narration_at(run: str, seconds: int) -> list:
    path = f'{run}/narration_muse.json' if os.path.exists(f'{run}/narration_muse.json') else f'{run}/narration.json'
    if not os.path.exists(path):
        return [''] * seconds
    text = [''] * seconds
    for n in json.load(open(path, encoding='utf-8')):
        for s in range(int(n['start_s']), min(int(np.ceil(n['end_s'])), seconds)):
            text[s] = n['text']
    return text


def bouts(labels: list, which: set) -> list:
    """Lengths (s) of the runs of consecutive seconds whose label is in `which`."""
    out, n = [], 0
    for lab in labels + ['']:
        if lab in which:
            n += 1
        elif n:
            out.append(n)
            n = 0
    return out


def stats(labels: list, speed: np.ndarray) -> dict:
    sit = bouts(labels, {'sitting', 'crouching'})
    return {'duration_min': round(len(labels) / 60, 2),
            'minutes': {k: round(labels.count(k) / 60, 2) for k in LABELS},
            'share': {k: round(labels.count(k) / max(len(labels), 1), 3) for k in LABELS},
            'sit_stand_transitions': len(sit),
            'longest_sitting_min': round(max(sit, default=0) / 60, 2),
            'walking_distance_m': round(float(speed.sum()) / FPS, 1),
            'bent_over_min': round(labels.count('bending') / 60, 2)}


def timeline_png(path: str, clips: list):
    """A band per clip, one color per label, 1 s per pixel column (scaled to 1200 px)."""
    font = ImageFont.load_default(size=16)
    total, row, left = max(len(c['labels']) for c in clips), 36, 140
    img = Image.new('RGB', (left + 1200 + 20, 50 + row * len(clips)), 'white')
    d = ImageDraw.Draw(img)
    for k, (name, color) in enumerate(zip(LABELS, COLORS)):
        d.rectangle((left + k * 190, 10, left + k * 190 + 14, 24), fill=color)
        d.text((left + k * 190 + 20, 8), name, fill='black', font=font)
    for r, c in enumerate(clips):
        y = 44 + r * row
        d.text((8, y + 6), c['name'][:16], fill='black', font=font)
        for s, lab in enumerate(c['labels']):
            x = left + s * 1200 / total
            d.rectangle((x, y, x + 1200 / total + 1, y + row - 8), fill=COLORS[LABELS.index(lab)])
    img.save(path)


def main(a):
    t0 = time.time()
    out = a.out or a.runs[0]
    os.makedirs(out, exist_ok=True)
    clips, rows = [], []
    for run in a.runs:
        labels = label_seconds(run)
        text = narration_at(run, len(labels))
        speed = np.genfromtxt(f'{run}/pose_timeseries.csv', delimiter=',', names=True)['speed_m_s']
        name = os.path.basename(os.path.normpath(run))
        clips.append({'name': name, 'labels': labels, 'text': text, 'stats': stats(labels, speed)})
        rows += [(s, name, lab, t) for s, (lab, t) in enumerate(zip(labels, text))]
    day = stats(sum((c['labels'] for c in clips), []),
                np.concatenate([np.genfromtxt(f'{r}/pose_timeseries.csv', delimiter=',', names=True)['speed_m_s']
                                for r in a.runs]))

    with open(f'{out}/activity.csv', 'w') as f:
        f.write('second,clip,label,narration\n')
        f.writelines(f'{s},{c},{lab},"{t.replace(chr(34), chr(39))}"\n' for s, c, lab, t in rows)
    timeline_png(f'{out}/activity.png', clips)

    # the log the LLM reads: totals, then each posture bout with what the narration says happened during it
    lines = [f"Total {day['duration_min']} min: " + ', '.join(f'{k} {v} min' for k, v in day['minutes'].items() if v),
             f"{day['sit_stand_transitions']} times sat or crouched down, longest sitting {day['longest_sitting_min']} min, "
             f"walked {day['walking_distance_m']} m, bent over {day['bent_over_min']} min."]
    for c in clips:
        lines.append(f"Clip {c['name']}:")
        s = 0
        while s < len(c['labels']):
            e = s
            while e < len(c['labels']) and c['labels'][e] == c['labels'][s]:
                e += 1
            said = ' '.join(dict.fromkeys(t for t in c['text'][s:e] if t))
            lines.append(f"  {c['labels'][s]} {e - s} s. {said}".rstrip())
            s = e
    log = '\n'.join(lines[:150])     # shortcut: the first 150 bouts; split longer days into clips

    report = {'clips': {c['name']: c['stats'] for c in clips}, 'total': day, 'posture_from': 'Meta Muse Spark',
              'log': log, 'runtime_s': round(time.time() - t0, 1)}     # log: also read by director/routine_tips.py
    json.dump(report, open(f'{out}/insights.json', 'w'), indent=2)
    with open(f'{out}/insights.md', 'w') as f:
        f.write(f"# Activity insights: {', '.join(c['name'] for c in clips)}\n\n![timeline](activity.png)\n\n"
                f"| | {' | '.join(LABELS)} | sit-downs | longest sit | walked |\n|---|{'---|' * (len(LABELS) + 3)}\n")
        for name, s in list(report['clips'].items()) + [('**total**', day)]:
            cells = [f'{s["minutes"][k]:.1f} min' for k in LABELS] + [str(s['sit_stand_transitions']),
                     f'{s["longest_sitting_min"]:.1f} min', f'{s["walking_distance_m"]:.0f} m']
            f.write(f"| {name} | {' | '.join(cells)} |\n")
        f.write(f'\n<details><summary>Posture log</summary>\n\n```\n{log}\n```\n</details>\n')
    print(json.dumps({k: report[k] for k in ('total', 'runtime_s')}, indent=1))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('runs', nargs='+', help='Run folders, one clip each, in time order.')
    parser.add_argument('--out', default=None, help='Report folder (default: the first run).')
    main(parser.parse_args())
