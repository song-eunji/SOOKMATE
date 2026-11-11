"""매칭 엔진 (기획서 6-(3)).

1단계 필터링 → 2단계 점수 → 3단계 전체 최적 배정(OR-Tools 최소비용 흐름) → 4단계 수락·재배정
"""
from __future__ import annotations

from datetime import timedelta

from ortools.graph.python import min_cost_flow
from sqlalchemy import select
from sqlalchemy.orm import Session

from .ai import embed, sim, set_sim
from .constants import PROPOSAL_TTL_HOURS, TIME_SLOTS, WEIGHTS, expand_times
from .models import Block, Match, User
from .notifications.service import match_event
from .scheduling.coordination import serialized
from .scheduling.reassignment import complete_pending, request_reassignment
from .util import utcnow, week_of

ACTIVE = ("proposed", "confirmed")  # 이번 주 상한에 포함되는 상태
# 가짜(시드) 사용자끼리도 서로 이어 줄지. 개발 시연에서는 켜 두고(main.py 가 DEV_MODE 로 정한다),
# 실제 로그인으로 쓸 때는 꺼서 가짜 프로필의 자리가 실제 사용자 몫으로 남게 한다.
FAKE_PAIRS = True


class MatchError(Exception):
    def __init__(self, message: str, code: int = 409):
        super().__init__(message)
        self.message = message
        self.code = code


def common(a: list, b: list) -> list:
    return sorted(set(a) & set(b))


# ------------------------------------------------------------ 1단계: 필수 조건
def hard_filter(a: User, b: User, blocked: set[frozenset]) -> bool:
    """서로 다른 집단 + 공통 가능 시간 + 공통 대화 언어(최소 1개) + 차단 아님."""
    if a.kind == b.kind:
        return False
    if frozenset((a.id, b.id)) in blocked:
        return False
    return bool(common(expand_times(a.times), expand_times(b.times))) and bool(common(a.langs, b.langs))


# --------------------------------------------------------------- 2단계: 점수
def score_pair(a: User, b: User) -> dict:
    """I 관심사 유사도, T 공통 시간 비율, L 언어 교환 충족도, R 양방향 적합도. 국적·학과는 쓰지 않는다."""
    I = set_sim(a.interests, b.interests)
    n = min(len(expand_times(a.times)), len(expand_times(b.times)))
    T = len(common(expand_times(a.times), expand_times(b.times))) / n if n else 0.0
    ln = min(len(a.langs), len(b.langs))
    L = min(1.0, len(common(a.langs, b.langs)) / ln) if ln else 0.0
    R = (set_sim(a.teach, b.learn) + set_sim(b.teach, a.learn)) / 2
    total = WEIGHTS["I"] * I + WEIGHTS["T"] * T + WEIGHTS["L"] * L + WEIGHTS["R"] * R
    return {"I": round(I, 4), "T": round(T, 4), "L": round(L, 4), "R": round(R, 4), "total": round(total, 4)}


SIMILAR_MIN = 0.4  # ai.sim 기준, 이 이상이면 비슷한 관심사로 보여 준다


def similar_pairs(mine: list[str], theirs: list[str]) -> list[dict]:
    """글자는 다르지만 뜻이 가까운 관심사 쌍 (예: 음악 / music). 같은 글자는 제외."""
    same = set(mine) & set(theirs)
    left = [x for x in mine if x not in same]
    right = [y for y in theirs if y not in same]
    pairs = []
    for x in left:
        s, y = max(((sim(embed(x), embed(y)), y) for y in right), default=(0.0, None))
        if y and s >= SIMILAR_MIN:
            pairs.append({"mine": x, "theirs": y})
            right.remove(y)
    return pairs


