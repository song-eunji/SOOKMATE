import os
from contextlib import contextmanager
from datetime import datetime, timezone

from apscheduler.schedulers.background import BackgroundScheduler

from .jobs import expire_and_reassign

JOB_ID = "expire-proposals"


@contextmanager
def scheduler_lifespan():
    if os.getenv("SCHEDULER_ENABLED", "1") != "1":
        yield None
        return
    seconds = int(os.getenv("SCHEDULER_INTERVAL_SECONDS", "60"))
    if seconds < 1:
        raise ValueError("SCHEDULER_INTERVAL_SECONDS must be positive")
    scheduler = BackgroundScheduler(timezone="UTC")
    scheduler.add_job(
        expire_and_reassign, "interval", seconds=seconds,
        id=JOB_ID, replace_existing=True, max_instances=1, coalesce=True,
        misfire_grace_time=seconds, next_run_time=datetime.now(timezone.utc),
    )
    scheduler.start()
    try:
        yield scheduler
    finally:
        scheduler.shutdown(wait=True)
