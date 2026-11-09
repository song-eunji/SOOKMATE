from app import activity_store as store
from app.models import AIQuota
from test_api import confirm, h


def setup_run(client, monkeypatch):
    m = confirm(client)
    path = f"/api/matches/{m['id']}"
    client.put(path + "/notes", headers=h(1), json={"next_text": "도자기", "share_next": True})
    calls = []
    monkeypatch.setattr(store, "analyze", lambda ex, notes: {"query": "도자기", "entries": ex["shared_entries"], "mode": "llm", "signals": [], "keywords": ["도자기"], "topics": []})
    monkeypatch.setattr(store.ai, "llm_status", lambda: {"status": "ok"})
    monkeypatch.setattr(store, "search_sources", lambda analysis, notes, exclude=None: {"sources": [{"id": "S1", "title": "자료", "url": "", "text": "자료", "provider": "library"}], "status": "ok", "provider": "library", "providers": {"library": "ok"}})
    def generate(ex, notes, sources, analysis, avoid=None):
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


def test_comparison_stores_evaluation_and_regenerate_replaces_run(client, monkeypatch):
    _, path, calls = setup_run(client, monkeypatch)
    both = client.post(path + "/next-activity?compare=true", headers=h(1)).json()
    assert set(both["evaluation"]["auto"]) == {"retrieval", "baseline"}
    assert both["evaluation"]["judge"] is None  # 테스트에는 키가 없어 심사는 건너뛰지만 비교는 유지된다
    again = client.post(path + "/next-activity?regenerate=true", headers=h(1)).json()
    assert again["run_id"] != both["run_id"] and "baseline" not in again
    assert calls == [True, False, True]


def test_search_disabled_generates_without_sources(client, monkeypatch):
    _, path, _ = setup_run(client, monkeypatch)
    monkeypatch.setenv("ACTIVITY_SEARCH_ENABLED", "0")
    from app import activity_search
    monkeypatch.setattr(store, "search_sources", activity_search.search_sources)
    result = client.post(path + "/next-activity?compare=true", headers=h(1)).json()
    assert result["retrieval"]["search_status"] == "disabled"
    assert not result["comparable"]
    assert result["retrieval"]["sources"] == []


def test_generation_failure_is_not_saved(client, monkeypatch):
    _, path, _ = setup_run(client, monkeypatch)
    monkeypatch.setattr(store, "generate", lambda *a, **kw: {"generation_mode": "fallback", "llm_status": {"status": "timeout"}, "sources": []})
    assert client.post(path + "/next-activity", headers=h(1)).status_code == 503
    assert client.get(path + "/activity-result", headers=h(1)).json() is None


def test_regenerate_avoids_previous_title_and_library_items(client, monkeypatch):
    _, path, _ = setup_run(client, monkeypatch)
    seen = []
    def search(analysis, notes, exclude=None):
        seen.append(set(exclude or ()))
        return {"sources": [{"id": "S1", "title": "자료", "url": "", "text": "자료", "provider": "library", "library_id": f"lib-{len(seen)}"}],
                "status": "ok", "provider": "library", "providers": {"library": "ok"}}
    avoids = []
    def generate(ex, notes, sources, analysis, avoid=None):
        avoids.append(list(avoid or []))
        return {"title": f"활동{len(avoids)}", "desc": "설명", "basis": "shared_notes", "reason": "이유", "steps": ["하나", "둘", "셋"],
                "sources": sources, "source_ids": ["S1"] if sources else [], "generation_mode": "llm", "generation_ms": 1, "llm_status": {"status": "ok"}}
    monkeypatch.setattr(store, "search_sources", search)
    monkeypatch.setattr(store, "generate", generate)
    client.post(path + "/next-activity", headers=h(1))
    client.post(path + "/next-activity?regenerate=true", headers=h(1))
    third = client.post(path + "/next-activity?regenerate=true", headers=h(1)).json()
    assert avoids == [[], ["활동1"], ["활동1", "활동2"]]
    assert seen == [set(), {"lib-1"}, {"lib-1", "lib-2"}]
    assert third["retrieval"]["title"] == "활동3"


def test_lock_is_per_match_not_global(client, monkeypatch):
    held = store._match_lock(999)
    held.acquire()  # 다른 매치에서 생성 중
    try:
        _, path, _ = setup_run(client, monkeypatch)
        assert client.post(path + "/next-activity", headers=h(1)).status_code == 200
    finally:
        held.release()


def test_same_match_in_progress_returns_structured_409(client, monkeypatch):
    m, path, _ = setup_run(client, monkeypatch)
    lock = store._match_lock(m["id"])
    lock.acquire()
    try:
        response = client.post(path + "/next-activity", headers=h(1))
        assert response.status_code == 409 and response.json()["detail"]["status"] == "in_progress"
    finally:
        lock.release()
