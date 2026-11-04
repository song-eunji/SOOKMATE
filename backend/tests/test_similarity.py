import math

from app import ai


def test_set_sim_empty_is_zero():
    assert ai.set_sim([], ["카페"]) == 0.0
    assert ai.set_sim(["카페"], []) == 0.0


def test_set_sim_ignores_order():
    assert ai.set_sim(["카페", "영화"], ["영화", "카페"]) > 0.99


def test_set_sim_more_overlap_scores_higher():
    mine = ["카페", "영화", "산책"]
    assert ai.set_sim(mine, ["카페", "영화", "독서"]) > ai.set_sim(mine, ["카페", "러닝", "독서"])
    assert ai.set_sim(mine, ["카페", "러닝", "독서"]) > ai.set_sim(mine, ["러닝", "독서", "여행"])


def test_sim_stretches_model_vectors_only():
    d = ai.embed_ngram("카페")
    assert ai.sim(d, d) == ai.cosine(d, d)

    def vec(cos):
        return (cos, math.sqrt(1 - cos * cos))

    base = (1.0, 0.0)
    assert ai.sim(base, vec(ai.SIM_FLOOR)) < 1e-9
    assert abs(ai.sim(base, vec(ai.SIM_CEIL)) - 1.0) < 1e-9
    assert ai.sim(base, vec(0.5)) == 0.0
