"""합성 프로필 40명으로 전체 배정을 돌려 지표를 출력한다. 임베딩 방식은 EMBED_BACKEND 로 고른다.

실행 (backend 폴더에서):
  EMBED_BACKEND=ngram python -m scripts.eval_matching
  EMBED_BACKEND=st    python -m scripts.eval_matching
결과는 한 줄 JSON 으로 나오므로 두 번 실행한 값을 나란히 비교하면 된다.
"""
import json
import os
import tempfile

os.environ["DATABASE_URL"] = f"sqlite:///{tempfile.mkdtemp()}/eval.db"  # app import 전에 지정

from sqlalchemy import select  # noqa: E402

from app import ai, matching  # noqa: E402
from app.db import Base, SessionLocal, engine  # noqa: E402
from app.models import Match, User  # noqa: E402
from app.seed import seed_demo  # noqa: E402


def main() -> None:
    Base.metadata.create_all(engine)
    with SessionLocal() as db:
        seed_demo(db)
        matching.assign(db)
        users = {u.id: u for u in db.scalars(select(User))}
        ms = db.scalars(select(Match)).all()

        totals = [matching.score_pair(users[m.domestic_id], users[m.international_id])["total"] for m in ms]
        violations = sum(
            1 for m in ms if not matching.hard_filter(users[m.domestic_id], users[m.international_id], set())
        )
        matched = {m.domestic_id for m in ms} | {m.international_id for m in ms}
        pairs = sorted(f"{m.domestic_id}-{m.international_id}" for m in ms)
        out = {
            "backend": ai.EMBED_BACKEND if not ai._st_failed else "ngram(대체)",
            "users": len(users),
            "matches": len(ms),
            "avg_score": round(sum(totals) / len(totals), 4) if totals else 0,
            "violations": violations,
            "unmatched_users": len(users) - len(matched),
            "unmatched_rate": round((len(users) - len(matched)) / len(users), 3),
            "pairs": pairs,
        }
        print(json.dumps(out, ensure_ascii=False))


if __name__ == "__main__":
    main()
