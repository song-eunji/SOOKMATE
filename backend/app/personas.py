"""시연용 가짜 프로필 50명: 국내 학생 16명, 유학생 34명(17개 나라). 모두 여성이고, 이름·소개는 전부 지어낸 예시입니다.

- 유학생의 한 줄 소개는 가능한 한 각자의 언어로 쓰고(번역 버튼으로 읽을 수 있어요), 선택지에 없는 언어는 영어를 대화 언어로 둡니다.
- 실제 학생 정보는 하나도 없습니다. 메일은 예약된 가짜 도메인(example.com)만 씁니다.
- 가짜끼리는 서로 이어 주지 않고, 실제로 로그인한 사용자에게만 추천됩니다(matching.FAKE_PAIRS).
"""
from sqlalchemy import delete, or_, select
from sqlalchemy.orm import Session

from .constants import DAYS, DEFAULT_WEEKLY_CAP, expand_times
from .models import Appointment, AuthToken, Block, ChatRead, Match, Message, Note, Report, User

ALL = "월화수목금:오전오후저녁"


def T(spec: str) -> list[str]:
    """'월수:오후 금:오전저녁' → ['월 오후', '수 오후', '금 오전', '금 저녁']  (요일 묶음 : 시간대 묶음)"""
    out = []
    for token in spec.split():
        days, slots = token.split(":")
        for d in DAYS:
            if d in days:
                out += [f"{d} {s}" for s in ("오전", "오후", "저녁") if s in slots]
    return expand_times(out)


def P(name, kind, dept, bio, langs, interests, times, teach, learn, prefs=(), nat=None, ui="ko"):
    return dict(
        name=name, kind=kind, dept=dept, bio=bio, langs=list(langs), interests=list(interests), times=T(times),
        teach=list(teach), learn=list(learn), prefs=list(prefs), nationality=nat, ui_lang=ui,
    )


def D(name, dept, bio, langs, interests, times, teach, learn, prefs=()):
    return P(name, "domestic", dept, bio, langs, interests, times, teach, learn, prefs)


def I(name, nat, dept, bio, langs, interests, times, teach, learn, prefs=(), ui="en"):
    return P(name, "international", dept, bio, langs, interests, times, teach, learn, prefs, nat, ui)


KO_EN = ["한국어", "English"]
CAMPUS = "캠퍼스 생활 팁"
ORDER = "식당 주문 요령"
KOREAN = "한국어 표현"
HOMEWORK = "과제·수강신청 팁"
CAFE = "서울 카페·맛집"
QUIET = "조용한 장소를 좋아해요"
SLOW = "천천히 말해주면 좋아요"

