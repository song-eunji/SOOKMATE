"""파일 SQLite와 독립 세션으로 예약 실행·복구·경합을 검증한다."""
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from threading import Barrier, Event

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select

from app import matching
from app.db import SessionLocal
from app.main import app
from app.models import Match, User
from app.notifications.models import Notification
from app.scheduling import scheduler as scheduler_module
from app.scheduling.jobs import expire_and_reassign
from app.scheduling.models import ReassignmentRequest
from app.scheduling.reassignment import has_pending
from app.util import utcnow, week_of


def proposal(db):
    return db.scalars(select(Match).where(Match.status == "proposed")).first()


def assert_invariants(db):
    rows = db.scalars(select(Match)).all()
    pairs = [(m.domestic_id, m.international_id) for m in rows]
    assert len(pairs) == len(set(pairs))
    counts = Counter(uid for m in rows if m.week == week_of() and m.status in matching.ACTIVE
                     for uid in (m.domestic_id, m.international_id))
    for uid, count in counts.items():
        assert count <= db.get(User, uid).weekly_cap


def test_expiry_boundary_and_confirmed_match_are_preserved(db, monkeypatch):
    now = utcnow()
    rows = db.scalars(select(Match).where(Match.status == "proposed").limit(4)).all()
    rows[0].expires_at = now - timedelta(microseconds=1)
    rows[1].expires_at = now
    rows[2].expires_at = now + timedelta(microseconds=1)
    rows[3].status = "confirmed"
    rows[3].expires_at = now - timedelta(days=1)
    db.commit()
    monkeypatch.setattr(matching, "utcnow", lambda: now)
    assert matching.expire_stale(db) == 1
    assert [m.status for m in rows] == ["expired", "proposed", "proposed", "confirmed"]


def test_job_expires_and_reassigns_without_http_request_and_is_repeatable(db):
    m = proposal(db)
    mid = m.id
    m.domestic_accepted = True  # 한쪽만 수락한 상태에서도 기한은 연장하지 않는다.
    m.expires_at = utcnow() - timedelta(seconds=1)
    db.commit()
    assert expire_and_reassign()["expired"] == 1
    db.expire_all()
    assert db.get(Match, mid).status == "expired"
    assert db.get(ReassignmentRequest, mid).completed_at is not None
    before = db.scalar(select(func.count(Notification.id)))
    assert expire_and_reassign() == {"expired": 0, "created": 0}
    assert db.scalar(select(func.count(Notification.id))) == before
    assert db.scalar(select(func.count(Notification.id)).where(
        Notification.match_id == mid, Notification.kind == "match_expired",
    )) == 2
    assert_invariants(db)


def test_accepting_overdue_proposal_uses_existing_410_and_notifies(db):
    m = proposal(db)
    mid, uid = m.id, m.domestic_id
    m.expires_at = utcnow() - timedelta(seconds=1)
    db.commit()
    with pytest.raises(matching.MatchError) as error:
        matching.accept(db, mid, uid)
    assert error.value.code == 410
    assert db.get(Match, mid).status == "expired"
    assert db.scalar(select(func.count(Notification.id)).where(
        Notification.match_id == mid, Notification.kind == "match_expired",
    )) == 2


@pytest.mark.parametrize("action", ["expire", "reject", "cancel", "block"])
def test_failed_reassignment_is_retried_from_durable_request(db, monkeypatch, action):
    m = proposal(db)
    mid, uid, partner = m.id, m.domestic_id, m.international_id
    if action == "expire":
        m.expires_at = utcnow() - timedelta(seconds=1)
        db.commit()
    if action == "cancel":
        matching.accept(db, mid, uid)
        matching.accept(db, mid, partner)
    real_assign = matching.assign
    def fail_assign(_db):
        raise RuntimeError("injected solver failure")
    monkeypatch.setattr(matching, "assign", fail_assign)
    with pytest.raises(RuntimeError, match="injected"):
        if action == "expire":
            expire_and_reassign()
        elif action == "block":
            matching.block_user(db, uid, partner)
        else:
            getattr(matching, action)(db, mid, uid)
    with SessionLocal() as check:
        assert has_pending(check)
        assert check.get(ReassignmentRequest, mid).completed_at is None
    monkeypatch.setattr(matching, "assign", real_assign)
    assert expire_and_reassign()["expired"] == 0  # 복구 시 만료 건수가 0이어도 재배정한다.
    with SessionLocal() as check:
        assert not has_pending(check)
        assert_invariants(check)


