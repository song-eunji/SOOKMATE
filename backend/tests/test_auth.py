"""학교 메일 인증 로그인: 도메인 제한, 인증 코드, 세션 토큰."""
import re

import pytest

from app import auth
from app import main as app_main
from app.db import SessionLocal
from app.models import LoginCode

SCHOOL = "sua@sookmyung.ac.kr"


@pytest.fixture(autouse=True)
def _no_cooldown(monkeypatch):
    """테스트에서는 재요청 대기 시간을 없앤다. 대기 시간 자체를 시험하는 테스트는 따로 되돌린다."""
    monkeypatch.setattr(auth, "COOLDOWN_SECONDS", 0)


def request_code(client, email=SCHOOL):
    return client.post("/api/auth/request-code", json={"email": email, "purpose": "signup"})


PW = "sookmate-pw1"


def signup(client, email=SCHOOL, lang="ko", password=PW):
    code = req(client, email, "signup").json()["dev_code"]
    r = client.post("/api/auth/signup", json={"email": email, "code": code, "password": password, "lang": lang})
    assert r.status_code == 200, r.text
    return r.json()


def login(client, email=SCHOOL, lang="ko"):
    """처음이면 회원가입, 이미 가입했으면 비밀번호로 로그인한다."""
    r = client.post("/api/auth/login", json={"email": email, "password": PW})
    if r.status_code == 200:
        return r.json()
    return signup(client, email, lang)


def bearer(token):
    return {"Authorization": f"Bearer {token}"}


# ------------------------------------------------------------------ 메일 주소 제한
@pytest.mark.parametrize(
    "email",
    [
        "sua@gmail.com",
        "sua@sookmyung.ac.kr.evil.com",  # 비슷한 도메인
        "sua@evilsookmyung.ac.kr",
        "sua@mail.sookmyung.ac.kr",  # 하위 도메인
        "sua@@sookmyung.ac.kr",
        "sookmyung.ac.kr",
        "",
        "  ",
        "sua @sookmyung.ac.kr",
    ],
)
def test_only_school_mail_is_accepted(client, email):
    r = request_code(client, email)
    assert r.status_code == 422
    assert isinstance(r.json()["detail"], str)  # 화면에 그대로 보여줄 수 있는 문장


def test_school_mail_is_case_and_space_insensitive(client):
    assert request_code(client, "  SUA@SookMyung.ac.kr ").status_code == 200


def test_options_tell_the_login_domain(client):
    assert client.get("/api/options").json()["login_domain"] == "sookmyung.ac.kr"


# --------------------------------------------------------------------- 코드 확인
def test_login_creates_account_and_session(client):
    out = login(client, lang="vi")
    assert out["is_new"] is True and out["token"]
    me = client.get("/api/me", headers=bearer(out["token"])).json()
    assert me["email"] == SCHOOL and me["onboarded"] is False and me["kind"] == "" and me["ui_lang"] == "vi"

    again = login(client, lang="ja")  # 같은 메일은 같은 계정, 이미 정해 둔 화면 언어는 유지
    assert again["is_new"] is False
    me2 = client.get("/api/me", headers=bearer(again["token"])).json()
    assert me2["id"] == me["id"] and me2["ui_lang"] == "vi"


def test_wrong_code_is_rejected_and_locks_after_too_many_tries(client):
    code = request_code(client).json()["dev_code"]
    wrong = "000000" if code != "000000" else "111111"
    for _ in range(auth.MAX_ATTEMPTS):
        r = client.post("/api/auth/signup", json={"password": PW, "email": SCHOOL, "code": wrong})
        assert r.status_code == 400
    # 시도 횟수를 넘으면 맞는 코드도 쓸 수 없고, 새 코드를 받아야 한다
    r = client.post("/api/auth/signup", json={"password": PW, "email": SCHOOL, "code": code})
    assert r.status_code == 429
    fresh = request_code(client).json()["dev_code"]
    assert client.post("/api/auth/signup", json={"password": PW, "email": SCHOOL, "code": fresh}).status_code == 200


def test_code_is_single_use(client):
    code = request_code(client).json()["dev_code"]
    assert client.post("/api/auth/signup", json={"password": PW, "email": SCHOOL, "code": code}).status_code == 200
    assert client.post("/api/auth/signup", json={"password": PW, "email": SCHOOL, "code": code}).status_code == 400