PERSONAS: list[dict] = [
    # ------------------------------------------------------------- 국내 학생 16명 (id 1~16)
    D("수아", "인공지능공학부", "카페랑 전시 좋아해요, 천천히 친해져요", KO_EN, ["카페", "전시", "러닝"], "수:오후 금:오전 목:저녁",
      [CAMPUS, ORDER], ["일본어 일상 표현", "일본 문화"]),
    D("민서", "영어영문학부", "영화 보고 얘기 나누는 거 좋아해요", KO_EN, ["영화", "드라마", "카페", "베이킹"], "월화수:오후저녁 금:오전",
      [KOREAN, HOMEWORK], ["English 회화", "미국 대학 문화"]),
    D("하윤", "일본학과", "일본 드라마 덕후예요, 일본어 수다 환영", ["한국어", "日本語", "English"], ["드라마", "음악", "맛집"], "월목금:오전오후 화:저녁",
      [CAFE, KOREAN], ["일본어 일상 표현", "일본 문화"]),
    D("지우", "중어중문학부", "중국어 연습 같이 해요, 마라탕 좋아해요", ["한국어", "中文"], ["맛집", "여행", "요가"], "화수목:오전오후저녁",
      [ORDER, KOREAN], ["중국어 표현", "중국 문화"]),
    D("서현", "경영학부", "러닝 크루 활동 중, 같이 뛰어요", KO_EN, ["러닝", "카페", "등산"], "월수금:오전저녁 화목:오후",
      [CAMPUS, HOMEWORK], ["English 회화"]),
    D("채원", "미디어학부", "사진 찍는 걸 좋아해요, 전시도 같이 가요", KO_EN, ["사진", "전시", "영화"], "월화수목금:오후저녁",
      [CAFE], ["베트남어 기초", "베트남 음식 이야기"]),
    D("예린", "컴퓨터과학전공", "보드게임 카페 투어 같이 하실래요?", KO_EN, ["보드게임", "K-pop", "그림"], ALL,
      [HOMEWORK, CAMPUS], ["English 회화", "미국 대학 문화"]),
    D("다은", "화학과", "조용히 책 읽고 카페 가는 걸 좋아해요", KO_EN, ["독서", "카페", "뜨개질"], "월수:오전오후 금:오전",
      [CAMPUS], ["프랑스어 기초", "프랑스 디저트 이야기"], [QUIET]),
    D("유진", "문헌정보학과", "전시와 공연을 보러 다녀요", KO_EN, ["전시", "공연", "독서"], "화목금:오전오후저녁",
      [CAFE, KOREAN], ["일본 문화", "중국 문화"]),
    D("소율", "소프트웨어융합학부", "게임보다 산책! 천천히 대화해요", KO_EN, ["산책", "음악", "캠핑"], "월화수목금:오전오후",
      [HOMEWORK], ["English 회화"]),
    D("나연", "약학부", "시험 기간 빼고 언제든 좋아요", KO_EN, ["요리", "베이킹", "영화"], "수:저녁 금:오후저녁",
      [ORDER], ["태국어 기초", "태국 음식 이야기"], ["사람 많은 곳은 피하고 싶어요"]),
    D("하은", "피아노과", "피아노 치고 노래 듣는 게 일상이에요", KO_EN, ["음악", "공연", "K-pop"], "월화수목금:저녁 수금:오전오후",
      [KOREAN], ["English 회화", "스페인어 기초"]),
    D("시은", "통계학과", "러닝 후 브런치 좋아해요", KO_EN, ["러닝", "맛집", "카페"], "월화수:오전오후저녁 목금:오전",
      [CAMPUS, CAFE], ["독일어 기초"]),
    D("가은", "의류학과", "패션이랑 전시 좋아해요, 일본어 조금 해요", ["한국어", "English", "日本語"], ["전시", "사진", "빈티지 쇼핑"], "월수목:오후저녁 금:오전오후",
      [CAFE], ["일본어 일상 표현"]),
    D("예서", "홍보광고학과", "새 친구 만나는 게 제일 좋아요", ["한국어", "English", "中文"], ["카페", "여행", "K-pop"], ALL,
      [KOREAN, ORDER], ["중국어 표현", "필리핀 문화"]),
    D("아린", "교육학부", "한국어 가르치는 게 꿈이에요", ["한국어", "English", "日本語"], ["독서", "산책", "그림"], "화목:오전오후저녁 월수금:오후",
      [KOREAN, CAMPUS], ["English 회화", "몽골 문화"], ["천천히 말하는 걸 좋아해요"]),
    # ------------------------------------------------------------- 유학생 34명 (id 17~50)
    # 일본 4
    I("하루카", "일본", "한국어학당", "韓国のカフェ巡りが好きです。ゆっくり話してね", ["日本語", "한국어"], ["카페", "전시", "사진"], "수:오후 금:오전 목:저녁",
      ["일본어 일상 표현", "일본 문화"], [CAMPUS, ORDER], [QUIET, "매운 음식은 피해요"], "ja"),
    I("Yuki", "일본", "경영학부", "韓国ドラマで韓国語を勉強中です！", ["日本語", "한국어", "English"], ["드라마", "K-pop", "맛집", "카페"], ALL,
      ["일본어 일상 표현", "일본 문화"], [KOREAN, CAFE], (), "ja"),
    I("Mio", "일본", "국제학부", "写真と散歩が好き。英語でも大丈夫です", ["日本語", "English"], ["사진", "산책", "전시"], "월화목:오후저녁 금:오전오후",
      ["일본 문화", "일본어 일상 표현"], [HOMEWORK, CAMPUS], [SLOW], "ja"),
    I("Nanami", "일본", "한국어학당", "料理とボードゲームが好きです", ["日本語", "한국어"], ["요리", "보드게임", "맛집"], "월수금:오전오후저녁",
      ["일본 문화"], [KOREAN, ORDER], ["매운 음식은 피해요"], "ja"),
    # 중국 4
    I("Wei", "중국", "경영학부", "我喜欢咖啡馆和K-pop，想多练习韩语", ["中文", "한국어"], ["카페", "K-pop", "음악"], "화목:오전오후저녁 월금:오후",
      ["중국어 표현", "중국 문화"], [KOREAN, CAFE], (), "zh"),
    I("Mei", "중국", "미디어학부", "喜欢看展览和拍照，欢迎一起逛展", ["中文", "English"], ["전시", "사진", "여행"], "월수금:오전오후 목:저녁",
      ["중국 문화"], [CAMPUS, HOMEWORK], (), "zh"),
    I("Xiaoli", "중국", "한국어학당", "想认识韩国朋友，一起吃好吃的", ["中文", "한국어", "English"], ["맛집", "요리", "드라마"], ALL,
      ["중국어 표현"], [ORDER, CAFE], ["사람 많은 곳은 피하고 싶어요"], "zh"),
    I("Jia", "중국", "컴퓨터과학전공", "跑步和读书，周末喜欢安静的地方", ["中文", "English"], ["러닝", "독서", "산책"], "월화수:저녁 목금:오전오후",
      ["중국 문화", "중국어 표현"], [KOREAN], [QUIET], "zh"),
    # 대만 2
    I("Yating", "대만", "국제학부", "我是台灣人，喜歡咖啡和旅行", ["中文", "English", "한국어"], ["카페", "여행", "음악"], "월화수목금:오후저녁",
      ["중국어 표현", "대만 밀크티 이야기"], [KOREAN, CAMPUS], (), "zh"),
    I("Chiayi", "대만", "문화콘텐츠학과", "愛看電影，也想學韓文歌", ["中文", "English"], ["영화", "K-pop", "음악"], "화수목:오전오후 금:저녁",
      ["중국 문화"], [KOREAN], (), "zh"),
    # 베트남 3
    I("Linh", "베트남", "경영학부", "Mình thích cà phê và học tiếng Hàn", ["Tiếng Việt", "한국어", "English"], ["카페", "독서", "산책"], "월수목:오전오후저녁",
      ["베트남어 기초", "베트남 음식 이야기"], [KOREAN, CAFE], (), "vi"),
    I("Mai", "베트남", "식품영양학과", "Thích nấu ăn và đi triển lãm cùng bạn", ["Tiếng Việt", "English"], ["요리", "전시", "사진"], "화금:오전오후 월목:저녁",
      ["베트남 음식 이야기"], [CAMPUS, ORDER], [SLOW], "vi"),
    I("Trang", "베트남", "한국어학당", "Mình mới đến Hàn, cần bạn giúp làm quen", ["Tiếng Việt", "한국어"], ["드라마", "K-pop", "맛집"], "월화수목금:오전오후",
      ["베트남어 기초"], [HOMEWORK, KOREAN], (), "vi"),
    # 미국 3
    I("Emily", "미국", "교환학생", "Exchange student into cafes & hiking", ["English", "한국어"], ["카페", "산책", "여행", "사진"], "수목금:오전오후저녁",
      ["English 회화", "미국 대학 문화"], [KOREAN, CAFE]),
    I("Jessica", "미국", "교환학생", "K-drama fan! Let's swap English & Korean", ["English"], ["드라마", "K-pop", "영화"], "월화:오후저녁 목금:오전",
      ["English 회화"], [KOREAN, ORDER], [SLOW]),
    I("Sophia", "미국", "미술사학과", "Art history major, love a good museum", ["English", "한국어"], ["전시", "독서", "사진"], "월수금:오전오후",
      ["미국 대학 문화"], [CAMPUS], [QUIET]),
    # 영국 2
    I("Charlotte", "영국", "교환학생", "Tea, books and long walks in Seoul", ["English"], ["독서", "산책", "카페"], "화목:오전오후저녁 월:저녁",
      ["English 회화"], [CAFE, KOREAN], ["채식 메뉴가 있으면 좋아요"]),
    I("Amelia", "영국", "음악학과", "Music lover learning Korean via K-pop", ["English", "한국어"], ["음악", "K-pop", "러닝"], "월화수목금:저녁 수금:오전오후",
      ["English 회화"], [KOREAN]),
    # 호주 2
    I("Chloe", "호주", "교환학생", "Coffee nerd from Melbourne, new to Seoul", ["English"], ["카페", "맛집", "러닝"], "월수:오후저녁 금:오전오후저녁",
      ["English 회화"], [CAFE, CAMPUS]),
    I("Grace", "호주", "영어영문학부", "Love baking and board game nights", ["English", "한국어"], ["요리", "보드게임", "영화"], "화목금:오후저녁",
      ["English 회화", "호주 대학 문화"], [KOREAN]),
    # 캐나다 2
    I("Hannah", "캐나다", "교환학생", "From Toronto. Photos and street food!", ["English", "한국어"], ["사진", "맛집", "여행"], ALL,
      ["English 회화"], [ORDER, KOREAN]),
    I("Megan", "캐나다", "문헌정보학과", "Quiet bookworm who enjoys cozy cafes", ["English"], ["독서", "카페", "산책"], "월화수:오전오후 목:저녁",
      ["캐나다 대학 문화"], [HOMEWORK, CAMPUS], [QUIET]),
    # 태국 2
    I("Ploy", "태국", "한국어학당", "สวัสดี! ชอบคาเฟ่และ K-pop ค่ะ", ["English", "한국어"], ["K-pop", "카페", "음악"], "월수금:오후저녁 화:오전오후",
      ["태국어 기초", "태국 음식 이야기"], [KOREAN, CAFE]),
    I("Namtan", "태국", "국제학부", "ชอบถ่ายรูปและเดินเล่นกับเพื่อนใหม่", ["English"], ["사진", "산책", "여행"], "화목금:오전오후저녁",
      ["태국 음식 이야기"], [CAMPUS], ["매운 음식도 좋아해요"]),
    # 인도네시아 2
    I("Putri", "인도네시아", "한국어학당", "Suka drama Korea dan jalan-jalan ke kafe", ["English", "한국어"], ["드라마", "카페", "여행"], "월화수목:오전오후저녁",
      ["인도네시아어 기초"], [KOREAN]),
    I("Dewi", "인도네시아", "식품영양학과", "Hobi saya membaca dan memasak bersama", ["English"], ["독서", "요리"], "수목:오후저녁 월금:오전",
      ["인도네시아 음식 이야기"], [ORDER, CAFE], ["할랄 메뉴가 있으면 좋아요"]),
    # 필리핀 1, 몽골 1, 우즈베키스탄 1
    I("Bea", "필리핀", "교환학생", "Mahilig sa musika at kape! Hi, I'm Bea", ["English", "한국어"], ["음악", "카페", "K-pop"], "월화수목금:오후저녁",
      ["English 회화", "필리핀 문화"], [KOREAN]),
    I("Nomin", "몽골", "경제학부", "Сайн уу! Би хөгжим, аялал дуртай", ["English", "한국어"], ["여행", "음악", "러닝"], "월수목:오전오후 금:저녁",
      ["몽골 문화"], [KOREAN, HOMEWORK]),
    I("Madina", "우즈베키스탄", "한국어학당", "Salom! Men taom pishirishni yoqtiraman", ["English", "한국어"], ["요리", "맛집", "드라마"], "화목금:오전오후저녁",
      ["우즈베크 음식 이야기"], [KOREAN, ORDER], [SLOW]),
    # 프랑스 2, 독일 1, 스페인 1, 이탈리아 1
    I("Camille", "프랑스", "교환학생", "J'aime les expos, le café et les balades", ["English", "한국어"], ["전시", "카페", "산책"], "월화수금:오후저녁",
      ["프랑스어 기초", "프랑스 디저트 이야기"], [CAFE, KOREAN]),
    I("Léa", "프랑스", "영상학과", "Passionnée de cinéma et de photographie", ["English"], ["영화", "사진", "독서"], "수목금:오전오후",
      ["프랑스어 기초"], [CAMPUS], [QUIET]),
    I("Anna", "독일", "교환학생", "Ich liebe Brettspiele und Kaffee", ["English", "한국어"], ["보드게임", "카페", "러닝"], "월화수목금:오전저녁",
      ["독일어 기초"], [KOREAN, CAFE]),
    I("Lucía", "스페인", "교환학생", "Me encanta bailar, cocinar y viajar", ["English", "한국어"], ["요리", "여행", "음악"], "월목금:오후저녁 수:오전오후저녁",
      ["스페인어 기초"], [ORDER, KOREAN]),
    I("Giulia", "이탈리아", "교환학생", "Amo la pasta, i musei e il caffè", ["English"], ["맛집", "전시", "카페"], "화수목:오전오후저녁",
      ["이탈리아 요리 이야기"], [CAFE, CAMPUS]),
]


