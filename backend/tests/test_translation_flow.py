import copy
import json
from app import ai
from app.activity_translation import translate_activity
from test_api import h
from test_activity_store import setup_run


def test_same_language_skips_llm(client, monkeypatch):
    def unexpected(*a, **kw):
        raise AssertionError("같은 언어에 AI 호출 금지")
    monkeypatch.setattr(ai, "llm_json", unexpected)
    assert client.post("/api/translate", headers=h(1), json={"text": "안녕하세요 같이 만나요"}).json()["translated"] is False


def test_target_and_identical_output(client, monkeypatch):
    seen = []
    def translate(system, user, **kw):
        seen.append(json.loads(user))
        return {"text": "Let's meet at the cafe."}
    monkeypatch.setattr(ai, "llm_json", translate)
    result = client.post("/api/translate", headers=h(1), json={"text": "카페에서 만나요", "target": "en"}).json()
    assert result["translated"] and result["lang"] == "en"
    assert seen[0]["번역할 언어"] == "English"
    result = client.post("/api/translate", headers=h(1), json={"text": "Let's meet at the cafe.", "target": "ko"}).json()
    assert result["translated"] is False
    assert client.post("/api/translate", headers=h(1), json={"text": "hello", "target": "xx"}).status_code == 422


def activity():
    return {"title": "카페 주문", "desc": "설명", "reason": "기록", "prep": "", "minutes": 20,
            "steps": ["주문해요 [S1]", "질문해요", "기록해요"], "sources": [{"id": "S1", "text": "원문"}], "source_ids": ["S1"]}


def test_activity_preserves_original_and_source(monkeypatch):
    original = activity()
    before = copy.deepcopy(original)
    monkeypatch.setattr(ai, "llm_json", lambda *a, **kw: {"title": "Cafe ordering", "desc": "Description", "reason": "Notes", "prep": "", "steps": ["Order [S1]", "Ask", "Write"]})
    result = translate_activity(original, "en")
    assert result["translation_status"] == "translated"
    assert result["minutes"] == 20 and result["sources"] == original["sources"]
    assert original == before
    result["sources"][0]["text"] = "changed"
    assert original == before


def test_invalid_citation_keeps_original(monkeypatch):
    original = activity()
    monkeypatch.setattr(ai, "llm_json", lambda *a, **kw: {"title": "Title", "desc": "Desc", "reason": "Reason", "prep": "", "steps": ["Order [S9]", "Ask", "Write"]})
    result = translate_activity(original, "en")
    assert result["translation_status"] == "failed" and result["steps"] == original["steps"]
    monkeypatch.setattr(ai, "llm_json", lambda *a, **kw: None)
    assert translate_activity(original, "ja")["title"] == original["title"]


def test_translation_permissions_and_persistence(client, monkeypatch):
    _, path, _ = setup_run(client, monkeypatch)
    saved = client.post(path + "/next-activity", headers=h(1)).json()
    monkeypatch.setattr(ai, "llm_json", lambda *a, **kw: {"title": "Make pottery", "desc": "Description", "reason": "Notes", "steps": ["One", "Two", "Three"]})
    body = {"run_id": saved["run_id"], "target": "en"}
    result = client.post(path + "/activity-result/translation", headers=h(1), json=body)
    assert result.status_code == 200 and result.json()["retrieval"]["title"] == "Make pottery"
    assert client.get(path + "/activity-result", headers=h(1)).json()["retrieval"]["title"] == saved["retrieval"]["title"]
    assert client.post(path + "/activity-result/translation", headers=h(5), json=body).status_code == 404
    assert client.post(path + "/activity-result/translation", headers=h(1), json={**body, "run_id": 99999}).status_code == 409
