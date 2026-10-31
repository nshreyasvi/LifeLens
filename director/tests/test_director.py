from __future__ import annotations

import asyncio
import json
import time
from dataclasses import replace
from pathlib import Path

import pytest
from pydantic import ValidationError

from director.anticipation import AnticipationWebSocketPredictor, EnergyOnlyPredictor, StubPredictor
from director.descriptions import load_dam_descriptions, select_dam_description
from director.fast_loop import FastLoop
from director.features import STILL_SPEED_M_S, FrameFeatures, energy_word, is_still_speed
from director.output_map import make_message
from director.music_map import MOOD_MUSIC
from director.replay import load_clip
from director.schemas import ScreenMessage, SlowSuggestion
from director.slow_loop import SlowLoop, summarize


TESTS = Path(__file__).parent


def frame(t: float, speed: float, zone: str = "A", *, energy: float | None = None) -> FrameFeatures:
    return FrameFeatures(t, zone, min(1, speed) if energy is None else energy,
                         speed, .9, 5.0, "standing",
                         "The performer is standing.", 0.0, 0.0)


def write_minimal_clip(path: Path, activity_csv: str, *, world_times: tuple[str, ...] =
                       ("0.00000", "0.03330", "0.06670")) -> None:
    (path / "kinematics").mkdir(parents=True, exist_ok=True)
    (path / "pose_timeseries.csv").write_text(
        "time_s,trunk_lean,pelvis_height_m,speed_m_s\n"
        "0.0000,10,1.0,0.2\n0.0333,11,1.0,0.3\n0.0667,12,1.0,0.4\n",
        encoding="utf-8",
    )
    world_rows = [f"{t},{x},0" for t, x in zip(world_times, (0, 1, 2))]
    (path / "kinematics" / "joints_world.csv").write_text(
        "time_s,pelvis_x,pelvis_y\n" + "\n".join(world_rows) + "\n",
        encoding="utf-8",
    )
    (path / "activity.csv").write_text(activity_csv, encoding="utf-8")


def test_real_clip_schema_and_headers():
    clip = load_clip(Path(__file__).parents[2] / "examples" / "office")
    assert abs(clip.fps - 30) < .01
    assert len(clip.frames) == 2493
    assert {f.zone for f in clip.frames} == {"A", "B", "C"}


@pytest.mark.parametrize(("activity_csv", "missing"), [
    ("second,clip,narration\n0,office,Someone moves.\n", "label"),
    ("second,clip,label\n0,office,walking\n", "narration"),
])
def test_load_clip_fails_clearly_when_activity_columns_are_missing(
    tmp_path, activity_csv, missing
):
    write_minimal_clip(tmp_path, activity_csv)
    with pytest.raises(ValueError, match=f"activity.csv missing required columns: {missing}"):
        load_clip(tmp_path)


def test_load_clip_filters_activity_rows_to_current_clip(tmp_path):
    clip_dir = tmp_path / "office"
    write_minimal_clip(
        clip_dir,
        "second,clip,label,narration\n"
        "0,robothome,walking,Wrong clip.\n"
        "0,office,standing,Office clip.\n",
    )
    clip = load_clip(clip_dir)
    assert {feature.posture_label for feature in clip.frames} == {"standing"}
    assert {feature.narration for feature in clip.frames} == {"Office clip."}


def test_load_clip_errors_if_activity_has_no_rows_for_current_clip(tmp_path):
    clip_dir = tmp_path / "office"
    write_minimal_clip(
        clip_dir,
        "second,clip,label,narration\n0,robothome,walking,Wrong clip.\n",
    )
    with pytest.raises(ValueError, match="no rows for current clip 'office'"):
        load_clip(clip_dir)


def test_load_clip_accepts_small_pose_world_timestamp_rounding_difference(tmp_path):
    write_minimal_clip(
        tmp_path,
        "second,label,narration\n0,standing,Still.\n",
        world_times=("0.0009", "0.0333", "0.0667"),
    )
    assert len(load_clip(tmp_path).frames) == 3


