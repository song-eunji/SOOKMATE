"""알림의 이벤트 범위, 접근 권한, 원자성, 기존 채팅 흐름을 검증한다."""
import pytest
from sqlalchemy import func, select

from app import matching
from app.db import SessionLocal
from app.models import Match, Message
from app.notifications.models import Notification
from app.notifications.service import match_event, message_event


def h(uid):
    return {"X-User-Id": str(uid)}


def proposal(db):
    return db.scalars(select(Match).where(Match.status == "proposed")).first()


def events(db, mid, kind):
    return db.scalars(select(Notification).where(
        Notification.match_id == mid, Notification.kind == kind,
    ).order_by(Notification.id)).all()


def confirm(db, m):
    matching.accept(db, m.id, m.domestic_id)
    matching.accept(db, m.id, m.international_id)


def test_new_proposals_notify_both_users_once(db):
    matches = db.scalars(select(Match)).all()
    for m in matches:
        assert {n.recipient_id for n in events(db, m.id, "match_proposed")} == {
            m.domestic_id, m.international_id,
        }
    before = db.scalar(select(func.count(Notification.id)))
    assert matching.assign(db) == 0
    match_event(db, matches[0], "match_proposed")  # 재처리해도 DB 제약으로 중복되지 않는다.
    db.commit()
    assert db.scalar(select(func.count(Notification.id))) == before


def test_accept_retry_and_confirmation_notify_actual_transitions(db):
    m = proposal(db)
    matching.accept(db, m.id, m.domestic_id)
    matching.accept(db, m.id, m.domestic_id)
    accepted = events(db, m.id, "match_accepted")
    assert [n.recipient_id for n in accepted] == [m.international_id]
    assert not events(db, m.id, "match_confirmed")
    matching.accept(db, m.id, m.international_id)
    assert len(events(db, m.id, "match_accepted")) == 2
    assert {n.recipient_id for n in events(db, m.id, "match_confirmed")} == {
        m.domestic_id, m.international_id,
    }


@pytest.mark.parametrize("action,kind", [("reject", "match_rejected"), ("cancel", "match_cancelled")])
def test_closing_notifies_partner_and_reassigns(db, action, kind):
    m = proposal(db)
    if action == "cancel":
        confirm(db, m)
    getattr(matching, action)(db, m.id, m.domestic_id)
    assert [n.recipient_id for n in events(db, m.id, kind)] == [m.international_id]
    with pytest.raises(matching.MatchError):
        getattr(matching, action)(db, m.id, m.domestic_id)
    assert len(events(db, m.id, kind)) == 1


def test_block_does_not_disclose_block_or_notify_unrelated_match(db):
    m = proposal(db)
    matching.block_user(db, m.domestic_id, m.international_id)
    assert db.get(Match, m.id).status == "cancelled"
    assert db.scalar(select(func.count(Notification.id)).where(
        Notification.kind == "match_cancelled",
    )) == 0
    # 활성 매칭이 없더라도 차단은 가능하다.
    matching.block_user(db, m.domestic_id, m.international_id)


def test_notification_list_pagination_and_ownership(client, db):
    m = proposal(db)
    uid = m.domestic_id
    response = client.get("/api/notifications", headers=h(uid))
    assert response.status_code == 200
    expected = db.scalars(select(Notification.id).where(
        Notification.recipient_id == uid,
    ).order_by(Notification.id.desc())).all()
    assert [row["id"] for row in response.json()] == expected
    first = client.get("/api/notifications?limit=1", headers=h(uid)).json()[0]
    next_page = client.get(f"/api/notifications?before_id={first['id']}", headers=h(uid)).json()
    assert all(row["id"] < first["id"] for row in next_page)
    assert client.get("/api/notifications?limit=101", headers=h(uid)).status_code == 422
    assert client.get("/api/notifications?before_id=0", headers=h(uid)).status_code == 422
    path = f"/api/notifications/{first['id']}/read"
    assert client.post(path, headers=h(m.international_id)).status_code == 404
    assert client.post(path, headers=h(uid)).status_code == 200
    row = next(x for x in client.get("/api/notifications", headers=h(uid)).json() if x["id"] == first["id"])
    assert row["read_at"] is not None
    assert client.post(path, headers=h(uid)).status_code == 200
    reread = next(x for x in client.get("/api/notifications", headers=h(uid)).json() if x["id"] == first["id"])
    assert reread["read_at"] == row["read_at"]
    unread = client.get("/api/notifications?unread_only=true", headers=h(uid)).json()
    assert all(x["read_at"] is None for x in unread)
    assert client.get("/api/notifications/unread-count", headers=h(uid)).json() == {"count": len(expected) - 1}
    assert client.get("/api/notifications", headers=h(999999)).status_code == 401


