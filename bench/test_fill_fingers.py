"""
fill_fingers: short gaps interpolated, long gaps eased to the clip's average hand, no flat-hand frames left.

conda activate omniegocap && python bench/test_fill_fingers.py
"""

import os
import sys

import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'pipeline'))
from run_omniegocap import fill_fingers  # noqa: E402

hp = np.zeros((100, 15, 3), dtype=np.float32)
hp[0:10, :, 0] = 0.2            # finger bend 0.2 rad, then a 10-frame gap,
hp[20:30, :, 0] = 0.6           # bend 0.6 rad, then a 70-frame gap to the end
out = fill_fingers(hp, sigma=0.5)
assert np.abs(out).sum(axis=(1, 2)).min() > 0, 'a frame was left flat'
assert abs(out[15, 0, 0] - 0.4) < 0.03, out[15, 0, 0]         # middle of the short gap: halfway
assert abs(out[90, 0, 0] - 0.4) < 0.03, out[90, 0, 0]         # deep in the long gap: the average hand (0.2 and 0.6)
assert np.abs(np.diff(out[:, 0, 0])).max() < 0.06, 'a jump'    # no snaps: <= 0.4 rad over the 8-frame ease
print('fill_fingers OK')
