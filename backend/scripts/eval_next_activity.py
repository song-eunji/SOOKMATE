"""검색 기반 추천 vs 검색 없는 추천 비교 평가 (합성 시나리오, 실제 무료 모델 호출).

실행: cd backend && python scripts/eval_next_activity.py [--limit 6]
- 같은 노트 분석 결과를 두 생성에 똑같이 넣고, 자료 제공 여부만 다르게 한다.
- 심사는 블라인드이고 A/B 순서를 바꿔 두 번 한다(위치 편향 상쇄). 두 번의 판정이 엇갈리면 무승부로 센다.
- 결과는 scripts/results/next_activity_eval.json 과 .md 로 저장한다. 학생 실제 데이터는 쓰지 않는다.
모델 호출: 시나리오당 최대 5회(분석 1 + 생성 2 + 심사 2).
"""
import argparse
import json
import sys
import time
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from dotenv import load_dotenv  # noqa: E402
load_dotenv(ROOT / ".env")

from app import ai  # noqa: E402
from app.activity_eval import RUBRIC, _KEYS, auto_metrics, judge  # noqa: E402
from app.activity_search import search_sources  # noqa: E402
from app.next_activity import analyze, generate  # noqa: E402

SCENARIOS = [
    ("주문 표현 + 빠른 말", [("A", "expr", "카페에서 '아이스 아메리카노 한 잔 주세요' 표현을 배웠다."),
                          ("B", "fact", "직원이 말을 빨리 해서 포장인지 묻는 걸 못 알아들었다.")]),
    ("전통 놀이 희망", [("B", "next_text", "다음에는 윷놀이 같은 한국 전통 놀이를 배워 보고 싶다.")]),
    ("서로 다른 희망", [("A", "next_text", "도자기 공방에 가 보고 싶다."),
                    ("B", "next_text", "돈을 쓰지 않고 학교 안에서 잠깐 이야기하고 싶다.")]),
    ("명절 이야기", [("A", "fact", "추석에 송편을 만든다는 걸 처음 알았다."),
                  ("B", "expr", "'명절 잘 보내세요'라는 인사를 배웠다.")]),
    ("학교생활 적응", [("A", "fact", "도서관 좌석 예약을 앱으로 해야 한다는 걸 알았다."),
                   ("B", "next_text", "교수님께 이메일 보내는 표현을 알고 싶다.")]),
    ("K-POP 관심", [("A", "expr", "노래 가사에 나온 '설레다'라는 말을 배웠다."),
                   ("B", "next_text", "좋아하는 노래 가사를 서로 설명해 보고 싶다.")]),
]


def call_ok(status):
    return status.get("status") not in ("daily_quota_exhausted", "minute_quota_exhausted", "rate_limited")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, default=len(SCENARIOS))
    parser.add_argument("--pause", type=float, default=4.0, help="분당 한도 보호용 대기(초)")
    args = parser.parse_args()
    rows = []
    for label, notes_spec in SCENARIOS[: args.limit]:
        entries = [{"id": f"N{i + 1}", "participant": who, "field": field, "text": text}
                   for i, (who, field, text) in enumerate(notes_spec)]
        ex, notes = {"common_interests": [], "shared_entries": entries}, [e["text"] for e in entries]
        analysis = analyze(ex, notes)
        found = search_sources(analysis, notes)
        rag = generate(ex, notes, found["sources"], analysis)
        base = generate(ex, notes, [], analysis)
        if rag["generation_mode"] != "llm" or base["generation_mode"] != "llm":
            print(f"[건너뜀] {label}: 생성 실패 {rag['llm_status']} / {base['llm_status']}", flush=True)
            if not call_ok(ai.llm_status()):
                break
            continue
        verdicts = [judge(notes, rag, base, order=["retrieval", "baseline"]),
                    judge(notes, rag, base, order=["baseline", "retrieval"])]
        verdicts = [v for v in verdicts if v]
        winners = {v["winner"] for v in verdicts}
        final = winners.pop() if len(winners) == 1 and verdicts else "tie"
        row = {"scenario": label, "notes": notes, "keywords": analysis["keywords"], "topics": analysis["topics"],
               "providers": found["providers"], "sources": [s["title"] for s in found["sources"]],
               "retrieval": {k: rag.get(k) for k in ("title", "desc", "steps", "source_ids", "minutes", "prep")},
               "baseline": {k: base.get(k) for k in ("title", "desc", "steps", "minutes", "prep")},
               "auto": {"retrieval": auto_metrics(rag, analysis, found["sources"]), "baseline": auto_metrics(base, analysis, [])},
               "judges": verdicts, "winner": final, "model": rag["llm"]["model"]}
        rows.append(row)
        print(f"[완료] {label}: 승자={final}, 판정 {len(verdicts)}회, 자료 {len(found['sources'])}개", flush=True)
        time.sleep(args.pause)

    out = ROOT / "scripts" / "results"
    out.mkdir(parents=True, exist_ok=True)
    (out / "next_activity_eval.json").write_text(json.dumps(rows, ensure_ascii=False, indent=1), encoding="utf-8")
    (out / "next_activity_eval.md").write_text(report(rows), encoding="utf-8")
    print(report(rows))


