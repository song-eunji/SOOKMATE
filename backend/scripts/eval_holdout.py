"""관심사·주제 두 평가 세트로 하한/상한과 집계 방식을 홀드아웃 검증한다.

실행 (backend 폴더에서):  python -m scripts.eval_holdout [모델이름]
"""
import itertools
import random
import sys

import numpy as np

from app import ai
from scripts import eval_quality as q

ai.EMBED_BACKEND = "st"
ai.EMBED_MODEL = sys.argv[1] if len(sys.argv) > 1 else "BAAI/bge-m3"

TOPICS = {
    "캠퍼스 생활 팁": ["캠퍼스 생활 팁", "campus life tips", "キャンパスライフのコツ", "校园生活小贴士", "mẹo sinh hoạt ở trường"],
    "식당 주문 요령": ["식당 주문 요령", "how to order at restaurants", "食堂での注文の仕方", "餐厅点餐方法", "cách gọi món ở nhà hàng"],
    "한국어 표현": ["한국어 표현", "Korean expressions", "韓国語の表現", "韩语表达", "cách diễn đạt tiếng Hàn"],
    "과제·수강신청 팁": ["과제·수강신청 팁", "tips for assignments and course registration", "課題と履修登録のコツ", "作业和选课技巧", "mẹo làm bài tập và đăng ký môn học"],
    "서울 카페·맛집": ["서울 카페·맛집", "cafes and restaurants in Seoul", "ソウルのカフェ・グルメ", "首尔咖啡馆和美食", "quán cà phê và quán ngon ở Seoul"],
    "일본어 일상 표현": ["일본어 일상 표현", "everyday Japanese expressions", "日本語の日常表現", "日语日常表达", "cách nói tiếng Nhật hằng ngày"],
    "일본 문화": ["일본 문화", "Japanese culture", "日本文化", "日本文化", "văn hóa Nhật Bản"],
    "중국어 표현": ["중국어 표현", "Chinese expressions", "中国語の表現", "汉语表达", "cách diễn đạt tiếng Trung"],
    "중국 문화": ["중국 문화", "Chinese culture", "中国文化", "中国文化", "văn hóa Trung Quốc"],
    "베트남어 기초": ["베트남어 기초", "basic Vietnamese", "ベトナム語の基礎", "越南语基础", "tiếng Việt cơ bản"],
    "베트남 음식 이야기": ["베트남 음식 이야기", "stories about Vietnamese food", "ベトナム料理の話", "越南美食故事", "chuyện ẩm thực Việt Nam"],
    "English 회화": ["English 회화", "English conversation", "英会話", "英语会话", "hội thoại tiếng Anh"],
    "미국 대학 문화": ["미국 대학 문화", "American college culture", "アメリカの大学文化", "美国大学文化", "văn hóa đại học Mỹ"],
}
T_LANGS = ["ko", "en", "ja", "zh", "vi"]

PHRASES = {
    "음악": ["음악", "음악 듣기", "노래 듣는 것", "listening to music", "music"],
    "영화": ["영화", "영화 보기", "영화관 가는 것", "watching movies", "movies"],
    "요리": ["요리", "요리하기", "집에서 음식 만들기", "cooking at home", "cooking"],
    "여행": ["여행", "여행 다니기", "국내 여행", "traveling", "travel"],
    "러닝": ["러닝", "달리기", "조깅", "jogging", "running"],
    "독서": ["독서", "책 읽기", "소설 읽는 것", "reading novels", "reading"],
    "사진": ["사진", "사진 찍기", "카메라", "taking photos", "photography"],
    "카페": ["카페", "카페 가기", "커피 마시기", "going to cafes", "coffee"],
}


def build(strings):
    strings = sorted(set(strings))
    idx = {s: i for i, s in enumerate(strings)}
    E = np.array([ai.embed_st(s) for s in strings], dtype=np.float32)
    return idx, E @ E.T


def make_lists(kind, names, langs_w, seed, n=300):
    r = random.Random(seed)
    src = q.CONCEPTS if kind == "i" else TOPICS
    L = q.LANGS if kind == "i" else T_LANGS
    out = []
    for _ in range(n):
        ca, cb = r.sample(names, r.randint(2, min(5, len(names)))), r.sample(names, r.randint(2, min(5, len(names))))
        lg = r.choices(list(langs_w), weights=list(langs_w.values()))[0]
        k = L.index(lg)
        out.append(([src[c][0] for c in ca], [src[c][k] for c in cb], len(set(ca) & set(cb)) / len(set(ca) | set(cb))))
    return out


