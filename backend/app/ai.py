"""AI 관련 코드 (임베딩, 문화 브리핑 RAG, 활동 카드, 다음 활동 제안).

원칙 (기획서 6-(4)):
- 개인 선호는 항상 사람이 입력한 값을 그대로 보여주고, LLM이 만들지 않는다.
- 브리핑의 문화 정보에는 출처를 붙이고, 근거 문서가 없으면 질문만 보여준다.
- LLM 결과는 서버에서 형식·출처를 검사하고, 실패하면 기본 카드(fallback)를 준다.
- 외부 LLM에는 이름·연락처 없이 필요한 텍스트만 보낸다.

임베딩은 EMBED_BACKEND 로 고릅니다. 기본은 설치 없이 도는 글자 n-gram이고,
st 로 바꾸면 다국어 모델(sentence-transformers)을 씁니다.
"""
from __future__ import annotations

import json
import logging
import math
import os
import re
import threading
import time
from contextvars import ContextVar
from collections import Counter
from functools import lru_cache
from pathlib import Path

from .constants import INTERESTS, TOPICS

log = logging.getLogger("sookmate.ai")
DATA_DIR = Path(__file__).resolve().parent.parent / "data"


# ---------------------------------------------------------------- embeddings
# ngram 또는 st(다국어 모델). st 를 못 쓰면 ngram 으로 돌아간다.
EMBED_BACKEND = os.getenv("EMBED_BACKEND", "ngram")
EMBED_MODEL = os.getenv("EMBED_MODEL", "BAAI/bge-m3")
_st_failed = False


def embed_ngram(text: str) -> dict[str, float]:
    t = re.sub(r"\s+", "", text.lower())
    grams = [t[i : i + n] for n in (2, 3) for i in range(len(t) - n + 1)]
    if not grams and t:
        grams = [t]
    counts = Counter(grams)
    norm = math.sqrt(sum(v * v for v in counts.values())) or 1.0
    return {k: v / norm for k, v in counts.items()}


_st_lock = threading.Lock()


@lru_cache(maxsize=1)
def _st_model():
    from sentence_transformers import SentenceTransformer

    return SentenceTransformer(EMBED_MODEL)


@lru_cache(maxsize=4096)
def embed_st(text: str) -> tuple[float, ...]:
    prefix = "query: " if "e5" in EMBED_MODEL.lower() else ""  # e5 모델은 접두어가 필요하다
    with _st_lock:  # 요청이 동시에 와도 모델 로딩과 계산이 겹치지 않게
        v = _st_model().encode(prefix + text[:100], normalize_embeddings=True)
    return tuple(float(x) for x in v)


def embed(text: str):
    global _st_failed
    if EMBED_BACKEND == "st" and not _st_failed:
        try:
            return embed_st(text)
        except Exception as e:
            _st_failed = True
            log.warning("다국어 임베딩을 못 써서 n-gram으로 대체: %s", e)
    return embed_ngram(text)


def warm_up() -> None:
    """서버를 켤 때 모델을 미리 불러오고 선택지 칩의 벡터를 계산해 둔다."""
    if EMBED_BACKEND == "st":
        for t in INTERESTS + TOPICS:
            embed(t)


def cosine(a, b) -> float:
    if isinstance(a, dict) and isinstance(b, dict):
        if len(a) > len(b):
            a, b = b, a
        return sum(v * b.get(k, 0.0) for k, v in a.items())
    return sum(x * y for x, y in zip(a, b))


# 모델마다 코사인이 퍼지는 범위가 달라서 하한~상한을 0~1로 늘려 쓴다.
# 값은 scripts/eval_quality.py 로 정했다.
_RANGES = {"bge-m3": (0.6, 0.8), "e5": (0.85, 0.92)}
_lo, _hi = next((r for k, r in _RANGES.items() if k in EMBED_MODEL.lower()), (0.6, 0.8))
SIM_FLOOR = float(os.getenv("EMBED_SIM_FLOOR", _lo))
SIM_CEIL = float(os.getenv("EMBED_SIM_CEIL", _hi))


def sim(a, b) -> float:
    """0~1 유사도. n-gram은 코사인 그대로."""
    c = cosine(a, b)
    if isinstance(a, dict):
        return c
    return min(1.0, max(0.0, (c - SIM_FLOOR) / (SIM_CEIL - SIM_FLOOR)))


