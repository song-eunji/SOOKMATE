"""화면 흐름 그대로 API를 호출해 보는 테스트."""


def h(uid):
    return {"X-User-Id": str(uid)}


def first_proposal(client, uid=1):
    rows = client.get("/api/matches", headers=h(uid)).json()
    assert rows, "추천이 없어요"
    return rows[0]


def confirm(client, uid=1):
    m = first_proposal(client, uid)
    assert client.post(f"/api/matches/{m['id']}/accept", headers=h(uid)).status_code == 200
    assert client.post(f"/api/dev/matches/{m['id']}/partner-accept", headers=h(uid)).status_code == 200
    return m


def test_options_and_me(client):
    o = client.get("/api/options").json()
    assert len(o["time_slots"]) == 65 and abs(sum(o["weights"].values()) - 1) < 1e-9
    me = client.get("/api/me", headers=h(1)).json()
    assert me["name"] == "수아" and me["weekly_cap"] == 2 and me["used_this_week"] <= 2


def test_profile_validation(client):
    # 시간·언어는 정해진 값만, 관심사·주제는 직접 입력도 받는다 (공백 정리, 중복 제거, 길이·개수 제한)
    assert client.put("/api/me/profile", headers=h(1), json={"times": ["없는 시간"]}).status_code == 422
    assert client.put("/api/me/profile", headers=h(1), json={"langs": ["Klingon"]}).status_code == 422
    assert client.put("/api/me/profile", headers=h(1), json={"interests": ["가" * 31]}).status_code == 422
    assert client.put("/api/me/profile", headers=h(1), json={"teach": [f"주제{i}" for i in range(11)]}).status_code == 422
    r = client.put(
        "/api/me/profile",
        headers=h(1),
        json={"interests": [" 뜨개질 ", "뜨개질", "", "카페"], "teach": ["한복 입는 법"], "learn": ["일본 라멘 이야기"]},
    )
    assert r.status_code == 200
    assert r.json()["interests"] == ["뜨개질", "카페"] and r.json()["teach"] == ["한복 입는 법"]
    r = client.put(
        "/api/me/profile",
        headers=h(1),
        json={"interests": ["카페"], "times": ["수 오후"], "langs": ["한국어"], "teach": ["캠퍼스 생활 팁"], "learn": ["일본 문화"]},
    )
    assert r.status_code == 200 and r.json()["interests"] == ["카페"]


def test_recommendation_has_reason_and_scores(client):
    m = first_proposal(client)
    assert set(m["score"]) == {"I", "T", "L", "R", "total"}
    assert m["explain"]["reason"]
    assert m["status"] == "proposed" and not m["my_accepted"]
    assert "prefs" not in m["partner"]  # 공개 선호는 확정 전에는 내려가지 않는다


def test_accept_flow_and_waiting_state(client):
    m = first_proposal(client)
    r = client.post(f"/api/matches/{m['id']}/accept", headers=h(1)).json()
    assert r["my_accepted"] and not r["partner_accepted"] and r["status"] == "proposed"
    client.post(f"/api/dev/matches/{m['id']}/partner-accept", headers=h(1))
    rows = client.get("/api/matches", headers=h(1)).json()
    assert next(x for x in rows if x["id"] == m["id"])["status"] == "confirmed"


def test_reject_gives_new_recommendation_set(client):
    m = first_proposal(client)
    assert client.post(f"/api/matches/{m['id']}/reject", headers=h(1)).status_code == 200
    ids = [x["id"] for x in client.get("/api/matches", headers=h(1)).json()]
    assert m["id"] not in ids


def test_chat_requires_confirmed_and_websocket_works(client):
    m = first_proposal(client)
    assert client.get(f"/api/matches/{m['id']}/messages", headers=h(1)).status_code == 403
    client.post(f"/api/matches/{m['id']}/accept", headers=h(1))
    client.post(f"/api/dev/matches/{m['id']}/partner-accept", headers=h(1))
    partner = m["partner"]["id"]
    with client.websocket_connect(f"/ws/matches/{m['id']}?user_id=1") as ws1, client.websocket_connect(
        f"/ws/matches/{m['id']}?user_id={partner}"
    ) as ws2:
        ws1.send_json({"text": "안녕하세요"})
        assert ws1.receive_json()["text"] == "안녕하세요"
        assert ws2.receive_json()["sender_id"] == 1
    msgs = client.get(f"/api/matches/{m['id']}/messages", headers=h(partner)).json()
    assert [x["text"] for x in msgs] == ["안녕하세요"]