def test_load_clip_rejects_pose_world_timestamp_mismatch(tmp_path):
    write_minimal_clip(
        tmp_path,
        "second,label,narration\n0,standing,Still.\n",
        world_times=("0.002", "0.0333", "0.0667"),
    )
    with pytest.raises(ValueError, match="timestamp mismatch at pose/world data row 1"):
        load_clip(tmp_path)


@pytest.mark.parametrize(("energy", "expected"), [
    (0.339, "low"), (0.34, "medium"), (0.679, "medium"), (0.68, "high"),
])
def test_energy_word_cutoffs_are_shared_by_features_and_screen(energy, expected):
    feature = frame(0, .2, energy=energy)
    message = make_message(msg_id=1, time_s=0, energy=energy, phase="set", cue="dim",
                           intensity=.2, zone="A", mood="calm", bpm=90,
                           source="fast", reason="The stage holds.")
    assert energy_word(energy) == expected
    assert feature.energy_word == expected
    assert message["energy"] == expected


def test_music_map_covers_every_allowed_slow_mood():
    from typing import get_args

    allowed_moods = get_args(SlowSuggestion.model_fields["mood"].annotation)
    assert set(MOOD_MUSIC) == set(allowed_moods)
    for target in MOOD_MUSIC.values():
        low, high = target["tempo_bpm"]
        assert 60 <= low <= high <= 180
        assert 0.0 <= target["energy"] <= 1.0


def test_director_has_one_shared_still_speed_rule():
    assert is_still_speed(STILL_SPEED_M_S)
    assert not is_still_speed(STILL_SPEED_M_S + 0.001)
    assert StubPredictor().still_speed_m_s == STILL_SPEED_M_S
    assert not hasattr(frame(0, .02), "stillness")


def test_screen_schema_preserves_panel_action_and_director_phase():
    msg = ScreenMessage.model_validate({
        "id": 1, "time": "0:00:01.000", "energy": "low", "action": "dim",
        "music_tempo": 90, "phase": "fire", "cue": "blackout", "intensity": 0,
        "color": "#3977FF", "zone": "A", "mood": "still", "source": "fast",
        "reason": "The performer settled.", "log": "The performer settled.",
    })
    assert msg.action == "dim" and msg.phase == "fire" and msg.intensity == 0


def test_make_message_maps_screen_keys_and_clamps_values():
    message = make_message(msg_id=2, time_s=1.25, energy=.8, phase="set", cue="flash",
                           intensity=1.4, zone="B", mood="joyful", bpm=220,
                           source="fast", reason="The energy peaks.", scene="spotlight",
                           stem="pulse", shader="ripple", model_summary="Moving quickly.",
                           model_decision="The scene brightens.")
    assert message["action"] == "flash_light"
    assert message["intensity"] == 1.0 and message["music_tempo"] == 180
    assert (message["scene"], message["stem"], message["shader"]) == (
        "spotlight", "pulse", "ripple")
    assert message["model_summary"] == "Moving quickly."


def test_synthetic_csv_is_walk_slow_freeze_walk():
    clip = load_clip(TESTS / "synthetic" / "walk_slow_freeze_walk")
    assert len(clip.frames) >= 90
    assert max(f.speed_m_s for f in clip.frames[:15]) > .5
    assert any(.1 < f.speed_m_s < .3 for f in clip.frames)
    assert any(f.speed_m_s <= .08 for f in clip.frames)
    assert max(f.speed_m_s for f in clip.frames[-15:]) > .5


