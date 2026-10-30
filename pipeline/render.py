"""
Render the body mesh from a third-person camera that follows the wearer, pair it with the ego video, write the manifest.

python pipeline/render.py --run runs/x [--size 960 720] [--distance 3.5] [--azimuth 135] [--elevation 20]

Writes mesh_exo.mp4 (frame i = input.mp4 frame i, 30 fps), side_by_side.mp4 (input | mesh) and manifest.json.
Offscreen OpenGL: PYOPENGL_PLATFORM=egl by default; set PYOPENGL_PLATFORM=osmesa if EGL is unavailable.
"""

import argparse
import json
import os
import subprocess
import time

os.environ.setdefault('PYOPENGL_PLATFORM', 'egl')

import imageio.v2 as imageio  # noqa: E402
import imageio_ffmpeg  # noqa: E402
import numpy as np  # noqa: E402
import pyrender  # noqa: E402
import trimesh  # noqa: E402
from PIL import Image, ImageDraw, ImageFont  # noqa: E402

FPS = 30
BODY_COLOR = (0.55, 0.65, 0.85, 1.0)
GRAPH_H, GRAPH_S = 260, 10.0        # pose graph strip: height (px), seconds shown
SIDES = ((0, 'l', (31, 119, 180)), (1, 'r', (255, 127, 14)))     # left blue, right orange
# SMPL-H joints (AMASS layout): pelvis, neck; (left, right) hip, knee, ankle, shoulder, elbow, wrist
PELVIS, NECK, HIP, KNEE, ANKLE, SHOULDER, ELBOW, WRIST = 0, 12, (1, 2), (4, 5), (7, 8), (16, 17), (18, 19), (20, 21)
PANELS = (('knee flexion (deg)', ('knee_l', 'knee_r'), 150), ('hip flexion (deg)', ('hip_l', 'hip_r'), 150),
          ('elbow flexion (deg)', ('elbow_l', 'elbow_r'), 160), ('trunk lean (deg)', ('trunk_lean',), 90),
          ('walking speed (m/s)', ('speed_m_s',), 2.5))


def checkerboard(center: np.ndarray, half: int = 15) -> trimesh.Trimesh:
    """1 m tiles on the floor (z = 0) around center."""
    cx, cy = np.floor(center[:2]).astype(int)
    verts, faces, colors = [], [], []
    for i in range(cx - half, cx + half):
        for j in range(cy - half, cy + half):
            k = len(verts)
            verts += [(i, j, 0), (i + 1, j, 0), (i + 1, j + 1, 0), (i, j + 1, 0)]
            faces += [(k, k + 1, k + 2), (k, k + 2, k + 3)]
            colors += [(200, 200, 200, 255) if (i + j) % 2 else (150, 150, 150, 255)] * 2
    return trimesh.Trimesh(verts, faces, face_colors=colors, process=False)


def look_at(eye: np.ndarray, target: np.ndarray) -> np.ndarray:
    """OpenGL camera pose (looks along -z, y up) with world z up."""
    back = eye - target
    back /= np.linalg.norm(back)
    right = np.cross([0.0, 0.0, 1.0], back)
    right /= np.linalg.norm(right)
    pose = np.eye(4)
    pose[:3, :3] = np.stack([right, np.cross(back, right), back], axis=1)
    pose[:3, 3] = eye
    return pose