def test_websocket_rejects_outsider(client):
    m = confirm(client)
    outsider = next(u["id"] for u in client.get("/api/users").json() if u["id"] not in (1, m["partner"]["id"]))
    try:
        with client.websocket_connect(f"/ws/matches/{m['id']}?user_id={outsider}"):
            assert False, "외부인이 연결됨"
    except Exception:
        pass


def test_brief_has_sources_and_partner_prefs(client):
    m = confirm(client)
    b = client.get(f"/api/matches/{m['id']}/brief", headers=h(1)).json()
    assert b["mode"] == "fallback" and b["questions"]
    assert all(t["source"] and t["source_id"] for t in b["tips"])
    # 개인 선호는 상대가 입력한 값 그대로
    partner = client.get("/api/me", headers=h(m["partner"]["id"])).json()
    assert b["prefs"] == partner["prefs"]


def test_activity_card_fallback(client):
    m = confirm(client)
    c = client.get(f"/api/matches/{m['id']}/activity-card", headers=h(1)).json()
    assert c["mine"]["minutes"] == 10 and c["theirs"]["minutes"] == 10 and c["mode"] == "fallback"


def test_notes_share_only_selected_items(client):
    m = confirm(client)
    pid = m["partner"]["id"]
    client.put(
        f"/api/matches/{m['id']}/notes",
        headers=h(1),
        json={"expr": "A", "fact": "B", "next_text": "도서관 이용법", "share_expr": True, "share_fact": False, "share_next": True},
    )
    seen = client.get(f"/api/matches/{m['id']}/notes", headers=h(pid)).json()
    assert seen["partner_shared"] == {"expr": "A", "fact": None, "next_text": "도서관 이용법"}
    assert seen["mine"] is None  # 상대 노트의 비공개 항목은 어디에도 내려가지 않는다
    nxt = client.get(f"/api/matches/{m['id']}/next-activity", headers=h(pid)).json()
    assert nxt["title"] == "도서관 이용법" and nxt["basis"] == "shared_notes"
    # 삭제하면 사라진다
    client.delete(f"/api/matches/{m['id']}/notes", headers=h(1))
    assert client.get(f"/api/matches/{m['id']}/notes", headers=h(pid)).json()["partner_shared"] is None


def test_block_and_report(client):
    m = confirm(client)
    pid = m["partner"]["id"]
    assert client.post("/api/reports", headers=h(1), json={"user_id": pid, "match_id": m["id"], "reason": "테스트"}).status_code == 200
    assert client.post("/api/blocks", headers=h(1), json={"user_id": pid}).status_code == 200
    rows = client.get("/api/matches", headers=h(1)).json()
    assert all(x["partner"]["id"] != pid for x in rows)


def test_other_users_match_is_hidden(client):
    m = first_proposal(client)
    outsider = next(u["id"] for u in client.get("/api/users").json() if u["id"] not in (1, m["partner"]["id"]))
    assert client.post(f"/api/matches/{m['id']}/accept", headers=h(outsider)).status_code in (403, 404)
    assert client.get(f"/api/matches/{m['id']}/brief", headers=h(outsider)).status_code == 404


