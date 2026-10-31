"""AnticipationEngine: one window in, one AnticipationFrame out."""

from __future__ import annotations

import time
from dataclasses import replace

import numpy as np

from anticipation.encoders.kinematic import (
    KinFeatures,
    RunningNormalizer,
    dominant_frequency,
    energy_phase,
    pose_features,
    video_motion_features,
)
from anticipation.heads.activity import PrototypeBank, descriptor
from anticipation.heads.anticipation import LearnedAnticipator, TrendAnticipator
from anticipation.heads.transition import TransitionDetector
from anticipation.io.frame_ring import Window
from anticipation.io.pose_source import PoseSequence
from anticipation.projection import Projector
from anticipation.schema import Activity, AnticipationFrame, Kinematics, Transition

HISTORY_S = 4.0


def window_features(emb_proj: np.ndarray | None, energy: float, kin: KinFeatures, slope: float) -> np.ndarray:
    """Per-window feature vector for the learned anticipator (keep in sync with training)."""
    emb = emb_proj if emb_proj is not None else np.zeros(0, np.float32)
    return np.concatenate([emb, [energy, kin.velocity, kin.cadence_hz, slope]]).astype(np.float32)


class AnticipationEngine:
    def __init__(
        self,
        encoder=None,  # VJEPA2Encoder or None (kinematics-only mode)
        projector: Projector | None = None,
        bank: PrototypeBank | None = None,
        learned: LearnedAnticipator | None = None,
        pose: PoseSequence | None = None,
        clip_frames: int = 8,  # frames sent to V-JEPA per window (subsampled); must be even
    ):
        self.encoder = encoder
        self.clip_frames = clip_frames
        self.projector = projector or Projector(64)
        self.bank = bank or PrototypeBank()
        self.learned = learned
        self.pose = pose
        self.trend = TrendAnticipator()
        self.transition = TransitionDetector()
        self.norm = RunningNormalizer()
        self._hist_t: list[float] = []
        self._hist_e: list[float] = []
        self.all_t: list[float] = []  # full-run energy series (never trimmed), used for training labels
        self.all_e: list[float] = []

    def process(self, w: Window) -> tuple[AnticipationFrame, dict]:
        """Returns the frame plus raw extras (pooled embedding, features) for logging/training."""
        t0 = time.perf_counter()
        kin = self._kinematics(w)
        energy = self._update_energy(kin)
        ht, he = np.array(self._hist_t), np.array(self._hist_e)
        slope = _slope(ht, he, 0.5)
        if len(ht) > 1 and ht[-1] - ht[0] >= 3.0:
            # rhythm over the 4 s history: a 2 s window only resolves 0.5 Hz steps
            kin = replace(kin, cadence_hz=dominant_frequency(ht, he))

        pooled = proj = dynamic = None
        activity, transition = Activity(), Transition()
        if self.encoder is not None:
            emb = self.encoder.encode(_subsample(w.frames, self.clip_frames))
            pooled, dynamic = emb.pooled, emb.dynamic
            proj = self.projector(pooled)
            label, conf, top3 = self.bank.classify(descriptor(pooled, dynamic))
            activity = Activity(label, conf, top3)
            score, change, _ = self.transition.update(pooled)
            transition = Transition(score, change)

        feats = window_features(proj, energy, kin, slope)
        if self.learned is not None:
            ant = self.learned.step(feats)
        else:
            ant = self.trend.predict(ht, he)

        frame = AnticipationFrame(
            t_start=w.t_start,
            t_end=w.t_end,
            latency_ms=(time.perf_counter() - t0) * 1000.0,
            source="video+pose" if kin.source == "pose" else "video",
            activity=activity,
            kinematics=Kinematics(energy, kin.velocity, kin.cadence_hz, kin.source, energy_phase(energy, slope)),
            transition=transition,
            anticipation=ant,
            embedding=proj,
        )
        return frame, {"pooled": pooled, "dynamic": dynamic, "features": feats, "energy_t": ht, "energy": he}

    def _kinematics(self, w: Window) -> KinFeatures:
        if self.pose is not None:
            seg = self.pose.slice(w.t_start, w.t_end)
            if len(seg.t) >= 3:
                return pose_features(seg.t, seg.joints)
        return video_motion_features(w.timestamps, w.frames)

    def _update_energy(self, kin: KinFeatures) -> float:
        last = self._hist_t[-1] if self._hist_t else -np.inf
        for t, e in zip(kin.t, kin.energy):
            if t > last + 1e-6:
                self._hist_t.append(float(t))
                self._hist_e.append(self.norm(float(e)))
                self.all_t.append(self._hist_t[-1])
                self.all_e.append(self._hist_e[-1])
                last = t
        cut = self._hist_t[-1] - HISTORY_S if self._hist_t else 0
        while self._hist_t and self._hist_t[0] < cut:
            self._hist_t.pop(0)
            self._hist_e.pop(0)
        # window energy = mean of the most recent 0.5 s
        ht, he = np.array(self._hist_t), np.array(self._hist_e)
        recent = he[ht >= ht[-1] - 0.5] if len(ht) else np.zeros(1)
        return float(recent.mean())


def _subsample(frames: np.ndarray, n: int) -> np.ndarray:
    if n <= 0 or len(frames) <= n:
        return frames
    idx = np.linspace(0, len(frames) - 1, n).round().astype(int)
    return frames[idx]


def _slope(t: np.ndarray, e: np.ndarray, span_s: float) -> float:
    if len(t) < 3:
        return 0.0
    m = t >= t[-1] - span_s
    if m.sum() < 3:
        return 0.0
    return float(np.polyfit(t[m] - t[-1], e[m], 1)[0])
