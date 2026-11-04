"""
Region descriptions by NVIDIA's Describe Anything Model (DAM-3B-Video), per window, from three inputs:
    ego    the ego video: SAM 2.1 segments the object under a point on the window's first frame and tracks it
    pose   the rendered body (mesh_exo.mp4): the mask is the body's silhouette (bluish pixels on the gray floor)
    both   ego and mesh frames side by side, both masks together
DAM describes each masked region over 8 frames of the window.

python pipeline/describe_anything.py --run runs/x [--window 5] [--point 0.5 0.6] [--sources ego pose both]

--point: normalized (x, y) of the ego region on each window's first frame. The default, a little below the image
center, is where a head-mounted camera tilted down sees what the hands work on.

Writes dam_<source>.json [{start_s, end_s, text}] and dam_<source>.srt on input.mp4's clock, listed in manifest.json.
Two passes keep it inside 8 GB of VRAM: SAM 2 for every window first, then DAM alone. DAM's weights: NVIDIA
Noncommercial License.
"""

import argparse
import json
import os
import tempfile
import time

import cv2
import numpy as np
import torch
from PIL import Image

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
SAM2_CKPT = os.path.join(ROOT, 'third_party', 'sam2', 'sam2.1_hiera_small.pt')
SAM2_CFG = 'configs/sam2.1/sam2.1_hiera_s.yaml'
QUERY = ('Video: ' + '<image>' * 8 + '\nGiven the video in the form of a sequence of frames above, describe the object '
         'in the masked region in the video in detail.')
TRACK_FPS, WIDTH = 10, 960      # SAM 2 tracks at 10 fps on 960 px frames: plenty for a 5 s window
MAX_TOKENS = 80                 # DAM writes ~1 token / 0.3 s on an 8 GB GPU: 80 tokens = 2-3 sentences


