import httpx

from app import activity_eval, activity_search as search


def test_library_finds_matching_activity_without_any_key(monkeypatch):
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    found = search.search_library("카페에서 주문 표현을 배웠는데 말이 빨라서 어려웠다", ["카페 주문 역할극"])
    titles = [s["title"] for s in found]
    assert any("주문" in t for t in titles)
    assert all(s["provider"] == "library" and s["text_kind"] == "curated_guide" for s in found)


def test_sources_get_sequential_ids_and_google_is_off_by_default(monkeypatch):
    monkeypatch.setenv("ACTIVITY_SEARCH_ENABLED", "1")
    monkeypatch.delenv("ACTIVITY_GOOGLE_SEARCH", raising=False)
    monkeypatch.setattr(search, "search_wikipedia", lambda topics: ([{"title": "윷놀이 (위키백과)", "url": "https://ko.wikipedia.org/wiki/윷놀이",
                                                                    "text": "전통 놀이", "text_kind": "encyclopedia_extract", "provider": "wikipedia"}], "ok"))
    monkeypatch.setenv("ACTIVITY_WIKIPEDIA", "1")
    result = search.search_sources({"keywords": ["윷놀이"], "topics": ["윷놀이"], "signals": [], "query": "윷놀이"}, ["윷놀이를 배우고 싶다"])
    assert [s["id"] for s in result["sources"]] == [f"S{i}" for i in range(1, len(result["sources"]) + 1)]
    assert result["providers"] == {"library": "ok", "wikipedia": "ok", "google": "disabled"}
    assert result["sources"][0]["title"].startswith("전통 놀이")


def _fake_wiki(monkeypatch, search_hits, extract):
    class Client:
        def __init__(self, **kwargs): pass
        def __enter__(self): return self
        def __exit__(self, *args): pass
        def get(self, url, params):
            if params.get("list") == "search":
                body = {"query": {"search": search_hits}}
            else:
                body = {"query": {"pages": [{"title": search_hits[0]["title"], "extract": extract}]}}
            return httpx.Response(200, json=body, request=httpx.Request("GET", url))
    monkeypatch.setattr(search.httpx, "Client", Client)


def test_wikipedia_uses_only_title_matching_pages(monkeypatch):
    _fake_wiki(monkeypatch, [{"title": "윷놀이"}], "윷놀이는 4개의 윷가락을 던지는 놀이다.")
    found, status = search.search_wikipedia(["윷놀이"])
    assert status == "ok" and found[0]["url"].startswith("https://ko.wikipedia.org/wiki/")
    _fake_wiki(monkeypatch, [{"title": "전혀 다른 문서"}], "무관")
    assert search.search_wikipedia(["윷놀이"]) == ([], "empty")


def test_wikipedia_network_failure_is_reported_not_raised(monkeypatch):
    class Client:
        def __init__(self, **kwargs): pass
        def __enter__(self): return self
        def __exit__(self, *args): pass
        def get(self, *a, **k): raise httpx.ConnectError("down")
    monkeypatch.setattr(search.httpx, "Client", Client)
    assert search.search_wikipedia(["추석"]) == ([], "failed")


def test_judge_unshuffles_blind_order(monkeypatch):
    # 심사 모델은 1/2만 본다. 서버가 원래 이름으로 되돌려야 한다.
    monkeypatch.setattr(activity_eval.ai, "llm_json", lambda s, u: {
        "scores": {"1": {"relevance": 5, "feasibility": 5, "specificity": 5, "novelty": 5},
                   "2": {"relevance": 1, "feasibility": 1, "specificity": 1, "novelty": 1}},
        "winner": "1", "reason": "1이 구체적"})
    a, b = {"title": "A", "desc": "", "steps": []}, {"title": "B", "desc": "", "steps": []}
    for seed in range(6):
        result = activity_eval.judge(["노트"], a, b, seed=seed)
        first = result["order"][0]
        assert result["winner"] == first and result["totals"][first] == 20


def test_auto_metrics_count_note_coverage_and_supported_steps():
    analysis = {"entries": [{"id": "N1", "text": "카페 주문 표현"}, {"id": "N2", "text": "윷놀이 하고 싶다"}]}
    activity = {"title": "카페 주문 연습", "desc": "", "reason": "", "steps": ["10분 동안 '주세요' 연습 [S1]", "역할 바꾸기"], "source_ids": ["S1"]}
    metrics = activity_eval.auto_metrics(activity, analysis, [{"id": "S1", "text": "역할극"}])
    assert metrics["note_coverage"] == {"value": 1, "total": 2, "label": "공유 기록 반영"}
    assert metrics["source_support"]["value"] == 1
    assert metrics["concrete_details"]["value"] >= 2
