"""브리핑 RAG 검색 비교: 기존 방식(질의 한 줄) vs 개인 선호 우선 검색.

기획서 6-(4): 관련 자료와 개인 선호를 함께 LLM에 전달하고 개인 선호를 우선한다.
정답: 선호마다 '꼭 나와야 하는 자료'를 사람이 정해 두고, 상위 3개 안에 들어오는지 본다.
  - 선호 반영률: 정답 자료 중 상위 3개에 들어온 비율
  - 1순위 적중률: 1순위 자료가 정답 중 하나인 비율
선호는 한국어와 유학생이 직접 쓸 법한 외국어(영·일·중·베)로 함께 적었다.

실행 (backend 폴더에서):  python -m scripts.eval_rag
다국어 모델로:            EMBED_BACKEND=st python -m scripts.eval_rag
"""
from app import ai

# (공개한 선호, 공통 관심사, 꼭 나와야 하는 자료)
CASES = [
    (["조용한 장소를 좋아해요"], ["카페"], {"doc-quiet-place"}),
    (["매운 음식은 피해요"], ["맛집"], {"doc-food-preference"}),
    (["조용한 장소를 좋아해요", "매운 음식은 피해요"], ["카페"], {"doc-quiet-place", "doc-food-preference"}),
    (["천천히 말해주면 좋아요"], ["전시"], {"doc-slow-talk"}),
    (["채식 메뉴가 있으면 좋아요"], ["요리"], {"doc-food-preference"}),
    (["사람 많은 곳은 피하고 싶어요"], ["독서"], {"doc-quiet-place"}),
    (["I prefer quiet places"], ["카페"], {"doc-quiet-place"}),
    (["Please speak slowly"], ["영화"], {"doc-slow-talk"}),
    (["I'm vegetarian"], ["맛집"], {"doc-food-preference"}),
    (["静かな場所が好きです"], ["카페"], {"doc-quiet-place"}),
    (["ゆっくり話してほしいです"], ["사진"], {"doc-slow-talk"}),
    (["不太能吃辣"], ["맛집"], {"doc-food-preference"}),
    (["Mình thích chỗ yên tĩnh"], ["카페"], {"doc-quiet-place"}),
    (["Mình ăn chay"], ["요리"], {"doc-food-preference"}),
]


def old_retrieve(prefs, interests, k=3):
    """기존 make_brief 의 검색 그대로: 선호·관심사·고정 문구를 한 줄로 합쳐 찾는다."""
    query = " ".join(prefs + interests + ["첫 만남 식당 카페 주문 대화 시간"])
    q = ai.embed(query)
    scored = []
    for d in ai.culture_docs():
        s = ai.sim(q, ai.embed(d["title"] + " " + d["text"]))
        s += 0.3 * sum(1 for t in d["topics"] if t in query)
        scored.append((s, d))
    scored.sort(key=lambda x: -x[0])
    return [d for s, d in scored[:k] if s > 0.05]


def new_retrieve(prefs, interests, k=3):
    return ai.retrieve(" ".join(interests + ["첫 만남 대화 약속 장소"]), k=k, prefs=prefs)


def evaluate(fn):
    found = total = top1 = 0
    misses = []
    for prefs, interests, gold in CASES:
        ids = [d["id"] for d in fn(prefs, interests)]
        hit = gold & set(ids)
        found += len(hit)
        total += len(gold)
        top1 += bool(ids) and ids[0] in gold
        if hit != gold:
            misses.append(f"{prefs} → {ids}")
    return found / total, top1 / len(CASES), misses


def main():
    print(f"임베딩: {ai.EMBED_BACKEND}   평가 사례 {len(CASES)}개 (한국어 6 · 외국어 8)\n")
    for name, fn in (("기존(질의 한 줄)", old_retrieve), ("선호 우선 검색", new_retrieve)):
        cover, top1, misses = evaluate(fn)
        print(f"[{name}] 선호 반영률 {cover:.0%}   1순위 적중률 {top1:.0%}")
        for m in misses:
            print("   놓침:", m)


if __name__ == "__main__":
    main()
