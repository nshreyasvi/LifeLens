"""
SLAM trajectory + wrists -> OmniEgoCap input: gravity-aligned z-up world, floor at z = 0, calibrated head mount.

python pipeline/build_input.py --run runs/x [--calib_seconds 3] [--cam_in_head 0 0.16 0.12] [--device gopro]

OmniEgoCap's trajectory adapter needs a metric world with z up and the floor height, and the repo leaves both to the
user. Both come from the floor plane in HaWoR's own SLAM points (points.npy): its normal is up, its height the floor.
For the first --calib_seconds, stand upright, look straight ahead and keep still: that window gives the mount, the
camera's tilt and roll relative to the head (the head is assumed level and facing the camera's horizontal forward).

Reads runs/x/{trajectory,wrist}.npz and points.npy. Writes omniegocap_input.npz, trajectory_aligned.npz,
points_aligned.npy (for OmniEgoCap's viewer), cam_to_head.txt and calibration.json (quality numbers).
"""

import argparse
import json

import numpy as np
from scipy.spatial.transform import Rotation

from omniegocap.adapters.trajectory import load_trajectory


def floor_plane(points: np.ndarray, cams: np.ndarray, iters: int = 1000, tol: float = 0.03):
    """RANSAC plane with the most points within tol (m) that the cameras sit 0.9-2.2 m above (rules out walls, tables).
    Returns the unit normal pointing to the cameras, a point on the plane and the inlier fraction."""
    rng, best = np.random.default_rng(0), None
    for _ in range(iters):
        a, b, c = points[rng.choice(len(points), 3, replace=False)]
        n = np.cross(b - a, c - a)
        if np.linalg.norm(n) < 1e-9:
            continue
        n /= np.linalg.norm(n)
        height = np.median((cams - a) @ n)
        if not 0.9 < abs(height) < 2.2:
            continue
        inliers = np.abs((points - a) @ n) < tol
        if best is None or inliers.sum() > best.sum():
            best = inliers
    if best is None:
        raise ValueError('No floor plane 0.9-2.2 m below the camera in the SLAM points')
    center = points[best].mean(0)
    n = np.linalg.svd(points[best] - center)[2][-1]     # least-squares refit on the inliers
    return (n if np.median((cams - center) @ n) > 0 else -n), center, float(best.mean())


def main(a):
    run = a.run
    traj, points = np.load(f'{run}/trajectory.npz'), np.load(f'{run}/points.npy').astype(np.float64)
    T, time_s = traj['T_world_cam'].astype(np.float64), traj['time_s']

    up, on_floor, inlier_frac = floor_plane(points, T[:, :3, 3])
    T_align = np.eye(4)
    T_align[:3, :3] = Rotation.align_vectors([[0.0, 0.0, 1.0]], [up])[0].as_matrix()
    T = T_align @ T
    points = points @ T_align[:3, :3].T
    floor_z = float(T_align[:3, :3][2] @ on_floor)

    window = time_s - time_s[0] < a.calib_seconds
    if window.sum() < 10:
        raise ValueError(f'Only {window.sum()} frames in the first {a.calib_seconds} s')
    R_wc = T[window, :3, :3]

    # head during calibration: y up (world z), z forward = camera forward projected on the floor, x left
    forward = R_wc[:, :, 2].copy()
    forward[:, 2] = 0
    flat = np.linalg.norm(forward, axis=1)
    if flat.min() < 0.3:
        raise ValueError('Camera points almost straight up or down during calibration; look ahead at the start')
    forward /= flat[:, None]
    head_up = np.broadcast_to([0.0, 0.0, 1.0], forward.shape)
    R_wh = np.stack([np.cross(head_up, forward), head_up, forward], axis=2)
    R_ch = Rotation.from_matrix(np.swapaxes(R_wc, 1, 2) @ R_wh).mean().as_matrix()
    T_cam_head = np.eye(4)
    T_cam_head[:3, :3] = R_ch
    T_cam_head[:3, 3] = -R_ch @ np.array(a.cam_in_head)    # head origin seen from the camera

    np.savez(f'{run}/trajectory_aligned.npz', T_world_cam=T, time_s=time_s)
    np.save(f'{run}/points_aligned.npy', points.astype(np.float32))
    np.savetxt(f'{run}/cam_to_head.txt', T_cam_head)
    seq = load_trajectory(f'{run}/trajectory_aligned.npz', f'{run}/wrist.npz', f'{run}/cam_to_head.txt',
                          wrist_frame='camera', floor_z=floor_z, points_path=f'{run}/points_aligned.npy',
                          device=a.device)
    seq.save(f'{run}/omniegocap_input.npz')

    # camera pitch in the mount: angle of the camera's forward axis below the head's forward axis
    cam_fwd_in_head = R_ch.T @ np.array([0.0, 0.0, 1.0])
    cam_height = float(np.median(T[window, 2, 3])) - floor_z
    report = {
        'floor_inlier_fraction': round(inlier_frac, 3),
        'floor_z_slam': round(floor_z, 3),
        'cam_height_m': round(cam_height, 3),
        'mount_pitch_down_deg': round(float(np.degrees(np.arcsin(-cam_fwd_in_head[1]))), 1),
        'calib_window_motion_m': round(float(np.ptp(T[window, :3, 3], axis=0).max()), 3),
        'head_height_median_m': round(float(np.median(seq.head[:, 2, 3])), 3),
        'path_length_m': round(float(np.linalg.norm(np.diff(seq.head[:, :3, 3], axis=0), axis=1).sum()), 2),
        'frames': len(seq),
        'wrist_visible_fraction': seq.visible.mean(0).round(3).tolist(),
    }
    with open(f'{run}/calibration.json', 'w') as f:
        json.dump(report, f, indent=2)
    print(json.dumps(report, indent=2))
    if not 1.2 < cam_height < 2.0:
        print(f'WARNING: camera {cam_height:.2f} m above the fitted floor at the start; floor or SLAM scale may be off')
    if report['calib_window_motion_m'] > 0.3:
        print('WARNING: camera moved > 0.3 m during the calibration window; floor and mount tilt may be off')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--run', required=True, help='Run folder.')
    parser.add_argument('--calib_seconds', type=float, default=3.0)
    parser.add_argument('--cam_in_head', type=float, nargs=3, default=[0.0, 0.16, 0.12],
                        help='Camera lens position in the SMPL-H head-joint frame (x left, y up, z forward), meters. '
                             'Default: forehead mount, ~16 cm above and ~12 cm in front of the head joint.')
    parser.add_argument('--device', default='', help="'gopro' draws the GoPro mesh in OmniEgoCap's viewer.")
    main(parser.parse_args())
