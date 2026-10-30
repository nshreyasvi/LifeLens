"""One-line live view of the StageSense WebSocket."""
from __future__ import annotations

import asyncio
import json
import sys

import websockets

URL = "ws://localhost:8765"
latest: dict = {}
ended = False


def bar(value: float, width: int = 12) -> str:
    filled = max(0, min(width, round(value * width)))
    return "█" * filled + "░" * (width - filled)


def render(m: dict) -> str:
    phase = m.get("phase", "set")
    log_line = m.get("log", "")
    cue = m.get("cue", "")
    marks = {"prearm": "⚠ PRE-ARM", "cancel": "✕ CANCEL", "set": "SET", "end": "■ END"}
    mark = "⬛ BLACKOUT" if phase == "fire" and cue == "blackout" else (
        "⚡ FLASH" if phase == "fire" and cue == "flash" else marks.get(phase, phase)
    )
    energy = {"low": .25, "medium": .55, "high": .9}.get(m.get("energy"), .0)
    event_name = m.get("prediction_event", "none")
    event = f"{event_name} {m.get('prediction_prob', 0):.2f}"
    return (f"{m.get('time', '--'):>12} | zone {m.get('zone', '?')} | E {bar(energy)} "
            f"| speed {m.get('speed', 0):.2f} | {m.get('posture_label', 'unknown')[:18]:18} "
            f"| detect {event:16} | {mark} | light {bar(m.get('intensity', 0))} "
            f"{m.get('intensity', 0):.2f} {m.get('color', '#000000')} "
            f"| {m.get('mood', '?')} | {m.get('music_tempo', 0)} BPM | {log_line[:48]}\n"
            f"WHAT THE MODEL SEES: {m.get('model_summary', '') or 'Waiting for the first slow-loop summary.'}\n"
            f"WHAT IT DECIDED: {m.get('model_decision', '') or 'Holding the starting scene.'}")


async def main() -> None:
    global latest, ended
    while True:
        try:
            async with websockets.connect(URL) as ws:
                async for raw in ws:
                    latest = json.loads(raw)
                    if latest.get("phase") == "end":
                        ended = True
                        return
        except (OSError, websockets.WebSocketException):
            await asyncio.sleep(.5)
            continue
        await asyncio.sleep(.5)


async def display() -> None:
    displayed = False
    while not ended:
        if latest:
            if displayed:
                sys.stdout.write("\033[2F")
            lines = render(latest).splitlines()
            sys.stdout.write("\r\033[2K" + lines[0] + "\n")
            sys.stdout.write("\r\033[2K" + lines[1] + "\n")
            sys.stdout.write("\r\033[2K" + lines[2])
            sys.stdout.flush()
            displayed = True
        await asyncio.sleep(1.0)
    if latest:
        if displayed:
            sys.stdout.write("\033[2F")
        lines = render(latest).splitlines()
        sys.stdout.write("\r\033[2K" + lines[0] + "\n")
        sys.stdout.write("\r\033[2K" + lines[1] + "\n")
        sys.stdout.write("\r\033[2K" + lines[2] + "\n")
        sys.stdout.flush()


async def run() -> None:
    await asyncio.gather(main(), display())


if __name__ == "__main__":
    try:
        asyncio.run(run())
    except KeyboardInterrupt:
        print()