def set_sim(xs: list[str], ys: list[str]) -> float:
    """두 목록의 유사도. 항목마다 상대 목록에서 가장 비슷한 것을 찾아 평균낸다."""
    if not xs or not ys:
        return 0.0
    ex, ey = [embed(x) for x in xs], [embed(y) for y in ys]
    xy = sum(max(sim(a, b) for b in ey) for a in ex) / len(ex)
    yx = sum(max(sim(a, b) for a in ex) for b in ey) / len(ey)
    return (xy + yx) / 2


# ----------------------------------------------------------------------- RAG
@lru_cache(maxsize=1)
def culture_docs() -> list[dict]:
    return json.loads((DATA_DIR / "culture_docs.json").read_text(encoding="utf-8"))


def retrieve(query: str, k: int = 3) -> list[dict]:
    q = embed(query)
    scored = []
    for d in culture_docs():
        s = sim(q, embed(d["title"] + " " + d["text"]))
        s += 0.3 * sum(1 for t in d["topics"] if t in query)
        scored.append((s, d))
    scored.sort(key=lambda x: -x[0])
    return [d for s, d in scored[:k] if s > 0.05]


# ------------------------------------------------------------------------ LLM
def llm_config() -> dict[str, str]:
    provider = os.getenv("LLM_PROVIDER", "auto").strip().lower()
    if provider == "auto":
        provider = "gemini" if os.getenv("GEMINI_API_KEY") else "anthropic"
    model = os.getenv("GEMINI_MODEL", "gemini-2.5-flash") if provider == "gemini" else os.getenv("ANTHROPIC_MODEL", "claude-sonnet-5-5")
    return {"provider": provider, "model": model}


_llm_status: ContextVar[dict | None] = ContextVar("llm_status", default=None)


def llm_status() -> dict:
    return dict(_llm_status.get() or {"status": "unknown"})


def _set_llm_status(status: str, **details) -> None:
    _llm_status.set({"status": status, **details})


def quota_status(payload: dict) -> dict:
    """Expose only quota category/delay; never provider messages or project identifiers."""
    result = {"status": "rate_limited"}
    details = payload.get("error", {}).get("details", [])
    for detail in details:
        if not isinstance(detail, dict):
            continue
        for violation in detail.get("violations", []):
            quota_id = violation.get("quotaId", "")
            if "PerDay" in quota_id:
                result["status"] = "daily_quota_exhausted"
            elif "PerMinute" in quota_id and result["status"] != "daily_quota_exhausted":
                result["status"] = "minute_quota_exhausted"
        delay = detail.get("retryDelay")
        if isinstance(delay, str) and re.fullmatch(r"\d+(?:\.\d+)?s", delay):
            result["retry_after_seconds"] = int(float(delay[:-1]))
    return result