def test_stub_requires_sustained_slowdown_after_real_movement():
    predictor = StubPredictor()
    for i in range(8):
        assert predictor.predict(frame(i / 10, .6))["event"] == "none"
    # A short stop is ignored even though the person was just walking.
    assert predictor.predict(frame(.8, .02))["event"] == "none"
    assert predictor.predict(frame(.9, .02))["event"] == "none"
    assert predictor.predict(frame(1.0, .6))["event"] == "none"
    # A later continuous stop lasting 0.8 s produces one freeze-detection event.
    for i in range(11, 19):
        prediction = predictor.predict(frame(i / 10, .02))
        assert prediction["event"] == "none"
    prediction = predictor.predict(frame(2.0, .02))
    assert prediction == {"event": "freeze", "prob": .82, "eta_ms": 1000}
    assert predictor.predict(frame(2.1, .02))["event"] == "none"


def test_upstream_parser_uses_energy_only_fallback_and_never_stub_prearms():
    parser = AnticipationWebSocketPredictor()
    for i in range(20):
        speed = .6 if i < 5 else .02
        prediction = parser.parse({}, frame(i / 10, speed))
        assert prediction["event"] != "freeze"
    assert parser.parse({"activity": {"conf": .2},
                         "anticipation": {"event": "freeze", "prob": .9}},
                        frame(3, .4))["event"] == "none"
    assert parser.parse({"activity": {"conf": .9},
                         "anticipation": {"event": "freeze", "prob": .8, "eta_ms": 500}},
                        frame(4, .4))["event"] == "freeze"


@pytest.mark.parametrize("payload", [
    {},
    {"activity": None, "anticipation": None},
    {"activity": {"conf": "high"}, "anticipation": {"prob": []}},
    [],
])
def test_upstream_parser_bad_payloads_fall_back_without_crashing(payload):
    result = AnticipationWebSocketPredictor().parse(payload, frame(0, .5))
    assert result["event"] in {"none", "energy_peak"}
    assert "prob" in result and "eta_ms" in result


def test_upstream_parser_oversized_number_falls_back_to_energy_only():
    parser = AnticipationWebSocketPredictor()
    result = parser.parse({"activity": {"conf": 10**10000},
                           "anticipation": {"event": "freeze", "prob": .99}},
                          frame(1, .5))
    assert result["event"] == "none"


def test_prearm_then_fire_on_synthetic_freeze():
    loop = FastLoop(StubPredictor())
    outputs = []
    for i in range(105):
        t = i / 30
        speed = .6 if t < .5 or t >= 2.8 else .2 if t < .8 else .02
        msg, logs = loop.step(frame(t, speed))
        outputs.append((msg, logs))
    assert any("freeze detection: stop detected · pre-arm" in logs for _, logs in outputs)
    assert any("check: settled · BLACKOUT" in logs for _, logs in outputs)
    assert any(m["phase"] == "fire" and m["cue"] == "blackout" and m["action"] == "dim"
               for m, _ in outputs)
    fire_index = next(i for i, (m, _) in enumerate(outputs)
                      if m["phase"] == "fire" and m["cue"] == "blackout")
    assert outputs[fire_index + 1][0]["intensity"] == 0.0
    assert outputs[fire_index + 1][0]["phase"] == "set"
    resumed = next(m for m, _ in outputs[fire_index + 1:]
                   if m["reason"] == "The performer moved again; the stage light returns.")
    assert resumed["reason"] == "The performer moved again; the stage light returns."
    assert resumed["phase"] == "set" and resumed["cue"] != "blackout"


def test_prearm_then_cancel_on_synthetic_recovery_raises_threshold_and_cools_down():
    loop = FastLoop(StubPredictor())
    outputs = []
    for i in range(90):
        t = i / 30
        speed = .6 if t < .5 else .02 if t < 1.7 else .22
        msg, logs = loop.step(frame(t, speed))
        outputs.append((msg, logs))
    assert any("freeze detection: stop detected · pre-arm" in logs for _, logs in outputs)
    assert any("check: still moving · cancel" in log for _, logs in outputs for log in logs)
    assert loop.threshold == .75
    assert loop.predictor.cooldown_until_s >= 2.0 + 3.0


