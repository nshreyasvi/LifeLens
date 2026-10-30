from __future__ import annotations

import asyncio
import json
import os
import re
import statistics
import time
import unicodedata
from collections import deque
from typing import Any, Callable

from .descriptions import DamDescription, DamSelection, select_dam_description
from .features import FrameFeatures
from .model_client import call_model_raw, muse_call_count, muse_key_configured, _extract_json
from .schemas import SlowSuggestion

DEFAULT_STATE = SlowSuggestion(mood="curious", scene="wash", bpm=90, stem="ambient",
                               shader="soft_glow", color="#3977FF",
                               reason="Holding a calm starting scene.")


def _safe_log_text(value: Any) -> str:
    """Remove terminal escape sequences and control/format characters from log text."""
    text = re.sub(r"\x1b(?:\[[0-?]*[ -/]*[@-~]|.)?", "", str(value))
    return "".join(" " if unicodedata.category(char) in {"Cc", "Cf"} else char
                   for char in text)


def summarize(frames: list[FrameFeatures], prediction: dict[str, Any], *,
              describe: str = "qwen", dam_descriptions: list[DamDescription] | None = None,
              dam_selection: DamSelection | None = None) -> str:
    """Build a text-only, under-80-word current view for the slow model."""
    if describe not in {"qwen", "dam", "both"}:
        raise ValueError("describe must be qwen, dam, or both")
    if not frames:
        return "The performer is on stage; energy is low; no freeze is being detected."
    latest = frames[-1]
    recent = [f for f in frames if latest.time_s - 6.0 <= f.time_s <= latest.time_s]
    labels = list(dict.fromkeys(
        f.posture_label for f in recent
        if f.posture_label and f.posture_label.strip().casefold() != "arms raised"
    ))[-4:]
    energies = [f.energy for f in recent]
    split = max(1, len(energies) // 2)
    early = sum(energies[:split]) / len(energies[:split])
    late_values = energies[split:] or energies
    late = sum(late_values) / len(late_values)
    trend = "rising" if late - early > 0.08 else "falling" if early - late > 0.08 else "steady"
    pieces = [f"Posture labels over the last six seconds: {', '.join(labels) or 'unknown'}."]
    if describe in {"qwen", "both"}:
        qwen = next((f.narration for f in reversed(recent) if f.narration), "No current Qwen narration.")
        pieces.append(f"Qwen: {qwen}")
    if describe in {"dam", "both"}:
        selected = dam_selection or select_dam_description(dam_descriptions or [], latest.time_s)
        pieces.append(f"DAM ({selected.source}, {selected.start_s:g}-{selected.end_s:g}s): {selected.text}")
    event = prediction.get("event", "none")
    prob = round(float(prediction.get("prob", 0.0)), 2)
    pieces.append(f"Zone {latest.zone}; energy {latest.energy_word}, {trend}; "
                  f"freeze-detection event {event} (reported score {prob}).")
    words = " ".join(pieces).split()
    if len(words) > 79:
        words = words[:79]
        words[-1] = words[-1].rstrip(".,;:") + "."
    return " ".join(words)


class SlowLoop:
    def __init__(self, *, provider: str | None = None, no_model: bool = False,
                 model_fn: Callable[..., Any] | None = None, interval_s: float = 6.0,
                 max_muse_calls: int = 30, describe: str = "qwen",
                 dam_descriptions: list[DamDescription] | None = None):
        if describe not in {"qwen", "dam", "both"}:
            raise ValueError("describe must be qwen, dam, or both")
        self.provider = (provider or os.getenv("MODEL_PROVIDER", "ollama")).lower()
        self.no_model = no_model
        self.model_fn = model_fn
        self.interval_s = interval_s
        self.max_muse_calls = max_muse_calls
        self.describe = describe
        self.dam_descriptions = dam_descriptions or []
        self.state = DEFAULT_STATE
        self.frames: deque[FrameFeatures] = deque(maxlen=210)
        self.latest_prediction: dict[str, Any] = {"event": "none", "prob": 0.0, "eta_ms": 0}
        self.latest_summary = "Model disabled; no summary is sent." if no_model else ""
        self.latest_decision = ("Model calls are disabled; holding the default scene."
                                if no_model else self.state.reason)
        self.latest_dam_selection: DamSelection | None = None
        self.logs: asyncio.Queue[str] = asyncio.Queue()
        self.updates: asyncio.Queue[SlowSuggestion] = asyncio.Queue()
        self.calls_made = 0
        self.valid_responses = 0
        self.fallback_cycles = 0
        self.cycles_completed = 0
        self.cycles_skipped = 0
        self.latencies: list[float] = []
        self.update_times: list[float] = []
        self.in_flight: asyncio.Task[None] | None = None

    def observe(self, frame: FrameFeatures, prediction: dict[str, Any] | None = None) -> None:
        self.frames.append(frame)
        if prediction is not None:
            self.latest_prediction = prediction

    async def _one_request(self, summary: str, retry_error: str | None,
                           *, provider: str | None = None) -> tuple[SlowSuggestion | None, str | None]:
        provider = provider or self.provider
        await self.logs.put(f"SENT TO MODEL: {_safe_log_text(summary)}")
        started = time.perf_counter()
        self.calls_made += 1
        try:
            if self.model_fn is not None:
                result = await asyncio.to_thread(self.model_fn, summary, provider=provider,
                                                 retry_error=retry_error)
                raw = result.model_dump_json() if isinstance(result, SlowSuggestion) else json.dumps(result)
            else:
                raw = await asyncio.to_thread(call_model_raw, summary, provider=provider,
                                              retry_error=retry_error, max_muse_calls=self.max_muse_calls)
            try:
                suggestion = SlowSuggestion.model_validate(_extract_json(raw))
            except Exception as exc:
                latency = time.perf_counter() - started
                self.latencies.append(latency)
                await self.logs.put(f"MODEL SAID: {_safe_log_text(raw)} -> invalid, {latency:.2f}s")
                return None, str(exc)
            latency = time.perf_counter() - started
            self.latencies.append(latency)
            self.valid_responses += 1
            await self.logs.put(f"MODEL SAID: {_safe_log_text(raw)} -> valid, {latency:.2f}s")
            return suggestion, None
        except Exception as exc:
            latency = time.perf_counter() - started
            self.latencies.append(latency)
            await self.logs.put(f"MODEL SAID: {_safe_log_text(type(exc).__name__ + ': ' + str(exc))} "
                                f"-> fallback, {latency:.2f}s")
            return None, str(exc)

    async def _cycle(self) -> None:
        current = list(self.frames)
        latest = current[-1].time_s if current else 0.0
        self.latest_dam_selection = (
            select_dam_description(self.dam_descriptions, latest)
            if self.describe in {"dam", "both"} else None
        )
        if self.latest_dam_selection:
            item = self.latest_dam_selection
            await self.logs.put(
                f"DAM SELECTED: {item.source} {item.start_s:g}-{item.end_s:g}s · {item.reason}"
            )
        summary = summarize(current, self.latest_prediction, describe=self.describe,
                            dam_descriptions=self.dam_descriptions,
                            dam_selection=self.latest_dam_selection)
        self.latest_summary = summary
        cycle_provider = self.provider
        if cycle_provider == "muse" and self.model_fn is None and not muse_key_configured():
            cycle_provider = "ollama"
            await self.logs.put("Muse key missing from director/.env; using Ollama fallback.")
        suggestion, error = await self._one_request(summary, None, provider=cycle_provider)
        if suggestion is None:
            suggestion, _ = await self._one_request(summary, error or "invalid response",
                                                    provider=cycle_provider)
        if suggestion is None:
            self.fallback_cycles += 1
            self.latest_decision = "The model response was invalid; the last good scene stays in place."
            await self.logs.put("slow: fallback · keeping the last good scene")
        else:
            bpm = max(self.state.bpm - 10, min(self.state.bpm + 10, suggestion.bpm))
            self.state = suggestion.model_copy(update={"bpm": bpm})
            self.latest_decision = self.state.reason
            self.update_times.append(time.perf_counter())
            self.updates.put_nowait(self.state)
            await self.logs.put(f"slow: {self.state.mood} · {self.state.bpm} BPM · {self.state.reason}")
        self.cycles_completed += 1

    async def update_once(self) -> SlowSuggestion:
        if self.no_model:
            await self.logs.put("slow: model disabled · holding last good scene")
            return self.state
        await self._cycle()
        return self.state

    async def run(self, stop: asyncio.Event) -> None:
        if self.no_model:
            await self.logs.put("slow: model disabled · holding last good scene")
            return
        loop = asyncio.get_running_loop()
        next_tick = loop.time()
        while not stop.is_set():
            delay = max(0, next_tick - loop.time())
            if delay:
                try:
                    await asyncio.wait_for(stop.wait(), timeout=delay)
                except asyncio.TimeoutError:
                    continue
            if stop.is_set():
                break
            if self.in_flight is not None:
                if not self.in_flight.done():
                    self.cycles_skipped += 1
                    await self.logs.put("slow: skipped · previous model call still in flight")
                    await asyncio.wait({self.in_flight})
                try:
                    self.in_flight.result()
                except Exception as exc:
                    await self.logs.put(f"slow: background task failed · {exc}")
            if stop.is_set():
                break
            self.in_flight = asyncio.create_task(self._cycle())
            next_tick = loop.time() + self.interval_s
        if self.in_flight is not None and not self.in_flight.done():
            await self.in_flight

    def metrics(self) -> dict[str, float | int]:
        muse_calls = muse_call_count() if self.provider == "muse" else 0
        return {
            "calls": self.calls_made,
            "valid_pct": 100.0 * self.valid_responses / max(1, self.calls_made),
            "fallback_pct": 100.0 * self.fallback_cycles / max(1, self.cycles_completed),
            "mean_latency_s": statistics.mean(self.latencies) if self.latencies else 0.0,
            "max_latency_s": max(self.latencies, default=0.0),
            "cycles": self.cycles_completed,
            "skipped": self.cycles_skipped,
            "muse_calls": muse_calls,
            "updates": len(self.update_times),
            "mean_update_interval_s": statistics.mean(
                b - a for a, b in zip(self.update_times, self.update_times[1:]))
                if len(self.update_times) > 1 else 0.0,
        }
