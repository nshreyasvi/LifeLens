"""
Captions of the POV video by Meta Muse Spark, one per 5 s window, to compare with Qwen3-VL-2B's (describe.py).

python pipeline/describe_muse.py --run runs/x [--window 5] [--frames 3] [--with-body]

Sends each window's frames (evenly spaced, 448 px wide JPEG) with the same question describe.py asks Qwen, and writes
narration_muse.json [{start_s, end_s, text}] on input.mp4's clock. --with-body also sends the 3D body (mesh_exo.mp4,
same frame numbers) at the same moments and writes narration_muse_body.json. The key is read from director/.env (MUSE_API_KEY),
never printed; requests go only to https://api.meta.ai.
"""

import argparse
import base64
import json
import os
import ssl
import time
from urllib.request import Request, urlopen

import cv2

WIDTH = 448
PROMPT = ('What is the camera wearer doing in this clip? Answer with one short sentence (under 15 words), starting '
          'with a third-person verb or "The camera wearer...". Do not describe the room or objects unless the wearer '
          'is interacting with them.')

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
URL = 'https://api.meta.ai/v1/responses'


def muse_key() -> str:
    for line in open(os.path.join(ROOT, 'director', '.env'), encoding='utf-8'):
        if line.strip().startswith('MUSE_API_KEY='):
            return line.split('=', 1)[1].strip()
    raise SystemExit('MUSE_API_KEY is missing from director/.env')


def window_frames(path: str, window: float, n: int) -> list:
    """[(start_s, end_s, [jpeg bytes] * n)] for each window of the video."""
    cap = cv2.VideoCapture(path)
    fps, total = cap.get(cv2.CAP_PROP_FPS), int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    out = []
    for w in range(int(total / fps // window) + (total / fps % window > 1)):
        start, end = w * window, min((w + 1) * window, total / fps)
        jpegs = []
        for k in range(n):
            cap.set(cv2.CAP_PROP_POS_FRAMES, int((start + (k + 0.5) * (end - start) / n) * fps))
            ok, img = cap.read()
            if ok:
                img = cv2.resize(img, (WIDTH, round(img.shape[0] * WIDTH / img.shape[1])), interpolation=cv2.INTER_AREA)
                jpegs.append(cv2.imencode('.jpg', img, [cv2.IMWRITE_JPEG_QUALITY, 85])[1].tobytes())
        out.append((start, round(end, 2), jpegs))
    return out


BODY_NOTE = (' The images are frames from one 5 s clip, in order: first the head camera, then the same moments of a 3D'
             ' body estimated from that camera (its legs are a guess; the camera never sees them).')


def caption(key: str, jpegs: list, tries: int = 3, body: bool = False) -> str:
    note = BODY_NOTE if body else ' The images are frames from one 5 s clip, in order.'
    content = [{'type': 'input_text', 'text': PROMPT + note}]
    content += [{'type': 'input_image', 'image_url': 'data:image/jpeg;base64,' + base64.b64encode(j).decode()} for j in jpegs]
    body = json.dumps({'model': os.getenv('MUSE_MODEL', 'muse-spark-1.3'),
                       'input': [{'role': 'user', 'content': content}]}).encode()
    for attempt in range(tries):
        try:
            req = Request(URL, data=body, method='POST',
                          headers={'Content-Type': 'application/json', 'Authorization': f'Bearer {key}'})
            with urlopen(req, timeout=90, context=ssl.create_default_context()) as r:
                p = json.loads(r.read())
            text = p.get('output_text') or ''.join(c.get('text', '') for o in p.get('output', [])
                                                     for c in o.get('content', []) if c.get('type') == 'output_text')
            return text.strip()
        except (OSError, ValueError) as err:     # timeouts and HTTP errors: wait and try again
            if attempt == tries - 1:
                return f'[no caption: {type(err).__name__}]'
            time.sleep(5 * (attempt + 1))


def main(a):
    key, t0 = muse_key(), time.time()
    out = []
    pov = window_frames(f'{a.run}/input.mp4', a.window, a.frames)
    body = window_frames(f'{a.run}/mesh_exo.mp4', a.window, a.frames) if a.with_body else [None] * len(pov)
    for (start, end, jpegs), b in zip(pov, body):
        out.append({'start_s': start, 'end_s': end, 'text': caption(key, jpegs + (b[2] if b else []), body=bool(b))})
        print(f"{start:6.1f} s  {out[-1]['text']}", flush=True)
    json.dump(out, open(f"{a.run}/narration_muse{'_body' if a.with_body else ''}.json", 'w'), indent=1)
    print(f'{len(out)} windows in {time.time() - t0:.0f} s')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--run', required=True)
    parser.add_argument('--window', type=float, default=5.0)
    parser.add_argument('--frames', type=int, default=3, help='Frames per window sent to Muse.')
    parser.add_argument('--with-body', action='store_true', help='Also send the 3D body at the same moments.')
    main(parser.parse_args())