def _new_user(i: int, p: dict) -> User:
    return User(
        email=f"persona{i + 1}@example.com", weekly_cap=DEFAULT_WEEKLY_CAP, is_synthetic=True, onboarded=True, **p
    )


def seed_personas(db: Session) -> None:
    """가짜 프로필 50명을 넣는다. 비어 있는 DB에서 쓴다(번호는 1번부터 이 순서대로)."""
    db.add_all(_new_user(i, p) for i, p in enumerate(PERSONAS))
    db.commit()


def replace_personas(db: Session) -> dict:
    """기존 가짜 프로필과 거기에 얽힌 추천·대화·메모를 지우고 새 50명으로 바꾼다. 실제 계정은 그대로 둔다."""
    fake = set(db.scalars(select(User.id).where(User.is_synthetic.is_(True))))
    removed = len(fake)
    if fake:
        in_match = or_(Match.domestic_id.in_(fake), Match.international_id.in_(fake))
        match_ids = set(db.scalars(select(Match.id).where(in_match)))
        if match_ids:
            for model in (Appointment, Message, Note, ChatRead, Report):
                db.execute(delete(model).where(model.match_id.in_(match_ids)))
            db.execute(delete(Match).where(Match.id.in_(match_ids)))
        db.execute(delete(Report).where(or_(Report.reporter_id.in_(fake), Report.target_id.in_(fake))))
        db.execute(delete(Block).where(or_(Block.user_id.in_(fake), Block.blocked_id.in_(fake))))
        db.execute(delete(AuthToken).where(AuthToken.user_id.in_(fake)))
        db.execute(delete(User).where(User.id.in_(fake)))
        db.commit()
    seed_personas(db)
    return {"removed": removed, "added": len(PERSONAS)}
