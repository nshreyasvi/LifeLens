"""
OmniEgoCap inference -> SMPL-H motion with HaWoR's finger poses, plus the SMPL-H body in its root frame for rendering.

python pipeline/run_omniegocap.py --run runs/x [--optimization] [--smooth 2]

The wrist guidance optimization is off by default: on the paper's GoPro track (HaWoR wrists, Table 3) it left body error
unchanged (111.7 -> 112.2 mm), raised jitter 71% (jerk 0.073 -> 0.125), and costs 2-3x runtime on an RTX 4060 laptop.

--smooth: Gaussian smoothing of the body over time (sigma in frames). On our three OmniEgoDB GoPro demos sigma 2 cut jerk
0.075 -> 0.016 with MPJPE 103.0 -> 102.6 mm and hand error 135.7 -> 134.0 mm: OmniEgoCap's output shakes, the body doesn't.
Fingers: HaWoR only estimates them where it detects the hand (median run 1-2 frames), so short gaps are interpolated and
long ones ease to the clip's average hand, instead of snapping to a flat hand 4-6 times a second.

Writes
    smplh.npz             OmniEgoCap's output (AMASS SMPL-H layout, see omniegocap/io/smplh.py) smoothed, with fingers,
                          meta.runtime_s = model time
    smplh_canonical.npz   verts (L, 6890, 3) body with zero root rotation and translation (meters, y up, z forward),
                          R (L, 3, 3), t (L, 3) root frame -> z-up world: v_world = R @ v + t, faces (F, 3),
                          joints (L, 22, 3) world, frame_valid (L,)
"""

import argparse
import json
import os
import time

import numpy as np
import torch
from scipy.ndimage import gaussian_filter1d
from scipy.spatial.transform import Rotation

from omniegocap.core.inference import OmniEgoCap
from omniegocap.io.sequence import EgoSequence
from omniegocap.utils.paths import repo_path

CHUNK = 512
BODY = ('pelvis', 'left_hip', 'right_hip', 'spine1', 'left_knee', 'right_knee', 'spine2', 'left_ankle', 'right_ankle',
        'spine3', 'left_foot', 'right_foot', 'neck', 'left_collar', 'right_collar', 'head', 'left_shoulder',
        'right_shoulder', 'left_elbow', 'right_elbow', 'left_wrist', 'right_wrist')
FINGERS = [f'{s}_{f}{i}' for s in ('left', 'right') for f in ('index', 'middle', 'pinky', 'ring', 'thumb') for i in (1, 2, 3)]


def smooth_rot(rotvec: np.ndarray, sigma: float) -> np.ndarray:
    """(L, J, 3) axis-angle smoothed over time: sign-aligned quaternions, Gaussian, renormalized."""
    q = Rotation.from_rotvec(rotvec.reshape(-1, 3)).as_quat().reshape(*rotvec.shape[:-1], 4)
    for t in range(1, len(q)):
        q[t] *= np.sign((q[t] * q[t - 1]).sum(-1, keepdims=True) + 1e-12)
    q = gaussian_filter1d(q, sigma, axis=0, mode='nearest')
    q /= np.linalg.norm(q, axis=-1, keepdims=True)
    return Rotation.from_quat(q.reshape(-1, 4)).as_rotvec().reshape(rotvec.shape).astype(np.float32)


def fill_fingers(hp: np.ndarray, max_gap: int = 15, ease: int = 8, sigma: float = 1.5) -> np.ndarray:
    """(L, 15, 3) one hand's finger poses, zero where HaWoR made no estimate. Gaps up to max_gap frames: interpolated
    between the estimates on either side. Longer gaps: eased from the nearest estimate to the clip's average hand."""
    on = np.any(hp != 0, axis=(1, 2))
    if not on.any():
        return hp
    quat = lambda x: Rotation.from_rotvec(x.reshape(-1, 3)).as_quat().reshape(-1, 15, 4)
    rest = np.stack([Rotation.from_rotvec(hp[on, j]).mean().as_rotvec() for j in range(15)])
    L, idx = len(hp), np.arange(len(hp))
    prev = np.maximum.accumulate(np.where(on, idx, -1))
    nxt = np.minimum.accumulate(np.where(on, idx, L)[::-1])[::-1]
    off = np.where(~on)[0]
    p, n = prev[off], nxt[off]
    bridge = (p >= 0) & (n < L) & (n - p - 1 <= max_gap)
    near = np.where((p >= 0) & ((n >= L) | (off - p <= n - off)), p, n)
    q0 = quat(hp[np.where(bridge, p, near)])
    q1 = np.where(bridge[:, None, None], quat(hp[np.where(bridge, n, 0)]), quat(np.repeat(rest[None], len(off), 0)))
    q1 *= np.sign((q0 * q1).sum(-1, keepdims=True) + 1e-12)
    w = np.where(bridge, (off - p) / np.maximum(n - p, 1), np.minimum(np.abs(off - near) / ease, 1.0))[:, None, None]
    m = (1 - w) * q0 + w * q1
    out = hp.copy()
    out[off] = Rotation.from_quat((m / np.linalg.norm(m, axis=-1, keepdims=True)).reshape(-1, 4)).as_rotvec().reshape(-1, 15, 3)
    return smooth_rot(out, sigma)


