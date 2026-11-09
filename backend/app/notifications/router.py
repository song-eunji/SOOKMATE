from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import User
from ..util import utcnow
from .models import Notification


class NotificationView(BaseModel):
    id: int
    kind: str
    match_id: int
    message_id: int | None
    created_at: datetime
    read_at: datetime | None

    model_config = {"from_attributes": True}


def create_router(me_dep) -> APIRouter:
    # 사용자 의존성을 주입받아 main.py를 역으로 import하지 않는다.
    router = APIRouter(prefix="/api/notifications", tags=["notifications"])

    @router.get("", response_model=list[NotificationView])
    def list_notifications(
        before_id: int | None = Query(default=None, gt=0),
        limit: int = Query(default=50, ge=1, le=100),
        unread_only: bool = False,
        me: User = Depends(me_dep), db: Session = Depends(get_db),
    ):
        query = select(Notification).where(Notification.recipient_id == me.id)
        if before_id is not None:
            query = query.where(Notification.id < before_id)
        if unread_only:
            query = query.where(Notification.read_at.is_(None))
        return db.scalars(query.order_by(Notification.id.desc()).limit(limit)).all()

    @router.get("/unread-count")
    def unread_count(me: User = Depends(me_dep), db: Session = Depends(get_db)):
        count = db.scalar(select(func.count(Notification.id)).where(
            Notification.recipient_id == me.id, Notification.read_at.is_(None),
        ))
        return {"count": count or 0}

    @router.post("/{notification_id}/read")
    def mark_read(notification_id: int, me: User = Depends(me_dep), db: Session = Depends(get_db)):
        row = db.scalar(select(Notification.id).where(
            Notification.id == notification_id, Notification.recipient_id == me.id,
        ))
        if row is None:
            raise HTTPException(404, "알림을 찾을 수 없어요.")
        db.execute(update(Notification).where(
            Notification.id == notification_id, Notification.read_at.is_(None),
        ).values(read_at=utcnow()))
        db.commit()
        return {"ok": True}

    return router
