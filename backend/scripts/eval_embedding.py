"""임베딩 방식 비교: n-gram(기준선) vs 다국어 모델.

실행: backend 폴더에서  python -m scripts.eval_embedding
"""
from __future__ import annotations

import sys

from app import ai

# (A, B, 기대) — 기대: high 같은 뜻, mid 비슷한 분야, low 무관
PROBES = [
    ("음악", "music", "high"),
    ("K-pop", "케이팝", "high"),
    ("요리", "cooking", "high"),
    ("영화", "movie", "high"),
    ("산책", "walking", "high"),
    ("한국어 표현", "Korean phrases", "high"),
    ("일본어 일상 표현", "日本語の日常表現", "high"),
    ("영화", "드라마", "mid"),
    ("카페", "맛집", "mid"),
    ("러닝", "산책", "mid"),
    ("영화", "러닝", "low"),
    ("음악", "cooking", "low"),
    ("보드게임", "요리", "low"),
    ("독서", "러닝", "low"),
]


def score(backend: str, a: str, b: str) -> float:
    ai.EMBED_BACKEND = backend
    ai._st_failed = False
    return ai.cosine(ai.embed(a), ai.embed(b))


def main() -> None:
    rows = [(a, b, exp, score("ngram", a, b), score("st", a, b)) for a, b, exp in PROBES]
    if ai._st_failed:
        print("다국어 모델을 쓸 수 없어요. sentence-transformers 설치를 확인하세요.")
        sys.exit(1)
    print(f"{'A':<14}{'B':<20}{'기대':<6}{'n-gram':>8}{'모델':>8}")
    for a, b, exp, n, m in rows:
        print(f"{a:<14}{b:<20}{exp:<6}{n:>8.3f}{m:>8.3f}")
    for exp in ("high", "mid", "low"):
        sel = [r for r in rows if r[2] == exp]
        print(f"평균[{exp}]  n-gram {sum(r[3] for r in sel)/len(sel):.3f}  모델 {sum(r[4] for r in sel)/len(sel):.3f}")


if __name__ == "__main__":
    main()
