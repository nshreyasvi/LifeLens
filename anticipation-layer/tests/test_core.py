import json

import numpy as np
import pytest

from anticipation.encoders.kinematic import (
    PHASES,
    RunningNormalizer,
    dominant_frequency,
    energy_phase,
    pose_features,
    video_motion_features,
)
from anticipation.engine import AnticipationEngine
from anticipation.heads.activity import PrototypeBank
from anticipation.heads.anticipation import TrendAnticipator, find_peaks, peak_labels
from anticipation.heads.transition import TransitionDetector
from anticipation.io.frame_ring import FrameRing
from anticipation.io.pose_source import PoseSequence, load_pose
from anticipation.projection import Projector
from anticipation.schema import AnticipationFrame, decode_embedding
from anticipation.service.mock_publisher import mock_frame


def test_frame_ring_emits_fixed_windows_at_stride():
    ring = FrameRing(window_s=2.0, stride_s=0.5, fps=8.0)
    frames = ((i / 8.0, np.zeros((4, 4, 3), np.uint8)) for i in range(80))
    wins = list(ring.windows(frames))
    assert all(w.frames.shape[0] == 16 for w in wins)
    starts = np.diff([w.t_end for w in wins])
    assert np.allclose(starts, 0.5)
    assert wins[0].t_end == pytest.approx(15 / 8.0)


def test_pose_energy_tracks_speed():
    t = np.arange(0, 2, 1 / 30)
    slow = np.zeros((len(t), 5, 3))
    slow[:, :, 0] = t[:, None] * 0.5
    fast = slow * 4
    e_slow = pose_features(t, slow)
    e_fast = pose_features(t, fast)
    assert e_slow.velocity == pytest.approx(0.5, rel=1e-3)
    assert e_fast.energy.mean() == pytest.approx(16 * e_slow.energy.mean(), rel=1e-3)


def test_dominant_frequency_finds_rhythm():
    t = np.arange(0, 4, 1 / 30)
    assert dominant_frequency(t, np.sin(2 * np.pi * 2.0 * t)) == pytest.approx(2.0, abs=0.3)
    assert dominant_frequency(t, np.ones_like(t)) == 0.0
    assert dominant_frequency(t, t**2) == 0.0  # slow drift is not a rhythm


def test_video_motion_zero_for_static_and_positive_for_change():
    t = np.arange(8) / 8.0
    static = np.full((8, 32, 32, 3), 100, np.uint8)
    assert video_motion_features(t, static).velocity == 0.0
    moving = static.copy()
    moving[::2] = 200
    assert video_motion_features(t, moving).velocity > 0


def test_normalizer_bounded():
    n = RunningNormalizer()
    vals = [n(v) for v in [1, 2, 4, 1]]
    assert max(vals) <= 1.0 and vals[2] == 1.0 and vals[3] == pytest.approx(0.25, rel=0.05)


def test_energy_phase_show_language():
    assert energy_phase(0.05, 0.0) == "calm"
    assert energy_phase(0.8, 0.1) == "peak"
    assert energy_phase(0.3, 1.0) == "build"
    assert energy_phase(0.3, -1.0) == "release"
    assert energy_phase(0.3, 0.0) == "steady"


def test_transition_fires_on_embedding_jump():
    rng = np.random.default_rng(0)
    a, b = rng.standard_normal(64), rng.standard_normal(64)
    det = TransitionDetector()
    changes = [det.update(a + 0.05 * rng.standard_normal(64))[1] for _ in range(10)]
    assert not any(changes)
    assert det.update(b)[1]


def test_prototype_bank_classifies_and_roundtrips(tmp_path):
    rng = np.random.default_rng(1)
    centers = {"walk": rng.standard_normal(32), "spin": rng.standard_normal(32)}
    bank = PrototypeBank()
    for k, c in centers.items():
        for _ in range(3):
            bank.add(k, c + 0.1 * rng.standard_normal(32))
    p = tmp_path / "bank.npz"
    bank.save(str(p))
    bank2 = PrototypeBank.load(str(p))
    label, conf, top3 = bank2.classify(centers["spin"])
    assert label == "spin" and conf > 0.5 and len(top3) == 2


def test_trend_predicts_upcoming_peak():
    t = np.arange(0, 1.0, 1 / 30)
    # parabola peaking at t=1.3 (0.3 s after "now")
    e = 0.9 - 2.0 * (t - 1.3) ** 2
    ant = TrendAnticipator().predict(t, e)
    assert ant.eta_ms is not None and 200 <= ant.eta_ms <= 400
    falling = TrendAnticipator().predict(t, 1.0 - t)
    assert falling.eta_ms is None


def test_peak_labels_horizons():
    peaks = find_peaks(np.arange(0, 3, 0.1), np.r_[np.zeros(10), [0.2, 0.6, 0.9, 0.6, 0.2], np.zeros(15)])
    assert peaks == pytest.approx([1.2])
    y = peak_labels(np.array([0.5, 1.0, 1.1]), peaks)
    assert y.tolist() == [[0, 0, 1], [1, 1, 1], [1, 1, 1]]


def test_projector_pca_and_fallback(tmp_path):
    x = np.random.default_rng(2).standard_normal((100, 1024)).astype(np.float32)
    assert Projector(64)(x[0]).shape == (64,)
    p = Projector(64).fit(x)
    p.save(str(tmp_path / "p.npz"))
    assert Projector.load(str(tmp_path / "p.npz"))(x[:3]).shape == (3, 64)


def test_schema_json_roundtrip():
    emb = np.linspace(-1, 1, 64).astype(np.float32)
    f = AnticipationFrame(t_start=0, t_end=2, embedding=emb)
    d = json.loads(f.to_json())
    assert set(d) >= {"t_start", "t_end", "activity", "kinematics", "transition", "anticipation", "embedding"}
    assert np.allclose(decode_embedding(d["embedding"]), emb, atol=1e-3)


def test_mock_frames_are_valid():
    import random

    rng = random.Random(0)
    for t in np.arange(0, 40, 0.5):
        d = json.loads(mock_frame(float(t), rng).to_json())
        assert 0 <= d["kinematics"]["energy"] <= 1
        assert d["anticipation"]["eta_ms"] is None or 0 <= d["anticipation"]["eta_ms"] <= 1000
        assert d["kinematics"]["phase"] in PHASES


def test_engine_kinematics_only_with_pose(tmp_path):
    t = np.arange(0, 6, 1 / 30)
    joints = np.zeros((len(t), 4, 3), np.float32)
    joints[:, :, 1] = np.sin(2 * np.pi * 1.0 * t)[:, None] * 0.3  # 1 Hz bounce
    np.savez(tmp_path / "pose.npz", joints=joints, t=t, joint_names=np.array(["a", "b", "c", "d"]))
    pose = load_pose(str(tmp_path / "pose.npz"))
    assert isinstance(pose, PoseSequence) and pose.fps == pytest.approx(30, rel=1e-3)

    eng = AnticipationEngine(encoder=None, pose=pose)
    ring = FrameRing(2.0, 0.5, 8.0)
    frames = ((i / 8.0, np.zeros((8, 8, 3), np.uint8)) for i in range(int(6 * 8)))
    out = [eng.process(w)[0] for w in ring.windows(frames)]
    assert out and all(f.kinematics.source == "pose" for f in out)
    assert any(f.anticipation.eta_ms is not None for f in out)
    assert out[-1].kinematics.cadence_hz == pytest.approx(2.0, abs=0.6)  # energy peaks twice per bounce
