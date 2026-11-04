"""
One frame of the rendered 3D body (mesh_exo.mp4) per 5 s window, as JPEG, for the Muse Spark steps that should see
the body instead of reading its numbers (director/posture_muse.py, director/routine_tips.py).

python pipeline/body_frames.py --run runs/x [--window 5]   -> runs/x/frames/body_0000.jpg, body_0005.jpg, ...

Each frame is the window's middle; the name is the window's start second.
"""

import argparse
import os

import cv2

WIDTH = 448


def main(a):
    out = os.path.join(a.run, 'frames')
    os.makedirs(out, exist_ok=True)
    cap = cv2.VideoCapture(os.path.join(a.run, 'mesh_exo.mp4'))
    fps, total = cap.get(cv2.CAP_PROP_FPS) or 30, int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    n = 0
    for start in range(0, int(total / fps), int(a.window)):
        cap.set(cv2.CAP_PROP_POS_FRAMES, int((start + a.window / 2) * fps))
        ok, img = cap.read()
        if not ok:
            continue
        img = cv2.resize(img, (WIDTH, round(img.shape[0] * WIDTH / img.shape[1])), interpolation=cv2.INTER_AREA)
        cv2.imwrite(os.path.join(out, f'body_{start:04d}.jpg'), img, [cv2.IMWRITE_JPEG_QUALITY, 85])
        n += 1
    print(f'{n} body frames in {out}')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--run', required=True)
    parser.add_argument('--window', type=float, default=5.0)
    main(parser.parse_args())
