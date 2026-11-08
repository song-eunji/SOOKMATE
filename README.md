# SOOKMATE

유학생과 국내 학생이 프로그램 참여 여부와 관계없이 짧은 만남으로 교류를 시작하고, 서로 하나씩 알려주며 관계를 이어 가도록 돕는 모바일 웹 서비스입니다. (SWAITHON 예선, 팀 숙덕숙덕)

학교 메일 인증 로그인부터 그 뒤의 핵심 흐름까지 만들어져 있습니다.

프로필 입력 → AI 추천 → 양측 수락 → 1:1 대화방 → 만나기 전 브리핑·활동 카드 → 교류 노트 → 다음 활동 제안

## 실행 방법

터미널 두 개가 필요합니다. (Python 3.11 이상, Node 20 이상)

**1) 백엔드** (포트 8000)

```
cd backend
python -m venv .venv
.venv\Scripts\activate          # macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload
```

처음 실행하면 합성 프로필 40명(국내 26 : 유학생 14)이 자동으로 들어가고 첫 추천이 만들어집니다. DB는 `backend/sookmate.db` 파일 하나입니다. 처음부터 다시 하려면 이 파일을 지우거나 `POST http://localhost:8000/api/dev/reset` 을 호출하세요. API 문서는 http://localhost:8000/docs 에서 볼 수 있습니다.

**2) 프론트엔드** (포트 5173)

```
cd frontend
npm install
npm run dev
```

브라우저에서 http://localhost:5173 을 엽니다.


## 로그인

숙명 메일(`@sookmyung.ac.kr`)로만 로그인합니다. 메일 아이디를 넣으면 6자리 인증 코드가 메일로 가고, 코드를 입력하면 들어옵니다. 비밀번호는 없습니다.
개발 모드(`DEV_MODE=1`)에서 메일 설정이 없으면 코드가 화면에 보이고, "개발용 사용자로 둘러보기"로 시드 사용자로 바로 들어갈 수도 있습니다.

## 구조

```
backend/                 FastAPI + SQLAlchemy (SQLite 기본, PostgreSQL로 교체 가능)
  app/main.py            API 라우트, WebSocket 대화방
  app/matching.py        필터링, 점수 계산, OR-Tools 전체 배정, 수락·거절·취소·차단
  app/ai.py              임베딩, 문화 브리핑 RAG, 활동 카드, 다음 활동 제안 (LLM 없이도 동작)
  app/models.py          DB 테이블
  app/seed.py            합성 프로필 40명
  app/constants.py       선택지와 규칙 값 (가중치, 주간 상한 등)
  data/culture_docs.json 브리핑에 쓰는 문화 안내 자료 (지금은 검토 전 예시)
  tests/                 pytest (매칭 규칙, API 흐름)
frontend/                React + TypeScript + Vite
  src/pages/             프로필, 추천, 대화, 브리핑, 노트 화면
  src/api.ts             API 호출, 로그인 토큰 처리
  src/types.ts           API 응답 타입
CLAUDE.md                AI 도구(바이브코딩)에게 줄 프로젝트 규칙
```

## 테스트

```
cd backend
python -m pytest
```

기획서 검증 항목을 그대로 확인합니다: 합성 프로필 40명, 주간 상한 2명 상황에서 시간·언어 불일치 0건, 상한 초과 0건, 거절·취소·기한 만료 뒤 재배정, 노트 공유 범위, 생성 실패 시 기본 카드.

## 환경 변수 (선택)

`backend/.env.example` 을 `.env` 로 복사해 쓰고, `uvicorn app.main:app --reload --env-file .env` 로 실행합니다.

- `ANTHROPIC_API_KEY`: 설정하면 브리핑·활동 카드를 LLM이 만듭니다. 없으면 검토 자료와 기본 카드가 나옵니다.
- `DATABASE_URL`: PostgreSQL 등으로 바꿀 때
- `DEV_MODE=0`: 개발용 사용자 전환, 개발용 API, 화면에 보이는 인증 코드를 끕니다. **실제로 서비스할 때는 반드시 0으로 두세요.**
- `ALLOWED_EMAIL_DOMAINS`, `SMTP_HOST` 등: 로그인 가능한 메일 도메인(기본 `sookmyung.ac.kr`)과 인증 메일 발송 설정

## 아직 안 된 것

- 인증 메일 발송: 로그인은 만들어져 있지만, 실제 메일을 보내려면 `SMTP_*` 설정이 필요합니다. 설정이 없으면 개발 모드에서만 화면과 서버 로그에 코드가 보입니다.
- 다국어 임베딩: 지금은 설치 없이 도는 글자 n-gram 방식입니다. `backend/app/ai.py` 의 `embed()` 한 함수를 다국어 임베딩 API로 바꾸고, 필요하면 pgvector에 저장하세요.
- 알림과 예약 작업: 추천 만료는 목록을 불러올 때 처리하고 있습니다. 주기 실행이 필요하면 스케줄러를 붙이세요.
- 다음 활동 제안 보내기, 정기 만남 일정 정하기: 화면 버튼만 있고 동작은 안 합니다.
- 그룹 매칭, 운영자 현황 화면, 버디 프로그램 연동: 기획서대로 후속 개발입니다.

## 같이 작업하는 규칙

- `main` 에 바로 올리지 말고 기능별 브랜치(`feature/chat`, `feature/brief` 등)에서 작업한 뒤 합칩니다.
- 기능마다 담당 폴더를 정해 그 안에서만 수정합니다. 공통 파일(`models.py`, `db.py`, `constants.py`, `types.ts`, `api.ts`, `App.tsx`)은 팀장과 상의 후 수정합니다.
- 합치기 전에 `python -m pytest` 와 `npm run build` 가 통과하는지 확인합니다.
- 실제 학생 정보(이름, 학번, 연락처)와 API 키는 저장소에 올리지 않습니다. 기획서 PDF도 `.gitignore` 에 넣어 두었습니다.
