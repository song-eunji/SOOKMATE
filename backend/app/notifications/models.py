from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from ..db import Base
from ..util import utcnow


class Notification(Base):
    __tablename__ = "notifications"
    __table_args__ = (
        UniqueConstraint("recipient_id", "event_key", name="uq_notification_recipient_event"),
        Index("ix_notification_recipient_id", "recipient_id", "id"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    recipient_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    event_key: Mapped[str] = mapped_column(String(120))
    kind: Mapped[str] = mapped_column(String(32))
    match_id: Mapped[int] = mapped_column(ForeignKey("matches.id"))
    message_id: Mapped[int | None] = mapped_column(ForeignKey("messages.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    read_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
