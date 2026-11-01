"""DB 객체를 API 응답(dict)으로 바꾸는 함수들."""
from sqlalchemy.orm import Session

from .matching import active_count, explain
from .models import Match, Message, User
from .util import week_of


def user_public(u: User) -> dict:
    """상대에게 보여줘도 되는 정보만. 국적·이메일·공개 선호(prefs)는 제외."""
    return {
        "id": u.id,
        "name": u.name,
        "bio": u.bio,
        "kind": u.kind,
        "dept": u.dept,
        "langs": u.langs,
        "interests": u.interests,
        "teach": u.teach,
        "learn": u.learn,
    }


def user_me(db: Session, u: User) -> dict:
    return {
        **user_public(u),
        "times": u.times,
        "prefs": u.prefs,
        "nationality": u.nationality,
        "onboarded": u.onboarded,
        "ui_lang": u.ui_lang or "ko",
        "weekly_cap": u.weekly_cap,
        "used_this_week": active_count(db, u.id, week_of()),
    }


def partner_of(db: Session, m: Match, me_id: int) -> User:
    return db.get(User, m.international_id if me_id == m.domestic_id else m.domestic_id)


def match_view(db: Session, m: Match, me: User) -> dict:
    partner = partner_of(db, m, me.id)
    mine_is_dom = me.id == m.domestic_id
    return {
        "id": m.id,
        "status": m.status,
        "my_accepted": m.domestic_accepted if mine_is_dom else m.international_accepted,
        "partner_accepted": m.international_accepted if mine_is_dom else m.domestic_accepted,
        "expires_at": m.expires_at.isoformat(),
        "score": {
            "I": m.score_i,
            "T": m.score_t,
            "L": m.score_l,
            "R": m.score_r,
            "total": round(m.total * 100),
        },
        "partner": user_public(partner),
        "explain": explain(me, partner),
    }


def message_view(msg: Message, read: bool = False) -> dict:
    return {
        "id": msg.id,
        "match_id": msg.match_id,
        "sender_id": msg.sender_id,
        "text": msg.text,
        "read": read,  # 상대가 읽었는지 (내가 보낸 메시지에서 의미 있음)
        "created_at": msg.created_at.isoformat(),
    }
