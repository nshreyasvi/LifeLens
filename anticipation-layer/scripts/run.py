"""Run the Anticipation Layer on a video (offline, or paced like a live camera).

    # left half of the side-by-side demo = raw ego video
    python scripts/run.py --video "../side_by_side.mp4" --crop 0 0 1120 720 --out runs/demo
    # simulate live + stream to Member B
    python scripts/run.py --video ego.mp4 --realtime --ws 8765
    # with Shrey's poses
    python scripts/run.py --video ego.mp4 --pose ego_pose.npz

Writes <out>/frames.jsonl, <out>/extras.npz (training data) and <out>/timeline.png.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import numpy as np

from anticipation.engine import AnticipationEngine
from anticipation.heads.activity import PrototypeBank
from anticipation.heads.anticipation import LearnedAnticipator
from anticipation.io.frame_ring import FrameRing
from anticipation.io.pose_source import load_pose
from anticipation.io.video_source import Crop, read_video
from anticipation.projection import Projector
from anticipation.service.publisher import JsonlWriter, WebSocketPublisher


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--video", required=True)
    ap.add_argument("--crop", type=int, nargs=4, metavar=("X", "Y", "W", "H"))
    ap.add_argument("--pose")
    ap.add_argument("--out", default="runs/latest")
    ap.add_argument("--fps", type=float, default=8.0, help="frames sampled per second into V-JEPA")
    ap.add_argument("--window", type=float, default=2.0)
    ap.add_argument("--stride", type=float, default=0.5)
    ap.add_argument("--clip-frames", type=int, default=8, help="frames per window fed to V-JEPA")
    ap.add_argument("--dtype", default="auto", choices=["auto", "fp16", "fp32"])
    ap.add_argument("--no-vjepa", action="store_true", help="kinematics only (no GPU model)")
    ap.add_argument("--prototypes", help="PrototypeBank .npz")
    ap.add_argument("--projector", help="Projector .npz (PCA)")
    ap.add_argument("--learned", help="AnticipationGRU checkpoint .pt")
    ap.add_argument("--realtime", action="store_true")
    ap.add_argument("--ws", type=int, help="WebSocket port to publish on")
    args = ap.parse_args()

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)

    encoder = None
    if not args.no_vjepa:
        from anticipation.encoders.video_vjepa import VJEPA2Encoder

        encoder = VJEPA2Encoder(dtype=args.dtype)
    engine = AnticipationEngine(
        encoder=encoder,
        projector=Projector.load(args.projector) if args.projector else None,
        bank=PrototypeBank.load(args.prototypes) if args.prototypes else None,
        learned=LearnedAnticipator(args.learned) if args.learned else None,
        pose=load_pose(args.pose) if args.pose else None,
        clip_frames=args.clip_frames,
    )
    ring = FrameRing(args.window, args.stride, args.fps)
    crop = Crop(*args.crop) if args.crop else None
    stream = read_video(args.video, target_fps=args.fps, crop=crop, realtime=args.realtime)
    writer = JsonlWriter(str(out / "frames.jsonl"))
    pub = WebSocketPublisher(port=args.ws).start() if args.ws else None

    rows, pooled, dynamic, feats = [], [], [], []
    for w in ring.windows(stream):
        frame, extra = engine.process(w)
        payload = frame.to_dict()
        writer.write(payload)
        if pub:
            pub.publish(frame.to_json())
        rows.append(payload)
        feats.append(extra["features"])
        if extra["pooled"] is not None:
            pooled.append(extra["pooled"])
            dynamic.append(extra["dynamic"])
        a = frame.anticipation
        eta = f"peak in {a.eta_ms} ms (p={a.prob:.2f})" if a.eta_ms is not None else "-"
        print(f"[{frame.t_start:6.2f}-{frame.t_end:6.2f}s] {frame.latency_ms:6.0f} ms  "
              f"E={frame.kinematics.energy:.2f}  chg={frame.transition.score:.2f}"
              f"{'*' if frame.transition.is_change else ' '}  {frame.activity.label:<12} {eta}")
    writer.close()

    np.savez(
        out / "extras.npz",
        t_end=np.array([r["t_end"] for r in rows]),
        features=np.stack(feats) if feats else np.zeros((0, 0)),
        pooled=np.stack(pooled) if pooled else np.zeros((0, 0)),
        dynamic=np.stack(dynamic) if dynamic else np.zeros((0, 0)),
        energy_t=np.array(engine.all_t),
        energy=np.array(engine.all_e),
    )
    if rows:
        plot_timeline(rows, out / "timeline.png")
        lat = [r["latency_ms"] for r in rows]
        print(f"\n{len(rows)} windows  median latency {np.median(lat):.0f} ms  -> {out}")


def plot_timeline(rows: list[dict], path: Path) -> None:
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    t = [r["t_end"] for r in rows]
    fig, ax = plt.subplots(3, 1, figsize=(11, 6), sharex=True)
    ax[0].plot(t, [r["kinematics"]["energy"] for r in rows], label="energy")
    peaks = [(r["t_end"] + r["anticipation"]["eta_ms"] / 1000) for r in rows if r["anticipation"]["eta_ms"]]
    ax[0].scatter(peaks, [1.02] * len(peaks), marker="v", color="tab:red", s=18, label="predicted peak")
    ax[0].set_ylabel("energy")
    ax[0].legend(loc="upper right", fontsize=8)
    ax[1].plot(t, [r["transition"]["score"] for r in rows], color="tab:purple")
    for r in rows:
        if r["transition"]["is_change"]:
            ax[1].axvline(r["t_end"], color="tab:red", alpha=0.4)
    ax[1].set_ylabel("change")
    ax[2].plot(t, [r["latency_ms"] for r in rows], color="tab:gray")
    ax[2].set_ylabel("latency ms")
    ax[2].set_xlabel("time (s)")
    fig.tight_layout()
    fig.savefig(path, dpi=110)
    plt.close(fig)


if __name__ == "__main__":
    main()