@pytest.mark.parametrize("race", ["accept", "assign", "expire", "overdue_accept"])
def test_scheduler_and_api_concurrency_with_separate_sessions(db, race):
    m = proposal(db)
    mid, uid, partner = m.id, m.domestic_id, m.international_id
    if race == "accept":
        matching.accept(db, mid, uid)
    else:
        m.expires_at = utcnow() - timedelta(seconds=1)
        db.commit()
    gate = Barrier(2)
    def scheduled():
        gate.wait(timeout=5)
        return expire_and_reassign()
    def api_request():
        with SessionLocal() as session:
            cached = session.get(Match, mid)  # 잠금 전 캐시도 최신 상태로 갱신해야 한다.
            gate.wait(timeout=5)
            if race == "overdue_accept":
                with pytest.raises(matching.MatchError) as error:
                    matching.accept(session, mid, partner)
                assert error.value.code in (409, 410)
            elif race == "accept":
                matching.accept(session, mid, partner)
            elif race == "assign":
                matching.assign(session)
            else:
                matching.expire_stale(session)
            return cached.id
    with ThreadPoolExecutor(max_workers=2) as pool:
        futures = [pool.submit(scheduled), pool.submit(api_request)]
        for future in futures:
            future.result(timeout=10)
    with SessionLocal() as check:
        assert_invariants(check)
        kind = "match_confirmed" if race == "accept" else "match_expired"
        assert check.scalar(select(func.count(Notification.id)).where(
            Notification.match_id == mid, Notification.kind == kind,
        )) == 2


def test_real_scheduler_runs_on_startup_and_stops_with_application(client, db, monkeypatch):
    m = proposal(db)
    mid = m.id
    m.expires_at = utcnow() - timedelta(seconds=1)
    db.commit()
    ran = Event()
    def observed_job():
        expire_and_reassign()
        ran.set()
    monkeypatch.setenv("SCHEDULER_ENABLED", "1")
    monkeypatch.setenv("SCHEDULER_INTERVAL_SECONDS", "1")
    monkeypatch.setattr(scheduler_module, "expire_and_reassign", observed_job)
    with TestClient(app):
        assert ran.wait(timeout=5), "APScheduler did not execute the startup sweep"
        scheduler = app.state.scheduler
        job = scheduler.get_job(scheduler_module.JOB_ID)
        assert job.max_instances == 1 and job.coalesce
        with SessionLocal() as check:
            assert check.get(Match, mid).status == "expired"
    assert not scheduler.running
    assert app.state.scheduler is None


def test_scheduler_disabled(monkeypatch):
    monkeypatch.setenv("SCHEDULER_ENABLED", "0")
    with scheduler_module.scheduler_lifespan() as scheduler:
        assert scheduler is None


@pytest.mark.parametrize("interval", ["0", "-1", "invalid"])
def test_invalid_scheduler_interval_is_rejected(monkeypatch, interval):
    monkeypatch.setenv("SCHEDULER_ENABLED", "1")
    monkeypatch.setenv("SCHEDULER_INTERVAL_SECONDS", interval)
    with pytest.raises(ValueError):
        with scheduler_module.scheduler_lifespan():
            pass


def test_concurrent_accepts_preserve_both_flags_and_one_confirmation(db):
    m = proposal(db)
    mid = m.id
    gate = Barrier(2)
    def accept(uid):
        with SessionLocal() as session:
            cached = session.get(Match, mid)
            gate.wait(timeout=5)
            matching.accept(session, cached.id, uid)
    with ThreadPoolExecutor(max_workers=2) as pool:
        futures = [pool.submit(accept, m.domestic_id), pool.submit(accept, m.international_id)]
        for future in futures:
            future.result(timeout=10)
    with SessionLocal() as check:
        result = check.get(Match, mid)
        assert result.status == "confirmed"
        assert result.domestic_accepted and result.international_accepted
        assert check.scalar(select(func.count(Notification.id)).where(
            Notification.match_id == mid, Notification.kind == "match_confirmed",
        )) == 2


def test_failed_expiry_commit_rolls_back_notifications_and_retry_request(db, monkeypatch):
    m = proposal(db)
    mid = m.id
    m.expires_at = utcnow() - timedelta(seconds=1)
    db.commit()
    def fail_commit():
        raise RuntimeError("injected expiry commit failure")
    monkeypatch.setattr(db, "commit", fail_commit)
    with pytest.raises(RuntimeError, match="injected"):
        matching.expire_stale(db)
    with SessionLocal() as check:
        assert check.get(Match, mid).status == "proposed"
        assert check.get(ReassignmentRequest, mid) is None
        assert not check.scalars(select(Notification).where(
            Notification.match_id == mid, Notification.kind == "match_expired",
        )).all()