def test_cancel_threshold_is_capped_at_point_eight():
    class AlwaysPredictsFreeze:
        def predict(self, features):
            return {"event": "freeze", "prob": .99, "eta_ms": 1000}

    loop = FastLoop(AlwaysPredictsFreeze())
    loop.threshold = .78
    loop.step(frame(0, .5))
    message, logs = loop.step(frame(1, .5))
    assert message["phase"] == "cancel"
    assert any("threshold +0.05" in log for log in logs)
    assert loop.threshold == .8


def test_three_cancels_do_not_lock_out_a_later_real_freeze():
    loop = FastLoop(StubPredictor())
    t = 0.0

    def step(speed: float):
        nonlocal t
        result = loop.step(frame(t, speed))
        t = round(t + 1 / 30, 6)
        return result

    def walk_for(seconds: float) -> None:
        end = t + seconds
        while t < end:
            step(.6)

    for _ in range(3):
        walk_for(.6)
        prearm_t = None
        stop_deadline = t + 2.0
        while t < stop_deadline:
            message, logs = step(.02)
            if "freeze detection: stop detected · pre-arm" in logs:
                prearm_t = t - 1 / 30
                break
        assert prearm_t is not None
        while t < prearm_t + .8:
            step(.02)
        canceled = False
        while loop.pending is not None:
            message, _ = step(.6)
            canceled = canceled or message["phase"] == "cancel"
        assert canceled
        walk_for(3.2)

    assert loop.threshold == .8
    prearm_t = None
    stop_deadline = t + 2.0
    while t < stop_deadline:
        message, logs = step(.02)
        if "freeze detection: stop detected · pre-arm" in logs:
            prearm_t = t - 1 / 30
            break
    assert prearm_t is not None
    fired = False
    while t < prearm_t + 1.1:
        message, _ = step(.02)
        fired = fired or (message["phase"] == "fire" and message["cue"] == "blackout")
    assert fired


def test_threshold_returns_to_base_after_ten_seconds_without_cancel():
    class AlwaysPredictsFreeze:
        def predict(self, features):
            return {"event": "freeze", "prob": .99, "eta_ms": 1000}

    loop = FastLoop(AlwaysPredictsFreeze())
    loop.step(frame(0, .5))
    message, _ = loop.step(frame(1, .5))
    assert message["phase"] == "cancel"
    assert loop.threshold == .75
    loop.step(frame(11.01, .5))
    assert loop.threshold == loop.base_threshold == .70


def test_local_model_prompt_varies_with_low_medium_and_high_energy():
    from director.model_client import _prompt

    prompts = [
        _prompt(summarize([frame(0, .2, energy=energy)], {"event": "none", "prob": 0}), None)
        for energy in (.2, .5, .9)
    ]
    assert len(set(prompts)) == 3
    assert "energy low" in prompts[0]
    assert "energy medium" in prompts[1]
    assert "energy high" in prompts[2]
    assert all("restrained" not in prompt for prompt in prompts)
    assert all("Mood guide:" in prompt for prompt in prompts)


def test_server_description_mode_defaults_to_qwen():
    from director.server import _arg_parser

    args = _arg_parser().parse_args(["examples/office"])
    assert args.describe == "qwen"


def test_ollama_request_uses_small_context_and_new_default_model(monkeypatch):
    import director.model_client as model_client

    captured = {}

    class Response:
        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

        def read(self):
            return b'{"response":"{}"}'

    def fake_urlopen(request, timeout):
        captured["url"] = request.full_url
        captured["body"] = json.loads(request.data)
        return Response()

    monkeypatch.delenv("OLLAMA_MODEL", raising=False)
    monkeypatch.setattr(model_client, "urlopen", fake_urlopen)
    model_client.call_model_raw("A text-only summary.", provider="ollama")
    assert captured["url"].endswith("/api/generate")
    assert captured["body"]["model"] == "llama3.2:3b"
    assert captured["body"]["options"] == {"temperature": 0, "num_ctx": 1024}


