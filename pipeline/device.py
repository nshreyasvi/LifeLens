"""The torch device the pipeline runs on: an NVIDIA GPU (CUDA), else an Apple GPU (MPS), else the CPU.

LIFELENS_DEVICE=cpu (or cuda, mps) overrides it, e.g. when a model hits an operation or dtype MPS lacks.
"""

import os

os.environ.setdefault('PYTORCH_ENABLE_MPS_FALLBACK', '1')   # ops MPS lacks run on the CPU instead of failing

import torch  # noqa: E402


def best() -> str:
    if os.getenv('LIFELENS_DEVICE'):
        return os.environ['LIFELENS_DEVICE']
    if torch.cuda.is_available():
        return 'cuda'
    if getattr(torch.backends, 'mps', None) is not None and torch.backends.mps.is_available():
        return 'mps'
    return 'cpu'


def peak_mb() -> float:
    """Peak GPU memory of this process in MB; 0 where torch does not track it (MPS, CPU)."""
    return torch.cuda.max_memory_allocated() / 2**20 if torch.cuda.is_available() else 0.0


if __name__ == '__main__':
    print(best())
