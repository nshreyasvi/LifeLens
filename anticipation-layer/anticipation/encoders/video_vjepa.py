"""V-JEPA 2 video encoder wrapper (HF transformers port of facebookresearch/vjepa2).

A clip of N frames is cut into 2x16x16 tubelets -> (N/2)*16*16 tokens of dim D
(D=1024 for ViT-L). We return both the full token grid and pooled descriptors.
"""

from __future__ import annotations

import time
from dataclasses import dataclass

import numpy as np
import torch

DEFAULT_MODEL = "facebook/vjepa2-vitl-fpc64-256"


@dataclass
class VideoEmbedding:
    pooled: np.ndarray  # (D,) mean over all tokens: mostly *what is in view*
    temporal: np.ndarray  # (N/2, D) mean over space per tubelet step
    latency_ms: float
    dynamic: np.ndarray | None = None  # (D,) mean |token(step+1) - token(step)| per patch: *how things move*


class VJEPA2Encoder:
    def __init__(
        self,
        model_id: str = DEFAULT_MODEL,
        device: str | None = None,
        dtype: str = "auto",
        warmup: bool = True,
    ):
        from transformers import AutoModel, AutoVideoProcessor

        self.device = device or ("cuda" if torch.cuda.is_available() else "cpu")
        # GTX 16xx cards are prone to fp16 NaNs; "auto" picks fp16 and falls back if needed.
        self.dtype = _resolve_dtype(dtype, self.device)
        self.processor = AutoVideoProcessor.from_pretrained(model_id)
        self.model = AutoModel.from_pretrained(model_id, dtype=self.dtype)
        self.model.to(self.device).eval()
        self.dim = int(self.model.config.hidden_size)
        self.patch = int(getattr(self.model.config, "patch_size", 16))
        self.tubelet = int(getattr(self.model.config, "tubelet_size", 2))
        if warmup:
            # first CUDA call compiles kernels (~50 s on a GTX 1650); pay it before going live
            self.encode(np.zeros((8, 256, 256, 3), np.uint8))

    @torch.inference_mode()
    def encode(self, frames: np.ndarray) -> VideoEmbedding:
        """frames: (N, H, W, 3) uint8 RGB, N even."""
        t0 = time.perf_counter()
        video = torch.from_numpy(frames).permute(0, 3, 1, 2)  # N,C,H,W
        inputs = self.processor(video, return_tensors="pt")
        inputs = {k: v.to(self.device, dtype=self.dtype) if v.is_floating_point() else v.to(self.device)
                  for k, v in inputs.items()}
        tokens = self.model.get_vision_features(**inputs)[0].float()  # (L, D)
        if self.device == "cuda":
            torch.cuda.synchronize()
        if not torch.isfinite(tokens).all():
            raise FloatingPointError("non-finite V-JEPA output (try dtype='fp32')")
        steps = frames.shape[0] // self.tubelet
        grid = tokens.reshape(steps, -1, self.dim)  # (steps, patches, D)
        temporal = grid.mean(dim=1)
        pooled = tokens.mean(dim=0)
        # mean pooling keeps appearance and averages motion away; per-patch change between
        # tubelet steps keeps it (computed on the GPU, ~free)
        dynamic = (grid[1:] - grid[:-1]).abs().mean(dim=(0, 1)) if steps > 1 else torch.zeros_like(pooled)
        return VideoEmbedding(
            pooled=pooled.cpu().numpy(),
            temporal=temporal.cpu().numpy(),
            latency_ms=(time.perf_counter() - t0) * 1000.0,
            dynamic=dynamic.cpu().numpy(),
        )


def _resolve_dtype(dtype: str, device: str) -> torch.dtype:
    if device != "cuda" or dtype == "fp32":
        return torch.float32
    if dtype == "fp16":
        return torch.float16
    # auto: GTX cards lack tensor cores; fp16 measured 3-4x slower than fp32 on a GTX 1650
    name = torch.cuda.get_device_name(0)
    return torch.float32 if "GTX" in name else torch.float16