def test_old_code_stops_working_when_a_new_one_is_issued(client):
    first = request_code(client).json()["dev_code"]
    second = request_code(client).json()["dev_code"]
    if first != second:  # 우연히 같으면 이 검사는 의미가 없다
        assert client.post("/api/auth/signup", json={"password": PW, "email": SCHOOL, "code": first}).status_code == 400
    assert client.post("/api/auth/signup", json={"password": PW, "email": SCHOOL, "code": second}).status_code == 200


def test_expired_code_is_rejected(client):
    code = request_code(client).json()["dev_code"]
    with SessionLocal() as db:
        row = db.query(LoginCode).order_by(LoginCode.id.desc()).first()
        row.expires_at = row.created_at  # 이미 만료
        db.commit()
    r = client.post("/api/auth/signup", json={"password": PW, "email": SCHOOL, "code": code})
    assert r.status_code == 400 and "만료" in r.json()["detail"]


def test_code_for_another_mail_does_not_work(client):
    code = request_code(client, "a@sookmyung.ac.kr").json()["dev_code"]
    assert client.post("/api/auth/signup", json={"password": PW, "email": "b@sookmyung.ac.kr", "code": code}).status_code == 400


def test_malformed_code_is_rejected(client):
    request_code(client)
    for bad in ["", "abc", "12345", "1234567", "12 345"]:
        assert client.post("/api/auth/signup", json={"password": PW, "email": SCHOOL, "code": bad}).status_code == 400


# ------------------------------------------------------------------ 요청 횟수 제한
def test_resend_cooldown(client, monkeypatch):
    monkeypatch.setattr(auth, "COOLDOWN_SECONDS", 60)
    assert request_code(client).status_code == 200
    assert request_code(client).status_code == 429
    assert request_code(client, "other@sookmyung.ac.kr").status_code == 200  # 다른 사람은 영향 없음


def test_hourly_limit(client):
    for _ in range(auth.MAX_CODES_PER_HOUR):
        assert request_code(client).status_code == 200
    assert request_code(client).status_code == 429


# ----------------------------------------------------------- 세션과 개발용 우회
def test_no_credentials_means_401_outside_dev_mode(client, monkeypatch):
    token = login(client)["token"]
    monkeypatch.setattr(app_main, "DEV_MODE", False)
    assert client.get("/api/me").status_code == 401
    assert client.get("/api/me", headers={"X-User-Id": "1"}).status_code == 401  # 개발용 헤더는 무시된다
    assert client.get("/api/me", headers=bearer(token)).status_code == 200
    assert client.get("/api/users").status_code == 404


def test_dev_header_still_works_in_dev_mode(client):
    assert client.get("/api/me", headers={"X-User-Id": "1"}).status_code == 200


def test_bad_token_is_401_even_with_dev_header(client):
    r = client.get("/api/me", headers={"Authorization": "Bearer nope", "X-User-Id": "1"})
    assert r.status_code == 401


def test_logout_ends_the_session(client):
    token = login(client)["token"]
    assert client.post("/api/auth/logout", headers=bearer(token)).status_code == 200
    assert client.get("/api/me", headers=bearer(token)).status_code == 401


def test_expired_token_is_rejected(client):
    from app.models import AuthToken

    token = login(client)["token"]
    with SessionLocal() as db:
        t = db.query(AuthToken).first()
        t.expires_at = t.created_at
        db.commit()
    assert client.get("/api/me", headers=bearer(token)).status_code == 401


def test_code_is_not_stored_in_plain_text(client):
    code = request_code(client).json()["dev_code"]
    with SessionLocal() as db:
        row = db.query(LoginCode).first()
        assert code not in (row.code_hash, row.salt)
        assert re.fullmatch(r"[0-9a-f]{64}", row.code_hash)


def test_mail_is_not_returned_dev_code_outside_dev_mode(client, monkeypatch):
    sent = {}
    monkeypatch.setattr(app_main, "DEV_MODE", False)
    monkeypatch.setattr(auth, "send_mail", lambda to, subject, body: sent.update(to=to, body=body))
    r = request_code(client)
    assert r.status_code == 200 and "dev_code" not in r.json()
    code = re.search(r"\b(\d{6})\b", sent["body"]).group(1)
    assert sent["to"] == SCHOOL
    assert client.post("/api/auth/signup", json={"password": PW, "email": SCHOOL, "code": code}).status_code == 200


