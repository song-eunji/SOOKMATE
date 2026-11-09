"""Persistent, input-versioned results. One process serializes generation per match."""
import hashlib
import json
import os
import threading
import time

from fastapi import HTTPException
from sqlalchemy import select

from . import ai
from .models import ActivityRun, AIQuota
from .next_activity import analyze, generate, search

_lock = threading.Lock()


def fingerprint(ex):
    return hashlib.sha256(json.dumps({"entries": ex["shared_entries"], "interests": sorted(ex["common_interests"]),
        "llm": ai.llm_config(), "search_model": os.getenv("GEMINI_SEARCH_MODEL"), "search_enabled": os.getenv("ACTIVITY_SEARCH_ENABLED", "1"), "version": 2}, sort_keys=True, ensure_ascii=False).encode()).hexdigest()


def current(db, mid, ex):
    row = db.scalar(select(ActivityRun).where(ActivityRun.match_id == mid))
    if row and row.fingerprint != fingerprint(ex):
        db.delete(row)
        db.commit()
        return None
    return row


def view(row, user_id, cached=True):
    return {**row.payload, "run_id": row.id, "cached": cached, "created_at": row.created_at.isoformat(),
            "ratings": row.ratings.get(str(user_id), {})}


def quota_key(model):
    return hashlib.sha256((os.getenv("GEMINI_API_KEY", "") + model).encode()).hexdigest()


def check_quota(db, model):
    row = db.get(AIQuota, quota_key(model))
    if row and row.blocked_until > time.time():
        raise HTTPException(429, {"status": row.status, "retry_after_seconds": int(row.blocked_until-time.time()),
                                 "message": "AI 호출 한도가 남아 있지 않습니다. 저장된 결과는 계속 볼 수 있습니다."})


def record_quota(db, status, model):
    if status.get("status") not in ("daily_quota_exhausted", "minute_quota_exhausted", "rate_limited"):
        return
    delay = status.get("retry_after_seconds") or (86400 if status["status"] == "daily_quota_exhausted" else 60)
    db.merge(AIQuota(key=quota_key(model), status=status["status"], blocked_until=time.time()+delay))
    db.commit()
    check_quota(db, model)


def run(db, mid, user_id, ex, notes, compare):
    if not _lock.acquire(blocking=False):
        raise HTTPException(409, "다른 추천을 생성 중입니다. 잠시 후 다시 확인해 주세요.")
    try:
        row = current(db, mid, ex)
        if row and (not compare or "baseline" in row.payload):
            return view(row, user_id)
        model = ai.llm_config()["model"]
        if row:
            result = row.payload["retrieval"]
            analysis = result["analysis"]
        else:
            check_quota(db, model)
            analysis = analyze(ex, notes)
            if notes:
                record_quota(db, ai.llm_status(), model)
            search_model = os.getenv("GEMINI_SEARCH_MODEL") or os.getenv("GEMINI_MODEL", "gemini-2.5-flash")
            search_enabled = os.getenv("ACTIVITY_SEARCH_ENABLED", "1") != "0"
            if search_enabled and analysis["query"]:
                check_quota(db, search_model)
                found = search(analysis["query"])
            else:
                found = {"sources": [], "status": "disabled" if not search_enabled else "no_query", "provider": "google_search"}
            record_quota(db, found, search_model)
            if search_enabled and found["status"] != "ok":
                raise HTTPException(503, "참고 자료를 검색하지 못했습니다. 검색 기반 추천은 생성하지 않았습니다. 잠시 후 다시 시도해 주세요.")
            check_quota(db, model)
            result = generate(ex, notes, found["sources"], analysis)
            record_quota(db, result["llm_status"], model)
            result.update(analysis=analysis, search_status=found["status"], search_provider=found["provider"], search_model=found.get("model"),
                          query=analysis["query"], retrieved_sources=found["sources"], grounding=found.get("grounding"))
            if result["generation_mode"] != "llm":
                raise HTTPException(503, "AI 추천 생성에 실패했습니다. 잠시 후 다시 시도해 주세요.")
            row = ActivityRun(match_id=mid, fingerprint=fingerprint(ex), payload={"retrieval": result}, ratings={})
            db.add(row)
            db.commit()
        if compare:
            check_quota(db, model)
            baseline = generate(ex, notes, [], analysis)
            record_quota(db, baseline["llm_status"], model)
            if baseline["generation_mode"] != "llm":
                raise HTTPException(503, "검색 없는 추천 생성에 실패했습니다. 검색 기반 추천은 저장되어 있습니다.")
            row.payload = {**row.payload, "baseline": baseline,
                "comparable": bool(result["sources"]), "rubric": ["노트 관심사와의 관련성", "실행 가능성", "이전 활동과의 차별성", "근거의 충실성"]}
            db.commit()
        return view(row, user_id, cached=False)
    finally:
        _lock.release()
