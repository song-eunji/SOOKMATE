"""합성 프로필 40명 (국내 26 : 유학생 14). 기획서 6-(6) 검증 조건(수 불균형, 주간 상한 2명)을 그대로 만든다.

실제 학생 정보는 하나도 없고, 이름·프로필은 모두 무작위로 만든 예시입니다.
사용자 1번 = 데모용 국내 학생, 27번 = 데모용 유학생(하루카).
"""
import random

from sqlalchemy.orm import Session

from .constants import DEFAULT_WEEKLY_CAP, INTERESTS, TIME_SLOTS
from .models import User

DOMESTIC_NAMES = [
    "수아", "민서", "하윤", "지우", "서현", "채원", "예린", "지민", "다은", "유진", "소율", "나연", "하은",
    "시은", "가은", "예서", "아린", "도아", "이서", "채아", "서아", "지안", "유나", "수민", "하린", "보라",
]
INTL = [
    ("하루카", "japan"), ("유키", "japan"), ("미오", "japan"),
    ("리나", "vietnam"), ("투안", "vietnam"), ("린", "vietnam"),
    ("웨이", "china"), ("메이", "china"), ("시아오", "china"), ("샤오리", "china"),
    ("에밀리", "us"), ("제시카", "us"), ("소피아", "us"), ("올리비아", "us"),
]
ORIGIN = {
    "japan": {"lang": "日本語", "teach": ["일본어 일상 표현", "일본 문화"]},
    "vietnam": {"lang": "Tiếng Việt", "teach": ["베트남어 기초", "베트남 음식 이야기"]},
    "china": {"lang": "中文", "teach": ["중국어 표현", "중국 문화"]},
    "us": {"lang": "English", "teach": ["English 회화", "미국 대학 문화"]},
}
UI_LANG_OF = {"japan": "ja", "vietnam": "vi", "china": "zh", "us": "en"}  # 유학생은 출신 언어 화면으로 시작
DOMESTIC_TEACH = ["캠퍼스 생활 팁", "식당 주문 요령", "한국어 표현", "과제·수강신청 팁", "서울 카페·맛집"]
DEPTS = ["인공지능공학부", "컴퓨터과학전공", "경영학부", "영어영문학부", "소프트웨어융합학부", "미디어학부"]
BIOS = [
    "카페 투어가 취미예요", "천천히 친해지고 싶어요", "전시 보러 다니는 걸 좋아해요", "산책하면서 얘기해요",
    "새로운 언어 배우는 게 즐거워요", "맛집 찾기가 특기예요", "",
]
INTL_PREFS = ["조용한 장소를 좋아해요", "매운 음식은 피해요", "천천히 말해주면 좋아요", "채식 메뉴가 있으면 좋아요"]


def seed_demo(db: Session, seed: int = 7) -> None:
    rnd = random.Random(seed)
    look = random.Random(seed + 1)  # 소개는 따로 뽑아서 프로필 값(rnd)이 달라지지 않게 한다
    uid = 0

    def add(**kw):
        nonlocal uid
        uid += 1
        kw.setdefault("email", f"demo{uid}@example.com")
        kw.setdefault("weekly_cap", DEFAULT_WEEKLY_CAP)
        kw["is_synthetic"] = True
        kw["bio"] = look.choice(BIOS)
        kw["onboarded"] = True
        db.add(User(**kw))

    all_teach = [t for o in ORIGIN.values() for t in o["teach"]]
    for k, name in enumerate(DOMESTIC_NAMES):
        langs = ["한국어"] + [x for x, p in (("English", 0.7), ("日本語", 0.2), ("中文", 0.15)) if rnd.random() < p]
        add(
            name=name,
            kind="domestic",
            dept=DEPTS[k % len(DEPTS)],
            langs=langs,
            interests=rnd.sample(INTERESTS, rnd.randint(2, 4)),
            times=rnd.sample(TIME_SLOTS, rnd.randint(4, 7)),
            teach=rnd.sample(DOMESTIC_TEACH, 2),
            learn=rnd.sample(all_teach, 2),
            prefs=rnd.sample(["사람 많은 곳은 피하고 싶어요"], rnd.randint(0, 1)),
        )
    for name, origin in INTL:
        o = ORIGIN[origin]
        langs = [o["lang"]]
        if rnd.random() < 0.7:
            langs.append("한국어")
        if "English" not in langs and (rnd.random() < 0.6 or "한국어" not in langs):
            langs.append("English")
        add(
            name=name,
            kind="international",
            dept="한류국제대학",
            ui_lang=UI_LANG_OF[origin],
            langs=langs,
            interests=rnd.sample(INTERESTS, rnd.randint(2, 4)),
            times=rnd.sample(TIME_SLOTS, rnd.randint(4, 7)),
            teach=list(o["teach"]),
            learn=rnd.sample(DOMESTIC_TEACH, 2),
            prefs=rnd.sample(INTL_PREFS, rnd.randint(1, 2)),
        )
    db.flush()

    # 데모 사용자 두 명은 프로토타입과 같은 프로필로 고정
    demo = db.get(User, 1)
    demo.name = "수아"
    demo.onboarded = False  # 처음 열면 기본 정보(닉네임·아바타·소개) 입력부터 보여준다
    demo.langs = ["한국어", "English"]
    demo.interests = ["카페", "전시", "러닝"]
    demo.times = ["수 오후", "금 오전", "목 저녁"]
    demo.teach = ["캠퍼스 생활 팁", "식당 주문 요령"]
    demo.learn = ["일본어 일상 표현", "일본 문화"]
    demo.prefs = []

    haruka = db.get(User, len(DOMESTIC_NAMES) + 1)
    haruka.name = "하루카"
    haruka.langs = ["日本語", "한국어"]
    haruka.interests = ["카페", "전시", "사진"]
    haruka.times = ["수 오후", "금 오전"]
    haruka.teach = ["일본어 일상 표현", "일본 문화"]
    haruka.learn = ["캠퍼스 생활 팁", "식당 주문 요령"]
    haruka.prefs = ["조용한 장소를 좋아해요", "매운 음식은 피해요"]
    db.commit()