def test_mail_not_configured_outside_dev_mode_is_503(client, monkeypatch):
    monkeypatch.setattr(app_main, "DEV_MODE", False)
    monkeypatch.delenv("SMTP_HOST", raising=False)
    assert request_code(client).status_code == 503


# ------------------------------------------------------------- 새 사용자의 첫 설정
def test_new_user_must_pick_student_kind_once(client):
    h = bearer(login(client)["token"])
    r = client.put("/api/me/basic", headers=h, json={"name": "새내기", "bio": ""})
    assert r.status_code == 422 and isinstance(r.json()["detail"], str)
    r = client.put("/api/me/basic", headers=h, json={"name": "새내기", "bio": "", "kind": "international"})
    assert r.status_code == 200 and r.json()["kind"] == "international" and r.json()["onboarded"] is True
    # 한 번 정한 구분은 바꿀 수 없다
    r = client.put("/api/me/basic", headers=h, json={"name": "새내기", "bio": "", "kind": "domestic"})
    assert r.status_code == 200 and r.json()["kind"] == "international"
    assert client.put("/api/me/basic", headers=h, json={"name": "x", "bio": "", "kind": "alien"}).status_code == 422


def test_account_without_kind_is_not_matched_and_does_not_break_matching(client):
    token = login(client)["token"]
    assert client.post("/api/recommendations/refresh", headers=bearer(token)).status_code == 200
    assert client.get("/api/matches", headers=bearer(token)).json() == []


def test_other_people_never_see_the_email(client):
    token = login(client)["token"]
    client.put("/api/me/basic", headers=bearer(token), json={"name": "새내기", "bio": "", "kind": "domestic"})
    for uid in (27, 28):
        for m in client.get("/api/matches", headers={"X-User-Id": str(uid)}).json():
            assert "email" not in m["partner"]


# ---------------------------------------------------------------- 대화방 웹소켓
def test_websocket_accepts_token_and_rejects_bad_token(client):
    h1 = {"X-User-Id": "1"}
    m = client.get("/api/matches", headers=h1).json()[0]
    client.post(f"/api/matches/{m['id']}/accept", headers=h1)
    client.post(f"/api/dev/matches/{m['id']}/partner-accept", headers=h1)

    from starlette.websockets import WebSocketDisconnect

    with pytest.raises(WebSocketDisconnect):
        with client.websocket_connect(f"/ws/matches/{m['id']}?token=bad"):
            pass
    with pytest.raises(WebSocketDisconnect):  # 개발 모드가 꺼지면 user_id 만으로는 들어갈 수 없다
        import app.main as mod

        old, mod.DEV_MODE = mod.DEV_MODE, False
        try:
            with client.websocket_connect(f"/ws/matches/{m['id']}?user_id=1"):
                pass
        finally:
            mod.DEV_MODE = old


# ------------------------------------------------- 가입(코드 한 번 + 비밀번호)과 로그인
def req(client, email, purpose):
    return client.post("/api/auth/request-code", json={"email": email, "purpose": purpose})


def test_signup_then_login_with_password_only(client):
    mail = "flow@sookmyung.ac.kr"
    out = signup(client, mail, lang="en")
    assert out["is_new"] is True
    # 같은 메일로 다시 가입하려고 하면 로그인하라고 안내한다
    r = req(client, mail, "signup")
    assert r.status_code == 409 and "로그인" in r.json()["detail"]
    # 로그인은 코드 없이 메일과 비밀번호만으로 된다
    again = client.post("/api/auth/login", json={"email": mail, "password": PW}).json()
    assert again["is_new"] is False
    me = client.get("/api/me", headers=bearer(again["token"])).json()
    assert me["email"] == mail and me["ui_lang"] == "en"


def test_login_no_longer_uses_codes(client):
    assert req(client, "x@sookmyung.ac.kr", "login").status_code == 422


def test_signup_is_still_limited_to_school_mail(client):
    for purpose in ("signup", "reset"):
        r = req(client, "someone@gmail.com", purpose)
        assert r.status_code == 422 and "숙명여자대학교" in r.json()["detail"]
    r = client.post("/api/auth/login", json={"email": "someone@gmail.com", "password": PW})
    assert r.status_code == 422 and "숙명여자대학교" in r.json()["detail"]


def test_purpose_must_be_known(client):
    assert req(client, "ok@sookmyung.ac.kr", "visit").status_code == 422
