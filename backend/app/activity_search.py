"""다음 활동 추천용 자료 검색. 무료로 동작하는 순서대로 합친다.

1) 교류 활동 자료집(data/activity_library.json): 팀이 직접 정리한 활동 방법. 키·네트워크 없이 항상 동작.
2) 한국어 위키백과 API: 노트에 나온 문화 주제의 배경 설명. 키 없이 무료, 실제 원문 링크가 있음.
3) Google 검색 그라운딩(선택): ACTIVITY_GOOGLE_SEARCH=1 일 때만. 무료 키에서는 한도가 거의 없어 기본은 끈다.

외부로는 분석 단계에서 걸러진 짧은 키워드만 나가고, 노트 원문은 나가지 않는다.
"""
from __future__ import annotations

import json
import os
import re
from functools import lru_cache
from urllib.parse import quote

import httpx

from . import ai

WIKI_API = "https://ko.wikipedia.org/w/api.php"
USER_AGENT = "SOOKMATE/0.2 (+https://github.com/song-eunji/SOOKMATE; student prototype) python-httpx"


@lru_cache(maxsize=1)
def library() -> list[dict]:
    return json.loads((ai.DATA_DIR / "activity_library.json").read_text(encoding="utf-8"))


def enabled(name: str, default: str) -> bool:
    return os.getenv(name, default).strip() not in ("0", "false", "False", "")


def _terms(text: str) -> list[str]:
    return [t for t in re.findall(r"[0-9A-Za-z가-힣\-]+", text) if len(t) >= 2]


def search_library(query_text: str, keywords: list[str], k: int = 3) -> list[dict]:
    """노트·키워드와 가장 가까운 활동 방법 k개. 태그가 직접 겹치면 가산점."""
    q = ai.embed(query_text)
    terms = set(_terms(" ".join(keywords) + " " + query_text))
    scored = []
    for doc in library():
        body = doc["title"] + " " + " ".join(doc["tags"]) + " " + doc["text"]
        score = ai.sim(q, ai.embed(body))
        tag_hits = [tag for tag in doc["tags"] if any(tag in term or term in tag for term in terms if len(term) >= 2)]
        score += 0.12 * len(tag_hits)
        scored.append((score, tag_hits, doc))
    scored.sort(key=lambda row: -row[0])
    picked = [row for row in scored if row[1]][:k] or scored[:k]
    return [{"title": doc["title"], "url": "", "text": doc["text"], "text_kind": "curated_guide",
             "provider": "library", "library_id": doc["id"], "matched": hits,
             "minutes": doc.get("minutes"), "cost": doc.get("cost"), "score": round(score, 3)}
            for score, hits, doc in picked]


def _wiki_get(client: httpx.Client, params: dict) -> dict:
    response = client.get(WIKI_API, params={**params, "format": "json", "utf8": 1, "formatversion": 2})
    response.raise_for_status()
    return response.json()


def search_wikipedia(topics: list[str], k: int = 2) -> tuple[list[dict], str]:
    """주제 명사로 위키백과를 찾고, 제목이 주제와 맞는 문서의 첫 문단만 쓴다."""
    topics = [t.strip() for t in topics if t and t.strip()][:3]
    if not topics:
        return [], "no_topic"
    found: list[dict] = []
    try:
        with httpx.Client(timeout=httpx.Timeout(6, connect=3), headers={"User-Agent": USER_AGENT}) as client:
            for topic in topics:
                if len(found) >= k:
                    break
                hits = _wiki_get(client, {"action": "query", "list": "search", "srsearch": topic,
                                          "srlimit": 3, "srnamespace": 0}).get("query", {}).get("search", [])
                # 정밀도 우선: 제목이 주제를 포함하거나 주제가 제목을 포함할 때만 쓴다.
                key = topic.replace(" ", "")
                # 제목이 주제를 포함하거나, 주제와 거의 같은 길이로 겹칠 때만 ("한국 전통 놀이" → "한국" 은 버린다)
                match = next((hit for hit in hits if key in hit["title"].replace(" ", "")
                              or (hit["title"].replace(" ", "") in key and len(hit["title"].replace(" ", "")) >= 0.7 * len(key))), None)
                if not match or any(s["title"] == match["title"] for s in found):
                    continue
                pages = _wiki_get(client, {"action": "query", "prop": "extracts", "exintro": 1, "explaintext": 1,
                                           "exsentences": 3, "redirects": 1, "titles": match["title"]})
                page = (pages.get("query", {}).get("pages") or [{}])[0]
                extract = (page.get("extract") or "").strip()
                if not extract or "동음이의" in extract[:80] or "다음을 가리킨다" in extract[:120]:
                    continue
                title = page.get("title", match["title"])
                found.append({"title": f"{title} (위키백과)", "url": f"https://ko.wikipedia.org/wiki/{quote(title.replace(' ', '_'))}",
                              "text": extract[:500], "text_kind": "encyclopedia_extract", "provider": "wikipedia",
                              "matched": [topic]})
    except httpx.TimeoutException:
        return found, "timeout" if not found else "ok"
    except (httpx.HTTPError, ValueError, KeyError, IndexError, TypeError):
        return found, "failed" if not found else "ok"
    return found, "ok" if found else "empty"


def search_sources(analysis: dict, notes: list[str]) -> dict:
    """세 공급원의 결과를 합쳐 S1.. ID를 붙인다. 공급원별 상태를 남겨 화면에서 보여준다."""
    keywords = analysis.get("keywords") or []
    topics = analysis.get("topics") or []
    providers: dict[str, str] = {}
    sources: list[dict] = []
    grounding = None

    if enabled("ACTIVITY_SEARCH_ENABLED", "1"):
        query_text = " ".join(keywords + [s.get("text", "") for s in analysis.get("signals", [])] + notes)
        lib = search_library(query_text, keywords)
        sources += lib
        providers["library"] = "ok" if lib else "empty"

        if enabled("ACTIVITY_WIKIPEDIA", "1"):
            wiki, providers["wikipedia"] = search_wikipedia(topics)
            sources += wiki
        else:
            providers["wikipedia"] = "disabled"

        if enabled("ACTIVITY_GOOGLE_SEARCH", "0") and analysis.get("query"):
            from .google_search import search as google_search
            found = google_search(analysis["query"])
            providers["google"] = found["status"]
            grounding = found.get("grounding")
            for source in found["sources"]:
                sources.append({**source, "provider": "google"})
        else:
            providers["google"] = "disabled"
    else:
        providers = {"library": "disabled", "wikipedia": "disabled", "google": "disabled"}

    # Google 그라운딩은 자체 S 번호를 쓰므로 근거 구간의 번호도 함께 바꾼다.
    remap = {}
    for index, source in enumerate(sources, 1):
        if source.get("provider") == "google":
            remap[source["id"]] = f"S{index}"
        source["id"] = f"S{index}"
    if grounding:
        grounding = {**grounding, "segments": [{**seg, "source_ids": [remap.get(i, i) for i in seg["source_ids"]]}
                                               for seg in grounding.get("segments", [])]}
    status = "ok" if sources else ("disabled" if providers.get("library") == "disabled" else "empty")
    return {"sources": sources, "status": status, "providers": providers, "provider": "+".join(
        name for name, state in providers.items() if state == "ok") or "none", "grounding": grounding}