def test_missing_muse_key_falls_back_to_ollama_once_with_one_log_line(monkeypatch):
    import director.slow_loop as slow_loop_module

    providers = []
    answer = SlowSuggestion(mood="curious", scene="wash", bpm=90, stem="ambient",
                            shader="soft_glow", color="#3977FF",
                            reason="The stage holds its opening scene.").model_dump_json()

    def fake_call(summary, *, provider=None, retry_error=None, max_muse_calls=30):
        providers.append(provider)
        return answer

    async def run():
        monkeypatch.setattr(slow_loop_module, "muse_key_configured", lambda: False)
        monkeypatch.setattr(slow_loop_module, "call_model_raw", fake_call)
        loop = SlowLoop(provider="muse")
        loop.observe(frame(0, .2))
        await loop.update_once()
        log_lines = []
        while not loop.logs.empty():
            log_lines.append(loop.logs.get_nowait())
        assert providers == ["ollama"]
        assert sum("Muse key missing from director/.env" in line for line in log_lines) == 1
        assert loop.state.mood == "curious"

    asyncio.run(run())


def test_muse_key_is_not_read_from_the_process_environment(monkeypatch):
    import director.model_client as model_client

    monkeypatch.setenv("MUSE_API_KEY", "environment-only-placeholder")
    monkeypatch.setattr(model_client, "dotenv_values", lambda path: {})
    assert model_client.muse_key_configured() is False


def test_energy_peak_fires_a_visible_flash_cue():
    loop = FastLoop(EnergyOnlyPredictor())
    loop.step(frame(0, .1, energy=.1))
    message, _ = loop.step(frame(.1, .5, energy=.8))
    assert message["phase"] == "set"
    assert message["cue"] == "flash"
    assert message["action"] == "flash_light"


def test_fast_loop_step_is_under_30ms():
    loop = FastLoop(StubPredictor())
    durations = []
    for i in range(300):
        before = time.perf_counter()
        loop.step(frame(i / 30, .4))
        durations.append((time.perf_counter() - before) * 1000)
    assert max(durations) < 30


def test_bad_model_output_retries_once_then_keeps_last_good():
    calls = []

    def invalid(summary, *, provider=None, retry_error=None):
        calls.append(retry_error)
        raise ValueError("bad response")

    async def run():
        loop = SlowLoop(model_fn=invalid)
        old = loop.state
        await loop.update_once()
        assert loop.state == old
        assert len(calls) == 2
        assert loop.fallback_cycles == 1

    asyncio.run(run())


def test_model_json_parser_normalizes_literal_control_chars_in_strings():
    from director.model_client import _extract_json
    result = _extract_json('{"reason":"A calm scene\nfor the performer."}')
    assert result["reason"] == "A calm scene for the performer."


def test_garbled_reason_rejects_ansi_reset_character_only():
    with pytest.raises(ValidationError, match="control or formatting"):
        SlowSuggestion(mood="calm", scene="wash", bpm=90, stem="ambient",
                       shader="soft_glow", color="#445566",
                       reason="Reset \x1bc terminal safely.")


def test_bad_model_reason_is_sanitized_before_any_terminal_log():
    def invalid(summary, *, provider=None, retry_error=None):
        return ('{"mood":"calm","scene":"wash","bpm":90,"stem":"ambient",'
                '"shader":"soft_glow","color":"#445566",'
                '"reason":"reset \x1bc terminal."}')

    async def run():
        loop = SlowLoop(model_fn=invalid)
        await loop.update_once()
        logs = []
        while not loop.logs.empty():
            logs.append(loop.logs.get_nowait())
        joined = "\n".join(logs)
        assert "\x1b" not in joined
        assert "MODEL SAID:" in joined and "fallback" in joined

    asyncio.run(run())


def test_bpm_moves_no_more_than_ten_per_slow_step():
    def suggest(summary, *, provider=None, retry_error=None):
        return SlowSuggestion(mood="joyful", scene="spotlight", bpm=150, stem="pulse",
                              shader="ripple", color="#AA33CC", reason="The scene lifts.")

    async def run():
        loop = SlowLoop(model_fn=suggest)
        await loop.update_once()
        assert loop.state.bpm == 100

    asyncio.run(run())


