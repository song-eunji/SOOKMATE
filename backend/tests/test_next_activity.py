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
    from app import activity_store
    monkeypatch.setattr(activity_store, "run", lambda db, mid, uid, ex, notes, compare, **kw: captured.extend(notes) or {"ok": True})
    response = client.post(path + "/next-activity?compare=true", headers=h(1))
    assert response.status_code == 200
    assert captured == ["공유 희망", "공유 사실"]
    assert client.post(path + "/next-activity", headers=h(5)).status_code == 404


def test_unconfigured_llm_still_finds_library_sources_but_is_not_comparable(monkeypatch):
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    monkeypatch.setenv("ACTIVITY_WIKIPEDIA", "0")
    result = activity.recommend({"common_interests": ["카페"]}, ["카페 주문"], compare=True)
    assert result["retrieval"]["retrieved_sources"]  # 자료집 검색은 키 없이도 동작
    assert result["retrieval"]["generation_mode"] == "fallback"
    assert result["retrieval"]["sources"] == []  # 생성이 안 됐으면 인용도 없다
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
    source = {"id": "S1", "title": "자료", "url": "", "text": "자료 내용", "provider": "library"}
    monkeypatch.setattr(activity, "search_sources", lambda analysis, notes: {"sources": [source], "status": "ok", "provider": "library", "providers": {}})
    inputs = []
    def llm(system, user):
        import json
        data = json.loads(user)
        if "entries" in data:
            return None
        inputs.append(data)
        return {"title": "활동", "desc": "설명", "reason": "이유", "steps": ["하나 [S1]", "둘", "셋"],
                "minutes": 20, "prep": "없음", "source_ids": ["S1"] if data["sources"] else []}
    monkeypatch.setattr(activity.ai, "llm_json", llm)
    result = activity.recommend({"common_interests": ["카페"]}, ["함께 카페"], compare=True)
    assert result["comparable"]
    assert inputs[0]["shared_notes"] == inputs[1]["shared_notes"]
    assert inputs[0]["sources"] and inputs[1]["sources"] == []
    assert inputs[0]["note_analysis"] == inputs[1]["note_analysis"]
    assert result["baseline"]["sources"] == []
    assert result["retrieval"]["minutes"] == 20


def test_search_with_no_sources_still_produces_baseline(monkeypatch):
    monkeypatch.setattr(activity, "search_sources", lambda analysis, notes: {"sources": [], "status": "empty", "provider": "none", "providers": {}})
    result = activity.recommend({"common_interests": ["전시"]}, ["전시"], compare=True)
    assert result["retrieval"]["search_status"] == "empty"
    assert result["baseline"]["title"]
    assert not result["comparable"]


def test_analysis_retains_only_verifiable_quotes(monkeypatch):
    monkeypatch.setattr(activity.ai, "llm_json", lambda *args: {
        "signals": [
            {"kind": "wish", "text": "도자기 만들기", "note_id": "N1", "quote": "도자기"},
            {"kind": "constraint", "text": "무료", "note_id": "N1", "quote": "무료"},
            {"kind": "wish", "text": "공방", "note_id": "N9", "quote": "공방"},
        ], "keywords": ["도자기 공방", "01012345678", "user@example.com"]})
    result = activity.analyze({"common_interests": []}, ["다음에는 도자기를 만들고 싶다"])
    assert result["mode"] == "llm"
    assert result["keywords"] == ["도자기 공방"]
    assert len(result["signals"]) == 1
    assert "도자기 공방" in result["query"]


def test_analysis_keeps_author_and_field(monkeypatch):
    monkeypatch.setattr(activity.ai, "llm_json", lambda *args: None)
    entries = [{"id": "N1", "participant": "B", "field": "next_text", "text": "전시"}]
    result = activity.analyze({"common_interests": [], "shared_entries": entries}, ["전시"])
    assert result["entries"] == entries
    assert result["mode"] == "fallback"


def test_no_notes_do_not_trigger_analysis_or_search(monkeypatch):
    monkeypatch.setattr(activity.ai, "llm_json", lambda *args: None)
    monkeypatch.setattr(activity, "search_sources", lambda *a: (_ for _ in ()).throw(AssertionError("unexpected search")))
    result = activity.recommend({"common_interests": []}, [])
    assert result["search_status"] == "no_query"
    assert result["analysis"]["entries"] == []


def test_api_analysis_anonymizes_participants_and_excludes_private_fields(client):
    m = confirm(client)
    path = f"/api/matches/{m['id']}"
    for uid, text in ((1, "전시"), (m["partner"]["id"], "도자기")):
        client.put(path + "/notes", headers=h(uid), json={
            "expr": "PRIVATE", "fact": "PRIVATE", "next_text": text, "share_next": True,
        })
    from app.main import _shared_activity_context
    from app.db import SessionLocal
    from app.models import User
    with SessionLocal() as db:
        ex, notes = _shared_activity_context(db, m["id"], db.get(User, 1))
    result = {"analysis": activity.analyze(ex, notes)}
    entries = result["analysis"]["entries"]
    assert {entry["participant"] for entry in entries} == {"A", "B"}
    assert {entry["text"] for entry in entries} == {"전시", "도자기"}
    assert all(entry["field"] == "next_text" for entry in entries)
    assert "PRIVATE" not in str(result)


def test_invented_joint_wish_is_rejected(monkeypatch):
    monkeypatch.setattr(activity.ai, "llm_json", lambda *args: {
        "title": "활동", "desc": "짧은 만남", "reason": "두 학생 모두 도자기를 만들기를 희망했어요.",
        "steps": ["주제를 정해요", "서로 연습해요", "한 가지씩 나눠요"], "source_ids": [],
    })
    result = activity.generate({"common_interests": []}, ["도자기를 만들어 보고 싶다."], [])
    assert result["generation_mode"] == "fallback"
    assert result["llm_status"]["status"] == "invalid_response"


def test_internal_labels_never_reach_the_user(monkeypatch):
    # 한쪽 기록만 있으면 모델이 'B님이'라고 쓰곤 한다. 거부하면 매번 실패하므로 중립 표현으로 바꾼다.
    monkeypatch.setattr(activity.ai, "llm_json", lambda *args: {
        "title": "윷놀이", "desc": "B님이 남긴 기록을 바탕으로 해요.", "reason": "B님의 기록에서 희망이 확인됐어요.",
        "steps": ["(5분) A님은 규칙을 알려줘요", "(10분) 한 판 해요", "(5분) 피드백해요"], "source_ids": [],
    })
    result = activity.generate({"common_interests": []}, ["윷놀이를 배우고 싶다."], [])
    assert result["generation_mode"] == "llm"
    text = str({k: result[k] for k in ("title", "desc", "reason", "steps")})
    assert "A님" not in text and "B님" not in text
    assert result["desc"] == "한 사람이 남긴 기록을 바탕으로 해요."
    assert result["steps"][0] == "(5분) 한 사람은 규칙을 알려줘요"


def test_tentative_record_specific_reason_is_allowed():
    assert activity.valid_note_claims({"reason": "주문 표현을 배웠다는 기록을 참고했어요. 상대도 괜찮다면 천천히 역할을 바꿔 연습해 보세요."})
