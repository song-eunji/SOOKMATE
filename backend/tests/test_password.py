"""비밀번호: 가입할 때 메일 코드를 한 번 확인하고 비밀번호를 정한다. 그 뒤로는 메일(아이디)과 비밀번호로 로그인한다."""
import re

import pytest
from sqlalchemy import select

from app import auth
from app import main as app_main
from app.db import SessionLocal
from app.models import AuthToken, User

MAIL = "pw@sookmyung.ac.kr"
PW = "sookmate-pw1"


@pytest.fixture(autouse=True)
def _no_cooldown(monkeypatch):
    monkeypatch.setattr(auth, "COOLDOWN_SECONDS", 0)


def code_for(client, purpose, mail=MAIL):
    r = client.post("/api/auth/request-code", json={"email": mail, "purpose": purpose})
    assert r.status_code == 200, r.text
    return r.json()["dev_code"]


def signup(client, mail=MAIL, password=PW, **kw):
    return client.post("/api/auth/signup", json={"email": mail, "code": code_for(client, "signup", mail), "password": password, **kw})


def login(client, mail=MAIL, password=PW):
    return client.post("/api/auth/login", json={"email": mail, "password": password})


def bearer(token):
    return {"Authorization": f"Bearer {token}"}


def row(mail=MAIL):
    with SessionLocal() as db:
        return db.scalars(select(User).where(User.email == mail)).first()


# ------------------------------------------------------------------ 가입
def test_signup_needs_a_valid_code_and_creates_an_account_with_a_session(client):
    r = signup(client)
    assert r.status_code == 200 and r.json()["is_new"] is True
    assert client.get("/api/me", headers=bearer(r.json()["token"])).json()["email"] == MAIL


def test_signup_without_the_right_code_creates_nothing(client):
    code_for(client, "signup")
    r = client.post("/api/auth/signup", json={"email": MAIL, "code": "000000", "password": PW})
    assert r.status_code == 400 and row() is None


def test_signup_is_refused_for_an_existing_account(client):
    signup(client)
    code = auth_code_directly(client)
    r = client.post("/api/auth/signup", json={"email": MAIL, "code": code, "password": "another-pw99"})
    assert r.status_code == 409
    assert login(client).status_code == 200  # 원래 비밀번호는 그대로


def auth_code_directly(client):
    """가입된 메일은 가입용 코드를 받을 수 없으므로, 재설정용 코드를 받아 가입에 써 본다."""
    return code_for(client, "reset")


@pytest.mark.parametrize("pw", ["short1a", "onlyletters", "12345678", "a1" * 40, "", "        "])
def test_weak_or_odd_passwords_are_rejected(client, pw):
    r = signup(client, password=pw)
    assert r.status_code == 422 and isinstance(r.json()["detail"], str)
    assert row() is None


def test_password_cannot_be_the_mail_id(client):
    assert signup(client, password="pw@sookmyung.ac.kr").status_code == 422
    assert row() is None


def test_password_is_never_stored_or_returned_in_plain_text(client):
    out = signup(client).json()
    u = row()
    assert PW not in (u.password_hash or "") and re.match(r"^scrypt\$[0-9a-f]+\$[0-9a-f]+$", u.password_hash)
    assert PW not in str(out) and "password" not in client.get("/api/me", headers=bearer(out["token"])).text.lower()


def test_same_password_gets_different_hashes(client):
    signup(client, "a@sookmyung.ac.kr")
    signup(client, "b@sookmyung.ac.kr")
    assert row("a@sookmyung.ac.kr").password_hash != row("b@sookmyung.ac.kr").password_hash


# ------------------------------------------------------------------ 로그인
def test_login_works_with_mail_and_password_and_is_case_insensitive_on_mail(client):
    signup(client)
    r = login(client, "  PW@SookMyung.ac.kr ")
    assert r.status_code == 200 and r.json()["is_new"] is False


def test_wrong_password_and_unknown_mail_look_the_same(client):
    signup(client)
    a = login(client, MAIL, "wrong-pw-123")
    b = login(client, "nobody@sookmyung.ac.kr", PW)
    assert a.status_code == b.status_code == 401
    assert a.json()["detail"] == b.json()["detail"] and "맞지 않" in a.json()["detail"]


def test_login_does_not_need_or_use_a_code(client):
    signup(client)
    assert login(client).status_code == 200  # 코드를 따로 받지 않았다


def test_accounts_stay_separate(client):
    signup(client, "a@sookmyung.ac.kr")
    signup(client, "b@sookmyung.ac.kr", password="other-pw-456")
    assert login(client, "a@sookmyung.ac.kr", "other-pw-456").status_code == 401


