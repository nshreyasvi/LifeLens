"""
long_low_is_sitting: a short crouch stays a crouch, a low bout of SIT_S seconds or more becomes sitting.

conda activate mhr && python bench/test_insights.py
"""

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'pipeline'))
from insights import SIT_S, long_low_is_sitting  # noqa: E402

short = ['standing'] * 3 + ['crouching'] * (SIT_S - 1) + ['standing'] * 3
assert long_low_is_sitting(short) == short, 'a short crouch was changed'
long_ = ['walking'] + ['sitting', 'crouching'] * SIT_S + ['standing']
assert long_low_is_sitting(long_) == ['walking'] + ['sitting'] * 2 * SIT_S + ['standing'], long_low_is_sitting(long_)
print('ok')
