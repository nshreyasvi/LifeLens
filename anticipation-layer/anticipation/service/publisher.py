"""Delivers AnticipationFrames to Member B: WebSocket broadcast + JSONL log."""

from __future__ import annotations

import asyncio
import json
import threading

import websockets


class JsonlWriter:
    def __init__(self, path: str):
        self._f = open(path, "w", encoding="utf-8")

    def write(self, payload: dict) -> None:
        self._f.write(json.dumps(payload) + "\n")
        self._f.flush()

    def close(self) -> None:
        self._f.close()


class WebSocketPublisher:
    """Broadcasts JSON strings to every connected client on ws://host:port.

    Runs its own event loop in a background thread so the (blocking) inference loop
    can call `publish()` directly.
    """

    def __init__(self, host: str = "0.0.0.0", port: int = 8765):
        self.host, self.port = host, port
        self._clients: set = set()
        self._loop = asyncio.new_event_loop()
        self._ready = threading.Event()
        self._thread = threading.Thread(target=self._run, daemon=True)

    def start(self) -> WebSocketPublisher:
        self._thread.start()
        self._ready.wait(5)
        return self

    def publish(self, message: str) -> None:
        asyncio.run_coroutine_threadsafe(self._broadcast(message), self._loop)

    @property
    def n_clients(self) -> int:
        return len(self._clients)

    def _run(self) -> None:
        asyncio.set_event_loop(self._loop)
        self._loop.run_until_complete(self._serve())

    async def _serve(self) -> None:
        async with websockets.serve(self._handler, self.host, self.port):
            self._ready.set()
            await asyncio.Future()

    async def _handler(self, ws) -> None:
        self._clients.add(ws)
        try:
            await ws.wait_closed()
        finally:
            self._clients.discard(ws)

    async def _broadcast(self, message: str) -> None:
        if self._clients:
            await asyncio.gather(*(c.send(message) for c in list(self._clients)), return_exceptions=True)
