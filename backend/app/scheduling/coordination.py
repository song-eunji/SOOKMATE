from functools import wraps
from threading import RLock


# 모든 매칭 변경 경로에서 공유. 내부 assign/expire 호출도 있어 RLock을 쓴다.
# 프로세스 간 잠금이 아니므로 API는 반드시 worker 1개로 운영한다.
matching_lock = RLock()


def serialized(fn):
    @wraps(fn)
    def wrapped(db, *args, **kwargs):
        with matching_lock:
            try:
                return fn(db, *args, **kwargs)
            except Exception:
                db.rollback()
                raise
    return wrapped
