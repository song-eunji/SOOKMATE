from datetime import datetime

from sqlalchemy import DateTime, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column

from ..db import Base
from ..util import utcnow


class ReassignmentRequest(Base):
    """상태 변경은 커밋됐지만 후속 배정이 실패한 경우 다음 주기에 복구한다."""
    __tablename__ = "reassignment_requests"

    match_id: Mapped[int] = mapped_column(ForeignKey("matches.id"), primary_key=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