def llm_json(system: str, user: str) -> dict | None:
    """Select Gemini/Anthropic; malformed, blocked or failed responses return None."""
    config = llm_config()
    provider, model = config["provider"], config["model"]
    _set_llm_status("pending", **config)
    if provider not in ("gemini", "anthropic"):
        _set_llm_status("invalid_provider", **config)
        return None
    key = os.getenv("GEMINI_API_KEY" if provider == "gemini" else "ANTHROPIC_API_KEY")
    if not key:
        _set_llm_status("not_configured", **config)
        return None
    try:
        if provider == "gemini":
            import httpx
            # Restrict the interpolated model to an identifier, never a URL/path.
            if not re.fullmatch(r"[a-zA-Z0-9._-]+", model):
                _set_llm_status("invalid_model", **config)
                return None
            timeout = min(60, max(5, float(os.getenv("LLM_TIMEOUT_SECONDS", "30"))))
            with httpx.Client(timeout=httpx.Timeout(timeout, connect=5)) as client:
                for attempt in range(2):
                    response = client.post(
                        f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent",
                        headers={"x-goog-api-key": key},
                        json={"systemInstruction": {"parts": [{"text": system}]},
                              "contents": [{"role": "user", "parts": [{"text": user}]}],
                              "generationConfig": {"responseMimeType": "application/json", "maxOutputTokens": 4096}},
                    )
                    if response.status_code in (500, 502, 503, 504) and attempt == 0:
                        time.sleep(0.5)
                        continue
                    break
                if response.is_error:
                    status = {400: "invalid_request", 401: "authentication", 403: "permission_denied",
                              404: "model_unavailable", 429: "rate_limited"}.get(response.status_code, "service_unavailable")
                    quota = quota_status(response.json()) if response.status_code == 429 else {"status": status}
                    _set_llm_status(**quota, http_status=response.status_code, attempts=attempt + 1, **config)
                    return None
                candidates = response.json().get("candidates", [])
                if not candidates or candidates[0].get("finishReason") != "STOP":
                    _set_llm_status("incomplete_response", **config)
                    return None
                parts = candidates[0].get("content", {}).get("parts", [])
                text = "".join(part.get("text", "") for part in parts if not part.get("thought"))
        else:
            import anthropic
            with anthropic.Anthropic(api_key=key, timeout=15, max_retries=0) as client:
                response = client.messages.create(
                    model=model, max_tokens=1600, system=system,
                    messages=[{"role": "user", "content": user}],
                )
                if response.stop_reason != "end_turn":
                    _set_llm_status("incomplete_response", **config)
                    return None
                text = "".join(block.text for block in response.content if getattr(block, "type", "") == "text")
        # JSON mode is a hint; callers still validate their required schema.
        match = re.search(r"\{.*\}", text, re.S)
        data = json.loads(match.group(0)) if match else None
        _set_llm_status("ok" if isinstance(data, dict) else "invalid_response", **config)
        return data if isinstance(data, dict) else None
    except Exception as error:
        # Never log provider response bodies, prompts, keys or credential-bearing URLs.
        import httpx
        status = "timeout" if isinstance(error, httpx.TimeoutException) else "connection_error" if isinstance(error, httpx.RequestError) else "invalid_response"
        _set_llm_status(status, **config)
        log.warning("%s LLM 호출 실패 (%s), 기본 카드로 대체", provider, type(error).__name__)
        return None


def _valid_str_list(v, lo: int, hi: int, maxlen: int) -> bool:
    return (
        isinstance(v, list)
        and lo <= len(v) <= hi
        and all(isinstance(x, str) and 0 < len(x) <= maxlen for x in v)
    )


# ------------------------------------------------------------------ 만나기 전 브리핑
def default_questions(partner, ex: dict) -> list[str]:
    qs: list[str] = []
    for c in ex["common_interests"][:2]:
        qs.append(f"{c} 관련해서 요즘 관심 있는 게 있어요?")
    if partner.kind == "international":
        qs.append("한국에서 가장 낯설었던 건 뭐예요?")
    else:
        qs.append("학교 생활에서 처음에 알았으면 좋았을 정보가 뭐였어요?")
    if ex["partner_topic"]:
        qs.append(f"{ex['partner_topic']}은(는) 어떻게 알려줄 수 있어요?")
    return qs[:3]


def make_brief(me, partner, ex: dict) -> dict:
    prefs = list(partner.prefs or [])  # 개인 선호가 최우선. 사람이 입력한 값 그대로.
    query = " ".join(prefs + ex["common_interests"] + ["첫 만남 식당 카페 주문 대화 시간"])
    docs = retrieve(query, k=3)

    mode = "fallback"
    tips: list[dict] = []
    questions: list[str] = []

    if docs:
        data = llm_json(
            "너는 한국 대학 캠퍼스의 교류 만남을 돕는 도우미야. 주어진 문서 안의 내용만 사용해서 "
            "짧은 안내와 첫 질문을 JSON으로만 답해. 형식: "
            '{"tips":[{"text":"...","source_id":"문서 id"}],"questions":["..."]}. '
            "문서에 없는 사실은 쓰지 마. 상대의 개인 선호는 문서보다 우선하니 반드시 존중해.",
            json.dumps(
                {
                    "상대가 공개한 선호": prefs,
                    "공통 관심사": ex["common_interests"],
                    "문서": [{"id": d["id"], "title": d["title"], "text": d["text"]} for d in docs],
                },
                ensure_ascii=False,
            ),
        )
        ids = {d["id"] for d in docs}
        if (
            data
            and isinstance(data.get("tips"), list)
            and 1 <= len(data["tips"]) <= 3
            and all(
                isinstance(t, dict)
                and isinstance(t.get("text"), str)
                and 0 < len(t["text"]) <= 200
                and t.get("source_id") in ids
                for t in data["tips"]
            )
            and _valid_str_list(data.get("questions"), 1, 4, 80)
        ):
            by_id = {d["id"]: d for d in docs}
            tips = [
                {"text": t["text"], "source": by_id[t["source_id"]]["source"], "source_id": t["source_id"]}
                for t in data["tips"]
            ]
            questions = data["questions"]
            mode = "llm"

    if not tips:
        tips = [{"text": d["text"], "source": d["source"], "source_id": d["id"]} for d in docs[:2]]
    if not questions:
        questions = default_questions(partner, ex)

    return {
        "prefs": prefs,
        "tips": tips,  # 문서가 없으면 빈 목록: 직접 확인할 질문만 보여줍니다.
        "questions": questions,
        "mode": mode,
        "note": None if tips else "참고할 자료가 없어서 직접 물어볼 질문만 보여드려요.",
    }


