import json

import httpx
import pytest

from app import ai


def fake_gemini(monkeypatch, payload, status=200):
    calls = []
    class Client:
        def __init__(self, **kwargs):
            pass
        def __enter__(self):
            return self
        def __exit__(self, *args):
            pass
        def post(self, url, **kwargs):
            calls.append((url, kwargs))
            return httpx.Response(status, json=payload, request=httpx.Request("POST", url))
    monkeypatch.setattr(httpx, "Client", Client)
    monkeypatch.setenv("GEMINI_API_KEY", "test-secret")
    monkeypatch.setenv("LLM_PROVIDER", "gemini")
    return calls


def test_gemini_json_request_and_thought_filter(monkeypatch):
    calls = fake_gemini(monkeypatch, {"candidates": [{"finishReason": "STOP", "content": {"parts": [
        {"thought": True, "text": "internal reasoning"}, {"text": json.dumps({"title": "활동"})},
    ]}}]})
    assert ai.llm_json("system", "notes") == {"title": "활동"}
    url, request = calls[0]
    assert "test-secret" not in url
    assert request["headers"]["x-goog-api-key"] == "test-secret"
    assert request["json"]["generationConfig"]["responseMimeType"] == "application/json"
    assert request["json"]["contents"][0]["parts"][0]["text"] == "notes"


@pytest.mark.parametrize("payload", [
    {"candidates": []},
    {"candidates": [{"finishReason": "MAX_TOKENS", "content": {"parts": [{"text": '{"title":"cut"}'}]}}]},
    {"candidates": [{"finishReason": "SAFETY"}]},
    {"candidates": [{"finishReason": "STOP", "content": {"parts": [{"text": "not json"}]}}]},
])
def test_invalid_or_incomplete_gemini_response_falls_back(monkeypatch, payload):
    fake_gemini(monkeypatch, payload)
    assert ai.llm_json("system", "notes") is None


def test_rate_limit_does_not_leak_secrets_or_retry(monkeypatch, caplog):
    calls = fake_gemini(monkeypatch, {"error": {"message": "test-secret private note"}}, 429)
    assert ai.llm_json("system", "private note") is None
    assert len(calls) == 1
    assert "test-secret" not in caplog.text and "private note" not in caplog.text


def test_auto_prefers_gemini_without_cross_provider_fallback(monkeypatch):
    monkeypatch.setenv("LLM_PROVIDER", "auto")
    monkeypatch.setenv("GEMINI_API_KEY", "test")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test")
    assert ai.llm_config()["provider"] == "gemini"
    monkeypatch.setenv("LLM_PROVIDER", "anthropic")
    assert ai.llm_config()["provider"] == "anthropic"


def test_missing_gemini_key_never_calls_network(monkeypatch):
    monkeypatch.setenv("LLM_PROVIDER", "gemini")
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    monkeypatch.setattr(httpx, "Client", lambda **kwargs: pytest.fail("unexpected network call"))
    assert ai.llm_json("system", "notes") is None


def test_transient_server_error_retries_once(monkeypatch):
    calls = fake_gemini(monkeypatch, {"error": {}}, 503)
    monkeypatch.setattr(ai.time, "sleep", lambda seconds: None)
    assert ai.llm_json("system", "notes") is None
    assert len(calls) == 2
    assert ai.llm_status()["status"] == "service_unavailable"
    assert ai.llm_status()["http_status"] == 503


def test_retry_can_recover(monkeypatch):
    monkeypatch.setenv("LLM_PROVIDER", "gemini")
    monkeypatch.setenv("GEMINI_API_KEY", "test")
    monkeypatch.setattr(ai.time, "sleep", lambda seconds: None)
    responses = [503, 200]
    class Client:
        def __init__(self, **kwargs):
            pass
        def __enter__(self):
            return self
        def __exit__(self, *args):
            pass
        def post(self, url, **kwargs):
            status = responses.pop(0)
            return httpx.Response(status, json={"candidates": [{"finishReason": "STOP", "content": {"parts": [{"text": '{"ok":true}'}]}}]}, request=httpx.Request("POST", url))
    monkeypatch.setattr(httpx, "Client", Client)
    assert ai.llm_json("system", "notes") == {"ok": True}
    assert ai.llm_status()["status"] == "ok"
    assert responses == []


def test_daily_quota_is_distinct_from_minute_limit():
    result = ai.quota_status({"error": {"details": [
        {"violations": [{"quotaId": "GenerateRequestsPerDayPerProjectPerModel-FreeTier"}]},
        {"retryDelay": "66545s"},
    ]}})
    assert result == {"status": "daily_quota_exhausted", "retry_after_seconds": 66545}
    assert ai.quota_status({"error": {"details": [{"violations": [{"quotaId": "RequestsPerMinute"}]}]}})["status"] == "minute_quota_exhausted"
