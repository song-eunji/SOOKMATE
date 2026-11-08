import os

from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import DeclarativeBase, sessionmaker

# 기본은 SQLite 파일(설치 없이 바로 실행). PostgreSQL로 바꾸려면 DATABASE_URL 환경변수만 바꾸면 됩니다.
DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./sookmate.db")

_connect_args = {"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {}
engine = create_engine(DATABASE_URL, connect_args=_connect_args)
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def ensure_columns() -> None:
    """이미 만들어진 DB 파일에 새 컬럼이 없으면 붙인다. (create_all 은 기존 테이블에 컬럼을 추가하지 않음)"""
    cols = {c["name"] for c in inspect(engine).get_columns("users")}
    add = {"ui_lang": "VARCHAR(4) DEFAULT 'ko'", "bio": "VARCHAR(80) DEFAULT ''", "onboarded": "BOOLEAN DEFAULT 0",
           "password_hash": "VARCHAR(200)", "login_fails": "INTEGER DEFAULT 0", "locked_until": "DATETIME"}
    with engine.begin() as conn:
        for name, ddl in add.items():
            if name not in cols:
                conn.execute(text(f"ALTER TABLE users ADD COLUMN {name} {ddl}"))