def test_basic_info_validation_and_visibility(client):
    me = client.get("/api/me", headers=h(1)).json()
    assert me["onboarded"] is True  # 가짜 프로필은 기본 정보까지 채워져 있다
    ok = {"name": " 수아수아 ", "bio": "카페에서 수다 떨기 좋아해요"}

    assert client.put("/api/me/basic", headers=h(1), json={**ok, "name": "  "}).status_code == 422
    assert client.put("/api/me/basic", headers=h(1), json={**ok, "name": "가" * 13}).status_code == 422
    assert client.put("/api/me/basic", headers=h(1), json={**ok, "bio": "가" * 41}).status_code == 422
    assert client.put("/api/me/basic", headers=h(1), json={**ok, "name": "하루카"}).status_code == 409  # 다른 사용자와 중복

    r = client.put("/api/me/basic", headers=h(1), json=ok)
    assert r.status_code == 200
    body = r.json()
    assert body["name"] == "수아수아" and body["bio"] == ok["bio"] and body["onboarded"] is True
    assert "avatar" not in body  # 사진·이모지 아바타 없이 이름 첫 글자로 보여준다
    # 내 이름으로 다시 저장해도 중복이 아니다
    assert client.put("/api/me/basic", headers=h(1), json={**ok, "bio": ""}).status_code == 200

    # 상대에게는 닉네임·아바타·소개만 보이고 이메일·국적은 안 보인다
    partner_view = client.get("/api/matches", headers=h(17)).json()
    mine = [m["partner"] for m in partner_view if m["partner"]["id"] == 1]
    for p in mine:
        assert p["name"] == "수아수아" and p["bio"] == ""
        assert "email" not in p and "nationality" not in p and "prefs" not in p


def test_chat_list_unread_and_read_receipts(client):
    assert client.get("/api/chats", headers=h(1)).json() == []  # 수락 전에는 대화방이 없다
    m = confirm(client)
    mid, partner = m["id"], m["partner"]["id"]

    rooms = client.get("/api/chats", headers=h(1)).json()
    assert len(rooms) == 1 and rooms[0]["match_id"] == mid and rooms[0]["last_message"] is None and rooms[0]["unread"] == 0
    assert rooms[0]["partner"]["id"] == partner and "email" not in rooms[0]["partner"]

    client.post(f"/api/matches/{mid}/messages", headers=h(partner), json={"text": "안녕하세요"})
    client.post(f"/api/matches/{mid}/messages", headers=h(partner), json={"text": "수요일 어때요?"})
    room = client.get("/api/chats", headers=h(1)).json()[0]
    assert room["unread"] == 2 and room["last_message"]["text"] == "수요일 어때요?"
    assert client.get("/api/chats", headers=h(partner)).json()[0]["unread"] == 0  # 보낸 사람 쪽은 안 읽음이 아니다

    # 내가 보낸 메시지는 상대가 읽기 전까지 '안 읽음'
    sent = client.post(f"/api/matches/{mid}/messages", headers=h(1), json={"text": "좋아요"}).json()
    assert sent["read"] is False
    assert client.post(f"/api/matches/{mid}/read", headers=h(partner)).status_code == 200
    msgs = client.get(f"/api/matches/{mid}/messages", headers=h(1)).json()
    assert [x["read"] for x in msgs if x["sender_id"] == 1] == [True]

    # 내가 읽으면 안 읽음이 0이 된다
    assert client.post(f"/api/matches/{mid}/read", headers=h(1)).status_code == 200
    assert client.get("/api/chats", headers=h(1)).json()[0]["unread"] == 0

    # 상대 사용자나 수락 전 만남은 읽음 처리할 수 없다
    assert client.post(f"/api/matches/{mid}/read", headers=h(5)).status_code == 404


def test_dev_partner_message_shows_up_as_unread(client):
    m = confirm(client)
    r = client.post(f"/api/dev/matches/{m['id']}/partner-message", headers=h(1))
    assert r.status_code == 200
    room = client.get("/api/chats", headers=h(1)).json()[0]
    assert room["unread"] == 1 and room["last_message"]["sender_id"] == m["partner"]["id"]


def test_ui_language_is_saved_per_user(client):
    o = client.get("/api/options").json()
    assert [c for c, _ in o["ui_langs"]] == ["ko", "en", "ja", "zh", "vi"]
    assert client.get("/api/me", headers=h(1)).json()["ui_lang"] == "ko"
    assert client.put("/api/me/language", headers=h(1), json={"lang": "fr"}).status_code == 422
    r = client.put("/api/me/language", headers=h(1), json={"lang": "ja"})
    assert r.status_code == 200 and r.json()["ui_lang"] == "ja"
    assert client.get("/api/me", headers=h(1)).json()["ui_lang"] == "ja"
    assert client.get("/api/me", headers=h(2)).json()["ui_lang"] == "ko"  # 다른 사용자는 그대로
    # 일본 유학생 시드는 일본어 화면으로 시작한다
    assert client.get("/api/me", headers=h(17)).json()["ui_lang"] == "ja"
