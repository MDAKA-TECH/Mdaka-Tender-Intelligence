"""One function, three providers: send the tender text, get JSON matching fields.SCHEMA back.

Choose with LLM_PROVIDER = anthropic | openai | gemini | fixture, and LLM_MODEL.
Keys: ANTHROPIC_API_KEY / OPENAI_API_KEY / GEMINI_API_KEY.
'fixture' replays a saved JSON response (LLM_FIXTURE=path) for tests without a key.
"""
from __future__ import annotations

import json
import os
import sys
import time
from dataclasses import dataclass

import httpx

from fields import SCHEMA, SYSTEM_PROMPT

# Model names change often: set LLM_MODEL to a current model from your provider's docs.
DEFAULT_MODELS = {
    "anthropic": "claude-sonnet-4-5",
    "openai": "gpt-4.1-mini",
    "gemini": "gemini-3-flash-preview",
}
TIMEOUT = httpx.Timeout(180.0, connect=15.0)
# Generous: "thinking" models count their reasoning against this limit too.
MAX_OUTPUT_TOKENS = int(os.getenv("LLM_MAX_OUTPUT_TOKENS", "32000"))


@dataclass
class LLMResult:
    data: dict
    provider: str
    model: str
    input_tokens: int | None = None
    output_tokens: int | None = None
    seconds: float = 0.0


class LLMError(RuntimeError):
    pass


def _key(name: str) -> str:
    v = os.getenv(name)
    if not v:
        raise LLMError(f"Set {name} in worker/.env to use this provider.")
    return v


class Overloaded(LLMError):
    """The provider is temporarily overloaded (HTTP 503/529). Worth retrying later or on another model."""


def _post(url: str, headers: dict, body: dict) -> dict:
    waits = [10, 30, 60]  # overload spikes on preview/free models usually clear within a minute or two
    for attempt in range(len(waits) + 1):
        r = httpx.post(url, headers=headers, json=body, timeout=TIMEOUT)
        if r.status_code in (429, 500, 502, 503, 529) and attempt < len(waits):
            # Honour Retry-After when the provider sends it.
            ra = r.headers.get("retry-after")
            wait = float(ra) if ra and ra.replace(".", "", 1).isdigit() else waits[attempt]
            print(f"  model API busy ({r.status_code}), retrying in {wait:.0f}s…", file=sys.stderr)
            time.sleep(wait)
            continue
        if r.status_code == 429:
            raise LLMError("Rate limit reached (free tier allows only a few requests per minute/day). Try again later.")
        if r.status_code in (503, 529):
            raise Overloaded(f"{r.status_code}: the model is overloaded right now. Try again later or set LLM_FALLBACK_MODEL.")
        if r.status_code >= 400:
            raise LLMError(f"{r.status_code} from model API: {r.text[:400]}")
        return r.json()
    raise LLMError("Model API kept failing")


def _anthropic(model: str, user: str) -> tuple[dict, int | None, int | None]:
    body = {
        "model": model,
        "max_tokens": MAX_OUTPUT_TOKENS,
        "temperature": 0,
        "system": SYSTEM_PROMPT,
        "messages": [{"role": "user", "content": user}],
        # A forced tool call makes the model return input that follows the schema.
        "tools": [{"name": "record_tender_facts", "description": "Record the extracted tender facts.", "input_schema": SCHEMA}],
        "tool_choice": {"type": "tool", "name": "record_tender_facts"},
    }
    res = _post("https://api.anthropic.com/v1/messages",
                {"x-api-key": _key("ANTHROPIC_API_KEY"), "anthropic-version": "2023-06-01"}, body)
    block = next((b for b in res.get("content", []) if b.get("type") == "tool_use"), None)
    if not block:
        raise LLMError(f"No structured output (stop_reason={res.get('stop_reason')}).")
    u = res.get("usage", {})
    return block["input"], u.get("input_tokens"), u.get("output_tokens")


def _openai(model: str, user: str) -> tuple[dict, int | None, int | None]:
    body = {
        "model": model,
        "temperature": 0,
        "max_completion_tokens": MAX_OUTPUT_TOKENS,
        "messages": [{"role": "system", "content": SYSTEM_PROMPT}, {"role": "user", "content": user}],
        "response_format": {"type": "json_schema", "json_schema": {"name": "tender_facts", "strict": True, "schema": SCHEMA}},
    }
    res = _post("https://api.openai.com/v1/chat/completions", {"Authorization": f"Bearer {_key('OPENAI_API_KEY')}"}, body)
    msg = res["choices"][0]["message"]
    if msg.get("refusal"):
        raise LLMError(f"Model refused: {msg['refusal']}")
    u = res.get("usage", {})
    return json.loads(msg["content"]), u.get("prompt_tokens"), u.get("completion_tokens")


