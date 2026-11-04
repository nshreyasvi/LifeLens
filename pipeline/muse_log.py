"""One line per Meta Muse Spark call into runs/muse_calls.jsonl, which the app's "Meta model calls" panel shows live:
the model, the feature, the prompt and the reply (both shortened). Never the key."""

import json
import os
import sys
import time

LOG = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'runs', 'muse_calls.jsonl')


def log(model: str, prompt: str, images: int, reply: str = '', error: str = '', started: float | None = None,
        feature: str = '') -> None:
    entry = {'t': round(time.time() * 1000), 'feature': feature or os.path.basename(sys.argv[0]).removesuffix('.py'),
             'model': model, 'prompt': prompt[:700], 'images': images, 'reply': reply[:700], 'error': error,
             'ms': round((time.time() - started) * 1000) if started else None}
    try:
        os.makedirs(os.path.dirname(LOG), exist_ok=True)
        with open(LOG, 'a', encoding='utf-8') as f:
            f.write(json.dumps(entry) + '\n')
    except OSError:
        pass     # the log only shows the calls: a failed write never stops the work
