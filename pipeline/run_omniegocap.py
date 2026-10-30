"""
OmniEgoCap inference -> SMPL-H motion, plus the SMPL-H body in its root frame for the MHR fit.

python pipeline/run_omniegocap.py --run runs/x [--optimization]

The wrist guidance optimization is off by default: on the paper's GoPro track (HaWoR wrists, Table 3) it left body error
unchanged (111.7 -> 112.2 mm), raised jitter 71% (jerk 0.073 -> 0.125), and costs 2-3x runtime on an RTX 4060 laptop.

Writes
    smplh.npz             OmniEgoCap's output (AMASS SMPL-H layout, see omniegocap/io/smplh.py), meta.runtime_s = model time
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
from scipy.spatial.transform import Rotation

from omniegocap.core.inference import OmniEgoCap
from omniegocap.io.sequence import EgoSequence
from omniegocap.utils.paths import repo_path

CHUNK = 512
BODY = ('pelvis', 'left_hip', 'right_hip', 'spine1', 'left_knee', 'right_knee', 'spine2', 'left_ankle', 'right_ankle',
        'spine3', 'left_foot', 'right_foot', 'neck', 'left_collar', 'right_collar', 'head', 'left_shoulder',
        'right_shoulder', 'left_elbow', 'right_elbow', 'left_wrist', 'right_wrist')
FINGERS = [f'{s}_{f}{i}' for s in ('left', 'right') for f in ('index', 'middle', 'pinky', 'ring', 'thumb') for i in (1, 2, 3)]


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
    result.meta.update(load_s=load_s, peak_gpu_mb=torch.cuda.max_memory_allocated() / 2**20)
    result.save(f'{a.run}/smplh.npz')

    # root-frame bodies in chunks: skinning all frames at once needs ~0.45 MB of VRAM per frame
    bm = model.body_model
    dev = bm.shapedirs.device
    betas = torch.from_numpy(result.betas).to(dev)[None]
    hand_file = f'{a.run}/wrist.npz'
    if os.path.exists(hand_file) and 'hand_pose' in np.load(hand_file):
        hand_pose_all = np.load(hand_file)['hand_pose'].astype(np.float32)
    else:
        hand_pose_all = np.zeros((len(result), 90), dtype=np.float32)
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
    main(parser.parse_args())
