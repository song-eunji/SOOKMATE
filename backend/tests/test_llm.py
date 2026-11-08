"""LLM 연결(브리핑·활동 카드의 화면 언어)과 번역 API.

실제 API 키 없이 돌도록 LLM 호출을 가짜 함수로 바꿔서 확인한다.
"""
import json
import sys
import types

from app import ai
from app.models import User


def h(uid):
    return {"X-User-Id": str(uid)}


def confirmed_match(client):
    m = client.get("/api/matches", headers=h(1)).json()[0]
    client.post(f"/api/matches/{m['id']}/accept", headers=h(1))
    client.post(f"/api/dev/matches/{m['id']}/partner-accept", headers=h(1))
    return m


def set_lang(client, uid, lang):
    assert client.put("/api/me/language", json={"lang": lang}, headers=h(uid)).status_code == 200


class FakeLLM:
    """llm_json 대신 들어가서, 받은 입력을 기록하고 정해 둔 답을 돌려준다."""

    def __init__(self, answer):
        self.answer = answer
        self.calls = []
        self.kwargs = []

    def __call__(self, system, user, **kw):
        self.calls.append((system, json.loads(user)))
        self.kwargs.append(kw)
        return self.answer(json.loads(user)) if callable(self.answer) else self.answer


# ------------------------------------------------------------------ 브리핑
def test_brief_uses_reader_language_and_allows_longer_text(client, monkeypatch):
    m = confirmed_match(client)
    set_lang(client, 1, "en")
    long_q = "What is something about campus life you wish someone had told you in your first week here?"
    assert 80 < len(long_q) <= 160  # 한국어 기준(80자)이면 떨어졌을 길이

    def answer(inp):
        sid = inp["문서"][0]["id"]
        return {"tips": [{"text": "Many cafes let you order at the counter first.", "source_id": sid}], "questions": [long_q]}

    fake = FakeLLM(answer)
    monkeypatch.setattr(ai, "llm_json", fake)
    b = client.get(f"/api/matches/{m['id']}/brief", headers=h(1)).json()
    assert fake.calls and fake.calls[0][1]["답변 언어"] == "English"
    assert b["mode"] == "llm" and b["lang"] == "en" and b["questions"] == [long_q]


def test_brief_keeps_korean_limit_for_korean_reader(client, monkeypatch):
    m = confirmed_match(client)

    def answer(inp):
        return {"tips": [{"text": "팁", "source_id": inp["문서"][0]["id"]}], "questions": ["가" * 81]}

    monkeypatch.setattr(ai, "llm_json", FakeLLM(answer))
    b = client.get(f"/api/matches/{m['id']}/brief", headers=h(1)).json()
    assert b["mode"] == "fallback" and b["lang"] == "ko"


def test_brief_keeps_partner_prefs_as_written(client, monkeypatch, db):
    m = confirmed_match(client)
    set_lang(client, 1, "vi")
    pid = m["partner"]["id"]
    partner = db.get(User, pid)
    partner.prefs = ["매운 음식은 잘 못 먹어요"]
    db.commit()

    def answer(inp):
        return {"tips": [{"text": "Mẹo", "source_id": inp["문서"][0]["id"]}], "questions": ["Bạn thích gì?"]}

    monkeypatch.setattr(ai, "llm_json", FakeLLM(answer))
    b = client.get(f"/api/matches/{m['id']}/brief", headers=h(1)).json()
    assert b["prefs"] == ["매운 음식은 잘 못 먹어요"]  # 개인 선호는 LLM이 바꾸지 않는다


# --------------------------------------------------------------- 활동 카드
def test_activity_card_uses_reader_language(client, monkeypatch):
    m = confirmed_match(client)
    set_lang(client, 1, "ja")
    fake = FakeLLM({"mine": "キャンパス生活のコツを10分で紹介します。", "theirs": "日本語の日常表現を教えてもらいます。"})
    monkeypatch.setattr(ai, "llm_json", fake)
    c = client.get(f"/api/matches/{m['id']}/activity-card", headers=h(1)).json()
    assert fake.calls and fake.calls[0][1]["답변 언어"] == "日本語"
    assert c["mode"] == "llm" and c["mine"]["desc"].startswith("キャンパス")


# --------------------------------------------------------------------- 번역
def test_translate_falls_back_to_original_without_key(client):
    r = client.post("/api/translate", json={"text": "안녕하세요!"}, headers=h(1)).json()
    assert r == {"text": "안녕하세요!", "translated": False, "lang": "ko"}


def test_translate_to_reader_language(client, monkeypatch):
    set_lang(client, 1, "zh")
    fake = FakeLLM({"text": "你好！很高兴认识你 😊"})
    monkeypatch.setattr(ai, "llm_json", fake)
    r = client.post("/api/translate", json={"text": "안녕하세요! 만나서 반가워요 😊"}, headers=h(1)).json()
    assert r == {"text": "你好！很高兴认识你 😊", "translated": True, "lang": "zh"}
    assert fake.calls[0][1] == {"번역할 언어": "简体中文", "문장": "안녕하세요! 만나서 반가워요 😊"}
    assert fake.kwargs[0]["fast"] is True  # 번역은 빠른 모델로 (공급자별 모델은 llm_config 가 고른다)


