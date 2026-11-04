import os
import tempfile

# app 모듈을 import 하기 전에 테스트용 DB 파일을 지정한다.
_tmp = tempfile.mkdtemp()
os.environ["DATABASE_URL"] = f"sqlite:///{_tmp}/test.db"
os.environ["DEV_MODE"] = "1"
os.environ["SCHEDULER_ENABLED"] = "0"  # ?? ??? ?? ?????? ??.
os.environ.pop("ANTHROPIC_API_KEY", None)  # 테스트는 항상 fallback 경로

import pytest
from fastapi.testclient import TestClient

from app.db import SessionLocal
from app.main import app


@pytest.fixture()
def client():
    with TestClient(app) as c:
        c.post("/api/dev/reset")
        yield c


@pytest.fixture()
def db(client):
    with SessionLocal() as s:
        yield s
