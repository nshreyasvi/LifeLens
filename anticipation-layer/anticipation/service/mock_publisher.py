"""Fake AnticipationFrame stream so Member B/C can build before the real model runs.

    python -m anticipation.service.mock_publisher --port 8765 --hz 2

Simulates a performer cycling idle -> walk -> dance_spin -> jump with rhythmic energy.
"""

from __future__ import annotations

import argparse
import math
import random
import time

import numpy as np

from anticipation.encoders.kinematic import energy_phase
from anticipation.schema import Activity, Anticipation, AnticipationFrame, Kinematics, Transition
from anticipation.service.publisher import WebSocketPublisher

PHASES = [("idle", 0.1, 0.0), ("walk", 0.35, 1.8), ("dance_spin", 0.7, 2.2), ("jump", 0.9, 1.2)]
PHASE_S = 8.0


def mock_frame(t: float, rng: random.Random) -> AnticipationFrame:
    i = int(t // PHASE_S) % len(PHASES)
    label, base, cadence = PHASES[i]
    wave = 0.5 + 0.5 * math.sin(2 * math.pi * max(cadence, 0.3) * t)
    energy = min(1.0, base * (0.6 + 0.6 * wave) + rng.uniform(-0.03, 0.03))
    phase_t = t % PHASE_S
    # next crest of the sine = next energy peak
    period = 1.0 / max(cadence, 0.3)
    eta = (0.25 - (t * max(cadence, 0.3)) % 1.0) % 1.0 * period
    others = [p[0] for p in PHASES if p[0] != label]
    conf = 0.75 + rng.uniform(0, 0.2)
    return AnticipationFrame(
        t_start=max(0.0, t - 2.0),
        t_end=t,
        latency_ms=rng.uniform(600, 900),
        source="mock",
        activity=Activity(label, conf, [(label, conf), (others[0], (1 - conf) * 0.7), (others[1], (1 - conf) * 0.3)]),
        kinematics=Kinematics(energy, energy * 2.0, cadence, "mock",
                              energy_phase(energy, 2 * math.pi * cadence * base * 0.3 * math.cos(2 * math.pi * cadence * t))),
        transition=Transition(0.9 if phase_t < 0.5 else 0.1, phase_t < 0.5),
        anticipation=Anticipation(
            eta_ms=int(eta * 1000) if base > 0.3 and eta <= 1.0 else None,
            prob=0.8 if base > 0.3 else 0.05,
            method="mock",
        ),
        embedding=np.random.default_rng(i).standard_normal(64).astype(np.float32),
    )


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8765)
    ap.add_argument("--hz", type=float, default=2.0)
    ap.add_argument("--print", action="store_true", help="also print frames")
    args = ap.parse_args()
    pub = WebSocketPublisher(port=args.port).start()
    print(f"mock AnticipationFrame stream on ws://localhost:{args.port} @ {args.hz} Hz (Ctrl+C to stop)")
    rng, t0 = random.Random(0), time.perf_counter()
    while True:
        frame = mock_frame(time.perf_counter() - t0, rng)
        msg = frame.to_json()
        pub.publish(msg)
        if args.print:
            print(msg[:200])
        time.sleep(1.0 / args.hz)


if __name__ == "__main__":
    main()
