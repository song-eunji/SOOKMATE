"""임베딩 설정별 '정답이 있는' 품질 비교.

정답: 관심사 14개를 5개 언어(ko/en/ja/zh/vi)로 적어 두고, 같은 개념이면 같은 뜻으로 본다.
  A. 항목 단위: 언어가 다른 두 표현이 같은 개념인지 구분하는 정도 (AUC)
  B. 목록 단위: 두 사람의 관심사 목록 유사도가 '개념 겹침(Jaccard)'과 얼마나 같은 순서인지 (Spearman)

실행 (backend 폴더에서):  python -m scripts.eval_quality [모델이름 ...]
"""
import itertools
import os
import random
import sys

from app import ai

CONCEPTS = {
    "카페": ["카페", "cafe", "カフェ", "咖啡馆", "quán cà phê"],
    "맛집": ["맛집", "good restaurants", "美味しい店", "美食餐厅", "quán ăn ngon"],
    "전시": ["전시", "exhibitions", "展覧会", "展览", "triển lãm"],
    "영화": ["영화", "movies", "映画", "电影", "phim điện ảnh"],
    "드라마": ["드라마", "TV dramas", "ドラマ", "电视剧", "phim truyền hình"],
    "독서": ["독서", "reading books", "読書", "阅读", "đọc sách"],
    "사진": ["사진", "photography", "写真", "摄影", "nhiếp ảnh"],
    "음악": ["음악", "music", "音楽", "音乐", "âm nhạc"],
    "K-pop": ["K-pop", "케이팝", "Kポップ", "韩国流行音乐", "nhạc K-pop"],
    "러닝": ["러닝", "running", "ランニング", "跑步", "chạy bộ"],
    "산책": ["산책", "taking walks", "散歩", "散步", "đi dạo"],
    "보드게임": ["보드게임", "board games", "ボードゲーム", "桌游", "trò chơi board game"],
    "요리": ["요리", "cooking", "料理", "烹饪", "nấu ăn"],
    "여행": ["여행", "traveling", "旅行", "旅游", "du lịch"],
}
# 숙명여대 공식 영문 페이지(2026.4.1 기준) 학부 유학생 상위 국적: 몽골 30.2%, 미얀마 15.0%, 베트남 13.6%, 중국 13.0%, 네팔 11.2%
# 몽골어(mn)·미얀마어(my)·네팔어(ne) 번역은 아직 원어민 검수 전이다.
EXTRA = {
    "카페": ["кафе", "ကော်ဖီဆိုင်", "क्याफे"],
    "맛집": ["амттай ресторан", "စားသောက်ဆိုင်ကောင်းများ", "राम्रो रेस्टुरेन्ट"],
    "전시": ["үзэсгэлэн", "ပြပွဲ", "प्रदर्शनी"],
    "영화": ["кино", "ရုပ်ရှင်", "चलचित्र"],
    "드라마": ["драма", "ဒရာမာ", "टिभी नाटक"],
    "독서": ["ном унших", "စာဖတ်ခြင်း", "पुस्तक पढ्ने"],
    "사진": ["гэрэл зураг", "ဓာတ်ပုံ", "फोटोग्राफी"],
    "음악": ["хөгжим", "ဂီတ", "संगीत"],
    "K-pop": ["К-поп", "ကေပေါ့ပ်", "के-पप"],
    "러닝": ["гүйлт", "အပြေးလေ့ကျင့်ခြင်း", "दौड"],
    "산책": ["алхалт", "လမ်းလျှောက်ခြင်း", "टहल"],
    "보드게임": ["ширээний тоглоом", "ဘုတ်ဂိမ်း", "बोर्ड गेम"],
    "요리": ["хоол хийх", "ချက်ပြုတ်ခြင်း", "खाना पकाउने"],
    "여행": ["аялал", "ခရီးသွားခြင်း", "यात्रा"],
}
for _c, _v in EXTRA.items():
    CONCEPTS[_c] += _v
LANGS = ["ko", "en", "ja", "zh", "vi", "mn", "my", "ne"]


def cos(a, b):
    return sum(x * y for x, y in zip(a, b))


def agg_joined(A, B, emb):
    return cos(emb(" ".join(sorted(A))), emb(" ".join(sorted(B))))


