"""
Fit Meta's MHR body model to OmniEgoCap's SMPL-H bodies with the fitter of MHR's official SMPL -> MHR converter, one
identity per video.

python pipeline/to_mhr.py --run runs/x [--stride 3] [--lod 1] [--official]

SMPL-H shares SMPL's 6890-vertex topology, so the converter's SMPL surface mapping applies as is. The fit runs on the
root-frame bodies (upright, at the origin: the converter's initialization) and the result is moved back to the world.
The converter fits every frame from the rest pose with ~600 Adam steps (~0.5 s per frame on an RTX 4060 laptop).
Instead, every 12th frame is fitted from scratch (body shape + pose, half the converter's schedule), then every
--stride-th frame is warm-started from those, interpolated, and refined with MHR's own tracking schedule (104 steps).
Frames in between get linearly interpolated pose parameters (root frame: no large rotations to wrap).
On a 10 s OmniEgoCap walk: 21 s instead of 63 s for the official fit at the same stride, vertex error 0.66 vs 0.64 cm
median, 1.36 vs 1.29 cm p99. Stride 3 interpolation added 2 mm mean / 19 mm p99 joint error; stride 6 added 8 / 72 mm.
--official runs the converter's own fit instead, in case fit_error is high on harder motion.

mhr.npz
    lbs_model_params (L, 204), identity_coeffs (1, 45), face_expr_coeffs (L, 72)   MHR parameters in the root frame
    R (L, 3, 3), t (L, 3)    root frame -> z-up world in meters: v_world = R @ v + t
    verts (L, V, 3) float16  MHR mesh in the root frame, meters (apply R, t for the world)
    fit_error (L,)           mean MHR-to-SMPL-H vertex distance per frame (interpolated frames included), centimeters
    key_frames (K,), faces (F, 3), frame_valid (L,)
"""

import argparse
import os
import sys
import time

import numpy as np
import torch

MHR_ROOT = os.path.abspath(os.environ.get('MHR_ROOT', os.path.join(os.path.dirname(__file__), '..', 'third_party', 'MHR')))
TOOL = os.path.join(MHR_ROOT, 'tools', 'mhr_smpl_conversion')
sys.path.insert(0, TOOL)
from conversion import Conversion  # noqa: E402
from mhr.mhr import MHR  # noqa: E402
from pytorch_fitting import PyTorchMHRFitting  # noqa: E402

COARSE = 12                                              # frames between from-scratch fits
COARSE_ITERS = [[10, 100], [10, 40, 40], [100]]          # half the converter's default [[20, 200], [20, 80, 80], [200]]
TRACK_ITERS = [[0, 0], [4, 10, 10], [80]]                # MHR's tracking schedule (pytorch_fitting.OptimizationConstants)
TRACK_LR = [[0.1, 0.02], [0.01, 0.01, 0.01], [0.002]]
IDENTITY = ('scale_params', 'body_identity_coeffs', 'head_identity_coeffs', 'hand_identity_coeffs')


class SMPLTopology(torch.nn.Module):
    """Stand-in for smplx.SMPL: the converter's vertex-input path only reads v_template.shape and faces."""

    def __init__(self, faces: np.ndarray, num_verts: int = 6890):
        super().__init__()
        self.register_buffer('v_template', torch.zeros(num_verts, 3))
        self.faces = faces.astype(np.int64)


def interp(x, xp, fp):
    """Linear interpolation of each column of fp (K, D) from frames xp to frames x."""
    return np.stack([np.interp(x, xp, c) for c in fp.T], axis=1).astype(np.float32)