def test_slow_screen_update_includes_scene_stem_shader_and_throttles_color():
    loop = FastLoop(StubPredictor())
    suggestion = SlowSuggestion(mood="joyful", scene="spotlight", bpm=100, stem="pulse",
                                shader="ripple", color="#AA33CC", reason="The scene lifts.")
    first = loop.slow_message(frame(10, .2), suggestion)
    second = loop.slow_message(frame(12, .2), suggestion)
    assert first["source"] == second["source"] == "slow"
    assert first["action"] == "change_color" and first["cue"] == "color"
    assert second["action"] == "dim" and second["cue"] == "dim"
    assert first["scene"] == "spotlight" and first["stem"] == "pulse"
    assert first["shader"] == "ripple"


def test_screen_publisher_filters_the_actual_emitted_stream(monkeypatch):
    from director.server import ScreenPublisher, send_screen

    class Client:
        def __init__(self):
            self.received = []

        async def send(self, payload):
            self.received.append(json.loads(payload))

    async def run():
        client = Client()
        clients = {client}
        publisher = ScreenPublisher()
        base = make_message(msg_id=1, time_s=0, energy=.4, phase="set", cue="dim",
                            intensity=.30, zone="A", mood="calm", bpm=90,
                            source="fast", reason="The stage stays calm.")
        await send_screen(clients, publisher, base)
        await send_screen(clients, publisher, dict(base, id=2, intensity=.34))
        await send_screen(clients, publisher, dict(base, id=3, intensity=.351))
        assert len(client.received) == 2
        assert client.received[-1]["intensity"] == .35

        phase_change = dict(base, id=4, phase="cancel", reason="The performer resumed moving.")
        await send_screen(clients, publisher, phase_change)
        await send_screen(clients, publisher, dict(phase_change, id=5, mood="joyful"))
        same_mood = dict(phase_change, mood="joyful")
        await send_screen(clients, publisher, dict(same_mood, id=6, music_tempo=100))
        assert len(client.received) == 5
        assert client.received[-1]["music_tempo"] == 100

        publisher.last_send = time.monotonic() - 1.1
        await send_screen(clients, publisher, dict(same_mood, id=7, music_tempo=100))
        assert len(client.received) == 6

        flash = dict(same_mood, id=8, cue="flash", action="flash_light", color="#FFFFFF")
        await send_screen(clients, publisher, flash)
        assert len(client.received) == 7 and client.received[-1]["cue"] == "flash"
        restore = dict(flash, id=9, cue="dim", action="dim", color="#3977FF")
        await send_screen(clients, publisher, restore)
        assert len(client.received) == 8 and client.received[-1]["cue"] == "dim"

        end = dict(restore, id=10, phase="end", reason="Replay ended.", log="Replay ended.")
        await send_screen(clients, publisher, end)
        assert len(client.received) == 9 and client.received[-1]["phase"] == "end"
        assert publisher.count == len(client.received)

    asyncio.run(run())


def test_slow_loop_skips_an_in_flight_cycle():
    def slow(summary, *, provider=None, retry_error=None):
        time.sleep(.4)
        return SlowSuggestion(mood="calm", scene="wash", bpm=90, stem="ambient",
                              shader="soft_glow", color="#445566", reason="The stage stays calm.")

    async def run():
        loop = SlowLoop(model_fn=slow, interval_s=.02)
        loop.observe(frame(0, .2))
        stop = asyncio.Event()
        task = asyncio.create_task(loop.run(stop))
        await asyncio.sleep(.075)
        stop.set()
        await task
        assert loop.cycles_skipped > 0

    asyncio.run(run())


