"""확정된 매칭에서 한국 시간 기준 약속을 제안하고 양측 합의로 확정한다."""
from datetime import date, datetime, timedelta
from typing import Literal
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from .constants import DAYS, expand_times
from .db import get_db
from .models import Appointment, Match, User
from .scheduling.coordination import serialized

KST = ZoneInfo("Asia/Seoul")


class ProposalIn(BaseModel):
    date: date
    slot: str = Field(max_length=30)
    version: int = Field(ge=0)


class ResponseIn(BaseModel):
    action: Literal["accept", "decline", "cancel"]
    version: int = Field(ge=1)


def participant(db, mid, me):
    match = db.get(Match, mid, populate_existing=True)
    if not match or me.id not in (match.domestic_id, match.international_id):
        raise HTTPException(404, "만남을 찾을 수 없어요.")
    if match.status != "confirmed":
        raise HTTPException(403, "양쪽이 수락한 만남에서만 쓸 수 있어요.")
    return match


def available(db, match):
    a, b = db.get(User, match.domestic_id), db.get(User, match.international_id)
    shared = set(expand_times(a.times)) & set(expand_times(b.times))
    now = datetime.now(KST)
    busy = set(db.execute(select(Appointment.date, Appointment.slot).join(Match, Match.id == Appointment.match_id).where(
        Appointment.status == "confirmed", Match.status == "confirmed", Match.id != match.id,
        or_(Match.domestic_id.in_([a.id, b.id]), Match.international_id.in_([a.id, b.id])),
    )).all())
    days = []
    for offset in range(14):
        day = now.date() + timedelta(days=offset)
        if day.weekday() >= len(DAYS):
            continue
        slots = sorted(key.split(" ", 1)[1] for key in shared if key.startswith(DAYS[day.weekday()] + " "))
        slots = [slot for slot in slots if datetime.fromisoformat(f"{day}T{slot.split('–')[0]}").replace(tzinfo=KST) > now]
        slots = [slot for slot in slots if (day.isoformat(), slot) not in busy]
        if slots:
            days.append({"date": day.isoformat(), "slots": slots})
    return days


def snapshot(db, match, me):
    row = db.get(Appointment, match.id, populate_existing=True)
    proposal = None
    if row:
        ended = datetime.fromisoformat(f"{row.date}T{row.slot.split('–')[0]}").replace(tzinfo=KST) <= datetime.now(KST)
        proposal = {"date": row.date, "slot": row.slot, "status": row.status, "version": row.version,
                    "mine": row.proposer_id == me.id, "past": ended}
    return {"available": available(db, match), "proposal": proposal, "timezone": "Asia/Seoul"}


@serialized
def change(db, mid, me, body):
    match = participant(db, mid, me)
    row = db.get(Appointment, mid, populate_existing=True)
    if body.version != (row.version if row else 0):
        raise HTTPException(409, "약속 상태가 바뀌었어요. 다시 확인해 주세요.")
    if isinstance(body, ProposalIn):
        if row and row.status in ("proposed", "confirmed"):
            # 지난 약속은 다음 약속으로 교체할 수 있다.
            past = datetime.fromisoformat(f"{row.date}T{row.slot.split('–')[0]}").replace(tzinfo=KST) <= datetime.now(KST)
            if not past:
                raise HTTPException(409, "진행 중인 약속을 먼저 취소해 주세요.")
        if not any(day["date"] == str(body.date) and body.slot in day["slots"] for day in available(db, match)):
            raise HTTPException(422, "두 사람의 공통 가능한 미래 시간을 선택해 주세요.")
        if not row:
            row = Appointment(match_id=mid, version=0)
            db.add(row)
        row.date, row.slot, row.proposer_id, row.status = str(body.date), body.slot, me.id, "proposed"
    else:
        if not row or row.status not in ("proposed", "confirmed"):
            raise HTTPException(409, "응답할 약속이 없어요.")
        if body.action == "cancel":
            if row.status == "proposed" and row.proposer_id != me.id:
                raise HTTPException(403, "상대 제안은 거절해 주세요.")
            row.status = "cancelled"
        else:
            if row.status != "proposed" or row.proposer_id == me.id:
                raise HTTPException(403, "상대방의 제안에만 응답할 수 있어요.")
            if body.action == "accept" and not any(day["date"] == row.date and row.slot in day["slots"] for day in available(db, match)):
                raise HTTPException(409, "지난 시간이거나 가능한 시간이 바뀌었어요. 다시 제안해 주세요.")
            row.status = "confirmed" if body.action == "accept" else "declined"
    row.version += 1
    db.commit()
    return snapshot(db, match, me)


def create_router(me_dep):
    router = APIRouter(prefix="/api/matches", tags=["appointments"])

    @router.get("/{mid}/appointment")
    def get_appointment(mid: int, me: User = Depends(me_dep), db: Session = Depends(get_db)):
        return snapshot(db, participant(db, mid, me), me)

    @router.post("/{mid}/appointment")
    def propose(mid: int, body: ProposalIn, me: User = Depends(me_dep), db: Session = Depends(get_db)):
        return change(db, mid, me, body)

    @router.post("/{mid}/appointment/respond")
    def respond(mid: int, body: ResponseIn, me: User = Depends(me_dep), db: Session = Depends(get_db)):
        return change(db, mid, me, body)

    return router