def explain(me: User, other: User) -> dict:
    """추천 이유는 실제로 겹치는 항목만으로 만든다. 없는 근거는 쓰지 않는다."""
    ints = common(me.interests, other.interests)
    similar = similar_pairs(me.interests, other.interests)
    shown = ints + [f"{p['mine']}({p['theirs']})" for p in similar]
    times = sorted(common(expand_times(me.times), expand_times(other.times)), key=lambda t: TIME_SLOTS.index(t) if t in TIME_SLOTS else 99)
    my_topic = (common(me.teach, other.learn) or [None])[0]
    partner_topic = (common(other.teach, me.learn) or [None])[0]
    mutual = bool(my_topic and partner_topic)

    ov = ""
    if shown and times:
        ov = f"{'·'.join(shown)} 관심사와 {times[0]} 시간이 겹"
    elif shown:
        ov = f"{'·'.join(shown)} 관심사가 겹"
    elif times:
        ov = f"{times[0]} 시간이 겹"
    mu = "서로 원하는 주제를 알려줄 수 있어요"
    if ov and mutual:
        reason = f"{ov}치고, {mu}."
    elif ov:
        reason = f"{ov}쳐요."
    elif mutual:
        reason = f"{mu}."
    else:
        reason = "겹치는 조건은 적지만 만날 수 있는 후보예요."
    return {
        "common_interests": ints,
        "similar_interests": similar,
        "common_times": times,
        "common_langs": common(me.langs, other.langs),
        "my_topic": my_topic,
        "partner_topic": partner_topic,
        "mutual": mutual,
        "reason": reason,
    }


# ------------------------------------------------------------ 상태 관리 보조
def active_count(db: Session, uid: int, week: str) -> int:
    rows = db.scalars(
        select(Match).where(
            Match.week == week,
            Match.status.in_(ACTIVE),
            (Match.domestic_id == uid) | (Match.international_id == uid),
        )
    ).all()
    return len(rows)


@serialized
def expire_stale(db: Session) -> int:
    now = utcnow()
    stale = db.scalars(select(Match).where(Match.status == "proposed", Match.expires_at < now).execution_options(populate_existing=True)).all()
    for m in stale:
        m.status = "expired"
        match_event(db, m, "match_expired")
        request_reassignment(db, m.id)
    if stale:
        db.commit()
    return len(stale)


# --------------------------------------------------- 3단계: 전체 최적 배정
@serialized
def assign(db: Session) -> int:
    """자리가 남은 사용자끼리만 새로 배정한다. 이미 있는 추천·확정은 건드리지 않는다.

    네트워크: source → 국내 학생(용량=남은 자리) → 유학생(용량 1, 비용=-점수) → sink(용량=남은 자리)
    '매칭 수를 먼저 최대화'한 뒤 같은 매칭 수 안에서 총점을 높인다(solve_max_flow_with_min_cost).
    """
    expire_stale(db)
    now = utcnow()
    week = week_of(now)

    users = db.scalars(select(User).execution_options(populate_existing=True)).all()
    blocked = {frozenset((b.user_id, b.blocked_id)) for b in db.scalars(select(Block))}
    all_matches = db.scalars(select(Match).execution_options(populate_existing=True)).all()
    existing = {frozenset((m.domestic_id, m.international_id)) for m in all_matches}

    used = {u.id: 0 for u in users}
    for m in all_matches:
        if m.week == week and m.status in ACTIVE:
            used[m.domestic_id] += 1
            used[m.international_id] += 1
    rem = {u.id: u.weekly_cap - used[u.id] for u in users}

    doms = [u for u in users if u.kind == "domestic" and rem[u.id] > 0]
    ints = [u for u in users if u.kind == "international" and rem[u.id] > 0]

    edges = []
    for d in doms:
        for i in ints:
            if frozenset((d.id, i.id)) in existing or not hard_filter(d, i, blocked):
                continue
            if not FAKE_PAIRS and d.is_synthetic and i.is_synthetic:
                continue
            edges.append((d, i, score_pair(d, i)))
    if not edges:
        complete_pending(db)
        db.commit()
        return 0

    dom_node = {d.id: 1 + k for k, d in enumerate(doms)}
    int_node = {i.id: 1 + len(doms) + k for k, i in enumerate(ints)}
    source, sink = 0, 1 + len(doms) + len(ints)

    smcf = min_cost_flow.SimpleMinCostFlow()
    for d in doms:
        smcf.add_arc_with_capacity_and_unit_cost(source, dom_node[d.id], rem[d.id], 0)
    for i in ints:
        smcf.add_arc_with_capacity_and_unit_cost(int_node[i.id], sink, rem[i.id], 0)
    edge_arcs = []
    for d, i, s in edges:
        cost = 1000 - int(round(s["total"] * 1000))  # 점수가 높을수록 비용이 낮다
        arc = smcf.add_arc_with_capacity_and_unit_cost(dom_node[d.id], int_node[i.id], 1, cost)
        edge_arcs.append((arc, d, i, s))
    supply = sum(rem[d.id] for d in doms)
    smcf.set_node_supply(source, supply)
    smcf.set_node_supply(sink, -supply)

    if smcf.solve_max_flow_with_min_cost() != smcf.OPTIMAL:
        return 0

    proposals = []
    for arc, d, i, s in edge_arcs:
        if smcf.flow(arc) > 0:
            proposals.append(
                Match(
                    domestic_id=d.id,
                    international_id=i.id,
                    status="proposed",
                    score_i=s["I"],
                    score_t=s["T"],
                    score_l=s["L"],
                    score_r=s["R"],
                    total=s["total"],
                    week=week,
                    expires_at=now + timedelta(hours=PROPOSAL_TTL_HOURS),
                )
            )
    db.add_all(proposals)
    db.flush()  # 알림과 같은 트랜잭션에서 새 Match ID를 확보한다.
    for proposal in proposals:
        match_event(db, proposal, "match_proposed")
    complete_pending(db)
    db.commit()
    return len(proposals)


