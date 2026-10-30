"""
Check of hawor_export.align, which joins the SLAM pieces: a known similarity between two worlds must be recovered.

conda activate hawor && python bench/test_slam_align.py
"""

import os
import sys

import numpy as np
from scipy.spatial.transform import Rotation

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'pipeline'))
from hawor_export import align  # noqa: E402

rng = np.random.default_rng(0)
B = np.tile(np.eye(4), (90, 1, 1))
B[:, :3, :3] = Rotation.random(90, random_state=1).as_matrix()
B[:, :3, 3] = np.cumsum(rng.normal(scale=0.05, size=(90, 3)), axis=0)     # a 3 s walk-like path
R, s, t = Rotation.random(random_state=2).as_matrix(), 1.15, np.array([3.0, -1.0, 0.5])
A = B.copy()
A[:, :3, :3] = R @ B[:, :3, :3]
A[:, :3, 3] = s * B[:, :3, 3] @ R.T + t

s_est, S = align(A, B)
B2 = B.copy()
B2[:, :3, 3] *= s_est
assert abs(s_est - s) < 1e-6 and np.allclose(S @ B2, A, atol=1e-6), (s_est, S)

B[:, :3, 3] = 0     # a camera standing still: no scale information, keep 1
assert align(B, B)[0] == 1.0
print('SLAM alignment check passed')