def agg_bestmatch(A, B, emb):
    ea, eb = [emb(x) for x in A], [emb(x) for x in B]
    ab = sum(max(cos(x, y) for y in eb) for x in ea) / len(ea)
    ba = sum(max(cos(y, x) for x in ea) for y in eb) / len(eb)
    return (ab + ba) / 2


def agg_centroid(A, B, emb):
    def mean(vs):
        n = len(vs)
        m = [sum(c) / n for c in zip(*vs)]
        norm = sum(x * x for x in m) ** 0.5 or 1.0
        return [x / norm for x in m]

    return cos(mean([emb(x) for x in A]), mean([emb(x) for x in B]))


AGGS = {"joined(현재)": agg_joined, "bestmatch": agg_bestmatch, "centroid": agg_centroid}


def auc(pos, neg):
    wins = sum((p > n) + 0.5 * (p == n) for p in pos for n in neg)
    return wins / (len(pos) * len(neg))


def ranks(xs):
    order = sorted(range(len(xs)), key=lambda i: xs[i])
    r = [0.0] * len(xs)
    i = 0
    while i < len(order):
        j = i
        while j + 1 < len(order) and xs[order[j + 1]] == xs[order[i]]:
            j += 1
        for k in range(i, j + 1):
            r[order[k]] = (i + j) / 2 + 1
        i = j + 1
    return r


def spearman(x, y):
    rx, ry = ranks(x), ranks(y)
    mx, my = sum(rx) / len(rx), sum(ry) / len(ry)
    num = sum((a - mx) * (b - my) for a, b in zip(rx, ry))
    den = (sum((a - mx) ** 2 for a in rx) * sum((b - my) ** 2 for b in ry)) ** 0.5
    return num / den if den else 0.0


def item_pairs():
    pos, neg = [], []
    for c1, c2 in itertools.product(CONCEPTS, repeat=2):
        for i, j in itertools.product(range(len(LANGS)), repeat=2):
            if i == j:
                continue
            (pos if c1 == c2 else neg).append((CONCEPTS[c1][i], CONCEPTS[c2][j]))
    return pos, neg


def list_pairs(n=400, seed=1):
    rnd = random.Random(seed)
    names = list(CONCEPTS)
    out = []
    for _ in range(n):
        ca, cb = rnd.sample(names, rnd.randint(2, 5)), rnd.sample(names, rnd.randint(2, 5))
        lb = rnd.choice(LANGS[1:])
        A = [CONCEPTS[c][0] for c in ca]
        B = [CONCEPTS[c][LANGS.index(lb)] for c in cb]
        out.append((A, B, len(set(ca) & set(cb)) / len(set(ca) | set(cb))))
    return out


def evaluate(model: str | None):
    if model:
        ai.EMBED_MODEL = model
        ai._st_model.cache_clear()
        ai.embed_st.cache_clear()
    ai.EMBED_BACKEND = "st"
    ai._st_failed = False

    def emb(t):
        return ai.embed_st(t)

    pos, neg = item_pairs()
    sp = [cos(emb(a), emb(b)) for a, b in pos]
    sn = [cos(emb(a), emb(b)) for a, b in neg]
    print(f"\n== 모델 {ai.EMBED_MODEL}")
    print(f"A. 항목 단위 AUC {auc(sp, sn):.3f}  (같은 뜻 평균 {sum(sp)/len(sp):.3f} / 다른 뜻 평균 {sum(sn)/len(sn):.3f})")
    per = []
    for k, lg in enumerate(LANGS[1:], start=1):
        p = [cos(emb(CONCEPTS[c][0]), emb(CONCEPTS[c][k])) for c in CONCEPTS]
        n = [cos(emb(CONCEPTS[a][0]), emb(CONCEPTS[b][k])) for a in CONCEPTS for b in CONCEPTS if a != b]
        per.append(f"{lg} {auc(p, n):.3f}")
    print("   언어별 AUC(ko↔):", "  ".join(per))
    lists = list_pairs()
    truth = [j for _, _, j in lists]
    for name, f in AGGS.items():
        pred = [f(A, B, emb) for A, B, _ in lists]
        print(f"B. 목록 단위 Spearman [{name:<12}] {spearman(pred, truth):.3f}")


if __name__ == "__main__":
    models = sys.argv[1:] or [None]
    for m in models:
        evaluate(m)
