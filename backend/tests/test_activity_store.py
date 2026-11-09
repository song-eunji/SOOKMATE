from app import activity_store as store
from app.models import AIQuota
from test_api import confirm, h


def setup_run(client, monkeypatch):
    m = confirm(client)
    path = f"/api/matches/{m['id']}"
    client.put(path + "/notes", headers=h(1), json={"next_text": "도자기", "share_next": True})
    calls = []
    monkeypatch.setattr(store, "analyze", lambda ex, notes: {"query": "도자기", "entries": ex["shared_entries"], "mode": "llm", "signals": [], "keywords": ["도자기"]})
    monkeypatch.setattr(store.ai, "llm_status", lambda: {"status": "ok"})
    monkeypatch.setattr(store, "search", lambda query: {"sources": [{"id": "S1", "title": "자료", "url": "https://example.com", "text": "자료"}], "status": "ok", "provider": "google_search"})
    def generate(ex, notes, sources, analysis):
        calls.append(bool(sources))
        return {"title": "도자기 만들기", "desc": "설명", "basis": "shared_notes", "reason": "공유 희망", "steps": ["하나", "둘", "셋"], "sources": sources, "source_ids": ["S1"] if sources else [], "generation_mode": "llm", "generation_ms": 1, "llm_status": {"status": "ok"}}
    monkeypatch.setattr(store, "generate", generate)
    return m, path, calls


def test_persistence_reuse_upgrade_and_private_ratings(client, monkeypatch):
    m, path, calls = setup_run(client, monkeypatch)
    first = client.post(path + "/next-activity", headers=h(1)).json()
    assert first["cached"] is False
    assert client.post(path + "/next-activity", headers=h(1)).json()["cached"]
    both = client.post(path + "/next-activity?compare=true", headers=h(1)).json()
    assert calls == [True, False]
    assert both["comparable"]
    assert client.put(path + "/activity-ratings", headers=h(1), json={"run_id": both["run_id"], "ratings": {"retrieval-0": 5}}).status_code == 200
    assert client.get(path + "/activity-result", headers=h(1)).json()["ratings"] == {"retrieval-0": 5}
    assert client.get(path + "/activity-result", headers=h(m["partner"]["id"])).json()["ratings"] == {}
    assert client.put(path + "/activity-ratings", headers=h(1), json={"run_id": both["run_id"], "ratings": {"retrieval-0": 9}}).status_code == 422
    client.put(path + "/notes", headers=h(1), json={"next_text": "도자기", "share_next": False})
    assert client.get(path + "/activity-result", headers=h(1)).json() is None
    assert client.put(path + "/activity-ratings", headers=h(1), json={"run_id": both["run_id"], "ratings": {}}).status_code == 409


def test_quota_stops_later_calls_and_repeat_requests(client, monkeypatch):
    _, path, calls = setup_run(client, monkeypatch)
    monkeypatch.setattr(store.ai, "llm_status", lambda: {"status": "daily_quota_exhausted", "retry_after_seconds": 1000})
    assert client.post(path + "/next-activity", headers=h(1)).status_code == 429
    assert client.post(path + "/next-activity", headers=h(1)).status_code == 429
    assert calls == []


def test_missing_shared_notes_and_outsiders_rejected(client, monkeypatch):
    _, path, _ = setup_run(client, monkeypatch)
    assert client.get(path + "/activity-result", headers=h(5)).status_code == 404
    client.delete(path + "/notes", headers=h(1))
    assert client.post(path + "/next-activity", headers=h(1)).status_code == 422


def test_search_disabled_does_not_call_provider(client, monkeypatch):
    _, path, _ = setup_run(client, monkeypatch)
    monkeypatch.setenv("ACTIVITY_SEARCH_ENABLED", "0")
    monkeypatch.setattr(store, "search", lambda query: (_ for _ in ()).throw(AssertionError("search must be off")))
    result = client.post(path + "/next-activity?compare=true", headers=h(1)).json()
    assert result["retrieval"]["search_status"] == "disabled"
    assert not result["comparable"]
    assert result["retrieval"]["sources"] == []


def test_search_failure_is_not_silently_saved_as_grounded(client, monkeypatch):
    _, path, calls = setup_run(client, monkeypatch)
    monkeypatch.setenv("ACTIVITY_SEARCH_ENABLED", "1")
    monkeypatch.setattr(store, "search", lambda query: {"sources": [], "status": "failed", "provider": "google_search"})
    response = client.post(path + "/next-activity", headers=h(1))
    assert response.status_code == 503
    assert calls == []
    assert client.get(path + "/activity-result", headers=h(1)).json() is None
