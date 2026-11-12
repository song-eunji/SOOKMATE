"""참고할 문화 정보: 읽는 사람에게 맞는 나라의 자료가 나오는지 확인한다."""
import types

from app import ai

COUNTRIES = {"공통", "한국", "일본", "중국", "베트남", "미국"}


def partner(kind, nationality=None, prefs=()):
    return types.SimpleNamespace(kind=kind, nationality=nationality, prefs=list(prefs))


def ex(interests=("카페",)):
    return {"common_interests": list(interests), "similar_interests": []}


def pick(p, interests=("카페",)):
    e = ex(interests)
    query = " ".join(e["common_interests"] + ["첫 만남 대화 약속 장소"])
    return ai.pick_culture_docs(p, e, query, list(p.prefs))


def test_every_doc_is_well_formed():
    docs = ai.culture_docs()
    assert len({d["id"] for d in docs}) == len(docs), "id가 겹쳐요"
    for d in docs:
        assert d["country"] in COUNTRIES, d["id"]
        assert d["topics"], d["id"]
        assert 0 < len(d["text"]) <= 200, d["id"]  # 브리핑 문장 길이 제한(200자)
        assert d["reviewed"] is False, d["id"]  # 검토 전까지는 검토됨으로 표시하지 않는다


def test_docs_shown_to_international_readers_have_all_translations():
    # 유학생이 읽는 한국·공통 자료는 AI 없이도 자기 언어로 보여야 한다
    for d in ai.culture_docs():
        if d["country"] not in ("한국", "공통"):
            continue
        tr = d.get("text_i18n") or {}
        for lang in ("en", "ja", "zh", "vi"):
            assert tr.get(lang), f"{d['id']} 에 {lang} 번역이 없어요"
            assert tr[lang] != d["text"], d["id"]
            assert len(tr[lang]) <= 400, d["id"]  # 다른 언어 글자 수 제한(한국어의 2배)


def make(reader_lang, partner_kind="domestic", nationality=None):
    me = types.SimpleNamespace(kind="international", ui_lang=reader_lang, nationality=None, prefs=[], teach=[], learn=[])
    p = types.SimpleNamespace(kind=partner_kind, nationality=nationality, prefs=[], teach=[], learn=[], name="송")
    return ai.make_brief(me, p, {"common_interests": ["드라마", "카페"], "similar_interests": [], "partner_topic": None})


def test_fallback_brief_shows_fixed_text_in_the_reader_language(monkeypatch):
    monkeypatch.setattr(ai, "llm_json", lambda *a, **k: None)  # AI 한도가 찼거나 키가 없는 상황
    by_id = {d["id"]: d for d in ai.culture_docs()}
    for lang in ("en", "ja", "zh", "vi"):
        b = make(lang)
        assert b["mode"] == "fallback" and b["lang"] == lang
        assert b["tips"], lang
        for tip in b["tips"]:
            assert tip["text"] == by_id[tip["source_id"]]["text_i18n"][lang]


def test_fallback_brief_stays_korean_for_korean_readers(monkeypatch):
    monkeypatch.setattr(ai, "llm_json", lambda *a, **k: None)
    by_id = {d["id"]: d for d in ai.culture_docs()}
    b = make("ko")
    assert b["lang"] == "ko"
    assert all(t["text"] == by_id[t["source_id"]]["text"] for t in b["tips"])


def test_untranslated_country_docs_fall_back_to_korean_text(monkeypatch):
    monkeypatch.setattr(ai, "llm_json", lambda *a, **k: None)
    b = make("en", partner_kind="international", nationality="일본")  # 일본 자료는 번역이 없다
    jp = [t for t in b["tips"] if t["source_id"].startswith("ja-")]
    assert jp and all(any("가" <= ch <= "힣" for ch in t["text"]) for t in jp)
    assert b["lang"] == "ko"  # 한국어 원문이 섞여 있다고 정직하게 알린다


def test_each_demo_country_has_enough_docs():
    by_country = {}
    for d in ai.culture_docs():
        by_country.setdefault(d["country"], []).append(d)
    for country in ("한국", "일본", "중국", "베트남", "미국"):
        assert len(by_country[country]) >= 5, country


def test_domestic_reader_sees_the_partner_country_not_korea():
    docs = pick(partner("international", "일본"))
    assert docs and {d["country"] for d in docs} <= {"일본", "공통"}
    assert "일본" in {d["country"] for d in docs}, "상대 나라 자료가 하나도 없어요"
    assert ai.culture_country(partner("international", "일본")) == "일본"


def test_international_reader_sees_korea():
    docs = pick(partner("domestic"))
    assert docs and {d["country"] for d in docs} <= {"한국", "공통"}
    assert ai.culture_country(partner("domestic")) == "한국"


def test_unknown_nationality_gets_only_common_docs():
    for nat in (None, "", "   ", "아이슬란드"):
        docs = pick(partner("international", nat))
        assert {d["country"] for d in docs} <= {"공통"}, nat


def test_partner_preference_still_comes_first():
    docs = pick(partner("international", "일본", prefs=["조용한 장소를 좋아해요"]))
    assert docs[0]["id"] == "doc-quiet-place"
    docs = pick(partner("domestic", prefs=["조용한 장소를 좋아해요"]))
    assert docs[0]["id"] == "doc-quiet-place"


def test_country_docs_keep_at_least_two_slots_even_with_a_preference():
    # 선호 자료가 맨 앞에 와도, 화면 제목이 나라 이름이라 그 나라 자료가 2개는 있어야 한다
    docs = pick(partner("international", "일본", prefs=["조용한 장소를 좋아해요"]), interests=("전시", "카페"))
    assert docs[0]["id"] == "doc-quiet-place"
    assert sum(d["country"] == "일본" for d in docs) >= 2


def test_common_interest_can_bring_a_common_doc():
    docs = pick(partner("international", "일본"), interests=("전시",))
    assert "doc-exhibition" in {d["id"] for d in docs}


def test_at_most_three_docs_without_duplicates():
    for p in (partner("international", "중국"), partner("domestic"), partner("international", None)):
        docs = pick(p, interests=("카페", "맛집", "전시"))
        assert len(docs) <= 3
        assert len({d["id"] for d in docs}) == len(docs)
