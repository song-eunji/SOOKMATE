"""시간 단위 선택과 이전 프로필의 호환성을 검증한다."""
from app.constants import TIME_SLOTS, expand_times
from app.main import ProfileIn


def test_legacy_periods_expand_without_duplicates():
    assert expand_times(["월 오전", "월 10:00–11:00"]) == [
        "월 09:00–10:00", "월 10:00–11:00", "월 11:00–12:00"
    ]


def test_exact_slots_do_not_overlap_at_boundary():
    assert not set(expand_times(["수 13:00–14:00"])) & set(expand_times(["수 14:00–15:00"]))
    assert set(expand_times(["수 오후"])) & set(expand_times(["수 13:00–14:00"])) == {"수 13:00–14:00"}


def test_options_cover_five_days_from_nine_to_twenty_two():
    assert len(TIME_SLOTS) == 65
    assert TIME_SLOTS[0] == "월 09:00–10:00"
    assert TIME_SLOTS[-1] == "금 21:00–22:00"


def test_profile_saves_hour_slots_and_accepts_legacy_clients():
    assert ProfileIn(times=["월 오전"]).times == expand_times(["월 오전"])
    assert ProfileIn(times=["금 20:00–21:00"]).times == ["금 20:00–21:00"]


def test_profile_rejects_unknown_time():
    import pytest
    from pydantic import ValidationError
    with pytest.raises(ValidationError):
        ProfileIn(times=["금 25:00–26:00"])
