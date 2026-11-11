"""가짜(시드) 프로필이 실제 로그인한 사용자와도 이어지는지: 추천 자리, 자동 수락, 자동 답장.

실제 서비스에는 가짜 사용자가 없으므로, 이 동작은 DEMO_PARTNERS=1 일 때만 켜진다(기본은 꺼짐).
"""
import pytest

from app import main as app_main
from app import matching
from app.db import Base, SessionLocal, engine
from app.models import User

ALL_TIMES = [f"{d} {s}" for d in "월화수목금" for s in ("오전", "오후", "저녁")]


@pytest.fixture(autouse=True)
def _fast_replies(monkeypatch):
    monkeypatch.setattr(app_main, "DEMO_REPLY_DELAY", 0)


def bearer(token):
    return {"Authorization": f"Bearer {token}"}


def real_user(client, mail="real@sookmyung.ac.kr", kind="international"):
    """학교 메일로 가입하고 첫 설정과 프로필까지 마친 실제 사용자(가짜가 아님)."""
    code = client.post("/api/auth/request-code", json={"email": mail, "purpose": "signup"}).json()["dev_code"]
    token = client.post("/api/auth/signup", json={"email": mail, "code": code, "password": "sookmate-pw1"}).json()["token"]
    h = bearer(token)
    assert client.put("/api/me/basic", headers=h, json={"name": "진짜", "bio": "", "kind": kind}).status_code == 200
    r = client.put(
        "/api/me/profile",
        headers=h,
        json={"interests": ["카페", "전시"], "times": ALL_TIMES, "langs": ["한국어", "English"], "teach": ["English 회화"], "learn": ["한국어 표현"], "prefs": []},
    )
    assert r.status_code == 200
    return h


def free_the_seeds(monkeypatch):
    """개발 모드가 아닌 상태처럼: 가짜 프로필은 그대로 두되 가짜끼리는 미리 이어 주지 않는다."""
    monkeypatch.setattr(matching, "FAKE_PAIRS", False)
    with SessionLocal() as db:
        app_main.reset_seed_data(db, preassign=False)


# ---------------------------------------------------------------- 추천 자리
def test_seed_profiles_do_not_fill_every_slot_before_real_users_arrive(client, monkeypatch):
    free_the_seeds(monkeypatch)
    with SessionLocal() as db:
        assert db.query(User).filter(User.is_synthetic.is_(True)).count() == 50  # 가짜 50명은 그대로 있다
    h = real_user(client)
    rows = client.get("/api/matches", headers=h).json()
    assert len(rows) == 2, "실제 사용자는 이번 주 상한(2명)까지 추천을 받아야 해요"
    with SessionLocal() as db:
        from app.models import Match

        fake_ids = {u.id for u in db.query(User).filter(User.is_synthetic.is_(True))}
        pairs = [(m.domestic_id, m.international_id) for m in db.query(Match)]
        assert pairs and all(not (d in fake_ids and i in fake_ids) for d, i in pairs), "가짜끼리 이어 두면 안 돼요"


def test_fake_pairs_stay_available_in_dev_mode(client):
    """개발 모드(기본)에서는 예전처럼 가짜끼리도 미리 이어 둔다."""
    assert matching.FAKE_PAIRS is True
    with SessionLocal() as db:
        from app.models import Match

        assert db.query(Match).count() > 0


def test_default_seed_preassigns_so_the_old_flow_still_works(client):
    """개발 모드의 기존 시연(수아 계정)은 그대로: 시드끼리 미리 맺어 둔다."""
    assert client.get("/api/matches", headers={"X-User-Id": "1"}).json()


# ----------------------------------------------------------------- 자동 수락
def test_fake_partner_accepts_back_for_a_real_user_when_demo_is_on(client, monkeypatch):
    free_the_seeds(monkeypatch)
    monkeypatch.setattr(app_main, "DEMO_PARTNERS", True)
    h = real_user(client)
    m = client.get("/api/matches", headers=h).json()[0]
    out = client.post(f"/api/matches/{m['id']}/accept", headers=h).json()
    assert out["status"] == "confirmed" and out["partner_accepted"] is True
    assert client.get("/api/chats", headers=h).json()[0]["match_id"] == m["id"]


def test_fake_partner_does_not_accept_when_demo_is_off(client, monkeypatch):
    free_the_seeds(monkeypatch)
    h = real_user(client)
    m = client.get("/api/matches", headers=h).json()[0]
    out = client.post(f"/api/matches/{m['id']}/accept", headers=h).json()
    assert out["status"] == "proposed" and out["partner_accepted"] is False


def test_fake_users_never_trigger_auto_accept(client, monkeypatch):
    """개발용으로 가짜 사용자 자신이 수락하는 경우에는 상대가 자동으로 수락하지 않는다."""
    monkeypatch.setattr(app_main, "DEMO_PARTNERS", True)
    m = client.get("/api/matches", headers={"X-User-Id": "1"}).json()[0]
    out = client.post(f"/api/matches/{m['id']}/accept", headers={"X-User-Id": "1"}).json()
    assert out["status"] == "proposed"


# ----------------------------------------------------------------- 자동 답장
def test_fake_partner_reads_and_replies_in_chat(client, monkeypatch):
    free_the_seeds(monkeypatch)
    monkeypatch.setattr(app_main, "DEMO_PARTNERS", True)
    h = real_user(client)
    m = client.get("/api/matches", headers=h).json()[0]
    client.post(f"/api/matches/{m['id']}/accept", headers=h)

    sent = client.post(f"/api/matches/{m['id']}/messages", headers=h, json={"text": "안녕하세요!"}).json()
    msgs = client.get(f"/api/matches/{m['id']}/messages", headers=h).json()
    assert [x["text"] for x in msgs][0] == "안녕하세요!"
    assert len(msgs) == 2 and msgs[1]["sender_id"] == m["partner"]["id"], "가짜 상대가 답장해야 해요"
    assert msgs[0]["read"] is True  # 내가 보낸 말을 상대가 읽었다
    room = client.get("/api/chats", headers=h).json()[0]
    assert room["unread"] == 1 and room["last_message"]["sender_id"] == m["partner"]["id"]
    assert sent["id"] == msgs[0]["id"]


def test_no_reply_when_demo_is_off(client, monkeypatch):
    free_the_seeds(monkeypatch)
    h = real_user(client)
    m = client.get("/api/matches", headers=h).json()[0]
    client.post(f"/api/matches/{m['id']}/accept", headers=h)
    # 상대가 수락하지 않았으므로 대화방은 아직 열리지 않는다
    assert client.get("/api/chats", headers=h).json() == []
