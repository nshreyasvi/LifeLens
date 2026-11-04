"""
One frame of the rendered 3D body (mesh_exo.mp4) and one of the head camera (input.mp4) per 5 s window, as JPEG, for
the Muse Spark steps that should see the person instead of reading numbers (director/posture_muse.py, routine_tips.py).

python pipeline/body_frames.py --run runs/x [--window 5]   -> runs/x/frames/body_0000.jpg, pov_0000.jpg, ...

Each frame is the window's middle; the name is the window's start second. The head camera is the run's input.mp4,
or public/video/input/<name>.mp4 for the examples (whose POV footage is not in the repo).
"""

import argparse
import os

import cv2

WIDTH = 448


ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))


def save(video: str, prefix: str, out: str, window: float) -> int:
    cap = cv2.VideoCapture(video)
    fps, total = cap.get(cv2.CAP_PROP_FPS) or 30, int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    n = 0
    for start in range(0, int(total / fps) + 1, int(window)):
        cap.set(cv2.CAP_PROP_POS_FRAMES, int((start + min(start + window, total / fps)) / 2 * fps))   # short last window: its middle
        ok, img = cap.read()
        if not ok:
            continue
        img = cv2.resize(img, (WIDTH, round(img.shape[0] * WIDTH / img.shape[1])), interpolation=cv2.INTER_AREA)
        cv2.imwrite(os.path.join(out, f'{prefix}_{start:04d}.jpg'), img, [cv2.IMWRITE_JPEG_QUALITY, 85])
        n += 1
    return n


def main(a):
    out = os.path.join(a.run, 'frames')
    os.makedirs(out, exist_ok=True)
    name = os.path.basename(os.path.normpath(a.run))
    pov = next((p for p in (os.path.join(a.run, 'input.mp4'), os.path.join(ROOT, 'public', 'video', 'input', f'{name}.mp4'))
                if os.path.exists(p)), None)
    n_body = save(os.path.join(a.run, 'mesh_exo.mp4'), 'body', out, a.window)
    n_pov = save(pov, 'pov', out, a.window) if pov else 0
    print(f'{n_body} 3D body and {n_pov} head-camera frames in {out}')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--run', required=True)
    parser.add_argument('--window', type=float, default=5.0)
    main(parser.parse_args())