def _gemini(model: str, user: str) -> tuple[dict, int | None, int | None]:
    # Gemini's responseSchema dialect differs from JSON Schema, so the schema goes in the prompt
    # and the reply is validated by our own validator afterwards.
    config = {"temperature": 0, "responseMimeType": "application/json", "maxOutputTokens": MAX_OUTPUT_TOKENS,
              # Extraction needs little reasoning; low thinking leaves the token budget for the answer.
              "thinkingConfig": {"thinkingLevel": os.getenv("GEMINI_THINKING_LEVEL", "low")}}
    body = {
        "systemInstruction": {"parts": [{"text": SYSTEM_PROMPT}]},
        "contents": [{"role": "user", "parts": [{"text": user + "\n\nReturn ONLY JSON matching this JSON Schema:\n" + json.dumps(SCHEMA)}]}],
        "generationConfig": config,
    }
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
    headers = {"x-goog-api-key": _key("GEMINI_API_KEY")}
    try:
        res = _post(url, headers, body)
    except LLMError as e:
        if "thinking" not in str(e).lower():
            raise
        config.pop("thinkingConfig")  # older models don't accept thinkingLevel
        res = _post(url, headers, body)

    try:
        cand = res["candidates"][0]
        # A long answer can arrive in several parts; skip any "thought" parts.
        text = "".join(p.get("text", "") for p in cand["content"]["parts"] if not p.get("thought"))
    except (KeyError, IndexError) as e:
        raise LLMError(f"Unexpected Gemini reply: {str(res)[:300]}") from e
    reason = cand.get("finishReason")
    if reason == "MAX_TOKENS":
        raise LLMError("Gemini ran out of output tokens before finishing. Raise LLM_MAX_OUTPUT_TOKENS in worker/.env.")
    if reason not in (None, "STOP"):
        raise LLMError(f"Gemini stopped early (finishReason={reason}).")
    u = res.get("usageMetadata", {})
    text = text.strip()
    if text.startswith("```"):  # occasionally wrapped in a ```json fence
        text = text.split("\n", 1)[1].rsplit("```", 1)[0]
    try:
        data = json.loads(text)
    except json.JSONDecodeError as e:
        raise LLMError(f"Gemini returned invalid JSON ({e.msg} at char {e.pos} of {len(text)}).") from e
    return data, u.get("promptTokenCount"), u.get("candidatesTokenCount")


def _fixture(_model: str, _user: str) -> tuple[dict, None, None]:
    path = os.getenv("LLM_FIXTURE")
    if not path:
        raise LLMError("Set LLM_FIXTURE to a saved response JSON.")
    with open(path, encoding="utf-8") as f:
        return json.load(f), None, None


PROVIDERS = {"anthropic": _anthropic, "openai": _openai, "gemini": _gemini, "fixture": _fixture}


def provider_and_model() -> tuple[str, str]:
    provider = (os.getenv("LLM_PROVIDER") or "").strip().lower()
    if provider not in PROVIDERS:
        raise LLMError(f"Set LLM_PROVIDER to one of: {', '.join(PROVIDERS)}.")
    return provider, os.getenv("LLM_MODEL") or DEFAULT_MODELS.get(provider, "fixture")


def call(user_prompt: str) -> LLMResult:
    provider, model = provider_and_model()
    t = time.monotonic()
    try:
        data, i, o = PROVIDERS[provider](model, user_prompt)
    except Overloaded:
        # Optional second model from the same provider, e.g. a Flash-Lite model when Flash is busy.
        fallback = os.getenv("LLM_FALLBACK_MODEL")
        if not fallback or fallback == model:
            raise
        print(f"  {model} overloaded, using fallback {fallback}", file=sys.stderr)
        model = fallback
        data, i, o = PROVIDERS[provider](model, user_prompt)
    return LLMResult(data=data, provider=provider, model=model, input_tokens=i, output_tokens=o, seconds=time.monotonic() - t)
