from datetime import datetime, timezone


def utcnow() -> datetime:
    """DB에는 timezone 없는 UTC 시각으로 저장합니다."""
    return datetime.now(timezone.utc).replace(tzinfo=None)


def week_of(dt: datetime | None = None) -> str:
    """주간 만남 상한을 세는 기준 (ISO 주차)."""
    y, w, _ = (dt or utcnow()).isocalendar()
    return f"{y}-W{w:02d}"
