"""개발자 입장: 이메일 없이 가짜 프로필 계정으로 들어간다. 스위치(DEV_LOGIN)가 켜졌을 때만, 가짜 계정으로만."""
import pytest
from sqlalchemy import select

from app import main as app_main
from app import matching
from app.db import SessionLocal
from app.models import AuthToken, User


def bearer(token):
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture()
def dev_login_on(monkeypatch):
    monkeypatch.setattr(app_main, "DEV_LOGIN", True)


def fake_ids(kind=None):
    with SessionLocal() as db:
        q = select(User).where(User.is_synthetic.is_(True))
        if kind:
            q = q.where(User.kind == kind)
        return [u.id for u in db.scalars(q.order_by(User.id))]


def test_switch_is_off_by_default_and_options_say_so(client):
    assert client.get("/api/options").json()["dev_login"] is False
    assert client.get("/api/auth/dev-users").status_code == 404
    assert client.post("/api/auth/dev-login", json={"user_id": 1}).status_code == 404


def test_options_tell_the_page_when_it_is_on(client, dev_login_on):
    assert client.get("/api/options").json()["dev_login"] is True


def test_dev_users_lists_only_fake_profiles(client, dev_login_on):
    client.post("/api/auth/request-code", json={"email": "real@sookmyung.ac.kr"})
    rows = client.get("/api/auth/dev-users").json()
    assert {r["id"] for r in rows} == set(fake_ids())
    assert all(set(r) == {"id", "name", "kind", "dept", "nationality", "bio"} for r in rows)
    assert "email" not in rows[0]


def test_dev_login_gives_a_working_session_as_that_fake_user(client, dev_login_on):
    uid = fake_ids("international")[0]
    out = client.post("/api/auth/dev-login", json={"user_id": uid}).json()
    me = client.get("/api/me", headers=bearer(out["token"])).json()
    assert me["id"] == uid and me["onboarded"] is True


def test_dev_login_never_works_for_real_accounts(client, dev_login_on):
    code = client.post("/api/auth/request-code", json={"email": "real@sookmyung.ac.kr", "purpose": "signup"}).json()["dev_code"]
    client.post("/api/auth/signup", json={"email": "real@sookmyung.ac.kr", "code": code, "password": "sookmate-pw1"})
    with SessionLocal() as db:
        real = db.scalars(select(User).where(User.is_synthetic.is_(False))).first()
    assert client.post("/api/auth/dev-login", json={"user_id": real.id}).status_code == 403
    assert client.post("/api/auth/dev-login", json={"user_id": 999999}).status_code == 404


def test_dev_login_works_even_when_dev_mode_is_off(client, dev_login_on, monkeypatch):
    uid = fake_ids("international")[0]
    monkeypatch.setattr(app_main, "DEV_MODE", False)
    out = client.post("/api/auth/dev-login", json={"user_id": uid})
    assert out.status_code == 200
    assert client.get("/api/me", headers=bearer(out.json()["token"])).status_code == 200
    assert client.get("/api/me", headers={"X-User-Id": str(uid)}).status_code == 401  # 헤더 우회는 여전히 막힘


def test_dev_login_session_is_short(client, dev_login_on):
    uid = fake_ids()[0]
    client.post("/api/auth/dev-login", json={"user_id": uid})
    with SessionLocal() as db:
        t = db.scalars(select(AuthToken).where(AuthToken.user_id == uid)).first()
    assert (t.expires_at - t.created_at).total_seconds() <= 12 * 3600


# ----------------------- 사람이 가짜 계정을 맡으면 자동 수락·자동 답장은 쉰다
def test_fake_partner_controlled_by_a_teammate_is_not_automated(client, dev_login_on, monkeypatch):
    monkeypatch.setattr(app_main, "DEMO_PARTNERS", True)
    monkeypatch.setattr(app_main, "DEMO_REPLY_DELAY", 0)
    monkeypatch.setattr(matching, "FAKE_PAIRS", False)
    from app.db import Base, engine

    with SessionLocal() as db:
        app_main.reset_seed_data(db, preassign=False)

    def login(mail):
        code = client.post("/api/auth/request-code", json={"email": mail, "purpose": "signup"}).json()["dev_code"]
        return bearer(client.post("/api/auth/signup", json={"email": mail, "code": code, "password": "sookmate-pw1"}).json()["token"])

    a = login("a@sookmyung.ac.kr")
    client.put("/api/me/basic", headers=a, json={"name": "에이", "bio": "", "kind": "domestic"})
    client.put("/api/me/profile", headers=a, json={"interests": ["카페"], "times": [f"{d} {s}" for d in "월화수목금" for s in ("오전", "오후", "저녁")],
                                                   "langs": ["한국어", "English"], "teach": [], "learn": [], "prefs": []})
    m = client.get("/api/matches", headers=a).json()[0]
    partner = m["partner"]["id"]

    # 팀원이 그 가짜 유학생 계정으로 들어온다 → 사람이 맡았으니 자동 수락은 하지 않는다
    b = bearer(client.post("/api/auth/dev-login", json={"user_id": partner}).json()["token"])
    out = client.post(f"/api/matches/{m['id']}/accept", headers=a).json()
    assert out["status"] == "proposed" and out["my_accepted"] is True and out["partner_accepted"] is False

    # 팀원이 직접 수락하면 대화방이 열린다
    mine = [x for x in client.get("/api/matches", headers=b).json() if x["id"] == m["id"]][0]
    assert mine["partner_accepted"] is True
    assert client.post(f"/api/matches/{m['id']}/accept", headers=b).json()["status"] == "confirmed"

    # 대화: 가짜 자동 답장은 없고, 팀원이 쓴 말만 오간다
    client.post(f"/api/matches/{m['id']}/messages", headers=a, json={"text": "안녕하세요!"})
    assert len(client.get(f"/api/matches/{m['id']}/messages", headers=a).json()) == 1
    client.post(f"/api/matches/{m['id']}/messages", headers=b, json={"text": "Hi!"})
    texts = [x["text"] for x in client.get(f"/api/matches/{m['id']}/messages", headers=a).json()]
    assert texts == ["안녕하세요!", "Hi!"]

    # 팀원이 로그아웃하면 다시 자동으로 돌아간다
    client.post("/api/auth/logout", headers=b)
    client.post(f"/api/matches/{m['id']}/messages", headers=a, json={"text": "다음에 또 봐요"})
    assert len(client.get(f"/api/matches/{m['id']}/messages", headers=a).json()) == 4  # 내 말 + 자동 답장이 더해진다
