import logging

from .. import matching
from ..db import SessionLocal
from .coordination import matching_lock
from .reassignment import has_pending

logger = logging.getLogger(__name__)


def expire_and_reassign() -> dict[str, int]:
    # HTTP 요청의 세션을 공유하지 않는다. 예외 시 세션 컨텍스트가 롤백한다.
    with matching_lock, SessionLocal() as db:
        try:
            expired = matching.expire_stale(db)
            created = matching.assign(db) if has_pending(db) else 0
            return {"expired": expired, "created": created}
        except Exception:
            logger.exception("추천 만료/재배정 실패. 미완료 배정은 다음 주기에 재시도합니다.")
            raise