def test_translate_rejects_bad_llm_output(client, monkeypatch):
    set_lang(client, 1, "en")
    monkeypatch.setattr(ai, "llm_json", FakeLLM({"wrong": "shape"}))
    r = client.post("/api/translate", json={"text": "카페 갈래요?"}, headers=h(1)).json()
    assert r["translated"] is False and r["text"] == "카페 갈래요?"


def test_translate_validates_input(client):
    assert client.post("/api/translate", json={"text": ""}, headers=h(1)).status_code == 422
    assert client.post("/api/translate", json={"text": "가" * 501}, headers=h(1)).status_code == 422


# ------------------------------------------------------------ LLM 호출 캐시
def test_llm_json_caches_only_success(monkeypatch):
    calls = {"n": 0, "fail": True}

    class Messages:
        def create(self, **kw):
            calls["n"] += 1
            if calls["fail"]:
                raise RuntimeError("network")
            block = types.SimpleNamespace(type="text", text='{"text": "ok"}')
            return types.SimpleNamespace(content=[block], stop_reason="end_turn")

    class Anthropic:
        def __init__(self, **kw):
            self.messages = Messages()

        def __enter__(self):  # 호출부가 with 문으로 쓴다
            return self

        def __exit__(self, *exc):
            return False

    monkeypatch.setitem(sys.modules, "anthropic", types.SimpleNamespace(Anthropic=Anthropic))
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test")
    monkeypatch.setattr(ai, "_llm_cache", {})

    assert ai.llm_json("s", "u") is None  # 실패는 저장하지 않는다
    calls["fail"] = False
    assert ai.llm_json("s", "u") == {"text": "ok"}
    assert ai.llm_json("s", "u") == {"text": "ok"}
    assert calls["n"] == 2  # 세 번 불렀지만 성공 뒤로는 캐시


# ------------------------------------------------- 기획서 6-(4): 선호 우선 RAG
def test_retrieve_puts_personal_preference_first():
    q = "카페 첫 만남 대화 약속 장소"
    assert ai.retrieve(q, prefs=["조용한 장소를 좋아해요"])[0]["id"] == "doc-quiet-place"
    assert ai.retrieve(q, prefs=["천천히 말해주면 좋아요"])[0]["id"] == "doc-slow-talk"
    # 유학생이 자기 언어로 쓴 선호도 찾는다
    assert ai.retrieve(q, prefs=["I prefer quiet places"])[0]["id"] == "doc-quiet-place"
    assert ai.retrieve(q, prefs=["Mình ăn chay"])[0]["id"] == "doc-food-preference"


def test_retrieve_returns_nothing_without_grounding():
    docs = [{"id": "x", "title": "도서관 이용", "text": "학생증으로 출입해요.", "topics": ["도서관"], "source": "s"}]
    assert ai.retrieve("보드게임", prefs=["축구"], docs=docs) == []
    assert [d["id"] for d in ai.retrieve("도서관 가기", docs=docs)] == ["x"]


def test_brief_sends_preference_docs_to_llm(client, monkeypatch, db):
    m = confirmed_match(client)
    partner = db.get(User, m["partner"]["id"])
    partner.prefs = ["조용한 장소를 좋아해요"]
    db.commit()
    fake = FakeLLM(None)
    monkeypatch.setattr(ai, "llm_json", fake)
    b = client.get(f"/api/matches/{m['id']}/brief", headers=h(1)).json()
    sent = [d["id"] for d in fake.calls[0][1]["문서"]]
    assert sent[0] == "doc-quiet-place"
    assert "국적" in fake.calls[0][0]  # 국적으로 성향을 짐작하지 말라는 규칙
    assert b["mode"] == "fallback" and b["tips"][0]["source_id"] == "doc-quiet-place"  # LLM 실패해도 선호 자료가 먼저


def test_brief_without_docs_asks_questions_only_in_reader_language(client, monkeypatch):
    m = confirmed_match(client)
    set_lang(client, 1, "en")
    monkeypatch.setattr(ai, "retrieve", lambda *a, **k: [])
    fake = FakeLLM({"questions": ["What kind of place feels comfortable for you?"]})
    monkeypatch.setattr(ai, "llm_json", fake)
    b = client.get(f"/api/matches/{m['id']}/brief", headers=h(1)).json()
    assert "문서" not in fake.calls[0][1]  # 근거가 없으니 사실 안내 없이 질문만
    assert b["tips"] == [] and b["mode"] == "llm" and b["lang"] == "en"
    assert b["questions"] == ["What kind of place feels comfortable for you?"]


# ------------------------------------------------ 기획서 6-(4): 임베딩으로 주제 연결
def test_activity_topics_link_by_meaning_not_exact_text():
    # 글자가 달라도 뜻이 가장 가까운 주제를 고른다
    assert ai._best_topic(["캠퍼스 생활 팁", "한국어 표현"], ["한국어 회화"]) == "한국어 표현"
    # 글자가 같으면 그대로
    assert ai._best_topic(["캠퍼스 생활 팁", "식당 주문 요령"], ["식당 주문 요령"]) == "식당 주문 요령"
    assert ai._best_topic([], ["무엇이든"]) is None
    assert ai._best_topic(["일본 문화"], []) == "일본 문화"
