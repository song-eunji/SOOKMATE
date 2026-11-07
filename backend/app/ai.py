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

import copy
import json
import logging
import math
import os
import re
import threading
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


def _keyword_hits(text: str, doc: dict) -> int:
    t = text.lower()
    return sum(1 for k in doc["topics"] if k.lower() in t)


def retrieve(query: str, k: int = 3, prefs: list[str] | None = None, docs: list[dict] | None = None) -> list[dict]:
    """관련 자료 상위 k개. prefs(개인 선호)가 있으면 선호마다 따로 찾아 일반 질의보다 우선한다.

    docs 를 넘기면 그 목록에서 찾는다(다른 자료 묶음에도 같은 검색을 쓰도록).
    """
    docs = culture_docs() if docs is None else docs
    prefs = [p for p in (prefs or []) if p and p.strip()]
    # 임베딩은 임베딩 담당의 embed()·sim() 을 그대로 쓴다 (0~1 유사도)
    qv = embed(query) if query.strip() else None
    pvs = [(p, embed(p)) for p in prefs]

    scored = []
    for d in docs:
        dv = embed(d["title"] + " " + d["text"])
        g_sim = sim(qv, dv) if qv is not None else 0.0
        g_kw = _keyword_hits(query, d)
        p_best, p_sim, p_kw = 0.0, 0.0, 0
        for p, pv in pvs:
            c, kw = sim(pv, dv), _keyword_hits(p, d)
            if c + 0.5 * kw > p_best:
                p_best, p_sim, p_kw = c + 0.5 * kw, c, kw
        score = p_best + 0.5 * (g_sim + 0.3 * g_kw)  # 개인 선호가 일반 질의보다 우선
        if g_kw or p_kw or max(g_sim, p_sim) > 0.05:  # 근거가 있는 자료만 (기존 기준 0.05 유지)
            scored.append((score, d))
    scored.sort(key=lambda x: -x[0])
    return [d for _, d in scored[:k]]


# ------------------------------------------------------------------------ LLM
_llm_cache: dict[tuple[str, str, str], dict] = {}
# 번역처럼 짧고 자주 부르는 일은 빠르고 저렴한 모델로
FAST_MODEL = os.getenv("ANTHROPIC_FAST_MODEL", "claude-haiku-5-5")
_LLM_CACHE_MAX = 2000


def llm_json(system: str, user: str, model: str | None = None, max_tokens: int = 700) -> dict | None:
    """ANTHROPIC_API_KEY 가 있을 때만 호출. 실패하거나 JSON이 아니면 None.

    입력이 같으면 저장해 둔 결과를 다시 쓴다(화면을 새로 열 때마다 호출·비용이 생기지 않게).
    실패는 저장하지 않아서 다음 요청 때 다시 시도한다.
    """
    key = os.getenv("ANTHROPIC_API_KEY")
    if not key:
        return None
    model = model or os.getenv("ANTHROPIC_MODEL", "claude-sonnet-5-5")
    ck = (model, system, user)
    if ck in _llm_cache:
        return copy.deepcopy(_llm_cache[ck])
    try:
        import anthropic

        client = anthropic.Anthropic(api_key=key, timeout=15)
        r = client.messages.create(
            model=model,
            max_tokens=max_tokens,
            system=system,
            messages=[{"role": "user", "content": user}],
        )
        text = "".join(b.text for b in r.content if getattr(b, "type", "") == "text")
        m = re.search(r"\{.*\}", text, re.S)
        data = json.loads(m.group(0)) if m else None
        if isinstance(data, dict):
            if len(_llm_cache) >= _LLM_CACHE_MAX:
                _llm_cache.clear()
            _llm_cache[ck] = copy.deepcopy(data)
            return data
        return None
    except Exception as e:  # 네트워크, 키, 파싱 오류 모두 fallback 으로
        log.warning("LLM 호출 실패, 기본 카드로 대체: %s", e)
        return None


# 화면 언어 코드 → LLM에 알려줄 언어 이름 (constants.UI_LANGS 와 같은 코드)
LANG_NAMES = {"ko": "한국어", "en": "English", "ja": "日本語", "zh": "简体中文", "vi": "Tiếng Việt"}


def _lang(user) -> str:
    code = getattr(user, "ui_lang", None) or "ko"
    return code if code in LANG_NAMES else "ko"