# ------------------------------------------------------ 4단계: 수락·거절·취소
def _participant(m: Match, uid: int) -> None:
    if uid not in (m.domestic_id, m.international_id):
        raise MatchError("이 만남에 참여한 사람만 할 수 있어요.", 403)


def _locked(db: Session, match_id: int) -> Match:
    m = db.scalars(select(Match).where(Match.id == match_id).with_for_update().execution_options(populate_existing=True)).first()
    if not m:
        raise MatchError("만남을 찾을 수 없어요.", 404)
    return m


@serialized
def accept(db: Session, match_id: int, uid: int) -> Match:
    m = _locked(db, match_id)
    _participant(m, uid)
    if m.status == "proposed" and m.expires_at < utcnow():
        m.status = "expired"
        match_event(db, m, "match_expired")
        request_reassignment(db, m.id)
        db.commit()
        assign(db)
        raise MatchError("추천 기한이 지났어요. 새 추천을 확인해 주세요.", 410)
    if m.status != "proposed":
        raise MatchError("이미 처리된 추천이에요.")
    accepted_before = m.domestic_accepted if uid == m.domestic_id else m.international_accepted
    if uid == m.domestic_id:
        m.domestic_accepted = True
    else:
        m.international_accepted = True
    if m.domestic_accepted and m.international_accepted:
        m.status = "confirmed"
    # 동시 수락이 와도 1인당 이번 주 상한을 넘지 않는지 한 번 더 확인
    for u in (m.domestic_id, m.international_id):
        cap = db.get(User, u).weekly_cap
        if active_count(db, u, m.week) > cap:
            db.rollback()
            raise MatchError("이번 주 만남 상한을 넘을 수 없어요.")
    if not accepted_before:
        match_event(db, m, "match_accepted", uid)
        if m.status == "confirmed":
            match_event(db, m, "match_confirmed")
    db.commit()
    return m


@serialized
def reject(db: Session, match_id: int, uid: int) -> Match:
    m = _locked(db, match_id)
    _participant(m, uid)
    if m.status != "proposed":
        raise MatchError("이미 처리된 추천이에요.")
    m.status = "rejected"
    match_event(db, m, "match_rejected", uid)
    request_reassignment(db, m.id)
    db.commit()
    assign(db)  # 자리가 풀렸으니 미매칭자만 다시 배정
    return m


@serialized
def cancel(db: Session, match_id: int, uid: int) -> Match:
    m = _locked(db, match_id)
    _participant(m, uid)
    if m.status != "confirmed":
        raise MatchError("확정된 만남만 취소할 수 있어요.")
    m.status = "cancelled"
    match_event(db, m, "match_cancelled", uid)
    request_reassignment(db, m.id)
    db.commit()
    assign(db)
    return m


@serialized
def block_user(db: Session, uid: int, target_id: int) -> None:
    if uid == target_id or not db.get(User, target_id):
        raise MatchError("차단할 수 없는 사용자예요.", 400)
    already = db.scalars(select(Block).where(Block.user_id == uid, Block.blocked_id == target_id)).first()
    if not already:
        db.add(Block(user_id=uid, blocked_id=target_id))
    pair = {uid, target_id}
    for m in db.scalars(select(Match).where(Match.status.in_(ACTIVE)).execution_options(populate_existing=True)):
        if {m.domestic_id, m.international_id} == pair:
            m.status = "cancelled"
            # 차단 사실은 상대에게 알리지 않는다.
            request_reassignment(db, m.id)
    db.commit()
    assign(db)
