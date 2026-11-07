from app import next_activity as activity
from test_api import confirm, h


def test_private_fields_never_reach_generation(client, monkeypatch):
    m = confirm(client)
    path = f"/api/matches/{m['id']}"
    client.put(path + "/notes", headers=h(1), json={
        "expr": "SECRET", "fact": "공유 사실", "next_text": "공유 희망",
        "share_expr": False, "share_fact": True, "share_next": True,
    })
    captured = []
    monkeypatch.setattr(activity, "recommend", lambda ex, notes, compare=False: captured.extend(notes) or {"ok": True})
    response = client.post(path + "/next-activity?compare=true", headers=h(1))
    assert response.status_code == 200
    assert captured == ["공유 희망", "공유 사실"]
    assert client.post(path + "/next-activity", headers=h(5)).status_code == 404


def test_unconfigured_is_not_claimed_as_rag(monkeypatch):
    monkeypatch.delenv("TAVILY_API_KEY", raising=False)
    result = activity.recommend({"common_interests": ["카페"]}, ["카페"], compare=True)
    assert result["retrieval"]["search_status"] == "not_configured"
    assert result["retrieval"]["sources"] == []
    assert not result["comparable"]


def test_fabricated_citation_falls_back(monkeypatch):
    monkeypatch.setattr(activity.ai, "llm_json", lambda *args: {
        "title": "활동", "desc": "설명", "reason": "이유", "steps": ["하나", "둘", "셋"],
        "source_ids": ["invented"],
    })
    result = activity.generate({"common_interests": []}, ["문화"], [
        {"id": "S1", "title": "자료", "url": "https://example.com", "text": "자료 내용"},
    ])
    assert result["generation_mode"] == "fallback"
    assert result["sources"] == []


def test_comparison_uses_same_notes_and_separate_sources(monkeypatch):
    source = {"id": "S1", "title": "자료", "url": "https://example.com", "text": "자료 내용"}
    monkeypatch.setattr(activity, "search", lambda query: ([source], "ok"))
    inputs = []
    def llm(system, user):
        import json
        data = json.loads(user)
        inputs.append(data)
        return {"title": "활동", "desc": "설명", "reason": "이유", "steps": ["하나", "둘", "셋"],
                "source_ids": ["S1"] if data["sources"] else []}
    monkeypatch.setattr(activity.ai, "llm_json", llm)
    result = activity.recommend({"common_interests": ["카페"]}, ["함께 카페"], compare=True)
    assert result["comparable"]
    assert inputs[0]["shared_notes"] == inputs[1]["shared_notes"]
    assert inputs[0]["sources"] and inputs[1]["sources"] == []
    assert result["baseline"]["sources"] == []


def test_search_filters_unsafe_urls(monkeypatch):
    monkeypatch.setenv("TAVILY_API_KEY", "test-only")
    class Response:
        def raise_for_status(self):
            pass
        def json(self):
            return {"results": [
                {"url": "javascript:alert(1)", "title": "bad", "content": "bad"},
                {"url": "https://example.com", "title": "good", "content": "evidence"},
                {"url": "https://example.com", "title": "duplicate", "content": "evidence"},
            ]}
    class Client:
        def __init__(self, **kwargs):
            pass
        def __enter__(self):
            return self
        def __exit__(self, *args):
            pass
        def post(self, *args, **kwargs):
            return Response()
    monkeypatch.setattr(activity.httpx, "Client", Client)
    sources, status = activity.search("전시")
    assert status == "ok"
    assert len(sources) == 1 and sources[0]["url"] == "https://example.com"


def test_search_failure_preserves_baseline(monkeypatch):
    monkeypatch.setattr(activity, "search", lambda query: ([], "failed"))
    result = activity.recommend({"common_interests": ["전시"]}, ["전시"], compare=True)
    assert result["retrieval"]["search_status"] == "failed"
    assert result["baseline"]["title"]
    assert not result["comparable"]
