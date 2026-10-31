from __future__ import annotations

import argparse
import asyncio
from collections import Counter
import json
import os
import time
from pathlib import Path
from typing import Any

from dotenv import load_dotenv
import websockets

from .anticipation import StubPredictor
from .fast_loop import FastLoop
from .replay import Clip, load_clip
from .features import STILL_SPEED_M_S, is_still_speed
from .slow_loop import SlowLoop
from .output_map import OUTPUT_FIELDS
from .descriptions import load_dam_descriptions
from .schemas import ScreenMessage


def _arg_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Replay a processed LifeLens clip through StageSense Director.")
    parser.add_argument("clip", help="clip directory or pose_timeseries.csv")
    parser.add_argument("--speed", type=float, default=1.0, help="replay speed multiplier (default: real speed)")
    parser.add_argument("--start", type=float, default=0.0, help="clip start offset in seconds")
    parser.add_argument("--duration", type=float, default=None, help="optional replay length in seconds")
    parser.add_argument("--no-model", action="store_true", help="skip all local model calls")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--max-muse-calls", type=int, default=30)
    parser.add_argument("--describe", choices=("qwen", "dam", "both"), default="qwen")
    return parser


class ScreenPublisher:
    """Change filtered WebSocket output with a one-second heartbeat."""
    def __init__(self) -> None:
        self.last: dict[str, Any] | None = None
        self.last_send = 0.0
        self.count = 0
        self.mood_counts: Counter[str] = Counter()

    def should_send(self, message: dict[str, Any]) -> bool:
        now = time.monotonic()
        if self.last is None:
            return True
        fields = (
            OUTPUT_FIELDS["phase"], OUTPUT_FIELDS["zone"], OUTPUT_FIELDS["mood"],
            OUTPUT_FIELDS["music_tempo"], OUTPUT_FIELDS["color"], OUTPUT_FIELDS["scene"],
            OUTPUT_FIELDS["stem"], OUTPUT_FIELDS["shader"],
        )
        changed = any(message.get(k) != self.last.get(k) for k in fields)
        intensity = OUTPUT_FIELDS["intensity"]
        changed = changed or abs(float(message[intensity]) - float(self.last[intensity])) > 0.05
        cue = OUTPUT_FIELDS["cue"]
        old_cue, new_cue = self.last.get(cue), message.get(cue)
        changed = changed or (old_cue != new_cue and "flash" in {old_cue, new_cue})
        return changed or now - self.last_send >= 1.0

    def sent(self, message: dict[str, Any]) -> None:
        self.last = dict(message)
        self.last_send = time.monotonic()
        self.count += 1
        self.mood_counts[str(message[OUTPUT_FIELDS["mood"]])] += 1

    def prepare(self, message: dict[str, Any]) -> dict[str, Any]:
        payload = dict(message)
        if self.last is not None and payload.get(OUTPUT_FIELDS["cue"]) != "blackout":
            intensity = OUTPUT_FIELDS["intensity"]
            before = float(self.last[intensity])
            target = float(payload[intensity])
            if abs(target - before) > 0.05:
                payload[intensity] = round(before + (0.05 if target > before else -0.05), 3)
            else:
                payload[intensity] = target
        return payload


async def send_screen(clients: set[Any], publisher: ScreenPublisher,
                      message: dict[str, Any]) -> None:
    if not publisher.should_send(message):
        return
    message = publisher.prepare(message)
    message = ScreenMessage.model_validate(message).model_dump()
    publisher.sent(message)
    if clients:
        await asyncio.gather(*(client.send(json.dumps(message)) for client in list(clients)),
                             return_exceptions=True)


