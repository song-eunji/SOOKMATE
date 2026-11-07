# SOOKMATE

유학생과 국내 학생이 프로그램 참여 여부와 관계없이 짧은 만남으로 교류를 시작하고, 서로 하나씩 알려주며 관계를 이어 가도록 돕는 모바일 웹 서비스입니다. (SWAITHON 예선, 팀 숙덕숙덕)

로그인(학교 메일 인증)을 뺀, 그 뒤의 핵심 흐름이 만들어져 있습니다.

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
  src/api.ts             API 호출 (로그인 붙일 때 헤더 부분만 바꾸면 됨)
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
- `DEV_MODE=0`: 개발용 사용자 전환과 개발용 API를 끕니다.

## 아직 안 된 것

- 로그인 (학교 메일 인증): `backend/app/main.py` 의 `me_dep()` 와 `frontend/src/api.ts` 의 헤더만 바꾸면 붙일 수 있게 분리해 두었습니다.
- 다국어 임베딩: 지금은 설치 없이 도는 글자 n-gram 방식입니다. `backend/app/ai.py` 의 `embed()` 한 함수를 다국어 임베딩 API로 바꾸고, 필요하면 pgvector에 저장하세요.
- 알림과 예약 작업: 추천 만료는 목록을 불러올 때 처리하고 있습니다. 주기 실행이 필요하면 스케줄러를 붙이세요.
- 다음 활동 제안 보내기, 정기 만남 일정 정하기: 화면 버튼만 있고 동작은 안 합니다.
- 그룹 매칭, 운영자 현황 화면, 버디 프로그램 연동: 기획서대로 후속 개발입니다.

## 같이 작업하는 규칙

- `main` 에 바로 올리지 말고 기능별 브랜치(`feature/chat`, `feature/brief` 등)에서 작업한 뒤 합칩니다.
- 기능마다 담당 폴더를 정해 그 안에서만 수정합니다. 공통 파일(`models.py`, `db.py`, `constants.py`, `types.ts`, `api.ts`, `App.tsx`)은 팀장과 상의 후 수정합니다.
- 합치기 전에 `python -m pytest` 와 `npm run build` 가 통과하는지 확인합니다.
- 실제 학생 정보(이름, 학번, 연락처)와 API 키는 저장소에 올리지 않습니다. 기획서 PDF도 `.gitignore` 에 넣어 두었습니다.

## 교류 노트 기반 다음 활동 추천·비교

노트를 저장한 뒤 **자료 검색하고 추천 비교하기**를 누르면, 동일한 공유 노트와
공통 관심사로 검색 기반 추천과 검색 없는 추천을 각각 생성합니다.

- `backend/.env`에 `TAVILY_API_KEY`, `ANTHROPIC_API_KEY`를 설정하고
  계정에서 사용 가능한 모델을 `ANTHROPIC_MODEL`로 지정하세요.
- 공유를 켠 표현·사실·다음 활동만 생성에 사용합니다. 검색에는 원문 대신
  서비스 관심사/교류 주제에 해당하는 키워드를 사용합니다. 일치하는 키워드가
  없으면 공통 관심사로 검색하고, 둘 다 없으면 검색하지 않습니다.
- 자료 링크와 발췌문, 추천 이유, 실행 단계, 생성 소요 시간을 확인할 수 있습니다.
  자료 ID가 유효한지 검사하지만, 인용 내용이 주장을 실제로 뒷받침하는지는
  원문을 열어 사람이 확인해야 합니다. 행사 일정·가격·예약은 원문에서 확인하세요.
- 키 미설정·검색 실패·생성 실패는 기본 제안으로 표시하며, 성공한 RAG 실험으로
  집계하지 않습니다. 기본 GET 조회는 유료 외부 API를 호출하지 않습니다.
- API: `POST /api/matches/{id}/next-activity?compare=true`.
  확정된 만남의 참여자만 접근할 수 있습니다.

시연 예시: 두 사람이 `전시에서 사진 찍기`, `서로의 사진 표현 배우기`를 공유한 뒤
추천 비교를 실행하세요. 두 AI 결과가 생성되면 관련성·실행 가능성·차별성·근거를
1~5점으로 기록하고 **추천·평가 결과 내려받기**로 JSON을 저장할 수 있습니다.
점수는 다운로드 파일에만 저장되며 서버에는 저장되지 않습니다.
공유 노트와 검색 발췌문이 파일에 포함되므로 공개 발표에는 합성 노트를 사용하세요.

평가 시에는 같은 합성 노트 사례를 여러 개 사용하고, 순서를 바꾸어 여러 명이
채점하세요. 화면의 비교는 탐색용이며 블라인드 실험이나 우수성 입증 결과가 아닙니다.
검색 없는 조건의 근거 항목은 검색 인용 대신 공유 노트에 근거한 설명을 평가하세요.
실제 외부 호출 검증에는 유효한 두 API 키가 필요합니다.
