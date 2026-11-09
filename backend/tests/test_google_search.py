from app.google_search import parse_grounding


def test_only_provider_linked_evidence_is_used():
    result = parse_grounding({"candidates": [{"finishReason": "STOP", "groundingMetadata": {
        "groundingChunks": [{"web": {"uri": "https://example.com", "title": "자료"}},
                            {"web": {"uri": "javascript:alert(1)", "title": "잘못된 주소"}},
                            {"web": {"uri": "https://unused.example.com", "title": "근거 없음"}}],
        "groundingSupports": [{"segment": {"text": "검색 근거 요약"}, "groundingChunkIndices": [0, 1, 99]}],
        "webSearchQueries": ["도자기 체험"],
        "searchEntryPoint": {"renderedContent": "<div>Google</div>"},
    }}]})
    assert result["status"] == "ok"
    assert len(result["sources"]) == 1
    assert result["sources"][0]["text_kind"] == "grounded_summary"
    assert result["grounding"]["segments"][0]["source_ids"] == ["S1"]
    assert result["grounding"]["search_entry_html"] == "<div>Google</div>"


def test_ungrounded_text_is_not_search_success():
    result = parse_grounding({"candidates": [{"finishReason": "STOP", "content": {"parts": [{"text": "출처 없는 답변"}]}}]})
    assert result["status"] == "empty"
    assert not result["sources"]


def test_search_uses_google_tool_and_same_key(monkeypatch):
    import httpx
    from app import google_search
    monkeypatch.setenv("GEMINI_API_KEY", "test-key")
    monkeypatch.setenv("GEMINI_MODEL", "gemini-2.5-flash")
    seen = []
    class Client:
        def __init__(self, **kwargs):
            pass
        def __enter__(self):
            return self
        def __exit__(self, *args):
            pass
        def post(self, url, **kwargs):
            seen.append(kwargs)
            assert "test-key" not in url
            return httpx.Response(429, json={}, request=httpx.Request("POST", url))
    monkeypatch.setattr(httpx, "Client", Client)
    result = google_search.search("도자기")
    assert result["status"] == "rate_limited"
    assert len(seen) == 1
    assert seen[0]["json"]["tools"] == [{"google_search": {}}]
    assert "responseMimeType" not in seen[0]["json"]["generationConfig"]
    assert seen[0]["headers"]["x-goog-api-key"] == "test-key"
