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
os.environ["ACTIVITY_WIKIPEDIA"] = "0"  # 테스트는 외부 검색 금지 (필요한 테스트만 가짜 응답으로 켬)
os.environ["ACTIVITY_GOOGLE_SEARCH"] = "0"
os.environ.pop("GEMINI_FALLBACK_MODELS", None)

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
