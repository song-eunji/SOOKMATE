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

- `GEMINI_API_KEY` 또는 `ANTHROPIC_API_KEY`: 설정하면 브리핑·활동 카드를 LLM이 만듭니다. 기본 자동 선택은 Gemini 키를 우선합니다. 둘 다 없으면 검토 자료와 기본 카드가 나옵니다.
- `DATABASE_URL`: PostgreSQL 등으로 바꿀 때
- `DEV_MODE=0`: 개발용 사용자 전환과 개발용 API를 끕니다.

## 아직 안 된 것

- 로그인 (학교 메일 인증): `backend/app/main.py` 의 `me_dep()` 와 `frontend/src/api.ts` 의 헤더만 바꾸면 붙일 수 있게 분리해 두었습니다.
- 다국어 임베딩: 지금은 설치 없이 도는 글자 n-gram 방식입니다. `backend/app/ai.py` 의 `embed()` 한 함수를 다국어 임베딩 API로 바꾸고, 필요하면 pgvector에 저장하세요.
- 알림과 예약 작업: 추천 만료는 목록을 불러올 때 처리하고 있습니다. 주기 실행이 필요하면 스케줄러를 붙이세요.
- 정기 만남 일정 정하기: 아직 구현하지 않았습니다. 다음 활동은 추천 결과에서 내용을 확인·수정한 뒤 채팅으로 제안할 수 있습니다.
- 그룹 매칭, 운영자 현황 화면, 버디 프로그램 연동: 기획서대로 후속 개발입니다.

## 같이 작업하는 규칙

- `main` 에 바로 올리지 말고 기능별 브랜치(`feature/chat`, `feature/brief` 등)에서 작업한 뒤 합칩니다.
- 기능마다 담당 폴더를 정해 그 안에서만 수정합니다. 공통 파일(`models.py`, `db.py`, `constants.py`, `types.ts`, `api.ts`, `App.tsx`)은 팀장과 상의 후 수정합니다.
- 합치기 전에 `python -m pytest` 와 `npm run build` 가 통과하는지 확인합니다.
- 실제 학생 정보(이름, 학번, 연락처)와 API 키는 저장소에 올리지 않습니다. 기획서 PDF도 `.gitignore` 에 넣어 두었습니다.

## 교류 노트와 다음 활동 추천

두 사람이 **공유한** 노트를 바탕으로 관련 자료를 찾아 읽고, 그 내용을 참고해 다음에 함께할 20~30분 활동을 제안합니다.
같은 기록으로 **자료 없이** 만든 추천과 비교·평가할 수 있습니다. 모든 단계가 무료 모델·무료 자료로 동작합니다.

### 사용 흐름 (노트 탭)

1. **만남 기록 남기기** — 배운 표현 / 알게 된 것 / 다음 희망 중 쓰고 싶은 것만. 입력하면 "공유하고 추천에 사용"이 켜지고, 끌 수 있습니다.
2. **공유하기** — 공유한 항목만 상대에게 보이고 추천에 쓰입니다. 한쪽 기록만 있어도 됩니다.
3. **다음 활동 추천받기** — 버튼 한 번으로 생성. 결과에는 시간·준비물, 단계별 순서(참고 자료 표시), "왜 이 활동이에요?"(근거가 된 기록 인용),
   참고한 자료 목록, "이 추천은 이렇게 만들어졌어요"(키워드 → 자료 → 모델)가 나옵니다.
4. **채팅으로 제안하기** — 메시지를 고친 뒤 보내야 실제 대화방에 전송됩니다. **다른 활동 추천받기**로 새로 만들 수 있습니다.
5. **🔬 자료 없이 만들었다면?** — 검색 없는 추천을 하나 더 만들어 나란히 보여주고, AI 블라인드 심사·자동 지표·내 평가(1~5점)를 함께 표시합니다.

### 파이프라인