def test_too_many_wrong_passwords_lock_the_account_for_a_while(client, monkeypatch):
    signup(client)
    for _ in range(auth.MAX_PASSWORD_FAILS):
        assert login(client, MAIL, "wrong-pw-123").status_code == 401
    r = login(client)  # 맞는 비밀번호도 잠겨 있는 동안은 안 된다
    assert r.status_code == 429 and "잠시" in r.json()["detail"]
    with SessionLocal() as db:  # 잠금 시간이 지나면 풀린다
        u = db.scalars(select(User).where(User.email == MAIL)).first()
        u.locked_until = u.locked_until.replace(year=2000)
        db.commit()
    assert login(client).status_code == 200
    assert row().login_fails == 0  # 성공하면 실패 횟수는 지워진다


def test_a_few_failures_followed_by_success_do_not_lock(client):
    signup(client)
    for _ in range(auth.MAX_PASSWORD_FAILS - 1):
        login(client, MAIL, "wrong-pw-123")
    assert login(client).status_code == 200
    for _ in range(auth.MAX_PASSWORD_FAILS - 1):
        assert login(client, MAIL, "wrong-pw-123").status_code == 401


def test_fake_profiles_cannot_log_in_with_a_password(client):
    r = login(client, "demo1@example.com", PW)
    assert r.status_code == 422  # 숙명 메일이 아니다


def test_old_account_without_a_password_is_told_to_set_one(client):
    with SessionLocal() as db:
        db.add(User(name="옛", email="old@sookmyung.ac.kr", kind="domestic", onboarded=True, is_synthetic=False))
        db.commit()
    r = login(client, "old@sookmyung.ac.kr", PW)
    assert r.status_code == 409 and "비밀번호" in r.json()["detail"]


# ------------------------------------------------------- 비밀번호 찾기·처음 설정
def test_reset_needs_a_registered_mail(client):
    r = client.post("/api/auth/request-code", json={"email": "ghost@sookmyung.ac.kr", "purpose": "reset"})
    assert r.status_code == 404 and "회원가입" in r.json()["detail"]


def test_reset_sets_a_new_password_and_signs_everyone_else_out(client):
    old_token = signup(client).json()["token"]
    r = client.post("/api/auth/reset-password", json={"email": MAIL, "code": code_for(client, "reset"), "password": "brand-new-pw9"})
    assert r.status_code == 200
    assert login(client, MAIL, PW).status_code == 401
    assert login(client, MAIL, "brand-new-pw9").status_code == 200
    assert client.get("/api/me", headers=bearer(old_token)).status_code == 401  # 이전 세션은 끊긴다
    assert client.get("/api/me", headers=bearer(r.json()["token"])).status_code == 200  # 지금 세션은 유효


def test_reset_with_a_wrong_code_changes_nothing(client):
    signup(client)
    code_for(client, "reset")
    r = client.post("/api/auth/reset-password", json={"email": MAIL, "code": "000000", "password": "brand-new-pw9"})
    assert r.status_code == 400 and login(client).status_code == 200


def test_reset_also_clears_a_lock(client):
    signup(client)
    for _ in range(auth.MAX_PASSWORD_FAILS):
        login(client, MAIL, "wrong-pw-123")
    assert login(client).status_code == 429
    client.post("/api/auth/reset-password", json={"email": MAIL, "code": code_for(client, "reset"), "password": "brand-new-pw9"})
    assert login(client, MAIL, "brand-new-pw9").status_code == 200


def test_old_account_can_set_its_first_password_with_a_code(client):
    with SessionLocal() as db:
        db.add(User(name="옛", email="old@sookmyung.ac.kr", kind="domestic", onboarded=True, is_synthetic=False))
        db.commit()
    code = code_for(client, "reset", "old@sookmyung.ac.kr")
    r = client.post("/api/auth/reset-password", json={"email": "old@sookmyung.ac.kr", "code": code, "password": PW})
    assert r.status_code == 200
    assert login(client, "old@sookmyung.ac.kr").status_code == 200


def test_reset_for_a_fake_profile_is_impossible(client):
    r = client.post("/api/auth/request-code", json={"email": "demo1@example.com", "purpose": "reset"})
    assert r.status_code == 422


# ------------------------------------------------------------------ 운영 설정
def test_dev_code_is_hidden_and_mail_is_sent_outside_dev_mode(client, monkeypatch):
    sent = {}
    monkeypatch.setattr(app_main, "DEV_MODE", False)
    monkeypatch.setattr(auth, "send_mail", lambda to, subject, body: sent.update(to=to, body=body))
    r = client.post("/api/auth/request-code", json={"email": MAIL, "purpose": "signup"})
    assert "dev_code" not in r.json()
    code = re.search(r"\b(\d{6})\b", sent["body"]).group(1)
    assert client.post("/api/auth/signup", json={"email": MAIL, "code": code, "password": PW}).status_code == 200
    assert login(client).status_code == 200


def test_sessions_from_password_login_last_a_month(client):
    signup(client)
    token = login(client).json()["token"]
    with SessionLocal() as db:
        t = db.scalars(select(AuthToken).order_by(AuthToken.id.desc())).first()
    assert (t.expires_at - t.created_at).days >= 29
    assert client.get("/api/me", headers=bearer(token)).status_code == 200
