"""
HaWoR on the ego video -> camera trajectory and wrist poses for OmniEgoCap.

python pipeline/hawor_export.py --video runs/x/input.mp4 --calib runs/x/calib.npz --out_dir runs/x

Runs HaWoR's hand detection + tracking, camera-space MANO estimation and masked DROID-SLAM with Metric3D scale. HaWoR's
infiller is skipped, as in the OmniEgoCap paper's GoPro track. HaWoR caches its work in runs/x/input/.
DROID-SLAM holds at most 512 keyframes (a fast 60 s parkour clip filled them by frame ~1400), so SLAM runs on 30 s pieces
that overlap by 3 s. Each piece is moved into the first piece's world by the similarity that best maps its overlap poses
onto the previous piece's: rotation from the camera orientations, scale and offset from the camera positions.

trajectory.npz   T_world_cam (N, 4, 4) metric SLAM world (arbitrary up), time_s (N,)
wrist.npz        wrist (N, 2, 4, 4) camera frame, visible (N, 2), time_s (N,); hand 0 = left, 1 = right
points.npy       (P, 3) SLAM scene points in the trajectory's world (keyframe depth), for the floor plane
"""

import argparse
import gc
import json
import os
import sys
from argparse import Namespace

import cv2
import numpy as np
import torch
from scipy.spatial.transform import Rotation

HAWOR = os.path.abspath(os.environ.get('HAWOR_ROOT', os.path.join(os.path.dirname(__file__), '..', 'third_party', 'HaWoR')))
FPS = 30    # HaWoR extracts frames with ffmpeg at 30 fps
SLAM_PIECE, SLAM_OVERLAP = 900, 90      # frames
HAWOR_DEFAULT_FOCAL = 600.0             # HaWoR's own default without --img_focal (scripts_test_video/hawor_video.py)


def slam_piece(hawor_slam, load_slam_cam, seq_folder, imgfiles, masks, a, b, focal):
    """T_world_cam (b - a, 4, 4) of frames [a, b): HaWoR's hawor_slam run on a folder that links just those frames."""
    d, n = f'{seq_folder}/slam_{a}_{b}', b - a
    out = f'{d}/SLAM/hawor_slam_w_scale_0_{n}.npz'
    if not os.path.exists(out):
        os.makedirs(f'{d}/extracted_images', exist_ok=True)
        os.makedirs(f'{d}/tracks_0_{n}', exist_ok=True)
        for f in imgfiles[a:b]:
            if not os.path.lexists(f'{d}/extracted_images/{os.path.basename(f)}'):
                os.symlink(f, f'{d}/extracted_images/{os.path.basename(f)}')
        np.save(f'{d}/tracks_0_{n}/model_masks.npy', masks[a:b])
        gc.collect()
        torch.cuda.empty_cache()    # DROID-SLAM needs most of an 8 GB GPU: hand back what the hand models cached
        hawor_slam(Namespace(video_path=f'{d}.mp4', img_focal=focal), 0, n)
        os.remove(f'{d}/tracks_0_{n}/model_masks.npy')     # ~2 GB per piece
    _, _, R, t = load_slam_cam(out)
    T = np.tile(np.eye(4), (n, 1, 1))
    T[:, :3, :3], T[:, :3, 3] = R.numpy(), t.numpy()
    return T


def piece_points(npz: str, h0: int, w0: int, step: int = 8, max_depth: float = 6.0) -> np.ndarray:
    """(P, 3) points in meters in the piece's world: SLAM keyframe depth back-projected, every step-th SLAM pixel."""
    d = np.load(npz)
    k = np.sqrt(384 * 512 / (h0 * w0))      # HaWoR's DROID-SLAM image size (masked_droid_slam.image_stream)
    sx, sy = int(w0 * k) / w0, int(h0 * k) / h0
    f, (cx, cy), scale = float(d['img_focal']), d['img_center'], float(d['scale'])
    disp = d['disps'][:, ::step, ::step]
    v, u = np.mgrid[0:d['disps'].shape[1]:step, 0:d['disps'].shape[2]:step]
    rays = np.stack([(u - cx * sx) / (f * sx), (v - cy * sy) / (f * sy), np.ones(u.shape)], -1)
    pose = d['traj'][d['tstamp']]                                   # keyframes: t xyz, q xyzw, camera to world
    depth = scale / np.maximum(disp, 1e-6)
    p = np.einsum('nij,nhwj->nhwi', Rotation.from_quat(pose[:, 3:]).as_matrix(), rays[None] * depth[..., None])
    p += scale * pose[:, None, None, :3]
    return p[(disp > 0) & (depth < max_depth)]


def align(A, B):
    """Scale s and transform S with A ~ S @ B (translations of B scaled by s first), from the same frames' poses in two worlds."""
    R = Rotation.from_matrix(A[:, :3, :3] @ B[:, :3, :3].transpose(0, 2, 1)).mean().as_matrix()
    pa, pb = A[:, :3, 3], B[:, :3, 3] @ R.T
    da, db = pa - pa.mean(0), pb - pb.mean(0)
    s = (da * db).sum() / (db * db).sum() if (db * db).sum() > 0.01 * len(db) else 1.0    # < 10 cm of motion: keep Metric3D's
    S = np.eye(4)
    S[:3, :3], S[:3, 3] = R, pa.mean(0) - s * pb.mean(0)
    return s, S


