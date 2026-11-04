"""SOOKMATE API.

로그인은 아직 없습니다. 요청 헤더 X-User-Id 로 '지금 사용자'를 정합니다(없으면 DEFAULT_USER_ID, 기본 1).
로그인(학교 메일 인증)을 붙일 때는 아래 me_dep() 한 곳만 바꾸면 됩니다.
"""
from __future__ import annotations

import os
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, Header, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from . import ai, matching, views
from .constants import BIO_MAX_LEN, DAYS, INTERESTS, LANGUAGES, NAME_MAX_LEN, SLOTS, TIME_SLOTS, TOPICS, UI_LANGS, WEIGHTS
from .db import Base, SessionLocal, engine, ensure_columns, get_db
from .models import ChatRead, Match, Message, Note, Report, User
from .seed import seed_demo
from .notifications.router import create_router as create_notifications_router
from .notifications.service import message_event, read_messages
from .scheduling.coordination import matching_lock, serialized
from .scheduling.scheduler import scheduler_lifespan

DEV_MODE = os.getenv("DEV_MODE", "1") == "1"


@asynccontextmanager
async def lifespan(app: FastAPI):
    Base.metadata.create_all(engine)
    ensure_columns()
    with SessionLocal() as db:
        if not db.scalars(select(User).limit(1)).first():
            seed_demo(db)
            matching.assign(db)
    with scheduler_lifespan() as scheduler:
        app.state.scheduler = scheduler
        try:
            yield
        finally:
            app.state.scheduler = None


