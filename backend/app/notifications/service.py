"""호출자의 트랜잭션에 알림을 기록한다. 여기에서는 commit하지 않는다."""
from sqlalchemy import update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.orm import Session

from ..models import Match, Message
from ..util import utcnow
from .models import Notification


def insert_once(db: Session, model, values: dict, keys: list[str]) -> None:
    dialect = db.get_bind().dialect.name
    insert = {"sqlite": sqlite_insert, "postgresql": pg_insert}[dialect]
    db.execute(insert(model).values(**values).on_conflict_do_nothing(index_elements=keys))


def notify(db: Session, recipient_id: int, kind: str, event_key: str,
           match_id: int, message_id: int | None = None) -> None:
    insert_once(db, Notification, {
        "recipient_id": recipient_id, "kind": kind, "event_key": event_key,
        "match_id": match_id, "message_id": message_id, "created_at": utcnow(),
    }, ["recipient_id", "event_key"])


def match_event(db: Session, match: Match, kind: str, actor_id: int | None = None) -> None:
    key = f"match:{match.id}:{kind}"
    if actor_id is not None:
        key += f":{actor_id}"
    for uid in (match.domestic_id, match.international_id):
        if uid != actor_id:
            notify(db, uid, kind, key, match.id)


def message_event(db: Session, match: Match, message: Message) -> None:
    recipient = match.international_id if message.sender_id == match.domestic_id else match.domestic_id
    notify(db, recipient, "message_created", f"message:{message.id}:created", match.id, message.id)


def read_messages(db: Session, match_id: int, uid: int, last_id: int) -> None:
    db.execute(update(Notification).where(
        Notification.recipient_id == uid, Notification.match_id == match_id,
        Notification.kind == "message_created", Notification.message_id <= last_id,
        Notification.read_at.is_(None),
    ).values(read_at=utcnow()))