# --------------------------------------------------------------------- 활동 카드
def _pair_topics(me, partner) -> tuple[str | None, str | None]:
    mine = (sorted(set(me.teach) & set(partner.learn)) or list(me.teach) or [None])[0]
    theirs = (sorted(set(partner.teach) & set(me.learn)) or list(partner.teach) or [None])[0]
    return mine, theirs


def make_activity_card(me, partner, ex: dict) -> dict:
    mine, theirs = _pair_topics(me, partner)
    if not mine or not theirs:
        return {
            "title": "서로 궁금한 것 10분씩 묻고 답하기",
            "mine": {"topic": "내가 궁금한 것", "minutes": 10, "desc": "상대에게 궁금한 것을 10분 동안 물어봐요."},
            "theirs": {"topic": "상대가 궁금한 것", "minutes": 10, "desc": "상대가 궁금한 것을 10분 동안 알려줘요."},
            "mode": "fallback",
        }

    base = {
        "title": "10분씩 서로 알려주기",
        "mine": {"topic": mine, "minutes": 10, "desc": f"{mine}에 대해 10분 동안 알려줘요."},
        "theirs": {"topic": theirs, "minutes": 10, "desc": f"{theirs}에 대해 10분 동안 알려줘요."},
        "mode": "fallback",
    }
    data = llm_json(
        "두 학생이 서로 하나씩 10분 동안 알려주는 활동 카드를 만들어줘. JSON으로만 답해. "
        '형식: {"mine":"내가 알려줄 활동 한 문장","theirs":"상대가 알려줄 활동 한 문장"}. '
        "각 문장은 80자 이하, 주어진 주제만 사용.",
        json.dumps({"내가 알려줄 주제": mine, "상대가 알려줄 주제": theirs}, ensure_ascii=False),
    )
    if (
        data
        and all(isinstance(data.get(k), str) and 0 < len(data[k]) <= 80 for k in ("mine", "theirs"))
    ):
        base["mine"]["desc"] = data["mine"]
        base["theirs"]["desc"] = data["theirs"]
        base["mode"] = "llm"
    return base


# --------------------------------------------------------------- 다음 활동 제안
def make_next_activity(ex: dict, shared_next: list[str]) -> dict:
    """교류 노트에서 '공유된 항목'만 근거로 쓴다. 규칙 기반(추후 LLM으로 교체 가능)."""
    topics = [t.strip() for t in shared_next if t and t.strip()]
    if topics:
        return {
            "title": topics[0],
            "desc": f"두 사람의 기록을 바탕으로 「{topics[0]}」을(를) 주제로 10분씩 나눠요.",
            "basis": "shared_notes",
        }
    if ex["common_interests"]:
        c = ex["common_interests"][0]
        return {
            "title": f"{c}로 한 번 더 만나기",
            "desc": f"공유된 기록이 없어서, 겹치는 관심사({c})로 부담 없이 한 번 더 만나 보면 어때요?",
            "basis": "common_interest",
        }
    return {
        "title": "가볍게 한 번 더 만나기",
        "desc": "공유된 기록이 아직 없어요. 편한 시간에 짧게 한 번 더 만나 보면 어때요?",
        "basis": "default",
    }