def fit_coarse_to_fine(converter, target, key, device):
    """MHR parameters on frames key: from scratch on every COARSE-th frame, then warm-started tracking on key."""
    converter._s2m_load_masks()
    solver = PyTorchMHRFitting(mhr_model=converter._mhr_model, mhr_edges=converter._mhr_edges,
                               mhr_vertex_mask=converter._mhr_vertex_mask, mhr_param_masks=converter._mhr_param_masks,
                               device=device)

    def optimize(frames, **kw):     # like PyTorchMHRFitting.fit: fit centered bodies, the center goes back in below
        t = target[frames]
        center = 0.5 * (t.amax(1, keepdim=True) + t.amin(1, keepdim=True))
        return solver._optimize_mhr(t - center, single_identity=True, exclude_expression=True, **kw), center

    coarse = np.union1d(np.arange(0, len(target), COARSE), [len(target) - 1])
    vc, _ = optimize(coarse, stage_iterations=COARSE_ITERS)
    known = {n: vc[n].detach() for n in IDENTITY}
    init = {n: torch.from_numpy(interp(key, coarse, vc[n].detach().cpu().numpy())).to(device)
            for n in ('rots', 'transls', 'pose_params')}
    v, center = optimize(key, stage_iterations=TRACK_ITERS, learning_rates=TRACK_LR, known_parameters=known,
                         initial_parameter_values=init)
    v.update(known)
    solver._concat_mhr_parameters(v)
    with torch.no_grad():
        v['lbs_model_params'][:, :3] += 0.1 * center[:, 0]
    return {n: v[n].detach().cpu().numpy() for n in ('lbs_model_params', 'identity_coeffs', 'face_expr_coeffs')}


def main(a):
    run = os.path.abspath(a.run)
    os.chdir(TOOL)      # the converter loads its mapping files from ./assets
    src = np.load(f'{run}/smplh_canonical.npz')
    device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
    mhr = MHR.from_files(device=device, lod=a.lod)
    converter = Conversion(mhr_model=mhr, smpl_model=SMPLTopology(src['faces']), method='pytorch')

    t0 = time.time()
    smplh = torch.from_numpy(src['verts']).float()
    L = len(smplh)
    target = converter._compute_target_vertices(smplh.to(device), 'smpl2mhr')
    key = np.union1d(np.arange(0, L, a.stride), [L - 1])
    if a.official:
        res = converter.convert_smpl2mhr(smpl_vertices=smplh[key], single_identity=True, return_mhr_parameters=True,
                                         return_fitting_errors=False)
        key_params = {k: v.detach().cpu().numpy() for k, v in res.result_parameters.items()}
    else:
        key_params = fit_coarse_to_fine(converter, target, key, device)
    params = {'identity_coeffs': key_params['identity_coeffs'][:1]}
    for k in ('lbs_model_params', 'face_expr_coeffs'):
        params[k] = interp(np.arange(L), key, key_params[k])
    on_device = {k: torch.from_numpy(v).to(device) for k, v in params.items()}
    _, verts = converter._mhr_para2mesh(on_device, return_mesh=False)
    err = np.asarray(converter._s2m_evaluate_conversion_error(on_device, target))
    fit_s = time.time() - t0

    np.savez_compressed(f'{run}/mhr.npz', **params, R=src['R'], t=src['t'], frame_valid=src['frame_valid'],
                        verts=(verts / 100.0).astype(np.float16),     # MHR works in centimeters
                        faces=np.asarray(mhr.character.mesh.faces), fit_error=err, key_frames=key, fit_s=fit_s,
                        lod=a.lod)
    print(f'MHR fit: {len(key)} key frames of {L} in {fit_s:.1f} s, vertex error median {np.median(err):.2f} cm / '
          f'max {err.max():.2f} cm')
    if np.median(err) > 2 and not a.official:   # 0.7 cm on the test walk
        print('WARNING: high MHR fit error; delete mhr.npz and rerun with --official')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--run', required=True)
    parser.add_argument('--stride', type=int, default=3, help='Fit every n-th frame, interpolate the rest (1 = all).')
    parser.add_argument('--lod', type=int, default=1, help='MHR level of detail (0 = finest ... 6 = coarsest).')
    parser.add_argument('--official', action='store_true', help="The converter's own fit (3x slower).")
    main(parser.parse_args())
