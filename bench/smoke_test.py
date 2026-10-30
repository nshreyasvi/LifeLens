"""
End-to-end smoke test without HaWoR: fakes what the ingest, calibrate and hawor stages write (a walk seen from a
head-mounted camera in a randomly rotated "SLAM" world), runs the rest of pipeline/run.py, then checks that
build_input recovered the true gravity, floor and mount tilt, and that every stream and the pose time series exist.

conda activate omniegocap && python bench/smoke_test.py

Without the licensed SMPL-H it uses a stand-in (bench/fake_smplh.py): meshes are then meaningless, timings still real.
"""

import json
import os
import shutil
import subprocess

import numpy as np
from scipy.spatial.transform import Rotation

from fake_smplh import make as make_fake_smplh

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RUN = os.path.join(ROOT, 'runs', '_smoke')
SMPLH = os.path.join(ROOT, 'third_party', 'OmniEgoCap', 'data', 'smplh', 'SMPLH_NEUTRAL.npz')
N, FPS = 300, 30
CAM_HEIGHT, PITCH_DOWN = 1.70, 25.0
CAM_IN_HEAD = np.array([0.0, 0.16, 0.12])   # build_input.py's default mount


def make_T(R, t):
    T = np.tile(np.eye(4), R.shape[:-2] + (1, 1))
    T[..., :3, :3], T[..., :3, 3] = R, t
    return T


def synth(rng):
    t = np.arange(N) / FPS
    walk = np.clip(t - 3.0, 0, None)          # still for the 3 s calibration window, then walk along +x
    yaw = np.radians(5) * np.sin(np.pi * walk)
    forward = np.stack([np.cos(yaw), np.sin(yaw), np.zeros(N)], 1)
    up = np.tile([0.0, 0.0, 1.0], (N, 1))
    R_wh = np.stack([np.cross(up, forward), up, forward], 2)                         # head: x left, y up, z forward
    head = np.stack([1.2 * walk, np.zeros(N), CAM_HEIGHT - 0.16 + 0.02 * np.sin(4 * np.pi * walk)], 1)

    R_hc = Rotation.from_euler('x', PITCH_DOWN, degrees=True).as_matrix() @ np.diag([-1.0, -1.0, 1.0])
    T_wc = make_T(R_wh @ R_hc, head + R_wh @ CAM_IN_HEAD)
    T_slam_w = make_T(Rotation.random(random_state=1).as_matrix(), np.array([5.0, -3.0, 2.0]))
    np.savez(f'{RUN}/trajectory.npz', T_world_cam=T_slam_w @ T_wc, time_s=t)

    # SLAM points: the floor plus a wall and a table top, which the floor fit has to reject
    floor = np.c_[rng.uniform(-2, 12, (6000, 2)), np.zeros(6000)]
    wall = np.c_[np.full(4000, 13.0), rng.uniform(-3, 3, 4000), rng.uniform(0, 3, 4000)]
    table = np.c_[rng.uniform(2, 3, (3000, 2)), np.full(3000, 0.75)]
    pts = np.concatenate([floor, wall, table]) + rng.normal(scale=0.01, size=(13000, 3))
    np.save(f'{RUN}/points.npy', (pts @ T_slam_w[:3, :3].T + T_slam_w[:3, 3]).astype(np.float32))

    swing = 0.15 * np.sin(2 * np.pi * walk)[:, None]
    wrist_w = np.stack([make_T(R_wh, head + R_wh @ [0.2, -0.45, 0.35] + swing * forward),
                        make_T(R_wh, head + R_wh @ [-0.2, -0.45, 0.35] - swing * forward)], 1)
    visible = np.stack([np.sin(t) > -0.3, np.cos(t) > -0.3], 1)
    np.savez(f'{RUN}/wrist.npz', wrist=np.linalg.inv(T_wc)[:, None] @ wrist_w, visible=visible, time_s=t)

    subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-f', 'lavfi', '-i', f'testsrc=size=1280x720:rate={FPS}',
                    '-frames:v', str(N), '-pix_fmt', 'yuv420p', f'{RUN}/input.mp4'], check=True)


def main():
    shutil.rmtree(RUN, ignore_errors=True)     # run.py skips stages whose outputs exist
    os.makedirs(RUN)
    synth(np.random.default_rng(0))
    real = os.path.isfile(SMPLH)
    env = dict(os.environ)
    if not real:
        make_fake_smplh(f'{RUN}/fake_smplh/SMPLH_NEUTRAL.npz')
        env['OMNIEGOCAP_SMPLH_DIR'] = f'{RUN}/fake_smplh'
    subprocess.run(['python', f'{ROOT}/pipeline/run.py', f'{RUN}/input.mp4', '_smoke'], env=env, check=True)

    c = json.load(open(f'{RUN}/calibration.json'))
    m = json.load(open(f'{RUN}/manifest.json'))
    assert abs(c['head_height_median_m'] - (CAM_HEIGHT - 0.16)) < 0.05, c
    assert abs(c['cam_height_m'] - CAM_HEIGHT) < 0.05, c                      # floor plane found, not the wall or table
    assert abs(c['mount_pitch_down_deg'] - PITCH_DOWN) < 1.5, c
    assert abs(c['path_length_m'] - 1.2 * (N / FPS - 3)) < 0.5, c
    assert m['frames'] == N, m
    for f in list(m['streams'].values()) + list(m['motion'].values()):
        assert os.path.getsize(f'{RUN}/{f}') > 0, f
    k = np.genfromtxt(f'{RUN}/kinematics/joints_world.csv', delimiter=',', names=True)
    assert len(k) == N and np.load(f'{RUN}/kinematics/joint_rotations.npy').shape == (N, 52, 3), k.dtype.names[:4]
    s = np.genfromtxt(f'{RUN}/pose_timeseries.csv', delimiter=',', names=True)
    assert len(s) == N and np.isfinite(s['knee_l']).all(), s.dtype.names
    print(f'SMOKE TEST PASSED ({"real" if real else "stand-in"} SMPL-H)')


if __name__ == '__main__':
    main()