def smooth(x: np.ndarray, window: int) -> np.ndarray:
    pad = np.pad(x, ((window // 2, window - 1 - window // 2), (0, 0)), mode='edge')
    return np.stack([np.convolve(pad[:, d], np.ones(window) / window, mode='valid') for d in range(x.shape[1])], axis=1)


def angle(u: np.ndarray, v: np.ndarray) -> np.ndarray:
    cos = (u * v).sum(-1) / (np.linalg.norm(u, axis=-1) * np.linalg.norm(v, axis=-1))
    return np.degrees(np.arccos(np.clip(cos, -1, 1)))


def pose_series(joints: np.ndarray) -> dict:
    """Per-frame joint angles (deg, 0 = straight / upright), pelvis height and walking speed from world joints, z up."""
    trunk = joints[:, NECK] - joints[:, PELVIS]
    s = {}
    for k, side, _ in SIDES:
        thigh = joints[:, KNEE[k]] - joints[:, HIP[k]]
        s[f'knee_{side}'] = angle(thigh, joints[:, ANKLE[k]] - joints[:, KNEE[k]])
        s[f'hip_{side}'] = angle(-trunk, thigh)
        s[f'elbow_{side}'] = angle(joints[:, ELBOW[k]] - joints[:, SHOULDER[k]], joints[:, WRIST[k]] - joints[:, ELBOW[k]])
    s['trunk_lean'] = angle(trunk, np.array([0.0, 0.0, 1.0]))
    s['pelvis_height_m'] = joints[:, PELVIS, 2]
    speed = np.linalg.norm(np.gradient(joints[:, PELVIS, :2], axis=0), axis=1) * FPS
    s['speed_m_s'] = smooth(speed[:, None], FPS // 2)[:, 0]
    return s


def graph_frames(s: dict, width: int):
    """One image per frame: the last GRAPH_S seconds of each PANELS series, scrolling, 'now' at the right edge."""
    font = ImageFont.load_default(size=16)
    pw, n = width // len(PANELS), int(GRAPH_S * FPS)
    bg = Image.new('RGB', (width, GRAPH_H), 'white')
    d = ImageDraw.Draw(bg)
    boxes = []
    for j, (title, keys, top) in enumerate(PANELS):
        x0, x1, y0, y1 = j * pw + 48, (j + 1) * pw - 16, 30, GRAPH_H - 26
        d.text((x0, 6), title, fill='black', font=font)
        if len(keys) == 2:
            d.text((x1 - 70, 6), 'L', fill=SIDES[0][2], font=font)
            d.text((x1 - 50, 6), 'R', fill=SIDES[1][2], font=font)
        for frac in (0.0, 0.5, 1.0):
            y = y1 - frac * (y1 - y0)
            d.line((x0, y, x1, y), fill=(220, 220, 220))
            d.text((j * pw + 4, y - 9), f'{top * frac:g}', fill='gray', font=font)
        d.text((x0, y1 + 5), f'-{GRAPH_S:g} s', fill='gray', font=font)
        d.text((x1 - 30, y1 + 5), 'now', fill='gray', font=font)
        boxes.append((x0, x1, y0, y1))
    for i in range(len(s['trunk_lean'])):
        img = bg.copy()
        d = ImageDraw.Draw(img)
        lo = max(0, i - n + 1)
        xs_frac = (i - np.arange(lo, i + 1)) / (n - 1)
        for (_, keys, top), (x0, x1, y0, y1) in zip(PANELS, boxes):
            for key, color in zip(keys, [c for _, _, c in SIDES] if len(keys) == 2 else ['black']):
                ys = y1 - np.clip(s[key][lo:i + 1] / top, 0, 1) * (y1 - y0)
                if len(ys) > 1:
                    d.line(list(zip(x1 - xs_frac * (x1 - x0), ys)), fill=color, width=2)
        yield np.asarray(img)


def render(run: str, a) -> int:
    mesh_path = f'{run}/mhr.npz' if os.path.exists(f'{run}/mhr.npz') else f'{run}/smplh_canonical.npz'
    m = np.load(mesh_path)
    verts = np.einsum('lij,lvj->lvi', m['R'], m['verts'].astype(np.float32)) + m['t'][:, None]
    # OmniEgoCap's feet sink 2-4 cm into the floor (up to 20 cm on uneven ground): lift the drawn body onto it. Video
    # only: lifting the motion itself moves the camera-pinned head too (MPJPE 102.6 -> 107.2 mm on the demos)
    verts[..., 2] += smooth(np.maximum(0.0, -verts[..., 2].min(1))[:, None], 5)
    faces = m['faces']
    center = smooth(verts.mean(axis=1), FPS)      # 1 s moving average: a steady camera
    az, el = np.radians(a.azimuth), np.radians(a.elevation)
    offset = a.distance * np.array([np.cos(el) * np.cos(az), np.cos(el) * np.sin(az), np.sin(el)])

    scene = pyrender.Scene(bg_color=(1.0, 1.0, 1.0, 1.0), ambient_light=(0.35, 0.35, 0.35))
    scene.add(pyrender.Mesh.from_trimesh(checkerboard(np.median(center, axis=0)), smooth=False))
    camera = scene.add(pyrender.PerspectiveCamera(yfov=np.radians(50), aspectRatio=a.size[0] / a.size[1]))
    light = scene.add(pyrender.DirectionalLight(intensity=3.0))
    material = pyrender.MetallicRoughnessMaterial(baseColorFactor=BODY_COLOR, metallicFactor=0.0, roughnessFactor=0.7)
    renderer = pyrender.OffscreenRenderer(*a.size)

    body = None
    with imageio.get_writer(f'{run}/mesh_exo.mp4', fps=FPS, codec='libx264', quality=8, macro_block_size=1) as writer:
        for i in range(len(verts)):
            if body is not None:
                scene.remove_node(body)
            body = scene.add(pyrender.Mesh.from_trimesh(trimesh.Trimesh(verts[i], faces, process=False),
                                                        material=material, smooth=True))
            target = center[i] + [0.0, 0.0, -0.1]
            pose = look_at(target + offset, target)
            scene.set_pose(camera, pose)
            scene.set_pose(light, pose)
            writer.append_data(renderer.render(scene)[0])
    renderer.delete()

    # pose time series: CSV for analysis, and a scrolling graph strip under the two videos
    s = pose_series(np.load(f'{run}/smplh_canonical.npz')['joints'])
    np.savetxt(f'{run}/pose_timeseries.csv', np.column_stack([np.arange(len(verts)) / FPS] + list(s.values())),
               delimiter=',', fmt='%.4f', header=','.join(['time_s'] + list(s)), comments='')
    w, h = imageio.get_reader(f'{run}/input.mp4').get_meta_data()['size']
    in_w = 2 * round(a.size[1] * w / h / 2)     # ego video scaled to the mesh video's height, even width
    with imageio.get_writer(f'{run}/pose_graph.mp4', fps=FPS, codec='libx264', quality=8, macro_block_size=1) as writer:
        for frame in graph_frames(s, in_w + a.size[0]):
            writer.append_data(frame)

    subprocess.run([imageio_ffmpeg.get_ffmpeg_exe(), '-y', '-loglevel', 'error', '-i', f'{run}/input.mp4',
                    '-i', f'{run}/mesh_exo.mp4', '-i', f'{run}/pose_graph.mp4',
                    '-filter_complex', f'[0:v]scale={in_w}:{a.size[1]}[a];[a][1:v]hstack=inputs=2[top];'
                    '[top][2:v]vstack=inputs=2',
                    '-c:v', 'libx264', '-crf', '20', '-pix_fmt', 'yuv420p', '-shortest', f'{run}/side_by_side.mp4'],
                   check=True)
    return len(verts)


def manifest(run: str, frames: int, render_s: float) -> dict:
    smplh_meta = json.loads(str(np.load(f'{run}/smplh.npz')['meta']))
    timings = {}
    if os.path.exists(f'{run}/timings.tsv'):
        for line in open(f'{run}/timings.tsv'):
            stage, seconds = line.split()
            timings[stage] = round(float(seconds), 2)
    timings['render'] = round(render_s, 2)
    # a re-render keeps what later stages (narration, DAM) added to an existing manifest
    out = json.load(open(f'{run}/manifest.json')) if os.path.exists(f'{run}/manifest.json') else {}
    streams = {'ego_video': 'input.mp4', 'mesh_video': 'mesh_exo.mp4', 'side_by_side': 'side_by_side.mp4',
               'pose_graph': 'pose_graph.mp4'}
    motion = {'smplh': 'smplh.npz', 'smplh_canonical': 'smplh_canonical.npz', 'omniegocap_input': 'omniegocap_input.npz',
              'camera_trajectory': 'trajectory_aligned.npz', 'pose_timeseries': 'pose_timeseries.csv',
              'kinematics': 'kinematics'}
    out.update({
        'frames': frames,
        'fps': FPS,
        'duration_s': round(frames / FPS, 2),
        'streams': {k: v for k, v in {**out.get('streams', {}), **streams}.items() if os.path.exists(f'{run}/{v}')},
        'motion': {k: v for k, v in motion.items() if os.path.exists(f'{run}/{v}')},
        'calibration': json.load(open(f'{run}/calibration.json')) if os.path.exists(f'{run}/calibration.json') else None,
        'omniegocap': {k: smplh_meta.get(k) for k in ('runtime_s', 'load_s', 'peak_gpu_mb', 'optimization')},
        'stage_wall_s': timings,
    })
    if os.path.exists(f'{run}/mhr.npz'):
        m = np.load(f'{run}/mhr.npz')
        out['motion']['mhr'] = 'mhr.npz'
        out['mhr_fit'] = {'fit_s': float(m['fit_s']), 'lod': int(m['lod']), 'key_frames': len(m['key_frames']),
                          'vertex_error_cm_median': float(np.median(m['fit_error'])),
                          'vertex_error_cm_max': float(np.max(m['fit_error']))}
    out['realtime_factor'] = round(sum(timings.values()) / (frames / FPS), 2)   # processing seconds per video second
    with open(f'{run}/manifest.json', 'w') as f:
        json.dump(out, f, indent=2)
    return out


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--run', required=True)
    parser.add_argument('--size', type=int, nargs=2, default=[960, 720], help='Mesh video width height (even).')
    parser.add_argument('--distance', type=float, default=3.5, help='Camera distance from the body (m).')
    parser.add_argument('--azimuth', type=float, default=135.0, help='Camera direction in the world xy plane (deg).')
    parser.add_argument('--elevation', type=float, default=20.0, help='Camera height angle (deg).')
    args = parser.parse_args()
    t0 = time.time()
    n = render(args.run, args)
    print(json.dumps(manifest(args.run, n, time.time() - t0), indent=2))