app = FastAPI(title="SOOKMATE API", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# --------------------------------------------------------------- 공통 의존성
def me_dep(x_user_id: int | None = Header(default=None), db: Session = Depends(get_db)) -> User:
    uid = x_user_id or int(os.getenv("DEFAULT_USER_ID", "1"))
    user = db.get(User, uid)
    if not user:
        raise HTTPException(401, "알 수 없는 사용자예요.")
    return user


app.include_router(create_notifications_router(me_dep))


def run(fn, *args):
    try:
        return fn(*args)
    except matching.MatchError as e:
        raise HTTPException(e.code, e.message)


def my_match(db: Session, match_id: int, me: User, confirmed: bool = False) -> Match:
    m = db.get(Match, match_id)
    if not m or me.id not in (m.domestic_id, m.international_id):
        raise HTTPException(404, "만남을 찾을 수 없어요.")
    if confirmed and m.status != "confirmed":
        raise HTTPException(403, "양쪽이 수락한 만남에서만 쓸 수 있어요.")
    return m


# --------------------------------------------------------------------- 입력
def _only(values: list[str], allowed: list[str], label: str) -> list[str]:
    bad = [v for v in values if v not in allowed]
    if bad:
        raise ValueError(f"{label}에 없는 값이에요: {bad}")
    return list(dict.fromkeys(values))


FREE_TEXT_MAX_LEN = 30
FREE_TEXT_MAX_ITEMS = 10


def _free(values: list[str], label: str) -> list[str]:
    """직접 입력도 받는 항목: 공백을 정리하고 중복·빈 값을 지운 뒤 길이와 개수를 제한한다."""
    out = list(dict.fromkeys(v.strip() for v in values if v.strip()))
    if any(len(v) > FREE_TEXT_MAX_LEN for v in out):
        raise ValueError(f"{label}은 {FREE_TEXT_MAX_LEN}자까지 쓸 수 있어요")
    if len(out) > FREE_TEXT_MAX_ITEMS:
        raise ValueError(f"{label}은 {FREE_TEXT_MAX_ITEMS}개까지 고를 수 있어요")
    return out


class ProfileIn(BaseModel):
    interests: list[str] = []
    times: list[str] = []
    langs: list[str] = []
    teach: list[str] = []
    learn: list[str] = []
    prefs: list[str] = Field(default=[], max_length=5)
    nationality: str | None = Field(default=None, max_length=40)

    @field_validator("interests")
    @classmethod
    def _i(cls, v):
        return _free(v, "관심사")

    @field_validator("times")
    @classmethod
    def _t(cls, v):
        return _only(v, TIME_SLOTS, "시간")

    @field_validator("langs")
    @classmethod
    def _l(cls, v):
        return _only(v, LANGUAGES, "언어")

    @field_validator("teach", "learn")
    @classmethod
    def _topics(cls, v):
        return _free(v, "주제")

    @field_validator("prefs")
    @classmethod
    def _p(cls, v):
        return [p.strip()[:40] for p in v if p.strip()]


class BasicIn(BaseModel):
    name: str = Field(max_length=NAME_MAX_LEN * 3)  # 공백 정리 뒤 길이는 아래에서 확인
    bio: str = Field(default="", max_length=BIO_MAX_LEN * 3)

    @field_validator("name")
    @classmethod
    def _n(cls, v):
        v = v.strip()
        if not v or len(v) > NAME_MAX_LEN:
            raise ValueError(f"닉네임은 1~{NAME_MAX_LEN}자로 써 주세요")
        return v

    @field_validator("bio")
    @classmethod
    def _b(cls, v):
        v = v.strip()
        if len(v) > BIO_MAX_LEN:
            raise ValueError(f"한 줄 소개는 {BIO_MAX_LEN}자까지 쓸 수 있어요")
        return v


class LanguageIn(BaseModel):
    lang: str

    @field_validator("lang")
    @classmethod
    def _l(cls, v):
        if v not in [c for c, _ in UI_LANGS]:
            raise ValueError("지원하지 않는 언어예요")
        return v


class MessageIn(BaseModel):
    text: str = Field(min_length=1, max_length=500)


class NoteIn(BaseModel):
    expr: str = Field(default="", max_length=200)
    fact: str = Field(default="", max_length=200)
    next_text: str = Field(default="", max_length=200)
    share_expr: bool = False
    share_fact: bool = False
    share_next: bool = False


class BlockIn(BaseModel):
    user_id: int


class ReportIn(BaseModel):
    user_id: int
    match_id: int | None = None
    reason: str = Field(min_length=1, max_length=200)


# ------------------------------------------------------------------ 기본 정보
@app.get("/api/options")
def options():
    return {
        "days": DAYS,
        "slots": SLOTS,
        "time_slots": TIME_SLOTS,
        "interests": INTERESTS,
        "languages": LANGUAGES,
        "topics": TOPICS,
        "ui_langs": UI_LANGS,
        "name_max_len": NAME_MAX_LEN,
        "bio_max_len": BIO_MAX_LEN,
        "weights": WEIGHTS,
        "dev_mode": DEV_MODE,
    }


@app.get("/api/users")
def list_users(db: Session = Depends(get_db)):
    """개발용: 사용자 전환 목록. 로그인이 생기면 DEV_MODE 에서만 열어 두세요."""
    if not DEV_MODE:
        raise HTTPException(404)
    return [{"id": u.id, "name": u.name, "kind": u.kind} for u in db.scalars(select(User).order_by(User.id))]


@app.get("/api/me")
def get_me(me: User = Depends(me_dep), db: Session = Depends(get_db)):
    return views.user_me(db, me)


@app.put("/api/me/basic")
def put_basic(body: BasicIn, me: User = Depends(me_dep), db: Session = Depends(get_db)):
    taken = db.scalars(select(User).where(User.id != me.id)).all()
    if any(u.name.casefold() == body.name.casefold() for u in taken):
        raise HTTPException(409, "이미 쓰고 있는 닉네임이에요.")
    me.name, me.bio, me.onboarded = body.name, body.bio, True
    db.commit()
    return views.user_me(db, me)


@app.put("/api/me/language")
def put_language(body: LanguageIn, me: User = Depends(me_dep), db: Session = Depends(get_db)):
    me.ui_lang = body.lang
    db.commit()
    return views.user_me(db, me)


@app.put("/api/me/profile")
def put_profile(body: ProfileIn, me: User = Depends(me_dep), db: Session = Depends(get_db)):
    with matching_lock:
        me.interests, me.times, me.langs = body.interests, body.times, body.langs
        me.teach, me.learn, me.prefs, me.nationality = body.teach, body.learn, body.prefs, body.nationality
        db.commit()
        matching.assign(db)  # 프로필이 바뀌면 자리가 남은 사람끼리 새로 배정
    return views.user_me(db, me)


# ----------------------------------------------------------------------- 매칭
@app.post("/api/recommendations/refresh")
def refresh(me: User = Depends(me_dep), db: Session = Depends(get_db)):
    created = matching.assign(db)
    return {"created": created}


@app.get("/api/matches")
def list_matches(me: User = Depends(me_dep), db: Session = Depends(get_db)):
    if matching.expire_stale(db):
        matching.assign(db)
    rows = db.scalars(
        select(Match)
        .where(or_(Match.domestic_id == me.id, Match.international_id == me.id), Match.status.in_(matching.ACTIVE))
        .order_by(Match.total.desc())
    ).all()
    return [views.match_view(db, m, me) for m in rows]


@app.post("/api/matches/{match_id}/accept")
def accept_match(match_id: int, me: User = Depends(me_dep), db: Session = Depends(get_db)):
    m = run(matching.accept, db, match_id, me.id)
    return views.match_view(db, m, me)


@app.post("/api/matches/{match_id}/reject")
def reject_match(match_id: int, me: User = Depends(me_dep), db: Session = Depends(get_db)):
    run(matching.reject, db, match_id, me.id)
    return {"ok": True}


@app.post("/api/matches/{match_id}/cancel")
def cancel_match(match_id: int, me: User = Depends(me_dep), db: Session = Depends(get_db)):
    run(matching.cancel, db, match_id, me.id)
    return {"ok": True}


# ---------------------------------------------------------------------- 대화방
class Hub:
    """같은 만남의 WebSocket 연결 모음 (서버 1대 기준 메모리 방식)."""

    def __init__(self):
        self.rooms: dict[int, set[WebSocket]] = {}

    def add(self, match_id: int, ws: WebSocket):
        self.rooms.setdefault(match_id, set()).add(ws)

    def remove(self, match_id: int, ws: WebSocket):
        self.rooms.get(match_id, set()).discard(ws)

    async def broadcast(self, match_id: int, payload: dict):
        for ws in list(self.rooms.get(match_id, ())):
            try:
                await ws.send_json(payload)
            except Exception:
                self.remove(match_id, ws)


hub = Hub()


@serialized
def _save_message(db: Session, match_id: int, sender_id: int, text: str) -> dict:
    m = matching._locked(db, match_id)
    matching._participant(m, sender_id)
    if m.status != "confirmed":
        raise matching.MatchError("양쪽이 수락한 만남에서만 쓸 수 있어요.", 403)
    msg = Message(match_id=match_id, sender_id=sender_id, text=text)
    db.add(msg)
    db.flush()
    message_event(db, m, msg)
    db.commit()
    return {"type": "message", **views.message_view(msg)}


def _last_read(db: Session, match_id: int, uid: int) -> int:
    row = db.scalars(select(ChatRead).where(ChatRead.match_id == match_id, ChatRead.user_id == uid)).first()
    return row.last_read_id if row else 0


@serialized
def _mark_read(db: Session, match_id: int, uid: int) -> int:
    """이 대화방의 마지막 메시지까지 읽은 것으로 기록하고, 그 메시지 번호를 돌려준다."""
    last_id = db.scalar(select(func.max(Message.id)).where(Message.match_id == match_id)) or 0
    row = db.scalars(select(ChatRead).where(ChatRead.match_id == match_id, ChatRead.user_id == uid)).first()
    if row:
        row.last_read_id = max(row.last_read_id, last_id)
    else:
        db.add(ChatRead(match_id=match_id, user_id=uid, last_read_id=last_id))
    read_messages(db, match_id, uid, last_id)
    db.commit()
    return last_id


@app.get("/api/chats")
def list_chats(me: User = Depends(me_dep), db: Session = Depends(get_db)):
    """내가 열려 있는 대화방 목록. 최근 대화가 위로 오고, 안 읽은 수를 함께 준다."""
    rows = db.scalars(
        select(Match).where(or_(Match.domestic_id == me.id, Match.international_id == me.id), Match.status == "confirmed")
    ).all()
    out = []
    for m in rows:
        last = db.scalars(select(Message).where(Message.match_id == m.id).order_by(Message.id.desc())).first()
        unread = db.scalar(
            select(func.count(Message.id)).where(
                Message.match_id == m.id, Message.sender_id != me.id, Message.id > _last_read(db, m.id, me.id)
            )
        )
        out.append(
            {
                "match_id": m.id,
                "partner": views.user_public(views.partner_of(db, m, me.id)),
                "last_message": (
                    {"text": last.text, "created_at": last.created_at.isoformat(), "sender_id": last.sender_id} if last else None
                ),
                "unread": unread or 0,
                "_at": (last.created_at if last else m.created_at),
            }
        )
    out.sort(key=lambda r: r["_at"], reverse=True)
    for r in out:
        del r["_at"]
    return out


@app.post("/api/matches/{match_id}/read")
async def read_chat(match_id: int, me: User = Depends(me_dep), db: Session = Depends(get_db)):
    my_match(db, match_id, me, confirmed=True)
    last_id = _mark_read(db, match_id, me.id)
    await hub.broadcast(match_id, {"type": "read", "reader_id": me.id, "last_read_id": last_id})
    return {"ok": True}


@app.get("/api/matches/{match_id}/messages")
def get_messages(match_id: int, me: User = Depends(me_dep), db: Session = Depends(get_db)):
    m = my_match(db, match_id, me, confirmed=True)
    partner_read = _last_read(db, match_id, views.partner_of(db, m, me.id).id)
    rows = db.scalars(select(Message).where(Message.match_id == match_id).order_by(Message.id)).all()
    return [views.message_view(x, read=x.id <= partner_read) for x in rows]


@app.post("/api/matches/{match_id}/messages")
async def post_message(match_id: int, body: MessageIn, me: User = Depends(me_dep), db: Session = Depends(get_db)):
    my_match(db, match_id, me, confirmed=True)
    payload = run(_save_message, db, match_id, me.id, body.text.strip())
    await hub.broadcast(match_id, payload)
    return payload


@app.websocket("/ws/matches/{match_id}")
async def ws_chat(ws: WebSocket, match_id: int, user_id: int):
    with SessionLocal() as db:
        m = db.get(Match, match_id)
        ok = bool(m) and m.status == "confirmed" and user_id in (m.domestic_id, m.international_id)
    if not ok:
        await ws.close(code=4403)
        return
    await ws.accept()
    hub.add(match_id, ws)
    try:
        while True:
            data = await ws.receive_json()
            text = str(data.get("text", "")).strip()[:500]
            if not text:
                continue
            with SessionLocal() as db:
                payload = _save_message(db, match_id, user_id, text)
            await hub.broadcast(match_id, payload)
    except matching.MatchError:
        await ws.close(code=4403)
    except WebSocketDisconnect:
        pass
    finally:
        hub.remove(match_id, ws)


# ------------------------------------------------ 만나기 전 브리핑 · 활동 카드
@app.get("/api/matches/{match_id}/brief")
def get_brief(match_id: int, me: User = Depends(me_dep), db: Session = Depends(get_db)):
    m = my_match(db, match_id, me, confirmed=True)
    partner = views.partner_of(db, m, me.id)
    return ai.make_brief(me, partner, matching.explain(me, partner))


@app.get("/api/matches/{match_id}/activity-card")
def get_activity_card(match_id: int, me: User = Depends(me_dep), db: Session = Depends(get_db)):
    m = my_match(db, match_id, me, confirmed=True)
    partner = views.partner_of(db, m, me.id)
    return ai.make_activity_card(me, partner, matching.explain(me, partner))


# ------------------------------------------------------------------- 교류 노트
def _note(db: Session, match_id: int, author_id: int) -> Note | None:
    return db.scalars(select(Note).where(Note.match_id == match_id, Note.author_id == author_id)).first()


def _note_view(n: Note | None) -> dict | None:
    if not n:
        return None
    return {
        "expr": n.expr,
        "fact": n.fact,
        "next_text": n.next_text,
        "share_expr": n.share_expr,
        "share_fact": n.share_fact,
        "share_next": n.share_next,
    }


@app.get("/api/matches/{match_id}/notes")
def get_notes(match_id: int, me: User = Depends(me_dep), db: Session = Depends(get_db)):
    m = my_match(db, match_id, me, confirmed=True)
    partner = views.partner_of(db, m, me.id)
    theirs = _note(db, match_id, partner.id)
    shared = None
    if theirs:  # 상대가 공유를 켠 항목만 내려간다
        shared = {
            "expr": theirs.expr if theirs.share_expr else None,
            "fact": theirs.fact if theirs.share_fact else None,
            "next_text": theirs.next_text if theirs.share_next else None,
        }
    return {"mine": _note_view(_note(db, match_id, me.id)), "partner_shared": shared}


@app.put("/api/matches/{match_id}/notes")
def put_note(match_id: int, body: NoteIn, me: User = Depends(me_dep), db: Session = Depends(get_db)):
    my_match(db, match_id, me, confirmed=True)
    n = _note(db, match_id, me.id)
    if not n:
        n = Note(match_id=match_id, author_id=me.id)
        db.add(n)
    for k, v in body.model_dump().items():
        setattr(n, k, v)
    db.commit()
    return _note_view(n)


@app.delete("/api/matches/{match_id}/notes")
def delete_note(match_id: int, me: User = Depends(me_dep), db: Session = Depends(get_db)):
    my_match(db, match_id, me, confirmed=True)
    n = _note(db, match_id, me.id)
    if n:
        db.delete(n)
        db.commit()
    return {"ok": True}


@app.get("/api/matches/{match_id}/next-activity")
def next_activity(match_id: int, me: User = Depends(me_dep), db: Session = Depends(get_db)):
    """두 사람 노트 중 '공유가 켜진 다음 활동'만 근거로 쓴다."""
    m = my_match(db, match_id, me, confirmed=True)
    partner = views.partner_of(db, m, me.id)
    shared: list[str] = []
    for author in (me, partner):
        n = _note(db, match_id, author.id)
        if n and n.share_next and n.next_text:
            shared.append(n.next_text)
    return ai.make_next_activity(matching.explain(me, partner), shared)


# ------------------------------------------------------------------ 신고 · 차단
@app.post("/api/blocks")
def block(body: BlockIn, me: User = Depends(me_dep), db: Session = Depends(get_db)):
    run(matching.block_user, db, me.id, body.user_id)
    return {"ok": True}


@app.post("/api/reports")
def report(body: ReportIn, me: User = Depends(me_dep), db: Session = Depends(get_db)):
    if not db.get(User, body.user_id):
        raise HTTPException(404, "신고할 사용자를 찾을 수 없어요.")
    db.add(Report(reporter_id=me.id, target_id=body.user_id, match_id=body.match_id, reason=body.reason))
    db.commit()
    return {"ok": True}


# ----------------------------------------------------------------- 개발용 도구
@app.post("/api/dev/reset")
def dev_reset(db: Session = Depends(get_db)):
    """DB를 비우고 합성 프로필 40명을 다시 넣은 뒤 첫 배정을 돌린다."""
    if not DEV_MODE:
        raise HTTPException(404)
    with matching_lock:
        db.close()
        Base.metadata.drop_all(engine)
        Base.metadata.create_all(engine)
        with SessionLocal() as s:
            seed_demo(s)
            n = matching.assign(s)
    return {"users": 40, "matches": n}


@app.post("/api/dev/matches/{match_id}/partner-accept")
def dev_partner_accept(match_id: int, me: User = Depends(me_dep), db: Session = Depends(get_db)):
    """개발용: 상대방이 수락한 것처럼 처리 (사용자 전환 없이 확정 흐름을 보려고)."""
    if not DEV_MODE:
        raise HTTPException(404)
    m = my_match(db, match_id, me)
    partner = views.partner_of(db, m, me.id)
    run(matching.accept, db, match_id, partner.id)
    return {"ok": True}


DEV_REPLIES = ["안녕하세요! 만나서 반가워요 😊", "수요일 오후 괜찮아요?", "학생회관 카페에서 봐요!", "그날 기대돼요"]


@app.post("/api/dev/matches/{match_id}/partner-message")
async def dev_partner_message(match_id: int, me: User = Depends(me_dep), db: Session = Depends(get_db)):
    """개발용: 상대가 메시지를 보낸 것처럼 처리 (안 읽음 표시를 보려고)."""
    if not DEV_MODE:
        raise HTTPException(404)
    m = my_match(db, match_id, me, confirmed=True)
    partner = views.partner_of(db, m, me.id)
    count = db.scalar(select(func.count(Message.id)).where(Message.match_id == match_id, Message.sender_id == partner.id)) or 0
    payload = run(_save_message, db, match_id, partner.id, DEV_REPLIES[count % len(DEV_REPLIES)])
    await hub.broadcast(match_id, payload)
    return {"ok": True}
