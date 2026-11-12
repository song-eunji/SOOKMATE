from datetime import datetime

from sqlalchemy import JSON, Boolean, DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from .constants import DEFAULT_WEEKLY_CAP
from .db import Base
from .util import utcnow


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(40))  # 닉네임
    ui_lang: Mapped[str] = mapped_column(String(4), default="ko")  # 화면 언어 코드
    bio: Mapped[str] = mapped_column(String(80), default="")  # 한 줄 소개 (사용자가 쓴 그대로 보여줌)
    onboarded: Mapped[bool] = mapped_column(Boolean, default=False)  # 기본 정보 입력을 마쳤는지
    email: Mapped[str] = mapped_column(String(120), default="")
    kind: Mapped[str] = mapped_column(String(16))  # "domestic" | "international"
    dept: Mapped[str] = mapped_column(String(60), default="")
    nationality: Mapped[str | None] = mapped_column(String(40), nullable=True)  # 선택 입력, 점수에 쓰지 않음
    langs: Mapped[list] = mapped_column(JSON, default=list)
    interests: Mapped[list] = mapped_column(JSON, default=list)
    times: Mapped[list] = mapped_column(JSON, default=list)  # "수 13:00–14:00" 형식 (기존 "수 오후"도 읽기 호환)
    teach: Mapped[list] = mapped_column(JSON, default=list)  # 알려줄 수 있는 것
    learn: Mapped[list] = mapped_column(JSON, default=list)  # 배우고 싶은 것
    prefs: Mapped[list] = mapped_column(JSON, default=list)  # 만나기 전 브리핑에 공개되는 선호
    weekly_cap: Mapped[int] = mapped_column(Integer, default=DEFAULT_WEEKLY_CAP)
    is_synthetic: Mapped[bool] = mapped_column(Boolean, default=False)
    password_hash: Mapped[str | None] = mapped_column(String(200), nullable=True)  # scrypt$솔트$해시 (평문은 저장하지 않는다)
    login_fails: Mapped[int] = mapped_column(Integer, default=0)  # 연속으로 비밀번호를 틀린 횟수
    locked_until: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)  # 이 시각까지 로그인 잠금


class Block(Base):
    __tablename__ = "blocks"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    blocked_id: Mapped[int] = mapped_column(ForeignKey("users.id"))


class Report(Base):
    __tablename__ = "reports"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    reporter_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    target_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    match_id: Mapped[int | None] = mapped_column(ForeignKey("matches.id"), nullable=True)
    reason: Mapped[str] = mapped_column(String(200))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class Match(Base):
    """한 번의 짧은 만남 단위.
    status: proposed(자리 임시 예약) → confirmed(양측 수락) / rejected / expired / cancelled
    proposed, confirmed 는 이번 주 상한(weekly_cap)에 포함되고, 나머지는 자리가 풀립니다."""

    __tablename__ = "matches"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    domestic_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    international_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    status: Mapped[str] = mapped_column(String(16), default="proposed")
    domestic_accepted: Mapped[bool] = mapped_column(Boolean, default=False)
    international_accepted: Mapped[bool] = mapped_column(Boolean, default=False)
    score_i: Mapped[float] = mapped_column(Float, default=0.0)
    score_t: Mapped[float] = mapped_column(Float, default=0.0)
    score_l: Mapped[float] = mapped_column(Float, default=0.0)
    score_r: Mapped[float] = mapped_column(Float, default=0.0)
    total: Mapped[float] = mapped_column(Float, default=0.0)
    week: Mapped[str] = mapped_column(String(10))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    expires_at: Mapped[datetime] = mapped_column(DateTime)


class Message(Base):
    __tablename__ = "messages"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    match_id: Mapped[int] = mapped_column(ForeignKey("matches.id"), index=True)
    sender_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    text: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class LoginCode(Base):
    """학교 메일로 보낸 인증 코드. 코드는 해시로만 저장하고, 한 번 쓰면 못 쓴다."""

    __tablename__ = "login_codes"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    email: Mapped[str] = mapped_column(String(254), index=True)
    salt: Mapped[str] = mapped_column(String(32))
    code_hash: Mapped[str] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    expires_at: Mapped[datetime] = mapped_column(DateTime)
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    used: Mapped[bool] = mapped_column(Boolean, default=False)


class AuthToken(Base):
    """로그인 세션. 토큰 자체는 저장하지 않고 해시만 둔다."""

    __tablename__ = "auth_tokens"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    expires_at: Mapped[datetime] = mapped_column(DateTime)


class ChatRead(Base):
    """대화방별로 각자 어디까지 읽었는지. 안 읽은 수와 '읽음' 표시에 쓴다."""

    __tablename__ = "chat_reads"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    match_id: Mapped[int] = mapped_column(ForeignKey("matches.id"), index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    last_read_id: Mapped[int] = mapped_column(Integer, default=0)


class Note(Base):
    """교류 노트. 기본은 비공개이고 share_* 가 켜진 항목만 상대에게 보입니다."""

    __tablename__ = "notes"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    match_id: Mapped[int] = mapped_column(ForeignKey("matches.id"), index=True)
    author_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    expr: Mapped[str] = mapped_column(String(200), default="")  # 새로 배운 표현
    fact: Mapped[str] = mapped_column(String(200), default="")  # 새로 알게 된 것
    next_text: Mapped[str] = mapped_column(String(200), default="")  # 다음에 하고 싶은 것
    share_expr: Mapped[bool] = mapped_column(Boolean, default=False)
    share_fact: Mapped[bool] = mapped_column(Boolean, default=False)
    share_next: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)


class ActivityRun(Base):
    __tablename__ = "activity_runs"
    __table_args__ = {"sqlite_autoincrement": True}
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    match_id: Mapped[int] = mapped_column(ForeignKey("matches.id"), unique=True)
    fingerprint: Mapped[str] = mapped_column(String(64))
    payload: Mapped[dict] = mapped_column(JSON, default=dict)
    ratings: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class AIQuota(Base):
    __tablename__ = "ai_quota"
    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    blocked_until: Mapped[float] = mapped_column(Float)
    status: Mapped[str] = mapped_column(String(40))


class Appointment(Base):
    """매칭당 현재 약속. version으로 오래된 화면의 응답을 차단한다."""
    __tablename__ = "appointments"
    match_id: Mapped[int] = mapped_column(ForeignKey("matches.id"), primary_key=True)
    date: Mapped[str] = mapped_column(String(10))
    slot: Mapped[str] = mapped_column(String(30))
    proposer_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    status: Mapped[str] = mapped_column(String(16), default="proposed")
    version: Mapped[int] = mapped_column(Integer, default=1)


class AppointmentEvent(Base):
    """약속이 제안·확정·거절·취소된 기록. 대화방에서 시간 순서대로 약속 카드를 보여주는 데 쓴다."""
    __tablename__ = "appointment_events"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    match_id: Mapped[int] = mapped_column(ForeignKey("matches.id"), index=True)
    actor_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    kind: Mapped[str] = mapped_column(String(16))  # proposed | confirmed | declined | cancelled
    date: Mapped[str] = mapped_column(String(10))
    slot: Mapped[str] = mapped_column(String(30))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