def export_kinematics(run: str, result, seq, joints_world: np.ndarray, hand_pose: np.ndarray):
    """The motion as plain .npy arrays and .csv tables in runs/x/kinematics/, for tools outside this pipeline."""
    out = f'{run}/kinematics'
    os.makedirs(out, exist_ok=True)
    L = len(joints_world)
    t = np.arange(L) / 30.0
    rotations = np.concatenate([result.root_orient[:, None], result.pose_body.reshape(L, 21, 3),
                                hand_pose.reshape(L, 30, 3)], axis=1)          # SMPL-H axis-angle, parent-relative
    arrays = {'time_s': t, 'joints_world': joints_world, 'joint_rotations': rotations, 'root_trans': result.trans,
              'betas': result.betas, 'frame_valid': result.frame_valid, 'head_world': seq.head,
              'wrist_world': seq.wrist, 'wrist_visible': seq.visible}
    for name, x in arrays.items():
        np.save(f'{out}/{name}.npy', np.asarray(x, dtype=np.float32 if name != 'frame_valid' else bool))
    for name, x, cols in (('joints_world', joints_world, BODY), ('joint_rotations', rotations, ('root',) + BODY[1:] + tuple(FINGERS))):
        header = ','.join(['time_s'] + [f'{c}_{a}' for c in cols for a in 'xyz'])
        np.savetxt(f'{out}/{name}.csv', np.column_stack([t, x.reshape(L, -1)]), delimiter=',', fmt='%.5f', header=header,
                   comments='')


def main(a):
    t0 = time.time()
    model = OmniEgoCap(a.checkpoint)
    load_s = time.time() - t0
    seq = EgoSequence.load(f'{a.run}/omniegocap_input.npz')

    torch.cuda.reset_peak_memory_stats()
    result = model.predict(seq, optimization=a.optimization)
    result.meta.update(load_s=load_s, peak_gpu_mb=torch.cuda.max_memory_allocated() / 2**20, smooth_sigma=a.smooth)
    if a.smooth > 0:
        rot = smooth_rot(np.concatenate([result.root_orient[:, None], result.pose_body.reshape(-1, 21, 3)], 1), a.smooth)
        result.root_orient, result.pose_body = rot[:, 0], rot[:, 1:].reshape(-1, 63)
        result.trans = gaussian_filter1d(result.trans, a.smooth, axis=0, mode='nearest').astype(np.float32)

    hand_file = f'{a.run}/wrist.npz'
    if os.path.exists(hand_file) and 'hand_pose' in np.load(hand_file):
        hand_pose_all = np.load(hand_file)['hand_pose'].astype(np.float32).reshape(-1, 2, 15, 3)
        hand_pose_all = np.stack([fill_fingers(hand_pose_all[:, h]) for h in (0, 1)], 1).reshape(-1, 90)
    else:
        hand_pose_all = np.zeros((len(result), 90), dtype=np.float32)
    result.save(f'{a.run}/smplh.npz')
    with np.load(f'{a.run}/smplh.npz', allow_pickle=True) as f:     # SMPLHSequence.save writes flat hands
        saved = dict(f)
    saved['poses'][:, 66:] = hand_pose_all
    np.savez(f'{a.run}/smplh.npz', **saved)

    # root-frame bodies in chunks: skinning all frames at once needs ~0.45 MB of VRAM per frame
    bm = model.body_model
    dev = bm.shapedirs.device
    betas = torch.from_numpy(result.betas).to(dev)[None]
    verts, joints = [], []
    with torch.no_grad():
        for s in range(0, len(result), CHUNK):
            pose = torch.from_numpy(result.pose_body[s:s + CHUNK]).to(dev)
            hp = torch.from_numpy(hand_pose_all[s:s + CHUNK]).to(dev)
            zeros = torch.zeros(len(pose), 3, device=dev)
            body = bm(root_orient=zeros, pose_body=pose, pose_hand=hp, trans=zeros, betas=betas)
            verts.append(body.v.cpu().numpy())
            joints.append(body.Jtr[:, :22].cpu().numpy())
    verts, joints = np.concatenate(verts), np.concatenate(joints)

    # SMPL: v_world = R (v_rest - J0) + J0 + trans, so the root-frame body maps to the world with t = J0 + trans - R J0
    J0 = joints[0, 0]
    R = Rotation.from_rotvec(result.root_orient).as_matrix().astype(np.float32)
    t = J0 + result.trans - R @ J0
    joints_world = np.einsum('lij,lkj->lki', R, joints) + t[:, None]
    np.savez(f'{a.run}/smplh_canonical.npz', verts=verts, R=R, t=t, faces=bm.f.cpu().numpy(),
             joints=joints_world, frame_valid=result.frame_valid, pose_hand=hand_pose_all)
    export_kinematics(a.run, result, seq, joints_world, hand_pose_all)
    print(json.dumps({k: result.meta[k] for k in ('runtime_s', 'load_s', 'peak_gpu_mb', 'optimization')}, default=float))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--run', required=True)
    parser.add_argument('--checkpoint', default=repo_path('checkpoints', 'omniegocap.pt'))
    parser.add_argument('--optimization', action='store_true', help='Wrist guidance optimization: slightly better hand '
                        'position, jerkier body, 2-3x slower. Worth trying with accurate wrists (e.g. headset tracking).')
    parser.add_argument('--smooth', type=float, default=2.0, help='Body smoothing sigma in frames (0 = raw OmniEgoCap).')
    main(parser.parse_args())
