from __future__ import annotations

import json
import os
import re
import ssl
from pathlib import Path
from urllib.parse import urlsplit
from typing import Any
from urllib.error import URLError
from urllib.request import Request, urlopen

from dotenv import dotenv_values
import certifi

from .schemas import SlowSuggestion

_MUSE_CALLS = 0


def muse_call_count() -> int:
    return _MUSE_CALLS


def _muse_api_key_from_file() -> str:
    """Read the Muse credential only from director/.env; never log its value."""
    values = dotenv_values(Path(__file__).with_name(".env"))
    return str(values.get("MUSE_API_KEY") or "").strip()


def muse_key_configured() -> bool:
    return bool(_muse_api_key_from_file())


def _extract_json(text: str) -> dict[str, Any]:
    text = text.strip()
    text = re.sub(r"^```(?:json)?\s*|\s*```$", "", text, flags=re.IGNORECASE)
    start, end = text.find("{"), text.rfind("}")
    if start < 0 or end < start:
        raise ValueError("model response did not contain a JSON object")
    candidate = text[start:end + 1]
    try:
        value = json.loads(candidate)
    except json.JSONDecodeError:
        cleaned: list[str] = []
        in_string = escaped = False
        for char in candidate:
            if escaped:
                cleaned.append(char); escaped = False
            elif char == "\\" and in_string:
                cleaned.append(char); escaped = True
            elif char == '"':
                cleaned.append(char); in_string = not in_string
            elif in_string and ord(char) < 0x20:
                cleaned.append(" ")
            else:
                cleaned.append(char)
        value = json.loads("".join(cleaned))
    if not isinstance(value, dict):
        raise ValueError("model response must be a JSON object")
    return value


def _prompt(summary: str, retry_error: str | None) -> str:
    prompt = (
        "Choose a stage direction that follows the supplied text. Reply with JSON only and exactly these keys: "
        "mood (calm|curious|joyful|tense|powerful), "
        "scene (wash|spotlight|silhouette|color_field), bpm (integer 60..180), "
        "stem (ambient|pulse|percussion|drone), "
        "shader (soft_glow|grain|ripple|none), color (#RRGGBB), reason (one short sentence). "
        "Mood guide: low energy with settled posture -> calm; medium energy or purposeful activity -> curious; "
        "high energy or active movement -> joyful or powerful; use tense only when the narration describes strain or urgency. "
        "Match the described posture and narration; do not invent activity. "
        "Use only the following word summary; it contains no pose arrays or embeddings.\n"
        f"Summary: {summary}"
    )
    if retry_error:
        prompt += f"\nYour previous JSON failed validation: {retry_error}. Correct it."
    return prompt


def _ollama(prompt: str, model: str) -> str:
    # Ollama's native /api/generate endpoint accepts a JSON Schema in `format`.
    body = json.dumps({
        "model": model,
        "prompt": prompt,
        "stream": False,
        "format": SlowSuggestion.model_json_schema(),
        "options": {"temperature": 0, "num_ctx": 1024},
    }).encode()
    request = Request(os.getenv("OLLAMA_BASE_URL", "http://localhost:11434").rstrip("/") + "/api/generate",
                      data=body, headers={"Content-Type": "application/json"}, method="POST")
    try:
        with urlopen(request, timeout=120) as response:
            payload = json.loads(response.read())
    except (URLError, TimeoutError, json.JSONDecodeError) as exc:
        raise RuntimeError(f"Ollama request failed: {exc}") from exc
    response_text = payload.get("response")
    if not isinstance(response_text, str):
        raise RuntimeError("Ollama response had no text field")
    return response_text


def _muse(prompt: str, max_calls: int) -> str:
    global _MUSE_CALLS
    if _MUSE_CALLS >= max_calls:
        raise RuntimeError(f"Muse call limit reached ({max_calls})")
    base_url = os.getenv("MUSE_BASE_URL", "https://api.meta.ai/v1").strip().rstrip("/")
    model = os.getenv("MUSE_MODEL", "muse-spark-1.3").strip()
    api_key = _muse_api_key_from_file()
    if not api_key:
        raise RuntimeError("MUSE_API_KEY is missing from director/.env; Muse request was not sent")
    if not base_url or not model:
        raise RuntimeError("MUSE_BASE_URL and MUSE_MODEL must be set")
    parsed = urlsplit(base_url)
    if (parsed.scheme != "https" or parsed.hostname != "api.meta.ai"
            or parsed.port not in (None, 443) or parsed.username or parsed.password
            or parsed.query or parsed.fragment):
        raise RuntimeError("Muse requests are restricted to HTTPS api.meta.ai")
    body = json.dumps({"model": model, "input": prompt}).encode()
    request = Request(base_url + "/responses", data=body,
                      headers={"Content-Type": "application/json", "Authorization": f"Bearer {api_key}"},
                      method="POST")
    tls_context = ssl.create_default_context(cafile=certifi.where())
    _MUSE_CALLS += 1
    try:
        with urlopen(request, timeout=120, context=tls_context) as response:
            print(f"MUSE_HTTP_STATUS {response.status}", flush=True)
            payload = json.loads(response.read())
    except (URLError, TimeoutError, json.JSONDecodeError) as exc:
        raise RuntimeError(f"Muse request failed: {exc}") from exc
    text = payload.get("output_text")
    if not isinstance(text, str):
        # Accept the documented Responses output content text envelope too.
        chunks = [part.get("text", "") for item in payload.get("output", [])
                  for part in item.get("content", []) if part.get("type") == "output_text"]
        text = "".join(chunks)
    if not text:
        raise RuntimeError("Muse response had no output text")
    return text


def call_model_raw(summary: str, *, provider: str | None = None,
                   retry_error: str | None = None, max_muse_calls: int = 30) -> str:
    provider = (provider or os.getenv("MODEL_PROVIDER", "ollama")).lower()
    prompt = _prompt(summary, retry_error)
    if provider == "ollama":
        return _ollama(prompt, os.getenv("OLLAMA_MODEL", "llama3.2:3b"))
    if provider == "muse":
        return _muse(prompt, max_muse_calls)
    raise ValueError("MODEL_PROVIDER must be ollama or muse")