def test_dam_real_format_selection_and_describe_modes():
    clip_dir = Path(__file__).parents[2] / "examples" / "office"
    records = load_dam_descriptions(clip_dir)
    assert len(records) == 51
    assert {row.source for row in records} == {"ego", "pose", "both"}
    selected = select_dam_description(records, 12)
    assert selected.source in {"pose", "both"}
    assert any(word in selected.text.lower() for word in ("figure", "person", "humanoid"))
    assert not any(word in selected.text.lower() for word in
                   ("arms", "hands", "fingers", "legs", "feet", "knees"))
    frames = [frame(i / 30, .2) for i in range(180)]
    qwen = summarize(frames, {"event": "none", "prob": 0}, describe="qwen")
    dam = summarize(frames, {"event": "none", "prob": 0}, describe="dam",
                    dam_descriptions=records)
    both = summarize(frames, {"event": "none", "prob": 0}, describe="both",
                     dam_descriptions=records)
    assert "Qwen:" in qwen and "DAM (" not in qwen
    assert "DAM (" in dam and "Qwen:" not in dam
    assert "Qwen:" in both and "DAM (" in both
    assert len(both.split()) < 80
    assert not any(value in both for value in ("pelvis", "trunk_lean", "embedding", "[", "]"))


def test_slow_summary_excludes_unreliable_arms_raised_label():
    frames = [frame(i / 30, .2) for i in range(180)]
    frames[0] = replace(frames[0], posture_label="arms raised")
    summary = summarize(frames, {"event": "none", "prob": 0}, describe="qwen")
    assert "arms raised" not in summary.casefold()
    assert "standing" in summary.casefold()


def test_dam_selector_skips_truncated_sentences():
    from director.descriptions import DamDescription

    selected = select_dam_description([
        DamDescription("pose", 0, 5, "The figure stands upright, with"),
        DamDescription("both", 0, 5, "A person walks calmly."),
    ], 1)
    assert selected.text == "A person walks calmly."


def test_muse_rejects_non_allowlisted_host_before_sending_key(monkeypatch):
    import director.model_client as model_client

    calls = []
    monkeypatch.setenv("MUSE_BASE_URL", "https://attacker.example/v1")
    monkeypatch.setenv("MUSE_MODEL", "muse-spark-1.3")
    monkeypatch.setattr(model_client, "_muse_api_key_from_file", lambda: "test-only-placeholder")
    monkeypatch.setattr(model_client, "urlopen", lambda *args, **kwargs: calls.append(args))
    with pytest.raises(RuntimeError, match="HTTPS api.meta.ai"):
        model_client._muse("A short test prompt.", max_calls=30)
    assert calls == []


def test_muse_request_uses_certifi_ca_context(monkeypatch):
    import certifi
    import director.model_client as model_client

    original_context = model_client.ssl.create_default_context
    captured = {}

    class Response:
        status = 200

        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

        def read(self):
            return b'{"output_text":"{}"}'

    def make_context(*, cafile):
        captured["cafile"] = cafile
        captured["context"] = original_context(cafile=cafile)
        return captured["context"]

    def fake_urlopen(request, *, timeout, context):
        captured["passed_context"] = context
        return Response()

    monkeypatch.setenv("MUSE_BASE_URL", "https://api.meta.ai/v1")
    monkeypatch.setenv("MUSE_MODEL", "muse-spark-1.3")
    monkeypatch.setattr(model_client, "_muse_api_key_from_file", lambda: "test-placeholder")
    monkeypatch.setattr(model_client.ssl, "create_default_context", make_context)
    monkeypatch.setattr(model_client, "urlopen", fake_urlopen)

    model_client._muse("A safe test prompt.", max_calls=30)

    assert captured["cafile"] == certifi.where()
    assert captured["passed_context"] is captured["context"]


def test_fast_zone_color_is_not_replaced_by_model_color():
    loop = FastLoop(StubPredictor())
    msg, _ = loop.step(frame(0, .3, "C"))
    assert msg["zone"] == "C" and msg["color"] == "#FF6347"
