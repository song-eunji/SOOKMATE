from sqlalchemy import select, update
from sqlalchemy.orm import Session

from ..notifications.service import insert_once
from ..util import utcnow
from .models import ReassignmentRequest


def request_reassignment(db: Session, match_id: int) -> None:
    insert_once(db, ReassignmentRequest, {
        "match_id": match_id, "created_at": utcnow(),
    }, ["match_id"])


def has_pending(db: Session) -> bool:
    return db.scalar(select(ReassignmentRequest.match_id).where(
        ReassignmentRequest.completed_at.is_(None),
    ).limit(1)) is not None


def complete_pending(db: Session) -> None:
    db.execute(update(ReassignmentRequest).where(
        ReassignmentRequest.completed_at.is_(None),
    ).values(completed_at=utcnow()))
