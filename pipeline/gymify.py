"""
Gymify a processed recording: which exercise it shows, its reps, sets, rest, range of motion, tempo and left/right
symmetry from the 3D body, then Meta Muse Spark's form coaching and the music to train to.

python pipeline/gymify.py --run runs/x [--exercise squat]

1. Exercise: Muse names it from frames of the 3D body (mesh_exo.mp4) over the most active 20 s, plus two head-camera
   frames when the recording has its POV, unless --exercise says it. Muse sees images, not the time series.
2. Reps: each flexion excursion of the exercise's main joint (mean of left and right, pose_timeseries.csv) of at least
   max(15 deg, 35% of its range) is a rep; reps further apart than 8 s start a new set. Measured, no model.
3. Coaching: Muse gets the 3D body at the start and the bottom of the first, middle and last rep, a head-camera frame,
   and the measured numbers; it answers form observations, changes, what went well and a music profile.
Writes <run>/gym.json. The key is read from director/.env, never printed.
"""

import argparse
import base64
import csv
import json
import os
import ssl
import time
from urllib.request import Request, urlopen

import numpy as np

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
URL = 'https://api.meta.ai/v1/responses'
FPS = 30
# exercise -> the joint its reps bend: knee, hip or elbow flexion, or "arms" (wrist height, e.g. jumping jacks)
EXERCISES = {'squat': 'knee', 'lunge': 'knee', 'jump squat': 'knee', 'step-up': 'knee', 'deadlift': 'hip',
             'good morning': 'hip', 'hip hinge': 'hip', 'sit-up': 'hip', 'push-up': 'elbow', 'bicep curl': 'elbow',
             'shoulder press': 'elbow', 'tricep dip': 'elbow', 'jumping jacks': 'arms', 'arm raise': 'arms'}
SET_GAP_S = 8.0


def muse_key() -> str:
    for line in open(os.path.join(ROOT, 'director', '.env'), encoding='utf-8'):
        if line.strip().startswith('MUSE_API_KEY='):
            return line.split('=', 1)[1].strip()
    raise SystemExit('MUSE_API_KEY is missing from director/.env')


def ask(key: str, text: str, jpegs: list, tries: int = 2) -> dict:
    """One Muse Spark call with images; the first JSON object of its answer."""
    content = [{'type': 'input_text', 'text': text}]
    content += [{'type': 'input_image', 'image_url': 'data:image/jpeg;base64,' + base64.b64encode(j).decode()} for j in jpegs]
    body = json.dumps({'model': os.getenv('MUSE_MODEL', 'muse-spark-1.3'), 'input': [{'role': 'user', 'content': content}]}).encode()
    for attempt in range(tries):
        try:
            req = Request(URL, data=body, method='POST', headers={'Content-Type': 'application/json', 'Authorization': f'Bearer {key}'})
            with urlopen(req, timeout=180, context=ssl.create_default_context()) as r:
                p = json.loads(r.read())
            out = p.get('output_text') or ''.join(c.get('text', '') for o in p.get('output', []) for c in o.get('content', [])
                                                  if c.get('type') == 'output_text')
            return json.loads(out[out.index('{'):out.rindex('}') + 1])
        except (OSError, ValueError) as err:
            if attempt == tries - 1:
                raise SystemExit(f'Muse Spark did not answer: {type(err).__name__}')
            time.sleep(5)


def frames(path: str, seconds: list, width: int = 448) -> list:
    """JPEG bytes of the video at these times (s); missing video or frames are skipped."""
    import cv2
    if not path or not os.path.exists(path):
        return []
    cap, out = cv2.VideoCapture(path), []
    for s in seconds:
        cap.set(cv2.CAP_PROP_POS_FRAMES, int(s * FPS))
        ok, img = cap.read()
        if ok:
            img = cv2.resize(img, (width, round(img.shape[0] * width / img.shape[1])), interpolation=cv2.INTER_AREA)
            out.append(cv2.imencode('.jpg', img, [cv2.IMWRITE_JPEG_QUALITY, 85])[1].tobytes())
    return out


