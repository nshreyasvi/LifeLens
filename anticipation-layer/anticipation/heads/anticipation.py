"""Predicts upcoming movement-energy peaks.

Two predictors share one interface:
  TrendAnticipator   - no training; fits a parabola to recent energy and extrapolates.
  LearnedAnticipator - small GRU over window features; labels come for free from the
                       future energy curve (see `peak_labels`), trained by
                       scripts/train_anticipation.py.
"""

from __future__ import annotations

import numpy as np
import torch
from torch import nn

from anticipation.schema import Anticipation

HORIZONS_S = (0.25, 0.5, 1.0)


def smooth(x: np.ndarray, k: int = 3) -> np.ndarray:
    if len(x) < k:
        return x
    pad = k // 2
    xp = np.pad(x, pad, mode="edge")  # edge padding keeps the newest sample unbiased
    return np.convolve(xp, np.ones(k) / k, mode="valid")


def find_peaks(t: np.ndarray, e: np.ndarray, min_height: float = 0.5, min_sep_s: float = 0.4) -> np.ndarray:
    """Times of local maxima in normalised energy `e` above `min_height`."""
    es = smooth(e)
    idx = [
        i for i in range(1, len(es) - 1)
        if es[i] >= es[i - 1] and es[i] > es[i + 1] and es[i] >= min_height
    ]
    peaks: list[float] = []
    for i in sorted(idx, key=lambda j: -es[j]):
        if all(abs(t[i] - p) >= min_sep_s for p in peaks):
            peaks.append(float(t[i]))
    return np.array(sorted(peaks))


def peak_labels(window_ends: np.ndarray, peak_times: np.ndarray, horizons=HORIZONS_S) -> np.ndarray:
    """y[i, h] = 1 if a peak occurs in (t_end_i, t_end_i + horizon_h]."""
    y = np.zeros((len(window_ends), len(horizons)), dtype=np.float32)
    for i, te in enumerate(window_ends):
        dt = peak_times - te
        for h, hz in enumerate(horizons):
            y[i, h] = float(np.any((dt > 0) & (dt <= hz)))
    return y


class TrendAnticipator:
    """Rhythm first (repeating movement: dance, running, reps), parabola otherwise."""

    def __init__(self, fit_s: float = 0.6, horizon_s: float = 1.0, min_peak: float = 0.5,
                 min_periodicity: float = 0.5):
        self.fit_s = fit_s
        self.horizon_s = horizon_s
        self.min_peak = min_peak
        self.min_periodicity = min_periodicity

    def predict(self, t: np.ndarray, e: np.ndarray) -> Anticipation:
        """t, e: recent history of normalised energy (0..1)."""
        rhythm = self._rhythm(t, e)
        return rhythm if rhythm is not None else self._parabola(t, e)

    def _rhythm(self, t: np.ndarray, e: np.ndarray) -> Anticipation | None:
        if len(t) < 16 or t[-1] - t[0] < 1.5:
            return None
        peaks = find_peaks(t, e, min_height=0.3, min_sep_s=0.2)
        if len(peaks) < 3:
            return None
        gaps = np.diff(peaks)
        period = float(np.median(gaps))
        regularity = 1.0 - float(np.std(gaps) / (period + 1e-9))
        if regularity < self.min_periodicity:
            return None
        now = float(t[-1])
        nxt = peaks[-1] + period
        while nxt <= now:
            nxt += period
        eta = nxt - now
        if eta > self.horizon_s:
            return None
        return Anticipation(eta_ms=int(eta * 1000), prob=float(np.clip(regularity, 0, 1)), method="rhythm")

    def _parabola(self, t: np.ndarray, e: np.ndarray) -> Anticipation:
        none = Anticipation(eta_ms=None, prob=0.0, method="trend")
        if len(t) < 5:
            return none
        now = float(t[-1])
        m = t >= now - self.fit_s
        tt, ee = t[m] - now, smooth(e[m])
        if len(tt) < 5 or np.ptp(tt) < 1e-3:
            return none
        a, b, c = np.polyfit(tt, ee, 2)
        resid = ee - np.polyval([a, b, c], tt)
        r2 = 1.0 - resid.var() / (ee.var() + 1e-9)
        if a < 0:  # concave: peak at the vertex
            t_peak = -b / (2 * a)
        elif b > 0:  # still rising: time to cross min_peak (or end of horizon)
            roots = np.roots([a, b, c - max(self.min_peak, ee[-1])])
            fut = [r.real for r in roots if abs(r.imag) < 1e-9 and r.real > 0]
            t_peak = min(fut) if fut else self.horizon_s
        else:
            return none
        if not (0 < t_peak <= self.horizon_s):
            return none
        peak_val = float(np.polyval([a, b, c], t_peak))
        if peak_val < self.min_peak:
            return none
        prob = float(np.clip(max(r2, 0.0) * min(peak_val, 1.0), 0.0, 1.0))
        return Anticipation(eta_ms=int(t_peak * 1000), prob=prob, method="trend")


class AnticipationGRU(nn.Module):
    def __init__(self, in_dim: int, hidden: int = 64, n_horizons: int = len(HORIZONS_S)):
        super().__init__()
        self.gru = nn.GRU(in_dim, hidden, batch_first=True)
        self.head = nn.Sequential(nn.Linear(hidden, hidden), nn.GELU(), nn.Linear(hidden, n_horizons))

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        """x: (B, S, F) -> logits (B, S, H), one prediction per window."""
        out, _ = self.gru(x)
        return self.head(out)


class LearnedAnticipator:
    """Stateful wrapper: feed one feature vector per window, get an Anticipation."""

    def __init__(self, ckpt_path: str, device: str = "cpu"):
        ckpt = torch.load(ckpt_path, map_location=device, weights_only=True)
        self.horizons = tuple(ckpt["horizons"])
        self.model = AnticipationGRU(ckpt["in_dim"], ckpt["hidden"], len(self.horizons))
        self.model.load_state_dict(ckpt["state_dict"])
        self.model.eval()
        self.mean = ckpt["feat_mean"].numpy()
        self.std = ckpt["feat_std"].numpy()
        self.threshold = float(ckpt.get("threshold", 0.5))
        self._h: torch.Tensor | None = None

    @torch.inference_mode()
    def step(self, feat: np.ndarray) -> Anticipation:
        x = torch.from_numpy(((feat - self.mean) / self.std).astype(np.float32))[None, None]
        out, self._h = self.model.gru(x, self._h)
        p = torch.sigmoid(self.model.head(out))[0, 0].numpy()
        for hz, ph in zip(self.horizons, p):
            if ph >= self.threshold:
                return Anticipation(eta_ms=int(hz * 1000), prob=float(ph), method="learned")
        return Anticipation(eta_ms=None, prob=float(p.max()), method="learned")
