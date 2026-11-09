"""검색 기반 추천(retrieval)과 검색 없는 추천(baseline)의 비교 평가.

- auto_metrics: 모델 없이 계산하는 참고 지표. 같은 기준을 두 추천에 똑같이 적용한다.
- judge: LLM 심사. 어느 쪽이 검색을 썼는지 숨기고 순서를 무작위로 섞는다(위치 편향 완화).
  심사에는 공유 노트만 주고 검색 자료는 주지 않는다. 자료와 비슷하다는 이유로 점수를 받지 않게 하기 위해서다.
어느 지표도 사람 평가를 대신하지 않는다. 화면에서는 사람 평가와 나란히 보여준다.
"""
from __future__ import annotations

import json
import random
import re

from . import ai

RUBRIC = ["노트 내용과의 관련성", "실제로 해보기 쉬움", "구체성", "새로움(지난 활동과의 차별성)"]
_KEYS = ["relevance", "feasibility", "specificity", "novelty"]


def _text(activity: dict) -> str:
    return " ".join([activity.get("title", ""), activity.get("desc", ""), activity.get("reason", "")]
                    + list(activity.get("steps", [])))


def _terms(text: str) -> set[str]:
    stop = {"있어요", "해요", "합니다", "그리고", "다음", "함께", "서로", "기록", "활동", "에서", "으로", "하고"}
    return {t for t in re.findall(r"[가-힣A-Za-z0-9]{2,}", text) if t not in stop}


def auto_metrics(activity: dict, analysis: dict | None, sources: list[dict]) -> dict:
    text = _text(activity)
    entries = (analysis or {}).get("entries", [])
    # 노트 반영도: 각 공유 기록의 핵심 단어(2글자 이상) 중 하나라도 추천에 나오면 반영으로 본다.
    reflected = 0
    for entry in entries:
        words = {w[:2] for w in _terms(entry["text"])}
        if words and any(w in text for w in words):
            reflected += 1
    # 구체성: 단계 수 + 시간·횟수 같은 숫자 + 따옴표로 제시한 실제 표현.
    concrete = len(re.findall(r"\d+\s*(?:분|개|번|명|장|줄|가지|회)", text)) + len(re.findall(r"['‘“\"][^'’”\"]{2,30}['’”\"]", text))
    # 자료 근거: 실제로 찾은 자료 ID를 [S1]처럼 명시한 단계 수. 단어 유사도로 추정하지 않는다.
    cited = {s["id"] for s in sources if s["id"] in activity.get("source_ids", [])}
    supported = sum(1 for step in activity.get("steps", []) if set(re.findall(r"S\d+", " ".join(re.findall(r"\[(S\d+(?:\s*,\s*S\d+)*)\]", step)))) & cited)
    steps = len(activity.get("steps", []))
    return {
        "note_coverage": {"value": reflected, "total": len(entries), "label": "공유 기록 반영"},
        "concrete_details": {"value": concrete, "label": "구체적 요소(시간·횟수·예시 표현)"},
        "steps": {"value": steps, "label": "실행 단계"},
        "source_support": {"value": supported, "total": steps, "label": "자료로 뒷받침된 단계"},
        "cited_sources": {"value": len(cited), "label": "인용한 자료"},
    }


def judge(notes: list[str], retrieval: dict, baseline: dict, seed: int | None = None,
          order: list[str] | None = None) -> dict | None:
    """블라인드 쌍대 비교 1회. 실패하면 None (비교 자체는 유지). order 를 주면 그 순서로 보여준다(평가 스크립트용)."""
    if order is None:
        order = ["retrieval", "baseline"]
        random.Random(seed).shuffle(order)
    items = {"retrieval": retrieval, "baseline": baseline}
    shown = {label: {k: items[name].get(k) for k in ("title", "desc", "steps")} for label, name in zip(("1", "2"), order)}
    data = ai.llm_json(
        "너는 대학생 문화 교류 활동 제안을 평가하는 심사위원이야. 공유 노트와 두 제안(1, 2)을 보고 기준별 1~5점을 매겨. "
        "제안이 어떻게 만들어졌는지는 알 수 없고 알 필요도 없어. 길이가 길다는 이유만으로 점수를 주지 마. "
        "기준: relevance(노트 내용과 관련), feasibility(20~30분 안에 부담 없이 해볼 수 있음), "
        "specificity(무엇을 어떤 순서로 할지 바로 알 수 있음), novelty(노트에 적힌 지난 활동의 단순 반복이 아님). "
        'JSON: {"scores":{"1":{"relevance":1,"feasibility":1,"specificity":1,"novelty":1},"2":{...}},'
        '"winner":"1|2|tie","reason":"120자 이하 한국어"}',
        json.dumps({"shared_notes": notes, "proposals": shown}, ensure_ascii=False),
    )
    try:
        scores = {name: {key: int(data["scores"][label][key]) for key in _KEYS}
                  for label, name in zip(("1", "2"), order)}
        if not all(1 <= v <= 5 for side in scores.values() for v in side.values()):
            return None
        winner = {"1": order[0], "2": order[1], "tie": "tie"}.get(str(data.get("winner")), "tie")
        reason = data.get("reason") if isinstance(data.get("reason"), str) else ""
        names = {"retrieval": "자료 참고 제안", "baseline": "기록만 쓴 제안"}
        for label, name in zip(("1", "2"), order):
            reason = re.sub(rf"제안\s*{label}(?!\d)|(?<![\d])\b{label}번?\s*(?=(?:은|는|이|가|의|보다)\b)", names[name], reason)
    except (TypeError, KeyError, ValueError):
        return None
    totals = {name: sum(side.values()) for name, side in scores.items()}
    return {"scores": scores, "totals": totals, "winner": winner, "reason": reason[:200],
            "order": order, "criteria": dict(zip(_KEYS, RUBRIC)), "model": ai.llm_status().get("model")}


def evaluate(notes: list[str], analysis: dict, retrieval: dict, baseline: dict, seed: int | None = None) -> dict:
    return {
        "auto": {"retrieval": auto_metrics(retrieval, analysis, retrieval.get("retrieved_sources") or retrieval.get("sources", [])),
                 "baseline": auto_metrics(baseline, analysis, [])},
        "judge": judge(notes, retrieval, baseline, seed),
    }