```
공유 노트 ─▶ ① 분석(LLM): 신호·검색 키워드·문화 주제 추출, 원문 인용 검증
          ─▶ ② 자료 검색: 교류 활동 자료집(임베딩+태그) + 한국어 위키백과 API (+ 선택: Google 그라운딩)
          ─▶ ③ 생성(LLM): 자료를 참고해 활동 작성, 실제 찾은 자료 ID만 인용 허용 [S1]
          ─▶ (비교) ③' 같은 분석·같은 모델로 자료 없이 생성 → ④ 블라인드 심사 + 자동 지표
```

| 파일 | 역할 |
|---|---|
| `backend/app/next_activity.py` | 노트 분석, 활동 생성, 형식·인용·합의 날조 검사 |
| `backend/app/activity_search.py` | 자료집·위키백과·Google 검색을 합쳐 S1.. 번호 부여, 공급원별 상태 |
| `backend/app/activity_eval.py` | 자동 지표, 순서를 섞는 블라인드 LLM 심사 |
| `backend/app/activity_store.py` | 결과 DB 저장·재사용, 무료 한도 기록, 재생성 |
| `backend/data/activity_library.json` | 팀이 정리한 교류 활동 24종 (검토 후 확장 필요) |
| `backend/scripts/eval_next_activity.py` | 합성 시나리오 6개 비교 평가 → `scripts/results/` |
| `frontend/src/pages/NotesPage.tsx` · `ActivityResults.tsx` · `ActivityCompare.tsx` | 3단계 안내, 결과, 비교 화면 |

### 설정 (무료)

`backend/.env.example`을 `.env`로 복사하고 Google AI Studio에서 받은 `GEMINI_API_KEY`만 넣으면 됩니다.

- 생성 모델: `GEMINI_MODEL=gemini-3.5-flash-lite`. 무료 한도(429)·연결 오류면 `GEMINI_FALLBACK_MODELS`(기본 `gemini-3.1-flash-lite,gemma-4-31b-it`)를 순서대로 시도합니다.
- 자료: 자료집은 항상, 위키백과는 `ACTIVITY_WIKIPEDIA=1`(키 없음). Google 검색 그라운딩은 2026-11-09 확인 결과
  무료 키에서 모든 모델이 429였으므로 기본으로 끕니다(`ACTIVITY_GOOGLE_SEARCH=0`). 결제된 프로젝트에서만 켜세요.
- 외부로는 분석에서 걸러진 짧은 키워드·문화 명사만 나가고 노트 원문·이름은 나가지 않습니다.
- 모든 무료 모델이 한도에 걸리면 DB에 대기 시간을 기록해 불필요한 호출을 막고, 저장된 결과는 계속 볼 수 있습니다.

### 비교 평가

- 두 추천은 같은 노트 분석·같은 모델을 쓰고 **자료 제공 여부만** 다릅니다.
- AI 심사는 어느 쪽이 자료를 썼는지 모르게 1/2로 보여주고 순서를 섞습니다. 심사에는 기록만 주고 자료는 주지 않습니다.
- 자동 지표: 공유 기록 반영 수, 자료로 뒷받침된 단계(`[S#]` 명시만 인정), 구체적 요소(시간·횟수·예시 표현), 단계 수.
- 오프라인 평가: `cd backend && python scripts/eval_next_activity.py` — 시나리오마다 A/B 순서를 바꿔 두 번 심사하고, 판정이 엇갈리면 무승부로 셉니다.
- 한계: 합성 시나리오·LLM 심사라 경향 확인용입니다. 실제 학생 대상 사용성·추천 품질은 아직 검증하지 않았습니다.

### 검증

`cd backend && python -m pytest` (72개), `cd frontend && npm run build`.
브라우저에서 기록 저장 → 추천 생성 → 근거·자료 표시 → 채팅 제안 수신 → 비교·평가 저장을 실제 무료 모델로 확인했습니다.