def windows(path: str, seconds: float) -> list:
    """[(start_s, frames)]: RGB frames at TRACK_FPS and WIDTH, grouped by window."""
    cap = cv2.VideoCapture(path)
    fps = cap.get(cv2.CAP_PROP_FPS)
    step, groups, i = max(round(fps / TRACK_FPS), 1), {}, 0
    while True:
        ok, img = cap.read()
        if not ok:
            break
        if i % step == 0:
            small = cv2.resize(img, (WIDTH, round(img.shape[0] * WIDTH / img.shape[1])), interpolation=cv2.INTER_AREA)
            groups.setdefault(int(i / fps // seconds), []).append(cv2.cvtColor(small, cv2.COLOR_BGR2RGB))
        i += 1
    return [(w * seconds, frames) for w, frames in sorted(groups.items())]


def track(predictor, frames: list, point: tuple) -> list:
    """SAM 2 masks (bool HxW) of the object under the normalized point on frames[0], for every frame."""
    with tempfile.TemporaryDirectory() as d:
        for k, f in enumerate(frames):
            cv2.imwrite(f'{d}/{k:05d}.jpg', cv2.cvtColor(f, cv2.COLOR_RGB2BGR))
        state = predictor.init_state(video_path=d)
        h, w = frames[0].shape[:2]
        with torch.autocast('cuda', dtype=torch.bfloat16):
            predictor.add_new_points_or_box(state, frame_idx=0, obj_id=1, points=np.array([[point[0] * w, point[1] * h]],
                                            dtype=np.float32), labels=np.array([1], dtype=np.int32))
            masks = [(logits[0, 0] > 0).cpu().numpy() for _, _, logits in predictor.propagate_in_video(state)]
    return masks


def body_mask(rgb: np.ndarray) -> np.ndarray:
    """The rendered body: render.py draws it bluish on a gray floor and a white background."""
    return rgb[..., 2].astype(int) - rgb[..., 0] > 25


def fill_empty(masks: list) -> list:
    """DAM crops around the region in every frame: an empty mask (object lost, body out of view) takes the nearest
    non-empty mask of the window."""
    full = [k for k, m in enumerate(masks) if m.any()]
    return [m if m.any() else masks[min(full, key=lambda k: abs(k - i))] for i, m in enumerate(masks)]


def side_by_side(ego: np.ndarray, mesh: np.ndarray) -> np.ndarray:
    h = mesh.shape[0]
    return np.hstack([cv2.resize(ego, (round(ego.shape[1] * h / ego.shape[0]), h)), mesh])


def srt_time(s: float) -> str:
    ms = round(s * 1000)
    return f'{ms // 3600000:02d}:{ms // 60000 % 60:02d}:{ms // 1000 % 60:02d},{ms % 1000:03d}'


def main(a):
    from sam2.build_sam import build_sam2_video_predictor
    t0 = time.time()
    ego, mesh = windows(f'{a.run}/input.mp4', a.window), windows(f'{a.run}/mesh_exo.mp4', a.window)
    predictor = build_sam2_video_predictor(SAM2_CFG, SAM2_CKPT, device='cuda')
    inputs = {s: [] for s in a.sources}          # source -> [(start_s, length_s, 8 frames, 8 masks)]
    for (start, frames), (_, body) in zip(ego, mesh):
        idx = np.linspace(0, min(len(frames), len(body)) - 1, 8).round().astype(int)
        masks = track(predictor, frames, a.point) if {'ego', 'both'} & set(a.sources) else None
        length = len(frames) / TRACK_FPS
        if 'ego' in inputs:
            inputs['ego'].append((start, length, [frames[k] for k in idx], [masks[k] for k in idx]))
        if 'pose' in inputs:
            inputs['pose'].append((start, length, [body[k] for k in idx], [body_mask(body[k]) for k in idx]))
        if 'both' in inputs:
            inputs['both'].append((start, length, [side_by_side(frames[k], body[k]) for k in idx],
                                   [side_by_side(masks[k].astype(np.uint8), body_mask(body[k]).astype(np.uint8)) > 0
                                    for k in idx]))
    del predictor
    torch.cuda.empty_cache()
    sam_s, t1 = time.time() - t0, time.time()

    from dam import DescribeAnythingModel, disable_torch_init
    disable_torch_init()
    dam = DescribeAnythingModel(model_path=a.model, conv_mode='v1', prompt_mode='full+focal_crop').to('cuda')
    counts = {}
    for source, items in inputs.items():
        out = []
        for start, length, frames, masks in items:
            if not any(m.any() for m in masks):     # nothing under the point, or no body in view
                continue
            text = dam.get_description([Image.fromarray(f) for f in frames],
                                       [Image.fromarray(m.astype(np.uint8) * 255) for m in fill_empty(masks)], QUERY,
                                       temperature=0.2, top_p=0.5, num_beams=1, max_new_tokens=MAX_TOKENS).strip()
            out.append({'start_s': round(start, 2), 'end_s': round(start + length, 2), 'text': text})
            print(f'{source:4s} {start:6.1f} s  {text[:140]}', flush=True)
        json.dump(out, open(f'{a.run}/dam_{source}.json', 'w'), indent=1)
        with open(f'{a.run}/dam_{source}.srt', 'w') as f:
            for i, n in enumerate(out, 1):
                f.write(f"{i}\n{srt_time(n['start_s'])} --> {srt_time(n['end_s'])}\n{n['text']}\n\n")
        counts[source] = len(out)
    dam_s = time.time() - t1

    manifest = f'{a.run}/manifest.json'
    if os.path.exists(manifest):
        m = json.load(open(manifest))
        m['streams'].update({f'dam_{s}': f'dam_{s}.srt' for s in counts})
        counts = {**m.get('describe_anything', {}).get('windows', {}), **counts}     # keep sources not re-run
        m['describe_anything'] = {'model': a.model, 'window_s': a.window, 'point': list(a.point), 'windows': counts,
                                  'sam2_s': round(sam_s, 1), 'dam_s': round(dam_s, 1)}
        json.dump(m, open(manifest, 'w'), indent=2)
    print(f'{counts}: SAM 2 {sam_s:.1f} s, DAM {dam_s:.1f} s')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--run', required=True)
    parser.add_argument('--window', type=float, default=5.0, help='Seconds of video per description.')
    parser.add_argument('--point', type=float, nargs=2, default=(0.5, 0.6), help='Normalized x y of the ego region.')
    parser.add_argument('--sources', nargs='+', default=['ego', 'pose', 'both'], choices=['ego', 'pose', 'both'])
    parser.add_argument('--model', default='nvidia/DAM-3B-Video')
    main(parser.parse_args())
