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

# 매치(두 사람)마다 따로 잠근다. 서버 전체 잠금이면 다른 커플의 생성 때문에 내 요청이 막힌다.
_locks: dict[int, threading.Lock] = {}
_locks_guard = threading.Lock()


def _match_lock(mid: int) -> threading.Lock:
    with _locks_guard:
        return _locks.setdefault(mid, threading.Lock())


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
    lock = _match_lock(mid)
    if not lock.acquire(blocking=False):
        raise HTTPException(409, {"status": "in_progress", "message": "이 대화의 추천을 이미 만드는 중이에요. 완성되면 바로 보여드릴게요."})
    try:
        row = current(db, mid, ex)
        history = []
        if row and regenerate:
            # 다시 추천받기: 이전 제안 제목과 인용한 자료집 항목을 기억해 겹치지 않게 만든다(최근 5개).
            prev = row.payload["retrieval"]
            # 인용 여부와 상관없이 지난번에 찾은 자료집 항목은 모두 빼야 실제로 다른 형식이 나온다.
            used = [s.get("library_id") for s in prev.get("retrieved_sources") or prev.get("sources", []) if s.get("library_id")]
            history = (row.payload.get("history", []) + [{"title": prev["title"], "library_ids": used}])[-5:]
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
            avoid = [h["title"] for h in history]
            exclude = {i for h in history for i in h["library_ids"]}
            found = search_sources(analysis, notes, exclude=exclude)
            result = generate(ex, notes, found["sources"], analysis, avoid=avoid)
            record_quota(db, result["llm_status"])
            if result["generation_mode"] != "llm":
                raise HTTPException(503, "AI가 활동을 만들지 못했어요. 잠시 후 다시 시도해 주세요.")
            result.update(analysis=analysis, search_status=found["status"], search_provider=found["provider"],
                          search_providers=found["providers"], query=analysis["query"],
                          retrieved_sources=found["sources"], grounding=found.get("grounding"),
                          total_ms=round((time.perf_counter() - started) * 1000))
            result["avoided"] = avoid
            row = ActivityRun(match_id=mid, fingerprint=fingerprint(ex), payload={"retrieval": result, "history": history}, ratings={})
            db.add(row)
            db.commit()
        if compare:
            check_quota(db)
            # 공정 비교: 자료만 빼고 나머지 입력(피해야 할 이전 제안 포함)은 같게 둔다.
            baseline = generate(ex, notes, [], analysis, avoid=result.get("avoided") or [])
            record_quota(db, baseline["llm_status"])
            if baseline["generation_mode"] != "llm":
                raise HTTPException(503, "검색 없는 추천을 만들지 못했어요. 먼저 만든 추천은 그대로 저장되어 있어요.")
            evaluation = evaluate(notes, analysis, result, baseline, seed=row.id)
            row.payload = {**row.payload, "baseline": baseline, "evaluation": evaluation,
                           "comparable": bool(result.get("sources")), "rubric": RUBRIC}
            db.commit()
        return view(row, user_id, cached=False)
    finally:
        lock.release()
