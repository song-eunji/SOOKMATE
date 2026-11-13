"""학교 메일 인증 로그인.

가입할 때 학교 메일로 보낸 6자리 코드를 한 번 확인하고 비밀번호를 정한다. 그 뒤로는 메일(아이디)과 비밀번호로 로그인한다.
- 비밀번호는 scrypt 로 해시해서만 저장하고, 연속으로 틀리면 잠깐 잠근다. 잊었거나 처음 정하는 옛 계정은 메일 코드로 다시 정한다.
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

import httpx
from sqlalchemy import delete, func, select
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
MAX_PASSWORD_FAILS = 5  # 연속으로 이만큼 틀리면 잠깐 잠근다
LOCK_MINUTES = 10
PASSWORD_MIN, PASSWORD_MAX = 8, 64

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
def _send_via_brevo(api_key: str, sender: str, to: str, subject: str, body: str) -> None:
    """Brevo 메일 API(HTTPS)로 보낸다. 무료 호스팅이 SMTP 포트를 막아도 443 포트로 나가서 막히지 않는다."""
    if not sender:
        raise MailNotConfigured()
    r = httpx.post(
        "https://api.brevo.com/v3/smtp/email",
        headers={"api-key": api_key, "accept": "application/json", "content-type": "application/json"},
        json={"sender": {"name": os.getenv("MAIL_FROM_NAME", "SOOKMATE"), "email": sender}, "to": [{"email": to}],
              "subject": subject, "textContent": body},
        timeout=15,
    )
    if r.status_code >= 400:  # 원인을 로그에서 바로 알 수 있게 응답 내용을 남긴다(키는 넣지 않는다)
        raise RuntimeError(f"Brevo 메일 API 오류 {r.status_code}: {r.text[:300]}")


def send_mail(to: str, subject: str, body: str) -> None:
    api_key = os.getenv("BREVO_API_KEY")
    if api_key:  # API 키가 있으면 SMTP 대신 HTTPS 로 보낸다
        _send_via_brevo(api_key, os.getenv("MAIL_FROM") or os.getenv("SMTP_USER", ""), to, subject, body)
        return
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


# ------------------------------------------------------------------------ 비밀번호
_SCRYPT = dict(n=2**14, r=8, p=1, maxmem=64 * 1024 * 1024, dklen=32)


def check_password_rules(password: str, email: str) -> None:
    if not (PASSWORD_MIN <= len(password or "") <= PASSWORD_MAX):
        raise AuthError(f"비밀번호는 {PASSWORD_MIN}자 이상 {PASSWORD_MAX}자 이하로 정해 주세요.", 422)
    if not (re.search(r"[A-Za-z]", password) and re.search(r"\d", password)):
        raise AuthError("비밀번호에는 영문과 숫자가 모두 들어가야 해요.", 422)
    if password.strip().lower() == email or password.strip().lower() == email.split("@")[0]:
        raise AuthError("메일 아이디와 같은 비밀번호는 쓸 수 없어요.", 422)


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.scrypt(password.encode(), salt=salt, **_SCRYPT)
    return f"scrypt${salt.hex()}${digest.hex()}"


_DUMMY = hash_password("dummy-password-1")  # 없는 메일일 때도 같은 시간이 걸리게 하려는 값


def verify_password(password: str, stored: str | None) -> bool:
    try:
        _, salt, digest = (stored or _DUMMY).split("$")
        got = hashlib.scrypt((password or "").encode(), salt=bytes.fromhex(salt), **_SCRYPT)
        return hmac.compare_digest(got, bytes.fromhex(digest)) and stored is not None
    except (ValueError, TypeError):
        return False


def login_with_password(db: Session, email: str, password: str) -> User:
    """메일(아이디)과 비밀번호를 확인한다. 연속으로 틀리면 잠깐 잠그고, 없는 메일과 틀린 비밀번호는 같은 말로 알려 준다."""
    user = db.scalars(select(User).where(func.lower(User.email) == email, User.is_synthetic.is_(False))).first()
    now = utcnow()
    if user and user.locked_until and now < user.locked_until:
        raise AuthError("비밀번호를 여러 번 틀렸어요. 잠시 후 다시 시도해 주세요.", 429)
    if user and user.password_hash is None:
        raise AuthError("아직 비밀번호가 없는 계정이에요. '비밀번호 찾기'로 먼저 설정해 주세요.", 409)
    ok = verify_password(password, user.password_hash if user else None)
    if not ok:
        if user:
            user.login_fails = (user.login_fails or 0) + 1
            if user.login_fails >= MAX_PASSWORD_FAILS:
                user.locked_until = now + timedelta(minutes=LOCK_MINUTES)
                user.login_fails = 0
            db.commit()
        raise AuthError("메일 또는 비밀번호가 맞지 않아요.", 401)
    user.login_fails, user.locked_until = 0, None
    db.commit()
    return user


def set_password(db: Session, user: User, password: str) -> None:
    check_password_rules(password, user.email)
    user.password_hash = hash_password(password)
    user.login_fails, user.locked_until = 0, None
    db.commit()


def revoke_all_tokens(db: Session, user_id: int) -> None:
    db.execute(delete(AuthToken).where(AuthToken.user_id == user_id))
    db.commit()


# ------------------------------------------------------------------------ 세션 토큰
def _token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


DEV_TOKEN_TTL = timedelta(hours=12)  # 개발자 입장으로 받은 세션은 짧게


def create_token(db: Session, user_id: int, ttl: timedelta | None = None) -> str:
    token = secrets.token_urlsafe(32)
    now = utcnow()
    db.add(AuthToken(token_hash=_token_hash(token), user_id=user_id, created_at=now, expires_at=now + (ttl or TOKEN_TTL)))
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


def has_active_session(db: Session, user_id: int) -> bool:
    """지금 누군가 이 계정으로 로그인해 있는지(만료되지 않은 세션이 있는지)."""
    return db.scalars(select(AuthToken.id).where(AuthToken.user_id == user_id, AuthToken.expires_at > utcnow())).first() is not None


def revoke_token(db: Session, token: str) -> None:
    row = db.scalars(select(AuthToken).where(AuthToken.token_hash == _token_hash(token))).first()
    if row:
        db.delete(row)
        db.commit()
