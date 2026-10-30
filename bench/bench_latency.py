"""
OmniEgoCap latency on this GPU: real checkpoint, stand-in SMPL-H (same sizes), synthetic walk with both wrists seen 70%
of the time, with and without the wrist guidance optimization. Best of two runs per setting (laptop clocks vary).

conda activate omniegocap && python bench/bench_latency.py [--lengths 300 900 1800 3600]

Prints a table and writes bench/latency_<gpu>.json.
(torch.compile of FlexAttention was also measured: no gain at these lengths, plus 6-30 s of compile per clip length.)
"""

import argparse
import json
import os

import numpy as np
import torch

from fake_smplh import make as make_fake_smplh
from omniegocap.core.inference import OmniEgoCap
from omniegocap.io.sequence import EgoSequence
from omniegocap.utils.paths import repo_path

HERE = os.path.dirname(os.path.abspath(__file__))


def walk(L: int, rng) -> EgoSequence:
    t = np.arange(L) / 30
    head = np.tile(np.eye(4), (L, 1, 1))
    head[:, :3, :3] = [[0, 0, 1], [1, 0, 0], [0, 1, 0]]      # x left, y up, z forward, facing world +x
    head[:, :3, 3] = np.stack([1.2 * t, np.zeros(L), 1.55 + 0.02 * np.sin(4 * np.pi * t)], 1)
    wrist = np.repeat(head[:, None], 2, axis=1)
    wrist[:, 0, :3, 3] += [0.35, 0.2, -0.45]
    wrist[:, 1, :3, 3] += [0.35, -0.2, -0.45]
    return EgoSequence(head=head, wrist=wrist, visible=rng.random((L, 2)) < 0.7)


def main(a):
    smplh_dir = os.path.join(HERE, '_fake_smplh')
    make_fake_smplh(os.path.join(smplh_dir, 'SMPLH_NEUTRAL.npz'))
    model = OmniEgoCap(a.checkpoint, smplh_dir=smplh_dir)
    rng = np.random.default_rng(0)
    for opt in (False, True):                                 # CUDA, cuBLAS and theseus warm-up
        model.predict(walk(64, rng), optimization=opt)

    rows = []
    for L in a.lengths:
        seq = walk(L, rng)
        for opt in (False, True):
            row = {'frames': L, 'video_s': L / 30, 'optimization': opt}
            try:
                torch.cuda.reset_peak_memory_stats()
                runtime = min(model.predict(seq, optimization=opt).meta['runtime_s'] for _ in range(2))
                row.update(runtime_s=round(runtime, 2), realtime_factor=round(runtime / (L / 30), 3),
                           peak_gpu_mb=round(torch.cuda.max_memory_allocated() / 2**20))
            except torch.OutOfMemoryError:
                row['runtime_s'] = 'OOM'
            torch.cuda.empty_cache()
            print(json.dumps(row), flush=True)
            rows.append(row)

    gpu = torch.cuda.get_device_name()
    with open(os.path.join(HERE, f"latency_{gpu.replace(' ', '_')}.json"), 'w') as f:
        json.dump({'gpu': gpu, 'torch': torch.__version__, 'rows': rows}, f, indent=2)
    print(f'\n{gpu}\n{"video s":>8} {"opt":>6} {"model s":>8} {"s per video s":>14} {"peak MB":>8}')
    for r in rows:
        print(f"{r['video_s']:8.0f} {str(r['optimization']):>6} {str(r['runtime_s']):>8} "
              f"{str(r.get('realtime_factor', '-')):>14} {str(r.get('peak_gpu_mb', '-')):>8}")


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--lengths', type=int, nargs='+', default=[300, 900, 1800, 3600])
    parser.add_argument('--checkpoint', default=repo_path('checkpoints', 'omniegocap.pt'))
    main(parser.parse_args())
