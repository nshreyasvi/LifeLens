"""
Stand-in SMPL-H file for smoke tests and latency benchmarks only, while the licensed SMPL-H is not downloaded.

python bench/fake_smplh.py <dir>     -> <dir>/SMPLH_NEUTRAL.npz

Same array shapes and kinematic tree as SMPL-H, with a crude body: blobs of vertices around rough SMPL rest joints.
Timings match the real model (same sizes); poses and meshes are meaningless.
"""

import os
import sys

import numpy as np

V, F, J = 6890, 13776, 52
BODY_PARENTS = [-1, 0, 0, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 9, 9, 12, 13, 14, 16, 17, 18, 19]
BODY_JOINTS = [
    (0.00, -0.22, 0.03), (0.06, -0.31, 0.02), (-0.06, -0.31, 0.02), (0.00, -0.11, 0.00), (0.10, -0.69, 0.02),
    (-0.10, -0.69, 0.02), (0.00, 0.03, 0.03), (0.09, -1.09, -0.02), (-0.09, -1.09, -0.02), (0.00, 0.08, 0.03),
    (0.12, -1.15, 0.10), (-0.12, -1.15, 0.10), (0.00, 0.29, 0.00), (0.08, 0.20, 0.01), (-0.08, 0.20, 0.01),
    (0.00, 0.36, 0.05), (0.17, 0.23, -0.01), (-0.17, 0.23, -0.01), (0.43, 0.21, -0.03), (-0.43, 0.21, -0.03),
    (0.68, 0.22, -0.03), (-0.68, 0.22, -0.03),
]


def make(path: str, seed: int = 0) -> None:
    rng = np.random.default_rng(seed)
    parents, joints = list(BODY_PARENTS), [np.array(j) for j in BODY_JOINTS]
    for wrist, side in ((20, 1.0), (21, -1.0)):     # 5 fingers x 3 joints per hand
        for finger in range(5):
            for k in range(3):
                parents.append(wrist if k == 0 else len(parents) - 1)
                joints.append(joints[wrist] + [side * (0.03 + 0.025 * k), 0.0, 0.02 * (finger - 2)])
    joints = np.array(joints)

    owner = rng.integers(0, 22, V)                  # vertices sit on body joints only
    v_template = joints[owner] + rng.normal(scale=0.04, size=(V, 3))
    weights = np.zeros((V, J))
    weights[np.arange(V), owner] = 1.0
    J_regressor = np.zeros((J, V))
    for j in range(22):
        own = owner == j
        J_regressor[j, own] = 1.0 / own.sum()
        v_template[own] += joints[j] - v_template[own].mean(0)     # regress exactly onto the joint
    J_regressor[22:37], J_regressor[37:] = J_regressor[20], J_regressor[21]    # finger joints sit on the wrists
    faces = np.stack([rng.choice(np.flatnonzero(owner == o), 3) for o in rng.integers(0, 22, F)])

    os.makedirs(os.path.dirname(path) or '.', exist_ok=True)
    np.savez(path, v_template=v_template, f=faces, J_regressor=J_regressor, weights=weights,
             kintree_table=np.array([[p if p >= 0 else 4294967295 for p in parents], list(range(J))], dtype=np.int64),
             shapedirs=rng.normal(scale=1e-3, size=(V, 3, 16)), posedirs=np.zeros((V, 3, (J - 1) * 9)))
    assert np.allclose(J_regressor[:22] @ v_template, joints[:22], atol=1e-6)


if __name__ == '__main__':
    make(os.path.join(sys.argv[1], 'SMPLH_NEUTRAL.npz'))
