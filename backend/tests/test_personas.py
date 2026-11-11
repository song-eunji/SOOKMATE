"""시연용 가짜 프로필(페르소나): 다양한지, 실제 정보가 섞이지 않았는지, 실제 사용자와 이어질 수 있는지."""
import re
from collections import Counter

import pytest
from sqlalchemy import select

from app import matching
from app.constants import BIO_MAX_LEN, INTERESTS, LANGUAGES, NAME_MAX_LEN, TIME_SLOTS, UI_LANGS
from app.db import Base, SessionLocal, engine
from app.models import Match, Message, Note, User
from app.personas import PERSONAS, replace_personas, seed_personas


@pytest.fixture()
def fresh():
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    with SessionLocal() as db:
        seed_personas(db)
    yield
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)


def people():
    with SessionLocal() as db:
        return list(db.scalars(select(User).order_by(User.id)))


# ------------------------------------------------------------------ 구성
def test_about_fifty_personas_mostly_international(fresh):
    rows = people()
    assert len(rows) == 50 and all(u.is_synthetic and u.onboarded for u in rows)
    assert sum(u.kind == "international" for u in rows) >= 30
    assert sum(u.kind == "domestic" for u in rows) >= 12


def test_names_are_unique_and_short(fresh):
    names = [u.name for u in people()]
    assert len(set(n.casefold() for n in names)) == len(names)
    assert all(0 < len(n) <= NAME_MAX_LEN for n in names)


def test_international_students_come_from_many_countries(fresh):
    intl = [u for u in people() if u.kind == "international"]
    countries = Counter(u.nationality for u in intl)
    assert all(u.nationality for u in intl)
    assert len(countries) >= 15, countries
    assert max(countries.values()) <= 4, "한 나라가 너무 많아요"


def test_profiles_are_complete_and_valid(fresh):
    for u in people():
        assert u.dept, u.name
        assert 0 < len(u.bio) <= BIO_MAX_LEN, (u.name, u.bio)
        assert 2 <= len(u.interests) <= 6 and 1 <= len(u.teach) <= 5 and 1 <= len(u.learn) <= 5, u.name
        assert all(0 < len(x) <= 30 for x in u.interests + u.teach + u.learn + u.prefs), u.name
        assert len(u.prefs) <= 5
        assert set(u.langs) <= set(LANGUAGES) and u.langs, u.name
        assert "한국어" in u.langs or "English" in u.langs, f"{u.name}: 누구와도 말이 통하는 언어가 하나는 있어야 해요"
        assert set(u.times) <= set(TIME_SLOTS) and len(u.times) >= 3, u.name
        assert u.ui_lang in {c for c, _ in UI_LANGS}, u.name


def test_every_time_slot_has_people_available(fresh):
    rows = people()
    for slot in TIME_SLOTS:
        assert sum(slot in u.times for u in rows if u.kind == "international") >= 6, slot
        assert sum(slot in u.times for u in rows if u.kind == "domestic") >= 3, slot


def test_busy_and_free_people_both_exist(fresh):
    counts = sorted(len(u.times) for u in people())
    assert counts[0] <= 15 and counts[-1] >= 39  # 1시간 슬롯: 바쁜 프로필과 여유 있는 프로필


def test_interests_are_varied(fresh):
    seen = {x for u in people() for x in u.interests}
    assert len(seen) >= 20
    assert set(INTERESTS) <= seen, "기본 추천 관심사는 한 번씩은 쓰여야 해요"


# ------------------------------------------------------- 언어와 실제 정보
def test_bios_are_written_in_each_students_own_language(fresh):
    by_country = {u.nationality: u for u in people() if u.kind == "international"}
    kana_kanji = re.compile(r"[぀-ヿ一-鿿]")
    hanzi = re.compile(r"[一-鿿]")
    viet = re.compile(r"[ăâđêôơưáàảãạéèẻẽẹíìỉĩịóòỏõọúùủũụýỳỷỹỵ]", re.I)
    japanese = [u for u in people() if u.nationality == "일본"]
    chinese = [u for u in people() if u.nationality == "중국"]
    vietnamese = [u for u in people() if u.nationality == "베트남"]
    assert japanese and all(kana_kanji.search(u.bio) for u in japanese)
    assert chinese and all(hanzi.search(u.bio) for u in chinese)
    assert vietnamese and all(viet.search(u.bio) for u in vietnamese)
    english = [u for u in people() if u.nationality in ("미국", "영국", "호주", "캐나다")]
    assert english and all(re.search(r"[A-Za-z]{3}", u.bio) for u in english)
    assert by_country  # 비어 있지 않다