@pytest.mark.parametrize("transport", ["rest", "websocket", "dev"])
def test_messages_notify_receiver_and_chat_read_updates_notifications(client, db, transport):
    m = proposal(db)
    confirm(db, m)
    sender, receiver = m.domestic_id, m.international_id
    if transport == "rest":
        response = client.post(f"/api/matches/{m.id}/messages", headers=h(sender), json={"text": "hello"})
        assert response.status_code == 200
    elif transport == "websocket":
        with client.websocket_connect(f"/ws/matches/{m.id}?user_id={sender}") as ws:
            ws.send_json({"text": "hello"})
            assert ws.receive_json()["text"] == "hello"
    else:
        assert client.post(f"/api/dev/matches/{m.id}/partner-message", headers=h(receiver)).status_code == 200
    db.expire_all()
    rows = events(db, m.id, "message_created")
    assert len(rows) == 1 and rows[0].recipient_id == receiver
    msg = db.get(Message, rows[0].message_id)
    message_event(db, m, msg)
    db.commit()
    assert len(events(db, m.id, "message_created")) == 1
    assert client.get("/api/chats", headers=h(receiver)).json()[0]["unread"] == 1
    assert client.post(f"/api/matches/{m.id}/read", headers=h(receiver)).status_code == 200
    db.expire_all()
    assert events(db, m.id, "message_created")[0].read_at is not None
    assert client.get("/api/chats", headers=h(receiver)).json()[0]["unread"] == 0


def test_notification_read_does_not_mark_chat_read(client, db):
    m = proposal(db)
    confirm(db, m)
    client.post(f"/api/matches/{m.id}/messages", headers=h(m.domestic_id), json={"text": "hello"})
    notification = events(db, m.id, "message_created")[0]
    client.post(f"/api/notifications/{notification.id}/read", headers=h(m.international_id))
    assert client.get("/api/chats", headers=h(m.international_id)).json()[0]["unread"] == 1


def test_failed_accept_commit_rolls_back_state_and_notification(db, monkeypatch):
    m = proposal(db)
    mid, uid = m.id, m.domestic_id
    def fail_commit():
        raise RuntimeError("injected commit failure")
    monkeypatch.setattr(db, "commit", fail_commit)
    with pytest.raises(RuntimeError, match="injected"):
        matching.accept(db, mid, uid)
    with SessionLocal() as check:
        assert check.get(Match, mid).domestic_accepted is False
        assert not events(check, mid, "match_accepted")


def test_failed_message_commit_leaves_no_message_or_notification(db, monkeypatch):
    from app.main import _save_message
    m = proposal(db)
    confirm(db, m)
    mid, uid = m.id, m.domestic_id
    def fail_commit():
        raise RuntimeError("injected commit failure")
    monkeypatch.setattr(db, "commit", fail_commit)
    with pytest.raises(RuntimeError, match="injected"):
        _save_message(db, mid, uid, "must rollback")
    with SessionLocal() as check:
        assert not check.scalars(select(Message).where(Message.match_id == mid)).all()
        assert not events(check, mid, "message_created")


def test_cancelled_websocket_cannot_send_more_messages(client, db):
    m = proposal(db)
    confirm(db, m)
    with client.websocket_connect(f"/ws/matches/{m.id}?user_id={m.domestic_id}") as ws:
        matching.cancel(db, m.id, m.domestic_id)
        ws.send_json({"text": "too late"})
        assert ws.receive() == {"type": "websocket.close", "code": 4403, "reason": ""}
    assert not events(db, m.id, "message_created")


def test_failed_assignment_commit_rolls_back_new_matches_and_notifications(db, monkeypatch):
    m = proposal(db)
    m.status = "rejected"
    db.commit()
    before_matches = db.scalar(select(func.count(Match.id)))
    before_notifications = db.scalar(select(func.count(Notification.id)))
    def fail_commit():
        # 실제 새 추천과 알림이 생성된 뒤 커밋이 실패하는 상황을 검증한다.
        assert db.scalar(select(func.count(Match.id))) > before_matches
        assert db.scalar(select(func.count(Notification.id))) > before_notifications
        raise RuntimeError("injected assignment commit failure")
    monkeypatch.setattr(db, "commit", fail_commit)
    with pytest.raises(RuntimeError, match="injected"):
        matching.assign(db)
    with SessionLocal() as check:
        assert check.scalar(select(func.count(Match.id))) == before_matches
        assert check.scalar(select(func.count(Notification.id))) == before_notifications