def mean(values):
    return round(sum(values) / len(values), 2) if values else 0


def report(rows):
    n = len(rows)
    win = {k: sum(1 for r in rows if r["winner"] == k) for k in ("retrieval", "baseline", "tie")}
    lines = [f"# 다음 활동 추천 비교 평가 ({date.today().isoformat()})", "",
             f"- 합성 시나리오 {n}개, 생성 모델: {', '.join(sorted({r['model'] for r in rows})) or '-'}",
             "- 두 생성은 같은 노트 분석을 쓰고 자료 제공 여부만 다르다. 심사는 블라인드, 순서를 바꿔 2회.",
             "- 주의: 표본이 작고 심사도 LLM이다. 경향 확인용이며 사용자 평가를 대신하지 않는다.", "",
             "## 블라인드 심사 결과", "",
             "| 자료 참고 승 | 기록만 승 | 무승부(판정 엇갈림 포함) |", "|---|---|---|",
             f"| {win['retrieval']} | {win['baseline']} | {win['tie']} |", "",
             "## 기준별 평균 점수 (1~5, 두 순서 평균)", "", "| 기준 | 자료 참고 | 기록만 |", "|---|---|---|"]
    for key, name in zip(_KEYS, RUBRIC):
        r = mean([v["scores"]["retrieval"][key] for row in rows for v in row["judges"]])
        b = mean([v["scores"]["baseline"][key] for row in rows for v in row["judges"]])
        lines.append(f"| {name} | {r} | {b} |")
    lines += ["", "## 자동 지표 평균", "", "| 지표 | 자료 참고 | 기록만 |", "|---|---|---|"]
    for key in ("note_coverage", "concrete_details", "steps", "source_support", "cited_sources"):
        label = rows[0]["auto"]["retrieval"][key]["label"] if rows else key
        r = mean([row["auto"]["retrieval"][key]["value"] for row in rows])
        b = mean([row["auto"]["baseline"][key]["value"] for row in rows])
        lines.append(f"| {label} | {r} | {b} |")
    lines += ["", "## 시나리오별", ""]
    for row in rows:
        lines += [f"### {row['scenario']} → {({'retrieval': '자료 참고', 'baseline': '기록만', 'tie': '무승부'})[row['winner']]}",
                  f"- 노트: {' / '.join(row['notes'])}", f"- 찾은 자료: {', '.join(row['sources']) or '없음'}",
                  f"- 자료 참고: **{row['retrieval']['title']}**", f"- 기록만: **{row['baseline']['title']}**"]
        for v in row["judges"]:
            lines.append(f"- 심사({'→'.join(v['order'])}): {v['reason']}")
        lines.append("")
    return "\n".join(lines)


if __name__ == "__main__":
    main()