def _limit(n: int, lang: str) -> int:
    """글자 수 제한은 한국어 기준이라, 다른 언어는 같은 뜻이 더 길어지는 만큼 넉넉하게 준다."""
    return n if lang == "ko" else n * 2


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
    similar = [p["theirs"] for p in ex.get("similar_interests", [])]
    query = " ".join(ex["common_interests"] + similar + ["첫 만남 대화 약속 장소"])
    docs = retrieve(query, k=3, prefs=prefs)

    mode = "fallback"
    tips: list[dict] = []
    questions: list[str] = []

    lang = _lang(me)
    rules = (
        "너는 한국 대학 캠퍼스에서 유학생과 국내 학생의 첫 만남을 돕는 도우미야. JSON으로만 답해. "
        "상대가 공개한 선호를 가장 먼저 반영하고, 국적이나 출신으로 상대의 성향을 짐작하지 마. "
        "문장은 모두 '답변 언어'로 짧고 부담 없게 써. "
    )
    inp = {
        "답변 언어": LANG_NAMES[lang],
        "상대가 공개한 선호": prefs,
        "공통 관심사": ex["common_interests"],
        "뜻이 비슷한 관심사": [f"{p['mine']} / {p['theirs']}" for p in ex.get("similar_interests", [])],
    }
    q_ok = lambda d: d and _valid_str_list(d.get("questions"), 1, 4, _limit(80, lang))  # noqa: E731

    if docs:
        data = llm_json(
            rules
            + "주어진 문서 안의 내용만 사용해서 짧은 안내와 첫 질문을 만들어. 문서에 없는 사실은 쓰지 마. "
            "선호와 관련된 문서가 있으면 그 안내를 먼저 써. source_id는 문서 id 그대로 둬. "
            '형식: {"tips":[{"text":"...","source_id":"문서 id"}],"questions":["..."]}',
            json.dumps(
                {**inp, "문서": [{"id": d["id"], "title": d["title"], "text": d["text"]} for d in docs]},
                ensure_ascii=False,
            ),
        )
        ids = {d["id"] for d in docs}
        if (
            q_ok(data)
            and isinstance(data.get("tips"), list)
            and 1 <= len(data["tips"]) <= 3
            and all(
                isinstance(t, dict)
                and isinstance(t.get("text"), str)
                and 0 < len(t["text"]) <= _limit(200, lang)
                and t.get("source_id") in ids
                for t in data["tips"]
            )
        ):
            by_id = {d["id"]: d for d in docs}
            tips = [
                {"text": t["text"], "source": by_id[t["source_id"]]["source"], "source_id": t["source_id"]}
                for t in data["tips"]
            ]
            questions = data["questions"]
            mode = "llm"
    else:
        # 근거 자료가 없으면 사실 안내는 하지 않고, 직접 확인할 질문만 만든다 (기획서 6-(4))
        data = llm_json(
            rules
            + "참고할 문서가 없으니 사실이나 문화 정보를 말하지 말고, 상대에게 직접 물어볼 첫 질문만 만들어. "
            '형식: {"questions":["..."]}',
            json.dumps(inp, ensure_ascii=False),
        )
        if q_ok(data):
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
        "lang": lang if mode == "llm" else "ko",  # 문장이 어떤 언어로 나왔는지 (fallback 은 한국어 원문)
        "note": None if tips else "참고할 자료가 없어서 직접 물어볼 질문만 보여드려요.",
    }


# --------------------------------------------------------------------- 활동 카드
def _best_topic(teach: list[str], learn: list[str]) -> str | None:
    """내가 알려줄 수 있는 것 중 상대가 배우고 싶은 것과 뜻이 가장 가까운 주제 (기획서 6-(4)).

    글자가 똑같지 않아도(예: '한국어 표현' / 'Korean phrases') 임베딩으로 연결한다.
    """
    teach = [t for t in teach if t]
    if not teach:
        return None
    learn = [x for x in learn if x]
    if not learn:
        return teach[0]
    best_s, best_t = -1.0, teach[0]
    for t in teach:
        et = embed(t)
        s = max(1.0 if t == x else sim(et, embed(x)) for x in learn)
        if s > best_s:
            best_s, best_t = s, t
    return best_t


def _pair_topics(me, partner) -> tuple[str | None, str | None]:
    return _best_topic(list(me.teach), list(partner.learn)), _best_topic(list(partner.teach), list(me.learn))


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
    lang = _lang(me)
    data = llm_json(
        "두 학생이 서로 하나씩 10분 동안 알려주는 활동 카드를 만들어줘. JSON으로만 답해. "
        "각 문장에는 누가 무엇을 알려주는지가 드러나게 하고, 상대가 배우고 싶다고 한 것에 맞춰 구체적으로 써. "
        "국적이나 출신으로 성향을 짐작하지 마. "
        '형식: {"mine":"내가 알려줄 활동 한 문장","theirs":"상대가 알려줄 활동 한 문장"}. '
        f"각 문장은 {_limit(80, lang)}자 이하, 주어진 주제만 사용. 문장은 '답변 언어'로 써.",
        json.dumps(
            {
                "답변 언어": LANG_NAMES[lang],
                "내가 알려줄 주제": mine,
                "상대가 배우고 싶다고 한 것": list(partner.learn),
                "상대가 알려줄 주제": theirs,
                "내가 배우고 싶다고 한 것": list(me.learn),
            },
            ensure_ascii=False,
        ),
    )
    if (
        data
        and all(isinstance(data.get(k), str) and 0 < len(data[k]) <= _limit(80, lang) for k in ("mine", "theirs"))
    ):
        base["mine"]["desc"] = data["mine"]
        base["theirs"]["desc"] = data["theirs"]
        base["mode"] = "llm"
    return base


# ------------------------------------------------------------------------- 번역
def translate(text: str, target: str) -> str | None:
    """사람이 쓴 글(채팅, 한 줄 소개, 공유 노트 등)을 target 언어로 번역. 실패하면 None.

    원문은 DB에 그대로 두고, 읽는 사람이 원할 때만 화면에서 번역해 보여준다.
    """
    text = text.strip()
    if not text or target not in LANG_NAMES:
        return None
    data = llm_json(
        "너는 대학생 교류 앱의 번역기야. '문장'을 '번역할 언어'로 자연스럽게 번역해. "
        "뜻을 더하거나 빼지 말고, 이모지·말투·고유명사는 살려. 설명 없이 JSON으로만 답해. "
        '형식: {"text":"번역문"}',
        json.dumps({"번역할 언어": LANG_NAMES[target], "문장": text}, ensure_ascii=False),
        model=FAST_MODEL,
        max_tokens=1000,
    )
    out = data.get("text") if data else None
    if isinstance(out, str) and 0 < len(out.strip()) <= max(300, len(text) * 4):
        return out.strip()
    return None


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
