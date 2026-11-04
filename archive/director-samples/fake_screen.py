from __future__ import annotations

import asyncio
import json
import os

import websockets


async def main() -> None:
    uri = os.getenv("DIRECTOR_WS", "ws://127.0.0.1:8765")
    waiting_announced = False
    while True:
        try:
            async with websockets.connect(uri) as socket:
                print(f"fake screen connected: {uri}", flush=True)
                waiting_announced = False
                async for raw in socket:
                    message = json.loads(raw)
                    print(json.dumps(message, sort_keys=True), flush=True)
        except (OSError, websockets.ConnectionClosed):
            if not waiting_announced:
                print("fake screen waiting for director...", flush=True)
                waiting_announced = True
            await asyncio.sleep(.5)


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print()

