import os
import tempfile

# app 모듈을 import 하기 전에 테스트용 DB 파일을 지정한다.
_tmp = tempfile.mkdtemp()
os.environ["DATABASE_URL"] = f"sqlite:///{_tmp}/test.db"
os.environ["DEV_MODE"] = "1"
os.environ.pop("ANTHROPIC_API_KEY", None)  # 테스트는 외부 AI 호출 금지
os.environ.pop("GEMINI_API_KEY", None)
os.environ.pop("TAVILY_API_KEY", None)
os.environ["LLM_PROVIDER"] = "auto"

import pytest
from fastapi.testclient import TestClient

from app.db import SessionLocal
from app.main import app


@pytest.fixture(autouse=True)
def _fresh_llm_cache():
    """LLM 결과는 입력이 같으면 저장해 두고 다시 쓰므로, 테스트끼리 섞이지 않게 매번 비운다."""
    from app import ai

    ai._llm_cache.clear()
    yield
    ai._llm_cache.clear()


@pytest.fixture()
def client():
    with TestClient(app) as c:
        c.post("/api/dev/reset")
        yield c


@pytest.fixture()
def db(client):
    with SessionLocal() as s:
        yield s