async def replay(clip: Clip, *, speed: float, start: float, duration: float | None,
                 no_model: bool, clients: set[Any], max_muse_calls: int = 30,
                 describe: str = "qwen") -> None:
    predictor_name = os.getenv("PREDICTOR", "stub").lower()
    if predictor_name != "stub":
        raise ValueError("Only PREDICTOR=stub is wired; the upstream WebSocket connection is [VERIFY]")
    predictor = StubPredictor()
    fast = FastLoop(predictor)
    dam_descriptions = load_dam_descriptions(clip.source_dir) if describe in {"dam", "both"} else []
    slow = SlowLoop(no_model=no_model, max_muse_calls=max_muse_calls,
                    interval_s=6.0, describe=describe, dam_descriptions=dam_descriptions)
    publisher = ScreenPublisher()
    stop = asyncio.Event()
    slow_task = asyncio.create_task(slow.run(stop))
    selected = [f for f in clip.frames if f.time_s >= start and (duration is None or f.time_s < start + duration)]
    if not selected:
        stop.set(); await slow_task
        raise ValueError("selected replay window has no frames")
    replay_started = time.perf_counter()
    prior_zone: str | None = None
    all_zone_changes: list[tuple[float, str, str]] = []
    for frame in clip.frames:
        if prior_zone is not None and frame.zone != prior_zone:
            all_zone_changes.append((frame.time_s, prior_zone, frame.zone))
        prior_zone = frame.zone
    print("DATA full-clip zone changes: " + (", ".join(f"{t:.2f}s {a}->{b}" for t, a, b in all_zone_changes) or "none"), flush=True)
    print(f"REPLAY clip={clip.name} window={selected[0].time_s:.2f}-{selected[-1].time_s:.2f}s "
          f"fps={clip.fps:.2f} speed={speed:g}x frames={len(selected)}", flush=True)
    print("MODEL raw-number guard: prompts contain posture words, narration, zone, energy word, and freeze-detection status only.", flush=True)
    still_start: float | None = None
    still_runs: list[tuple[float, float]] = []
    for frame in selected:
        if is_still_speed(frame.speed_m_s) and still_start is None:
            still_start = frame.time_s
        elif not is_still_speed(frame.speed_m_s) and still_start is not None:
            still_runs.append((still_start, frame.time_s))
            still_start = None
    if still_start is not None:
        still_runs.append((still_start, selected[-1].time_s))
    for begin, end in still_runs:
        if end - begin >= 1.0:
            print(f"DATA stillness speed<={STILL_SPEED_M_S:g}m/s {begin:.2f}-{end:.2f}s (pose-derived estimate)", flush=True)
    zone_before: str | None = None
    wall_total = 0.0
    wall_max = 0.0
    cpu_total = 0.0
    cpu_max = 0.0
    step_count = 0
    last_printed_second: int | None = None
    for frame in selected:
        started = time.perf_counter()
        cpu_started = time.process_time()
        message, logs = fast.step(frame)
        elapsed = (time.perf_counter() - started) * 1000
        cpu_elapsed = (time.process_time() - cpu_started) * 1000
        wall_total += elapsed; step_count += 1
        wall_max = max(wall_max, elapsed)
        cpu_total += cpu_elapsed
        cpu_max = max(cpu_max, cpu_elapsed)
        # Carry only the compact freeze-detection status into the slow-loop summary.
        last_pred = fast.last_prediction
        slow.observe(frame, last_pred)
        message.update({OUTPUT_FIELDS["speed"]: round(frame.speed_m_s, 3),
                        OUTPUT_FIELDS["posture_label"]: frame.posture_label,
                        OUTPUT_FIELDS["prediction_event"]: last_pred["event"],
                        OUTPUT_FIELDS["prediction_prob"]: last_pred["prob"],
                        OUTPUT_FIELDS["model_summary"]: slow.latest_summary,
                        OUTPUT_FIELDS["model_decision"]: slow.latest_decision})
        if zone_before is None:
            print(f"ZONE start {frame.time_s:.2f}s {frame.zone} floor=({frame.floor_x:.2f},{frame.floor_y:.2f})", flush=True)
        elif zone_before != frame.zone:
            print(f"ZONE {frame.time_s:.2f}s {zone_before}->{frame.zone} floor=({frame.floor_x:.2f},{frame.floor_y:.2f})", flush=True)
        zone_before = frame.zone
        for log in logs:
            print(f"{frame.time_s:7.2f}s {log}", flush=True)
        state = slow.state
        message["mood"] = state.mood
        message["music_tempo"] = state.bpm
        message[OUTPUT_FIELDS["scene"]] = state.scene
        message[OUTPUT_FIELDS["stem"]] = state.stem
        message[OUTPUT_FIELDS["shader"]] = state.shader
        if int(frame.time_s) != last_printed_second:
            print(f"{frame.time_s:7.2f}s output intensity={message[OUTPUT_FIELDS['intensity']]:.2f} "
                  f"mood={message[OUTPUT_FIELDS['mood']]} bpm={message[OUTPUT_FIELDS['music_tempo']]} "
                  f"zone={message[OUTPUT_FIELDS['zone']]}", flush=True)
            last_printed_second = int(frame.time_s)
        await send_screen(clients, publisher, message)
        while not slow.updates.empty():
            state = slow.updates.get_nowait()
            slow_message = fast.slow_message(frame, state)
            slow_message.update({OUTPUT_FIELDS["speed"]: round(frame.speed_m_s, 3),
                                OUTPUT_FIELDS["posture_label"]: frame.posture_label,
                                OUTPUT_FIELDS["prediction_event"]: last_pred["event"],
                                OUTPUT_FIELDS["prediction_prob"]: last_pred["prob"],
                                OUTPUT_FIELDS["model_summary"]: slow.latest_summary,
                                OUTPUT_FIELDS["model_decision"]: slow.latest_decision})
            await send_screen(clients, publisher, slow_message)
        while not slow.logs.empty():
            print(f"{frame.time_s:7.2f}s {slow.logs.get_nowait()}", flush=True)
        elapsed_clip = frame.time_s - selected[0].time_s
        target_wall = elapsed_clip / speed
        sleep_for = target_wall - (time.perf_counter() - replay_started)
        if sleep_for > 0:
            await asyncio.sleep(sleep_for)
    stop.set()
    await slow_task
    while not slow.logs.empty():
        print(f"{selected[-1].time_s:7.2f}s {slow.logs.get_nowait()}", flush=True)
    end_message = dict(message)
    end_message[OUTPUT_FIELDS["id"]] = int(message[OUTPUT_FIELDS["id"]]) + 1
    end_message[OUTPUT_FIELDS["phase"]] = "end"
    end_message[OUTPUT_FIELDS["cue"]] = "dim"
    end_message[OUTPUT_FIELDS["reason"]] = "Replay ended."
    end_message[OUTPUT_FIELDS["log"]] = "Replay ended."
    await send_screen(clients, publisher, end_message)
    print("SCREEN end message sent; heartbeat stopped", flush=True)
    metrics = slow.metrics()
    print("SLOW_METRICS " + json.dumps(metrics, sort_keys=True), flush=True)
    print(f"SCREEN_MESSAGES sent={publisher.count} target=well-under-900", flush=True)
    print("MOOD_COUNTS " + json.dumps(dict(sorted(publisher.mood_counts.items())), sort_keys=True), flush=True)
    wall_status = "PASS" if wall_max < 30 else "OVER 30ms"
    cpu_status = "PASS" if cpu_max < 30 else "OVER 30ms"
    print(f"FAST_LOOP wall_mean={wall_total / max(1, step_count):.3f}ms "
          f"wall_max={wall_max:.3f}ms target=<30ms wall_status={wall_status}; "
          f"cpu_mean={cpu_total / max(1, step_count):.3f}ms cpu_max={cpu_max:.3f}ms "
          f"cpu_status={cpu_status} frames={step_count}", flush=True)


async def run(args: argparse.Namespace) -> None:
    if args.speed <= 0:
        raise ValueError("--speed must be greater than zero")
    project_root = Path(__file__).resolve().parents[1]
    load_dotenv(project_root / "director" / ".env")
    clip = load_clip(args.clip)
    clients: set[Any] = set()
    ready = asyncio.Event()

    async def handler(websocket: Any) -> None:
        clients.add(websocket)
        print("SCREEN connected", flush=True)
        ready.set()
        try:
            await websocket.wait_closed()
        finally:
            clients.discard(websocket)

    async with websockets.serve(handler, args.host, args.port):
        print(f"SCREEN websocket=ws://{args.host}:{args.port}", flush=True)
        # Allow the fake screen to connect if it is started alongside the director.
        try:
            await asyncio.wait_for(ready.wait(), timeout=5.0)
        except asyncio.TimeoutError:
            print("SCREEN no client connected; continuing and logging locally", flush=True)
        await replay(clip, speed=args.speed, start=args.start, duration=args.duration,
                     no_model=args.no_model, clients=clients, max_muse_calls=args.max_muse_calls,
                     describe=args.describe)


def main() -> None:
    args = _arg_parser().parse_args()
    asyncio.run(run(args))


if __name__ == "__main__":
    main()

