"""Manual model quality check; three synthetic cases, no search or student DB mutations.
Run from backend: python scripts/check_activity_scenarios.py
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from dotenv import load_dotenv
load_dotenv(Path(__file__).resolve().parents[1] / ".env")
from app.next_activity import generate

CASES = [
    ("한쪽만 기록", [("A", "expr", "주문할게요라는 표현을 배웠다.")]),
    ("경험과 어려움", [("A", "expr", "카페에서 주문할 때 쓰는 표현을 배웠다."),
                  ("B", "fact", "대화가 빨라서 몇 번 못 알아들었다.")]),
    ("서로 다른 희망", [("A", "next_text", "도자기를 만들어 보고 싶다."),
                   ("B", "next_text", "돈을 쓰지 않고 학교에서 잠깐 이야기하고 싶다.")]),
]
for label, rows in CASES:
    entries = [{"id": f"N{i+1}", "participant": author, "field": field, "text": text}
               for i, (author, field, text) in enumerate(rows)]
    analysis = {"entries": entries, "signals": [], "keywords": [], "mode": "manual_fixture", "query": ""}
    result = generate({"common_interests": [], "shared_entries": entries}, [e["text"] for e in entries], [], analysis)
    print(json.dumps({"scenario": label, "mode": result["generation_mode"], "status": result["llm_status"],
                      "title": result["title"], "desc": result["desc"], "reason": result["reason"],
                      "steps": result["steps"]}, ensure_ascii=False), flush=True)
    if result["llm_status"].get("status") in ("daily_quota_exhausted", "rate_limited", "minute_quota_exhausted"):
        break
