# Test and watch the director

## Set up

From the repository root:

```sh
python3 -m venv director/venv
source director/venv/bin/activate
python -m pip install -r director/requirements.txt -r director/requirements-dev.txt
cp director/.env.example director/.env
```

For local Llama, install it with `ollama pull llama3.2:3b`. For Muse, place `MUSE_API_KEY` in `director/.env`; never put the key in a command or log.

## Office replay with Llama

```sh
MODEL_PROVIDER=ollama director/venv/bin/python -m director.server examples/office --start 23 --duration 30 --describe qwen
```

In the recorded run, `ollama ps` showed `llama3.2:3b` at 2.2 GB. The slow loop returned 5/5 valid answers (mean 2.11 s, max 2.23 s), and output mood counts were calm 46, curious 16, joyful 13. Freeze detection pre-armed at 26.07 s and 32.93 s; it blacked out at 27.07 s and 33.93 s.

## Full robothome replay with Muse

```sh
MODEL_PROVIDER=muse director/venv/bin/python -m director.server examples/robothome --describe qwen --speed 2
```

The recorded full-clip run returned 16/16 valid answers (mean 8.56 s, max 16.08 s); mood counts were calm 415 and curious 425. It logged 10 pre-arms, 6 blackouts, and 4 cancels. The stop near 136.9 s was canceled at 137.90 s; the stops near 176.4, 214.8, and 240.9 s blacked out at 177.40, 215.80, and 241.93 s.

## Tests

```sh
director/venv/bin/python -m pytest director/tests -q
```

The current suite output is `49 passed in 0.75s`. The synthetic CSV replay ends with a cancel; it is not evidence of a synthetic blackout. Add `--no-model` to exercise only the fast loop, or `--speed 2` to shorten replay time.