def agg(S, idx, A, B, fl, ce, mode):
    ia, ib = [idx[x] for x in A], [idx[y] for y in B]
    M = np.clip((S[np.ix_(ia, ib)] - fl) / (ce - fl), 0, 1)
    xy, yx = M.max(1).mean(), M.max(0).mean()
    if mode == "avg":
        return (xy + yx) / 2
    if mode == "min":
        return min(xy, yx)
    return (xy * yx) ** 0.5  # geo


I_W = {"mn": .30, "my": .15, "vi": .14, "zh": .13, "ne": .11, "en": .12, "ja": .05}
T_W = {"en": .35, "vi": .25, "zh": .25, "ja": .15}


def main():
    strings = [s for v in q.CONCEPTS.values() for s in v] + [s for v in TOPICS.values() for s in v] + [s for v in PHRASES.values() for s in v]
    idx, S = build(strings)

    pos, neg = [], []
    for c1, c2 in itertools.product(TOPICS, repeat=2):
        for i, j in itertools.product(range(5), repeat=2):
            if i != j:
                (pos if c1 == c2 else neg).append(S[idx[TOPICS[c1][i]], idx[TOPICS[c2][j]]])
    print(f"모델 {ai.EMBED_MODEL}\n주제 항목 AUC {q.auc(pos, neg):.3f}  (같은 뜻 {np.mean(pos):.3f} / 다른 뜻 {np.mean(neg):.3f})")
    pos, neg = [], []
    for c1, c2 in itertools.product(PHRASES, repeat=2):
        for i, j in itertools.product(range(5), repeat=2):
            if i != j:
                (pos if c1 == c2 else neg).append(S[idx[PHRASES[c1][i]], idx[PHRASES[c2][j]]])
    print(f"같은 언어 표현 변형 AUC {q.auc(pos, neg):.3f}  (같은 뜻 {np.mean(pos):.3f} / 다른 뜻 {np.mean(neg):.3f})")

    grid = [(fl, ce) for fl in (0.4, 0.45, 0.5, 0.55, 0.6, 0.65, 0.7) for ce in (0.75, 0.8, 0.85, 0.9) if ce > fl + 0.1]
    modes = ["avg", "min", "geo"]
    rows = {}
    for sp in range(4):
        r = random.Random(100 + sp)
        res = {}
        for kind, src, W in (("i", q.CONCEPTS, I_W), ("t", TOPICS, T_W)):
            names = list(src)
            r.shuffle(names)
            half = len(names) // 2
            tr, te = names[:half], names[half:]
            Ltr, Lte = make_lists(kind, tr, W, 1 + sp), make_lists(kind, te, W, 9 + sp)
            res[kind] = (Ltr, Lte)
        best = None
        for mode, (fl, ce) in itertools.product(modes, grid):
            tr_s = np.mean([q.spearman([agg(S, idx, A, B, fl, ce, mode) for A, B, _ in res[k][0]], [t for *_, t in res[k][0]]) for k in res])
            if best is None or tr_s > best[0]:
                best = (tr_s, mode, fl, ce)
        _, mode, fl, ce = best
        te_s = np.mean([q.spearman([agg(S, idx, A, B, fl, ce, mode) for A, B, _ in res[k][1]], [t for *_, t in res[k][1]]) for k in res])
        base = np.mean([q.spearman([agg(S, idx, A, B, 0.6, 0.8, "avg") for A, B, _ in res[k][1]], [t for *_, t in res[k][1]]) for k in res])
        print(f"분할 {sp}: 학습에서 고른 설정 {mode} floor {fl} ceil {ce} → 홀드아웃 {te_s:.3f}  (현재 설정 0.6/0.8 avg: {base:.3f})")
        rows[sp] = (mode, fl, ce, te_s, base)
    print("홀드아웃 평균: 고른 설정 %.3f / 현재 설정 %.3f" % (np.mean([v[3] for v in rows.values()]), np.mean([v[4] for v in rows.values()])))

    allL = {k: make_lists(k, list(src), W, 77, 400) for k, src, W in (("i", q.CONCEPTS, I_W), ("t", TOPICS, T_W))}
    print("\n전체 평균 (관심사+주제) 상위 8")
    sc = []
    for mode, (fl, ce) in itertools.product(modes, grid):
        v = np.mean([q.spearman([agg(S, idx, A, B, fl, ce, mode) for A, B, _ in allL[k]], [t for *_, t in allL[k]]) for k in allL])
        sc.append((v, mode, fl, ce))
    for v, mode, fl, ce in sorted(sc, reverse=True)[:8]:
        print(f"  {mode:4} floor {fl} ceil {ce}: {v:.3f}")
    cur = [x for x in sc if x[1] == "avg" and x[2] == 0.6 and x[3] == 0.8][0]
    print(f"  현재(avg 0.6/0.8): {cur[0]:.3f}")


if __name__ == "__main__":
    main()