def main(a):
    video, out_dir = os.path.abspath(a.video), os.path.abspath(a.out_dir)
    focal = a.focal or HAWOR_DEFAULT_FOCAL
    os.chdir(HAWOR)     # HaWoR loads its weights from relative paths
    sys.path.insert(0, HAWOR)
    from lib.eval_utils.custom_utils import load_slam_cam
    from scripts.scripts_test_video.detect_track_video import detect_track_video
    from scripts.scripts_test_video.hawor_slam import hawor_slam
    from scripts.scripts_test_video.hawor_video import hawor_motion_estimation

    args = Namespace(video_path=video, img_focal=focal, input_type='file', vis_mode='world',
                     checkpoint='./weights/hawor/checkpoints/hawor.ckpt',
                     infiller_weight='./weights/hawor/checkpoints/infiller.pt')
    start, end, seq_folder, imgfiles = detect_track_video(args)
    frame_chunks_all, _ = hawor_motion_estimation(args, start, end, seq_folder)

    N = len(imgfiles)
    time_s = np.arange(N) / FPS
    h0, w0 = cv2.imread(imgfiles[0]).shape[:2]
    masks = np.load(f'{seq_folder}/tracks_{start}_{end}/model_masks.npy', mmap_mode='r')
    T, scales, points = np.tile(np.eye(4), (N, 1, 1)), [], []
    for p in range(0, max(N - SLAM_OVERLAP, 1) if not a.hands_only else 0, SLAM_PIECE - SLAM_OVERLAP):
        q = min(p + SLAM_PIECE, N)
        Tp = slam_piece(hawor_slam, load_slam_cam, seq_folder, imgfiles, masks, p, q, focal)
        pts = piece_points(f'{seq_folder}/slam_{p}_{q}/SLAM/hawor_slam_w_scale_0_{q - p}.npz', h0, w0)
        if p:   # T[p:p + SLAM_OVERLAP] still holds the previous piece's poses of the overlap
            s, S = align(T[p:p + SLAM_OVERLAP], Tp[:SLAM_OVERLAP])
            Tp[:, :3, 3] *= s
            Tp = S @ Tp
            pts = s * pts @ S[:3, :3].T + S[:3, 3]
            scales.append(round(s, 3))
        m = p + SLAM_OVERLAP // 2 if p else 0
        T[m:q] = Tp[m - p:]
        points.append(pts)
    if points:
        np.savez(f'{out_dir}/trajectory.npz', T_world_cam=T, time_s=time_s)
        points = np.concatenate(points)
        np.save(f'{out_dir}/points.npy',
                points[np.random.default_rng(0).permutation(len(points))[:200_000]].astype(np.float32))

    # frames where the detector really saw each hand; HaWoR also predicts on interpolated boxes between detections
    detected = [set(), set()]
    tracks = np.load(f'{seq_folder}/tracks_{start}_{end}/model_tracks.npy', allow_pickle=True).item()
    for trk in tracks.values():
        det = np.array([t['det'] for t in trk])
        if not det.any():
            continue
        is_right = np.concatenate([t['det_handedness'] for t in trk])[det]
        hand = int(is_right.mean() >= 0.5)     # HaWoR's own left / right split
        detected[hand].update(t['frame'] for t in trk if t['det'])

    wrist = np.tile(np.eye(4), (N, 2, 1, 1))
    visible = np.zeros((N, 2), dtype=bool)
    hand_pose = np.zeros((N, 90), dtype=np.float32)
    for hand in (0, 1):
        for frames in frame_chunks_all[hand]:
            with open(f'{seq_folder}/cam_space/{hand}/{frames[0]}_{frames[-1]}.json') as f:
                pred = json.load(f)
            # MANO global_orient and transl used as the camera-frame wrist pose as they are, like OmniEgoDB's GoPro inputs
            wrist[frames, hand, :3, :3] = np.array(pred['init_root_orient'])[0]
            wrist[frames, hand, :3, 3] = np.array(pred['init_trans'])[0]
            visible[frames, hand] = [f in detected[hand] for f in frames]
            if 'init_hand_pose' in pred:
                hp = np.array(pred['init_hand_pose'])[0]
                rotvec = Rotation.from_matrix(hp.reshape(-1, 3, 3)).as_rotvec().reshape(len(frames), 45)
                offset = 0 if hand == 0 else 45
                hand_pose[frames, offset:offset + 45] = rotvec.astype(np.float32)
    np.savez(f'{out_dir}/wrist.npz', wrist=wrist, visible=visible, hand_pose=hand_pose, time_s=time_s)
    print(f'{N} frames, SLAM in {0 if a.hands_only else len(scales) + 1} pieces (scale corrections {scales}), '
          f'wrists visible {visible.mean(0).round(3).tolist()} (left, right)')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--video', required=True)
    parser.add_argument('--focal', type=float, default=None,
                        help=f'Focal length (px) of the video; HaWoR uses {HAWOR_DEFAULT_FOCAL:g} when it is not given.')
    parser.add_argument('--out_dir', required=True)
    parser.add_argument('--hands_only', action='store_true',
                        help='Wrists and finger poses only, no SLAM (the camera path comes from elsewhere).')
    main(parser.parse_args())
