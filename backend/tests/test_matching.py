"""기획서 6-(6) 검증: 합성 프로필 40명, 주간 상한 2명, 조건 위반 0건."""
from collections import Counter

from sqlalchemy import select

from app import matching
from app.models import Match, User
from app.util import week_of

ACTIVE = ("proposed", "confirmed")


def active(db):
    return db.scalars(select(Match).where(Match.status.in_(ACTIVE))).all()


def assert_invariants(db):
    users = {u.id: u for u in db.scalars(select(User))}
    rows = active(db)
    load = Counter()
    pairs = set()
    for m in rows:
        d, i = users[m.domestic_id], users[m.international_id]
        # 시간·언어 불일치 0건
        assert set(d.times) & set(i.times), "공통 시간 없음"
        assert set(d.langs) & set(i.langs), "공통 언어 없음"
        # 서로 다른 집단
        assert d.kind == "domestic" and i.kind == "international"
        # 같은 쌍 중복 없음
        key = (m.domestic_id, m.international_id)
        assert key not in pairs
        pairs.add(key)
        load[m.domestic_id] += 1
        load[m.international_id] += 1
    # 상한 초과 0건
    for uid, n in load.items():
        assert n <= users[uid].weekly_cap


def test_seed_is_unbalanced_40(db):
    users = db.scalars(select(User)).all()
    assert len(users) == 40
    assert sum(u.kind == "domestic" for u in users) == 26
    assert sum(u.kind == "international" for u in users) == 14


def test_initial_assignment_respects_rules(db):
    assert len(active(db)) > 0
    assert_invariants(db)


def test_assignment_is_maximal(db):
    """더 배정할 수 있는 쌍이 남아 있지 않아야 한다(매칭 수 최대화)."""
    before = len(active(db))
    created = matching.assign(db)
    assert created == 0
    assert len(active(db)) == before


def test_scores_use_weights(db):
    m = active(db)[0]
    expected = 0.35 * m.score_i + 0.30 * m.score_t + 0.15 * m.score_l + 0.20 * m.score_r
    assert abs(m.total - expected) < 1e-3


def test_reject_releases_slot_and_reassigns(db):
    m = active(db)[0]
    pair = (m.domestic_id, m.international_id)
    matching.reject(db, m.id, m.domestic_id)
    db.expire_all()
    assert db.get(Match, m.id).status == "rejected"
    # 같은 쌍은 다시 추천되지 않는다
    again = [(x.domestic_id, x.international_id) for x in active(db)]
    assert pair not in again
    assert_invariants(db)


def test_both_accept_confirms(db):
    m = active(db)[0]
    matching.accept(db, m.id, m.domestic_id)
    assert db.get(Match, m.id).status == "proposed"
    matching.accept(db, m.id, m.international_id)
    assert db.get(Match, m.id).status == "confirmed"
    assert_invariants(db)


def test_outsider_cannot_accept(db):
    m = active(db)[0]
    outsider = next(u.id for u in db.scalars(select(User)) if u.id not in (m.domestic_id, m.international_id))
    try:
        matching.accept(db, m.id, outsider)
        assert False, "참여자가 아닌 사람이 수락됨"
    except matching.MatchError as e:
        assert e.code == 403


def test_cancel_confirmed_reassigns(db):
    m = active(db)[0]
    matching.accept(db, m.id, m.domestic_id)
    matching.accept(db, m.id, m.international_id)
    matching.cancel(db, m.id, m.domestic_id)
    assert db.get(Match, m.id).status == "cancelled"
    assert_invariants(db)


def test_block_cancels_and_never_rematches(db):
    m = active(db)[0]
    matching.block_user(db, m.domestic_id, m.international_id)
    db.expire_all()
    assert db.get(Match, m.id).status == "cancelled"
    for x in active(db):
        assert (x.domestic_id, x.international_id) != (m.domestic_id, m.international_id)
    assert_invariants(db)


def test_expired_proposal_frees_slot(db):
    from datetime import timedelta

    from app.util import utcnow

    m = active(db)[0]
    m.expires_at = utcnow() - timedelta(hours=1)
    db.commit()
    assert matching.expire_stale(db) >= 1
    assert db.get(Match, m.id).status == "expired"


def test_reason_only_uses_real_overlap(db):
    d = db.get(User, 1)
    i = db.get(User, 27)  # 하루카
    ex = matching.explain(d, i)
    assert ex["common_interests"] == ["전시", "카페"]
    assert ex["common_times"] == ["수 오후", "금 오전"]
    assert ex["mutual"] is True
    # 겹치는 게 없으면 없는 근거를 만들지 않는다
    d.interests, d.times, d.teach, d.learn = [], [], [], []
    ex2 = matching.explain(d, i)
    assert "관심사" not in ex2["reason"] and "시간" not in ex2["reason"]
    assert week_of()


def test_similar_pairs_shows_close_but_not_identical_interests():
    pairs = matching.similar_pairs(["한국어 표현", "카페"], ["한국어", "카페"])
    assert pairs == [{"mine": "한국어 표현", "theirs": "한국어"}]
    assert matching.similar_pairs(["영화"], ["러닝"]) == []


def test_reason_mentions_similar_interests(db):
    d, i = db.get(User, 1), db.get(User, 27)
    d.interests, i.interests = ["한국어 표현"], ["한국어"]
    d.times, d.teach, d.learn = [], [], []
    ex = matching.explain(d, i)
    assert ex["common_interests"] == []
    assert "한국어 표현(한국어)" in ex["reason"]