def columns(path: str) -> dict:
    rows = list(csv.DictReader(open(path, encoding='utf-8')))
    return {k: np.array([float(r[k]) for r in rows]) for k in rows[0]}


def smooth(x: np.ndarray, n: int = 9) -> np.ndarray:
    return np.convolve(np.pad(x, n // 2, mode='edge'), np.ones(n) / n, mode='valid')


def turning_points(x: np.ndarray, thr: float) -> list:
    """Alternating ('min', i) / ('max', i) of x, each at least thr from the one before (hysteresis)."""
    pts, mode, lo, hi = [], 0, 0, 0          # mode +1: rising (tracking a max), -1: falling (tracking a min)
    for i in range(len(x)):
        if x[i] > x[hi]:
            hi = i
        if x[i] < x[lo]:
            lo = i
        if mode >= 0 and x[hi] - x[i] >= thr and (mode == 1 or hi > lo):
            if mode == 0:
                pts.append(('min', lo))
            pts.append(('max', hi))
            mode, lo = -1, i
        elif mode <= 0 and x[i] - x[lo] >= thr and (mode == -1 or lo > hi):
            if mode == 0:
                pts.append(('max', hi))
            pts.append(('min', lo))
            mode, hi = 1, i
    if mode == -1:
        pts.append(('min', lo))
    return pts


def reps_of(x: np.ndarray, fps: int = FPS) -> list:
    """[(start, peak, end, rest)]: frame indices of each min -> max -> min excursion 0.6-12 s long, and its rest angle."""
    x = smooth(x)
    lo, hi = np.percentile(x, [5, 95])
    if hi - lo < 15:
        return []
    pts = turning_points(x, max(15.0, 0.35 * (hi - lo)))
    reps = []
    for (ka, a), (kp, p), (kc, c) in zip(pts, pts[1:], pts[2:]):
        if (ka, kp, kc) != ('min', 'max', 'min'):
            continue
        # a rep starts where the joint leaves its rest and ends where it is back (10% of its range): a min found
        # anywhere on a long pause between sets would make the rep, its tempo and the rest wrong
        s, e = p, p
        while s > a and x[s - 1] > x[a] + 0.1 * (x[p] - x[a]):
            s -= 1
        while e < c and x[e + 1] > x[c] + 0.1 * (x[p] - x[c]):
            e += 1
        reps.append((s, p, e, (x[a] + x[c]) / 2))
    return [r for r in reps if 0.6 <= (r[2] - r[0]) / fps <= 12]


def signal(pose: dict, joints: dict | None, joint: str):
    """The main joint's left, right and mean signal (degrees; wrist height x100 for 'arms')."""
    if joint == 'arms' and joints:
        rel = lambda side: 100 * (joints[f'{side}_wrist_z'] - joints['pelvis_z']) / np.maximum(0.2, joints['head_z'] - joints['pelvis_z'])
        left, right = rel('left'), rel('right')
    else:
        left, right = pose[f'{joint}_l'], pose[f'{joint}_r']
    return left, right, (left + right) / 2


def analyse(pose: dict, joints: dict | None, joint: str) -> dict:
    left, right, x = signal(pose, joints, joint)
    reps = reps_of(x)
    xs = smooth(x)
    out = []
    for s, p, e, rest in reps:
        out.append({'start_s': round(s / FPS, 2), 'bottom_s': round(p / FPS, 2), 'end_s': round(e / FPS, 2),
                    'rom_deg': round(float(xs[p] - rest), 1),
                    'down_s': round((p - s) / FPS, 2), 'up_s': round((e - p) / FPS, 2),
                    'asym_deg': round(float(abs(left[p] - right[p])), 1)})
    sets, cur = [], []
    for r in out:
        if cur and r['start_s'] - cur[-1]['end_s'] > SET_GAP_S:
            sets.append(cur)
            cur = []
        cur.append(r)
    if cur:
        sets.append(cur)
    set_rows = [{'reps': len(st), 'start_s': st[0]['start_s'], 'end_s': st[-1]['end_s'],
                 'rest_after_s': round(sets[k + 1][0]['start_s'] - st[-1]['end_s'], 1) if k + 1 < len(sets) else None}
                for k, st in enumerate(sets)]
    stat = lambda k: [r[k] for r in out]
    summary = {}
    if out:
        rom, down, up = np.array(stat('rom_deg')), np.array(stat('down_s')), np.array(stat('up_s'))
        n3 = max(1, len(out) // 3)
        summary = {'reps': len(out), 'sets': len(sets), 'rom_mean_deg': round(float(rom.mean()), 1),
                   'rom_min_deg': round(float(rom.min()), 1), 'rom_max_deg': round(float(rom.max()), 1),
                   'rom_change_pct': round(float(100 * (rom[-n3:].mean() / rom[:n3].mean() - 1)), 1),
                   'down_mean_s': round(float(down.mean()), 2), 'up_mean_s': round(float(up.mean()), 2),
                   'tempo_cv_pct': round(float(100 * (down + up).std() / (down + up).mean()), 1),
                   'asym_mean_deg': round(float(np.mean(stat('asym_deg'))), 1), 'asym_max_deg': round(float(max(stat('asym_deg'))), 1),
                   'reps_per_min': round(float(60 * len(out) / max(1e-6, sum(r['end_s'] - r['start_s'] for r in out))), 1)}
    return {'joint': joint, 'reps': out, 'sets': set_rows, 'summary': summary}


RECOGNISE = """These images show one person exercising. The first {n_body} are their 3D body, reconstructed by LifeLens
from a camera on their head (the legs are estimated, the camera never sees them), at {times} s; the rest are that head
camera. Which exercise is this? Answer with one JSON object only: {{"exercise": one of {names} or a short name if none
fits, or "none" if they are not exercising, "main_joint": "knee", "hip", "elbow", "arms" or "none", "confidence": 0 to
1, "reason": one sentence naming what in the images shows it}}."""

COACH = """You are a strength and fitness coach. The images show a person doing {exercise}: their 3D body, reconstructed
by LifeLens from a camera on their head (legs estimated), at the start and the bottom of reps {rep_list}, in that order,
then their head camera at the bottom of rep {mid}. Measured from the 3D body ({joint} flexion, degrees):
{numbers}
Per rep (start, bottom, range of motion, seconds down and up, left-right difference at the bottom):
{table}
Coach them from what the images show and the numbers. Answer with one JSON object only:
{{"summary": 2 sentences, "form": 3-5 observations, each naming the rep and image or number it rests on,
"improvements": 3-5 objects {{"change": short instruction starting with a verb, "why": the image or number behind it,
"how": a cue they can use in the next set}}, "went_well": 2-3 strings, "caveats": 1-2 strings on what the 3D estimate
cannot show, "music": {{"search": 2-4 words of genre or style for a seed song, "energy": 0-1, "tempo": BPM to train to,
"valence": 0-1, "danceability": 0-1, "instrumentalness": 0-1, "reason": one sentence}}}}. No medical diagnosis."""


def main(a):
    run = a.run.rstrip('/')
    pose = columns(f'{run}/pose_timeseries.csv')
    jpath = f'{run}/kinematics/joints_world.csv'
    joints = columns(jpath) if os.path.exists(jpath) else None
    name = os.path.basename(run)
    body_video = f'{run}/mesh_exo.mp4'
    pov = next((p for p in (f'{run}/input.mp4', f'{ROOT}/public/video/input/{name}.mp4') if os.path.exists(p)), '')
    key = muse_key()
    n = len(pose['time_s'])
    t0 = time.time()

    # 1. the exercise: the user's, or Muse's from frames of the most active 20 s
    if a.exercise:
        ex = {'exercise': a.exercise, 'main_joint': EXERCISES.get(a.exercise, 'knee'), 'source': 'you', 'confidence': 1.0, 'reason': ''}
    else:
        motion = sum(np.abs(np.diff(pose[c], prepend=pose[c][0])) for c in ('knee_l', 'knee_r', 'hip_l', 'hip_r', 'elbow_l', 'elbow_r'))
        per_s = np.add.reduceat(motion, np.arange(0, n, FPS))
        w = min(20, len(per_s))
        start = int(np.argmax(np.convolve(per_s, np.ones(w), mode='valid'))) if len(per_s) > w else 0
        times = [round(start + w * (k + 0.5) / 6, 1) for k in range(6)]
        imgs = frames(body_video, times)
        povs = frames(pov, [times[1], times[4]])
        ex = ask(key, RECOGNISE.format(n_body=len(imgs), times=', '.join(map(str, times)), names=', '.join(EXERCISES)), imgs + povs)
        ex = {'exercise': str(ex.get('exercise', 'none')).lower(), 'main_joint': ex.get('main_joint', 'none'),
              'confidence': ex.get('confidence'), 'reason': ex.get('reason', ''), 'source': 'Meta Muse Spark', 'frames_at_s': times}
    joint = ex['main_joint'] if ex['main_joint'] in ('knee', 'hip', 'elbow', 'arms') else EXERCISES.get(ex['exercise'])
    if not joint:                                   # no exercise named: the joint that moves the most
        joint = max(('knee', 'hip', 'elbow'), key=lambda j: float(np.ptp(np.percentile(signal(pose, joints, j)[2], [5, 95]))))
    # no exercise (Muse says none, and you did not pick one): no reps, rather than counting everyday arm moves as reps
    result = {'joint': joint, 'reps': [], 'sets': [], 'summary': {}} if ex['exercise'] == 'none' else analyse(pose, joints, joint)
    out = {'exercise': ex, **result, 'review': None}

    # 2. coaching from the 3D body at the first, middle and last rep, with the numbers
    reps = result['reps']
    if reps and ex['exercise'] != 'none':
        picks = sorted({0, len(reps) // 2, len(reps) - 1})
        imgs = frames(body_video, [t for k in picks for t in (reps[k]['start_s'], reps[k]['bottom_s'])])
        povs = frames(pov, [reps[len(reps) // 2]['bottom_s']])
        sm = result['summary']
        numbers = (f"{sm['reps']} reps in {sm['sets']} set(s); range of motion {sm['rom_mean_deg']} deg on average "
                   f"({sm['rom_min_deg']}-{sm['rom_max_deg']}), {sm['rom_change_pct']}% from the first to the last third; "
                   f"{sm['down_mean_s']} s down and {sm['up_mean_s']} s up per rep, tempo varies {sm['tempo_cv_pct']}%; "
                   f"left-right difference {sm['asym_mean_deg']} deg on average, up to {sm['asym_max_deg']}; "
                   f"{sm['reps_per_min']} reps per minute. Rests: {[s['rest_after_s'] for s in result['sets'][:-1]] or 'none'} s.")
        table = '\n'.join(f"rep {k + 1}: {r['start_s']}-{r['bottom_s']} s, {r['rom_deg']} deg, {r['down_s']}/{r['up_s']} s, "
                          f"{r['asym_deg']} deg" for k, r in enumerate(reps[:30]))
        prompt = COACH.format(exercise=ex['exercise'], rep_list=', '.join(str(k + 1) for k in picks), mid=len(reps) // 2 + 1,
                              joint=joint, numbers=numbers, table=table) + (f'\nAbout the person: {a.person}.' if a.person else '')
        review = ask(key, prompt, imgs + povs)
        review['prompt'] = prompt
        review['images'] = {'body_at_s': [t for k in picks for t in (reps[k]['start_s'], reps[k]['bottom_s'])],
                            'pov_at_s': [reps[len(reps) // 2]['bottom_s']] if povs else []}
        out['review'] = review
    out['runtime_s'] = round(time.time() - t0, 1)
    json.dump(out, open(f'{run}/gym.json', 'w', encoding='utf-8'), indent=1)
    sm = result['summary']
    print(f"{ex['exercise']} ({ex['source']}): {sm.get('reps', 0)} reps, {sm.get('sets', 0)} sets, joint {joint}, "
          f"{out['runtime_s']} s", flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--run', required=True)
    parser.add_argument('--exercise', default='', help=f"Skip recognition: one of {', '.join(EXERCISES)}.")
    parser.add_argument('--person', default='', help="The wearer, e.g. '178 cm, 75 kg, 30 years old': for the coaching.")
    main(parser.parse_args())
