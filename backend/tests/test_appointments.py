import pytest
from sqlalchemy import select
from app.constants import TIME_SLOTS
from app.models import Appointment, Match, User


def h(uid):
    return {"X-User-Id": str(uid)}


@pytest.fixture
def pair(db):
    m = db.scalar(select(Match))
    m.status = "confirmed"
    for uid in (m.domestic_id, m.international_id):
        db.get(User, uid).times = TIME_SLOTS
    db.commit()
    return m.id, m.domestic_id, m.international_id


def body(client, pair):
    mid, a, _ = pair
    day = client.get(f"/api/matches/{mid}/appointment", headers=h(a)).json()["available"][0]
    return {"date": day["date"], "slot": day["slots"][0], "version": 0}


def test_accept_reload_and_stale_response(client, pair):
    mid, a, b = pair
    url = f"/api/matches/{mid}/appointment"
    assert client.post(url, headers=h(a), json=body(client, pair)).status_code == 200
    assert client.post(url + "/respond", headers=h(a), json={"action": "accept", "version": 1}).status_code == 403
    result = client.post(url + "/respond", headers=h(b), json={"action": "accept", "version": 1})
    assert result.status_code == 200 and result.json()["proposal"]["status"] == "confirmed"
    assert client.get(url, headers=h(a)).json()["proposal"]["status"] == "confirmed"
    assert client.post(url + "/respond", headers=h(b), json={"action": "accept", "version": 1}).status_code == 409


def test_decline_reproposal_and_cancel(client, pair):
    mid, a, b = pair
    url = f"/api/matches/{mid}/appointment"
    proposal = body(client, pair)
    client.post(url, headers=h(a), json=proposal)
    assert client.post(url + "/respond", headers=h(b), json={"action": "decline", "version": 1}).json()["proposal"]["status"] == "declined"
    assert client.post(url, headers=h(b), json={**proposal, "version": 2}).status_code == 200
    assert client.post(url + "/respond", headers=h(a), json={"action": "cancel", "version": 3}).status_code == 403
    assert client.post(url + "/respond", headers=h(b), json={"action": "cancel", "version": 3}).json()["proposal"]["status"] == "cancelled"


def test_invalid_time_and_duplicate_proposal(client, pair):
    mid, a, b = pair
    url = f"/api/matches/{mid}/appointment"
    proposal = body(client, pair)
    assert client.post(url, headers=h(a), json={**proposal, "date": "2020-01-01"}).status_code == 422
    assert client.post(url, headers=h(a), json={**proposal, "slot": "03:00–04:00"}).status_code == 422
    assert client.post(url, headers=h(a), json=proposal).status_code == 200
    assert client.post(url, headers=h(b), json=proposal).status_code == 409


def test_permissions(client, pair, db):
    mid, a, b = pair
    outsider = db.scalar(select(User.id).where(User.id.not_in([a, b])))
    url = f"/api/matches/{mid}/appointment"
    assert client.get(url, headers=h(outsider)).status_code == 404
    db.get(Match, mid).status = "proposed"
    db.commit()
    assert client.get(url, headers=h(a)).status_code == 403


def test_availability_changes_prevent_acceptance(client, pair, db):
    mid, a, b = pair
    url = f"/api/matches/{mid}/appointment"
    client.post(url, headers=h(a), json=body(client, pair))
    db.get(User, b).times = []
    db.commit()
    assert client.post(url + "/respond", headers=h(b), json={"action": "accept", "version": 1}).status_code == 409
    assert db.get(Appointment, mid).status == "proposed"


def test_confirmed_meetup_excludes_same_time_for_another_partner(client, pair, db):
    mid, a, b = pair
    url = f"/api/matches/{mid}/appointment"
    proposal = body(client, pair)
    client.post(url, headers=h(a), json=proposal)
    client.post(url + "/respond", headers=h(b), json={"action": "accept", "version": 1})
    outsider = db.scalar(select(User).where(User.kind == "international", User.id != b))
    outsider.times = TIME_SLOTS
    original = db.get(Match, mid)
    other = Match(domestic_id=a, international_id=outsider.id, status="confirmed", week=original.week, expires_at=original.expires_at)
    db.add(other)
    db.commit()
    other_url = f"/api/matches/{other.id}/appointment"
    result = client.get(other_url, headers=h(a)).json()
    assert not any(day["date"] == proposal["date"] and proposal["slot"] in day["slots"] for day in result["available"])
    assert client.post(other_url, headers=h(a), json=proposal).status_code == 422
    assert client.post(url + "/respond", headers=h(b), json={"action": "cancel", "version": 2}).status_code == 200
    assert client.post(other_url, headers=h(a), json=proposal).status_code == 200


def test_expired_proposal_cannot_be_accepted(client, pair, db):
    mid, a, b = pair
    url = f"/api/matches/{mid}/appointment"
    client.post(url, headers=h(a), json=body(client, pair))
    db.get(Appointment, mid).date = "2020-01-01"
    db.commit()
    assert client.get(url, headers=h(b)).json()["proposal"]["past"] is True
    assert client.post(url + "/respond", headers=h(b), json={"action": "accept", "version": 1}).status_code == 409