def test_ui_language_follows_the_home_language(fresh):
    for u in people():
        want = {"일본": "ja", "중국": "zh", "대만": "zh", "베트남": "vi"}.get(u.nationality or "", None)
        if want:
            assert u.ui_lang == want, u.name
        if u.kind == "domestic":
            assert u.ui_lang == "ko", u.name


def test_no_real_personal_data(fresh):
    for u in people():
        assert u.email.endswith("@example.com"), u.email  # 예약된 가짜 도메인
        text = " ".join([u.name, u.bio, u.dept, *u.interests, *u.teach, *u.learn, *u.prefs])
        assert not re.search(r"\d{3,}", text), f"숫자 열이 들어 있어요: {u.name}"
        assert "@" not in text and "http" not in text.lower()


# -------------------------------------------------- 실제 사용자와 이어지는지
def real_domestic(**kw):
    base = dict(
        id=9999, name="실제", email="me@sookmyung.ac.kr", kind="domestic", dept="", langs=["한국어", "English"],
        interests=["카페", "전시"], times=list(TIME_SLOTS), teach=["한국어 표현"], learn=["일본 문화"], prefs=[],
        weekly_cap=2, is_synthetic=False, onboarded=True,
    )
    base.update(kw)
    return User(**base)


def test_a_domestic_student_has_many_international_candidates(fresh):
    me = real_domestic()
    intl = [u for u in people() if u.kind == "international"]
    ok = [u for u in intl if matching.hard_filter(me, u, set())]
    assert len(ok) >= 28, f"후보가 너무 적어요: {len(ok)}"
    top = sorted(ok, key=lambda u: -matching.score_pair(me, u)["total"])[:6]
    assert len({u.nationality for u in top}) >= 4, "추천 상위가 한 나라에 몰려요"


def test_an_international_student_has_domestic_candidates_too(fresh):
    me = real_domestic(kind="international", langs=["English", "한국어"], teach=["English 회화"], learn=["한국어 표현"])
    dom = [u for u in people() if u.kind == "domestic"]
    assert len([u for u in dom if matching.hard_filter(u, me, set())]) >= 10


def test_a_real_user_gets_recommendations_from_the_personas(fresh, monkeypatch):
    monkeypatch.setattr(matching, "FAKE_PAIRS", False)
    with SessionLocal() as db:
        me = real_domestic(id=None)
        db.add(me)
        db.commit()
        matching.assign(db)
        rows = list(db.scalars(select(Match)))
        assert len(rows) == 2 and all(me.id in (m.domestic_id, m.international_id) for m in rows)


# -------------------------------------------------------------- 교체
def test_replace_keeps_real_accounts_and_clears_old_fake_links(fresh):
    with SessionLocal() as db:
        real = real_domestic(id=None)
        db.add(real)
        db.commit()
        fake_ids = [u.id for u in db.scalars(select(User).where(User.is_synthetic.is_(True)))]
        d, i = fake_ids[0], [u for u in db.scalars(select(User)) if u.kind == "international"][0].id
        m = Match(domestic_id=real.id, international_id=i, status="confirmed", week="2026-W01", expires_at=real.__class__.__mro__ and __import__("datetime").datetime(2030, 1, 1))
        db.add(m)
        db.commit()
        db.add_all([Message(match_id=m.id, sender_id=real.id, text="hi"), Note(match_id=m.id, author_id=real.id)])
        db.commit()
        real_id = real.id

        out = replace_personas(db)

        assert out["removed"] == 50 and out["added"] == 50
        assert db.get(User, real_id) is not None and db.get(User, real_id).email == "me@sookmyung.ac.kr"
        assert db.query(Match).count() == 0 and db.query(Message).count() == 0 and db.query(Note).count() == 0
        assert db.query(User).filter(User.is_synthetic.is_(True)).count() == 50
        assert not (set(fake_ids) & {u.id for u in db.scalars(select(User).where(User.is_synthetic.is_(True)))})


def test_personas_list_is_the_source_of_truth():
    assert len(PERSONAS) == 50
