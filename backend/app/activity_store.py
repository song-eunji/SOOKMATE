"""Persistent, input-versioned results. One process serializes generation per match.

흐름: 공유 노트 분석 → 자료 검색(자료집·위키백과·선택적 Google) → 활동 생성 → (비교 시) 검색 없는 생성 + 평가.
"""
import hashlib
import json
import os
import threading
import time

from fastapi import HTTPException
from sqlalchemy import select

from . import ai
from .activity_eval import RUBRIC, evaluate
from .models import ActivityRun, AIQuota
from .next_activity import analyze, generate
from .activity_search import search_sources

_lock = threading.Lock()


def fingerprint(ex):
    return hashlib.sha256(json.dumps({"entries": ex["shared_entries"], "interests": sorted(ex["common_interests"]),
        "llm": ai.llm_config(), "fallbacks": os.getenv("GEMINI_FALLBACK_MODELS", ""),
        "search": [os.getenv(k, d) for k, d in (("ACTIVITY_SEARCH_ENABLED", "1"), ("ACTIVITY_WIKIPEDIA", "1"), ("ACTIVITY_GOOGLE_SEARCH", "0"))],
        "version": 3}, sort_keys=True, ensure_ascii=False).encode()).hexdigest()


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


def quota_key():
    return hashlib.sha256((os.getenv("GEMINI_API_KEY", "") + "|".join(ai.llm_models())).encode()).hexdigest()


def check_quota(db):
    row = db.get(AIQuota, quota_key())
    if row and row.blocked_until > time.time():
        raise HTTPException(429, {"status": row.status, "retry_after_seconds": int(row.blocked_until - time.time()),
                                 "message": "무료 AI 호출 한도를 모두 사용했어요. 저장된 결과는 계속 볼 수 있고, 한도가 초기화되면 다시 만들 수 있어요."})


def record_quota(db, status):
    """모든 무료 모델이 한도에 걸렸을 때만 막는다(마지막으로 시도한 모델의 상태가 남는다)."""
    if status.get("status") not in ("daily_quota_exhausted", "minute_quota_exhausted", "rate_limited"):
        return
    delay = status.get("retry_after_seconds") or (3600 if status["status"] == "daily_quota_exhausted" else 60)
    db.merge(AIQuota(key=quota_key(), status=status["status"], blocked_until=time.time() + delay))
    db.commit()
    check_quota(db)


def run(db, mid, user_id, ex, notes, compare, regenerate=False):
    if not _lock.acquire(blocking=False):
        raise HTTPException(409, "다른 추천을 만드는 중이에요. 잠시 후 다시 확인해 주세요.")
    try:
        row = current(db, mid, ex)
        if row and regenerate:
            db.delete(row)
            db.commit()
            row = None
        if row and (not compare or "baseline" in row.payload):
            return view(row, user_id)
        if row:
            result = row.payload["retrieval"]
            analysis = result["analysis"]
        else:
            check_quota(db)
            started = time.perf_counter()
            analysis = analyze(ex, notes)
            record_quota(db, ai.llm_status())
            found = search_sources(analysis, notes)
            result = generate(ex, notes, found["sources"], analysis)
            record_quota(db, result["llm_status"])
            if result["generation_mode"] != "llm":
                raise HTTPException(503, "AI가 활동을 만들지 못했어요. 잠시 후 다시 시도해 주세요.")
            result.update(analysis=analysis, search_status=found["status"], search_provider=found["provider"],
                          search_providers=found["providers"], query=analysis["query"],
                          retrieved_sources=found["sources"], grounding=found.get("grounding"),
                          total_ms=round((time.perf_counter() - started) * 1000))
            row = ActivityRun(match_id=mid, fingerprint=fingerprint(ex), payload={"retrieval": result}, ratings={})
            db.add(row)
            db.commit()
        if compare:
            check_quota(db)
            baseline = generate(ex, notes, [], analysis)
            record_quota(db, baseline["llm_status"])
            if baseline["generation_mode"] != "llm":
                raise HTTPException(503, "검색 없는 추천을 만들지 못했어요. 먼저 만든 추천은 그대로 저장되어 있어요.")
            evaluation = evaluate(notes, analysis, result, baseline, seed=row.id)
            row.payload = {**row.payload, "baseline": baseline, "evaluation": evaluation,
                           "comparable": bool(result.get("sources")), "rubric": RUBRIC}
            db.commit()
        return view(row, user_id, cached=False)
    finally:
        _lock.release()
