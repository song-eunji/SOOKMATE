"""학교 메일 인증 로그인.

비밀번호 없이, 학교 메일로 보낸 6자리 인증 코드를 맞히면 로그인한다.
- 메일 주소는 허용한 도메인(ALLOWED_EMAIL_DOMAINS, 기본 sookmyung.ac.kr)과 정확히 같아야 한다.
- 인증 코드는 해시로만 저장하고, 10분 안에 한 번만 쓸 수 있고, 5번 틀리면 새 코드를 받아야 한다.
- 로그인하면 임의의 세션 토큰을 주고, 서버에는 토큰의 해시만 저장한다.
"""
from __future__ import annotations

import hashlib
import hmac
import logging
import os
import re
import secrets
import smtplib
from datetime import timedelta
from email.message import EmailMessage

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .models import AuthToken, LoginCode, User
from .util import utcnow

log = logging.getLogger("sookmate.auth")

ALLOWED_DOMAINS = [d.strip().lower() for d in os.getenv("ALLOWED_EMAIL_DOMAINS", "sookmyung.ac.kr").split(",") if d.strip()]
LOGIN_DOMAIN = ALLOWED_DOMAINS[0]  # 화면에 보여줄 대표 도메인

CODE_TTL = timedelta(minutes=10)
TOKEN_TTL = timedelta(days=30)
COOLDOWN_SECONDS = 60  # 같은 메일로 코드를 다시 받기까지 기다리는 시간
MAX_CODES_PER_HOUR = 5
MAX_ATTEMPTS = 5

_EMAIL = re.compile(r"^[a-z0-9._%+-]+@([a-z0-9-]+(?:\.[a-z0-9-]+)+)$")


class AuthError(Exception):
    def __init__(self, message: str, code: int = 400):
        super().__init__(message)
        self.message = message
        self.code = code


class MailNotConfigured(Exception):
    pass


def normalize_email(raw: str) -> str:
    """공백과 대소문자를 정리하고, 형식과 도메인을 확인한다. 하위 도메인이나 비슷한 도메인은 받지 않는다."""
    email = (raw or "").strip().lower()
    m = _EMAIL.match(email) if len(email) <= 254 else None
    if not m:
        raise AuthError("메일 주소 형식이 맞지 않아요.", 422)
    if m.group(1) not in ALLOWED_DOMAINS:
        raise AuthError("숙명여자대학교 메일(@sookmyung.ac.kr)만 쓸 수 있어요.", 422)
    return email


def _digest(salt: str, code: str) -> str:
    return hashlib.sha256(f"{salt}:{code}".encode()).hexdigest()


# --------------------------------------------------------------------- 인증 코드
def issue_code(db: Session, email: str) -> str:
    now = utcnow()
    last = db.scalars(select(LoginCode).where(LoginCode.email == email).order_by(LoginCode.id.desc())).first()
    if last and (now - last.created_at).total_seconds() < COOLDOWN_SECONDS:
        raise AuthError("인증 코드를 너무 자주 요청했어요. 잠시 후 다시 시도해 주세요.", 429)
    recent = db.scalar(select(func.count(LoginCode.id)).where(LoginCode.email == email, LoginCode.created_at > now - timedelta(hours=1)))
    if (recent or 0) >= MAX_CODES_PER_HOUR:
        raise AuthError("인증 코드를 너무 자주 요청했어요. 잠시 후 다시 시도해 주세요.", 429)

    code = f"{secrets.randbelow(10**6):06d}"
    salt = secrets.token_hex(8)
    db.add(LoginCode(email=email, salt=salt, code_hash=_digest(salt, code), expires_at=now + CODE_TTL))
    db.commit()
    return code


def check_code(db: Session, email: str, code: str) -> None:
    """가장 최근에 받은 코드만 유효하다. 맞으면 그 코드를 쓴 것으로 처리하고, 틀리면 시도 횟수를 센다."""
    row = db.scalars(select(LoginCode).where(LoginCode.email == email, LoginCode.used.is_(False)).order_by(LoginCode.id.desc())).first()
    if row is None:
        raise AuthError("인증 코드가 맞지 않아요.", 400)
    if utcnow() >= row.expires_at:
        raise AuthError("인증 코드가 만료됐어요. 새 코드를 받아 주세요.", 400)
    if row.attempts >= MAX_ATTEMPTS:
        raise AuthError("시도 횟수를 넘었어요. 새 코드를 받아 주세요.", 429)

    row.attempts += 1
    good = bool(re.fullmatch(r"\d{6}", code or "")) and hmac.compare_digest(row.code_hash, _digest(row.salt, code))
    if not good:
        db.commit()
        raise AuthError("인증 코드가 맞지 않아요.", 400)
    row.used = True
    db.commit()


# ----------------------------------------------------------------------- 메일 발송
def send_mail(to: str, subject: str, body: str) -> None:
    host = os.getenv("SMTP_HOST")
    if not host:
        raise MailNotConfigured()
    msg = EmailMessage()
    msg["From"] = os.getenv("MAIL_FROM") or os.getenv("SMTP_USER", "")
    msg["To"] = to
    msg["Subject"] = subject
    msg.set_content(body)
    with smtplib.SMTP(host, int(os.getenv("SMTP_PORT", "587")), timeout=15) as s:
        s.starttls()
        if os.getenv("SMTP_USER"):
            s.login(os.getenv("SMTP_USER", ""), os.getenv("SMTP_PASSWORD", ""))
        s.send_message(msg)


def send_code_mail(to: str, code: str) -> None:
    minutes = int(CODE_TTL.total_seconds() // 60)
    send_mail(
        to,
        f"[SOOKMATE] 인증 코드 {code} / Verification code {code}",
        f"SOOKMATE 인증 코드: {code}\n{minutes}분 안에 입력해 주세요. 본인이 요청하지 않았다면 이 메일을 무시해 주세요.\n\n"
        f"Your SOOKMATE verification code: {code}\nIt expires in {minutes} minutes. If you didn't request it, please ignore this email.\n",
    )


# ------------------------------------------------------------------------ 세션 토큰
def _token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def create_token(db: Session, user_id: int) -> str:
    token = secrets.token_urlsafe(32)
    now = utcnow()
    db.add(AuthToken(token_hash=_token_hash(token), user_id=user_id, created_at=now, expires_at=now + TOKEN_TTL))
    db.commit()
    return token


def user_from_token(db: Session, token: str) -> User | None:
    row = db.scalars(select(AuthToken).where(AuthToken.token_hash == _token_hash(token))).first()
    if row is None:
        return None
    if utcnow() >= row.expires_at:
        db.delete(row)
        db.commit()
        return None
    return db.get(User, row.user_id)


def revoke_token(db: Session, token: str) -> None:
    row = db.scalars(select(AuthToken).where(AuthToken.token_hash == _token_hash(token))).first()
    if row:
        db.delete(row)
        db.commit()
