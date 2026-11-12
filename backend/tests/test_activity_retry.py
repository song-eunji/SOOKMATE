import httpx
import pytest

from app import ai, next_activity


@pytest.mark.parametrize("status, expected_calls", [
    ("timeout", 2), ("connection_error", 2), ("service_unavailable", 2),
    ("incomplete_response", 2), ("invalid_response", 2),
    ("daily_quota_exhausted", 1), ("rate_limited", 1), ("authentication", 1),
])
def test_generation_retries_only_transient_failure_once(monkeypatch, status, expected_calls):
    calls = []
    monkeypatch.setattr(next_activity.time, "sleep", lambda _: None)
    monkeypatch.setattr(ai, "llm_status", lambda: {"status": status})
    monkeypatch.setattr(ai, "make_next_activity", lambda *args: {})
    monkeypatch.setattr(ai, "llm_json", lambda *args, **kwargs: calls.append(1))
    result = next_activity.generate({"common_interests": []}, ["공유 노트"], [])
    assert len(calls) == expected_calls
    assert result["generation_mode"] == "fallback"


def test_transient_failure_can_recover(monkeypatch):
    good = {"title": "활동", "desc": "설명", "reason": "이유", "steps": ["하나", "둘", "셋"], "source_ids": []}
    answers = iter([None, good])
    monkeypatch.setattr(next_activity.time, "sleep", lambda _: None)
    monkeypatch.setattr(ai, "make_next_activity", lambda *args: {})
    monkeypatch.setattr(ai, "llm_status", lambda: {"status": "timeout"})
    monkeypatch.setattr(ai, "llm_json", lambda *args, **kwargs: next(answers))
    assert next_activity.generate({"common_interests": []}, ["공유 노트"], [])["generation_mode"] == "llm"


def test_truncated_gemini_response_uses_next_model(monkeypatch):
    calls = []
    class Client:
        def __init__(self, **kwargs): pass
        def __enter__(self): return self
        def __exit__(self, *args): pass
        def post(self, url, **kwargs):
            calls.append(url)
            candidate = {"finishReason": "MAX_TOKENS"} if len(calls) == 1 else {"finishReason": "STOP", "content": {"parts": [{"text": '{"ok":true}'}]}}
            return httpx.Response(200, json={"candidates": [candidate]}, request=httpx.Request("POST", url))
    monkeypatch.setattr(httpx, "Client", Client)
    monkeypatch.setenv("GEMINI_API_KEY", "test-key")
    monkeypatch.setenv("LLM_PROVIDER", "gemini")
    monkeypatch.setenv("GEMINI_MODEL", "primary")
    monkeypatch.setenv("GEMINI_FALLBACK_MODELS", "backup")
    assert ai.llm_json("system", "user") == {"ok": True}
    assert len(calls) == 2 and "backup" in calls[-1]
