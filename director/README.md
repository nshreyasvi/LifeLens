# StageSense Director

The director replays a processed LifeLens clip. Pose and activity data become light cues sent over a local WebSocket.

## How it works

The fast loop maps energy and zone to light level and colour. Freeze detection pre-arms a dim, then fires a blackout if the performer remains still. The slow loop sends a text summary to Muse Spark or local Llama and uses the validated result for mood and tempo.

Messages include `action`, `phase`, `cue`, `intensity`, `color`, `zone`, `mood`, `music_tempo`, `reason`, and scene fields. `action` is `dim | change_color | flash_light`; `phase` is `prearm | fire | cancel | set | end`.

## Set up

From the LifeLens repository root:

```sh
python3 -m venv director/venv
source director/venv/bin/activate
python -m pip install -r director/requirements.txt -r director/requirements-dev.txt
cp director/.env.example director/.env
ollama pull llama3.2:3b
```

The model command downloads the local Llama model. For Muse, set `MODEL_PROVIDER=muse` and `MUSE_API_KEY` in `director/.env`; keep the key private.

## Run

```sh
source director/venv/bin/activate
MODEL_PROVIDER=ollama python -m director.server examples/office --start 23 --duration 30 --describe qwen
```

For Muse, replace `MODEL_PROVIDER=ollama` with `MODEL_PROVIDER=muse`. Add `--speed 2` to replay twice as fast or `--no-model` to skip the slow loop. Open the local preview with `open director/samples/preview.html`.

## Test

```sh
python -m pytest director/tests -q
```

## Results

The office clip, 23–53 s, ran with Llama 3.2 3B: `ollama ps` showed 2.2 GB, the slow loop returned 5/5 valid replies, and mean/max reply time was 2.11/2.23 s. Its screen messages had moods `calm`, `curious`, and `joyful`.

The office clip, 23–53 s, previously ran with Muse Spark: HTTP 200, 4/4 valid replies, and about 8 s mean reply time. In the full robothome clip at 2× speed, Muse returned 16/16 valid replies with 8.56 s mean and 16.08 s maximum latency; the screen mood counts were 415 calm and 425 curious. The tests reported 48 passing before the mood-map test was added.

Freeze thresholds were tuned on the office 23–53 s window. These replay results do not measure a live performance.
The current local test suite passes 49 tests.

## Known limits

* The director replays processed clips only; it is not live. Energy normalization and zone fitting use the whole clip.
* Energy is pelvis walking speed. Movement in place is not detected.
* Freeze detection reacts about 0.8 s after a stop. Real anticipation needs timestamped output from an upstream model, which is not connected.
* The energy-peak flash is defined in the fast loop, but the configured stub does not emit that event, so it cannot trigger in the current server run.
* The synthetic test clip ends with a cancel, not a blackout.
* Output reaches `director/samples/preview.html`; the main app does not connect to it.
* Muse slow-loop responses in the full robothome run averaged 8.56 s, with a 16.08 s maximum. Replies can take longer than the loop interval.
* The WebSocket has no authentication. Keep it bound to `127.0.0.1`.
* The mood-to-music table in `music_map.py` is a set of targets only; it does not call a music service.

## Credits

* [Muse Spark 1.3 and Meta Model API](https://dev.meta.ai/docs/quickstart)
* [Llama 3.2 through Ollama](https://ollama.com/library/llama3.2)
* [websockets](https://websockets.readthedocs.io/)
* [Pydantic](https://docs.pydantic.dev/)
* [python-dotenv](https://github.com/theskumar/python-dotenv)
* [certifi](https://github.com/certifi/python-certifi)
* [pytest](https://docs.pytest.org/)
