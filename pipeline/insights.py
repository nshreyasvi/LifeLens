"""
Daily-activity insights from one or more runs (one clip each, in the order given): what the wearer's body did each
second, how the time splits, posture and breaks, and a short summary with schedule suggestions by a local LLM.

python pipeline/insights.py runs/x                                   # one clip: writes into runs/x
python pipeline/insights.py runs/a runs/b runs/c --out runs/day       # a day of clips: one report

Each second gets one label from the body pose (pose_timeseries.csv, kinematics/joints_world.npy), relative to the
wearer's own leg length:
    walking      pelvis moving faster than 0.5 m/s
    sitting      pelvis below 75% of its standing height, knees bent less than 110 deg
    crouching    pelvis below 75% of its standing height, knees bent more than 110 deg
    bending      standing, trunk leaning more than 35 deg
    arms raised  standing, a wrist above the shoulders
    standing     anything else
plus the Qwen narration of that second (narration.json, if the run has it).

Writes activity.csv (second, clip, label, narration), insights.json (minutes per label, transitions, longest sitting
bout, walking distance, time bent over, summary), insights.md and activity.png (a timeline band per clip).
"""

import argparse
import json
import os
import time

import numpy as np
from PIL import Image, ImageDraw, ImageFont

FPS = 30
LABELS = ('walking', 'standing', 'sitting', 'crouching', 'bending', 'arms raised')
COLORS = ((44, 160, 44), (180, 180, 180), (31, 119, 180), (148, 103, 189), (214, 39, 40), (255, 127, 14))
SMOOTH_S = 5        # a label must hold for most of a 5 s window: drops 1-2 s flicker
PROMPT = ('You are a health coach. Below is a log of one person\'s day, measured from a head-mounted camera: how long '
          'they spent in each body posture and what they were doing. In under 150 words, write two short paragraphs. '
          'First: what they did, in time order. Second: three concrete suggestions to improve their schedule, breaks '
          'or posture. Only state numbers that appear in the log.\n\n{log}')


def label_seconds(run: str) -> list:
    """One posture label per second of the clip."""
    ts = np.genfromtxt(f'{run}/pose_timeseries.csv', delimiter=',', names=True)
    joints = np.load(f'{run}/kinematics/joints_world.npy')
    leg = np.median(np.linalg.norm(joints[:, 4] - joints[:, 1], axis=1) + np.linalg.norm(joints[:, 7] - joints[:, 4], axis=1))
    stand_h = leg + 0.08                    # pelvis height standing: leg length plus ankle height
    wrist_up = (joints[:, (20, 21), 2] > joints[:, (16, 17), 2].max(1, keepdims=True)).any(1)
    labels = []
    for s in range(len(ts) // FPS):
        f = slice(s * FPS, (s + 1) * FPS)
        knee = np.median((ts['knee_l'][f] + ts['knee_r'][f]) / 2)
        low = np.median(ts['pelvis_height_m'][f]) < 0.75 * stand_h
        if np.median(ts['speed_m_s'][f]) > 0.5:
            labels.append('walking')
        elif low:
            labels.append('crouching' if knee > 110 else 'sitting')
        elif np.median(ts['trunk_lean'][f]) > 35:
            labels.append('bending')
        elif wrist_up[f].mean() > 0.5:
            labels.append('arms raised')
        else:
            labels.append('standing')
    h = SMOOTH_S // 2
    return [max(LABELS, key=labels[max(0, i - h):i + h + 1].count) for i in range(len(labels))]


def narration_at(run: str, seconds: int) -> list:
    if not os.path.exists(f'{run}/narration.json'):
        return [''] * seconds
    text = [''] * seconds
    for n in json.load(open(f'{run}/narration.json')):
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


def summarize(log: str, model_id: str) -> str:
    import torch
    from transformers import AutoModelForImageTextToText, AutoProcessor
    processor = AutoProcessor.from_pretrained(model_id)
    model = AutoModelForImageTextToText.from_pretrained(model_id, dtype=torch.bfloat16, device_map='cuda')
    prompt = processor.apply_chat_template([{'role': 'user', 'content': [{'type': 'text', 'text': PROMPT.format(log=log)}]}],
                                           add_generation_prompt=True)
    inputs = processor(text=[prompt], return_tensors='pt').to(model.device)
    ids = model.generate(**inputs, max_new_tokens=400, do_sample=False)
    return processor.batch_decode(ids[:, inputs['input_ids'].shape[1]:], skip_special_tokens=True)[0].strip()


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
            lines.append(f"  {s // 60}:{s % 60:02d}-{e // 60}:{e % 60:02d} {c['labels'][s]}. {said}".rstrip())
            s = e
    log = '\n'.join(lines[:150])     # shortcut: a 2B model reads ~150 lines well; summarize per clip for longer days
    summary = summarize(log, a.model) if a.model else ''

    report = {'clips': {c['name']: c['stats'] for c in clips}, 'total': day, 'summary': summary, 'model': a.model,
              'runtime_s': round(time.time() - t0, 1)}
    json.dump(report, open(f'{out}/insights.json', 'w'), indent=2)
    with open(f'{out}/insights.md', 'w') as f:
        f.write(f"# Activity insights: {', '.join(c['name'] for c in clips)}\n\n![timeline](activity.png)\n\n"
                f"| | {' | '.join(LABELS)} | sit-downs | longest sit | walked |\n|---|{'---|' * (len(LABELS) + 3)}\n")
        for name, s in list(report['clips'].items()) + [('**total**', day)]:
            cells = [f'{s["minutes"][k]:.1f} min' for k in LABELS] + [str(s['sit_stand_transitions']),
                     f'{s["longest_sitting_min"]:.1f} min', f'{s["walking_distance_m"]:.0f} m']
            f.write(f"| {name} | {' | '.join(cells)} |\n")
        f.write(f'\n{summary}\n\n<details><summary>Log given to the model</summary>\n\n```\n{log}\n```\n</details>\n')
    print(json.dumps({k: report[k] for k in ('total', 'runtime_s')}, indent=1))
    print(summary)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('runs', nargs='+', help='Run folders, one clip each, in time order.')
    parser.add_argument('--out', default=None, help='Report folder (default: the first run).')
    parser.add_argument('--model', default='Qwen/Qwen3-VL-2B-Instruct', help="Summary LLM; '' for numbers only.")
    main(parser.parse_args())
