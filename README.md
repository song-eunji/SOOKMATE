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
  app/notifications/     인앱 알림 저장·조회·읽음 처리
  app/scheduling/        추천 만료 예약 작업·재배정 복구
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

## 알림 및 추천 만료 작업

추가 의존성은 `cd backend` 후 `pip install -r requirements.txt`로 설치합니다.
기존 `uvicorn app.main:app --reload` 명령으로 실행하면 기본 60초마다 만료된 추천을 처리하고 재배정합니다.
기존 목록 조회 및 수락 요청의 만료 처리도 유지합니다. 서버 시작 시에도 한 번 검사하므로 중단 중 지난 기한을 복구합니다.
DB에는 기존과 같은 timezone 없는 UTC를 사용하며, 추천 기한 48시간·주간 상한·점수·과거 상대 재추천 금지 규칙은 유지합니다.

- `SCHEDULER_ENABLED=0`: 예약 작업 비활성화. 기존 요청 시 만료 처리는 계속 동작합니다.
- `SCHEDULER_INTERVAL_SECONDS=60`: 검사 주기(양의 정수, 초).
- 설정 파일을 쓸 때는 `uvicorn app.main:app --reload --env-file .env`로 실행합니다.

현재 지원 범위는 **API 프로세스 1개, worker 1개**입니다. `--workers 2` 이상이나 같은 DB를 사용하는 API 서버 여러 개, 별도 스케줄러 프로세스를 함께 실행하지 마세요.
매칭 API와 예약 작업이 공유하는 재진입 잠금은 프로세스 내부용입니다. `max_instances=1`과 `coalesce=True`는 같은 스케줄러 내부의 중복만 제어합니다.
여러 프로세스로 확장하려면 모든 매칭 쓰기 경로의 DB 기반 실행 조정이 먼저 필요합니다.
스케줄러는 lifespan에서 시작하고 종료 시 진행 중인 작업을 기다립니다. 모듈 import만으로 실행되지 않습니다.

알림 테이블과 재배정 대기 테이블은 별도 모듈에서 기존 `Base`에 등록하므로 다음 서버 시작 때 자동 생성됩니다.
기존 테이블 컬럼은 변경하지 않으며, 이미 존재하던 추천에 대한 과거 알림은 소급 생성하지 않습니다.
기존 DB 초기화 API는 새 테이블도 함께 초기화합니다.

| API | 설명 |
|---|---|
| `GET /api/notifications` | 내 알림 목록, ID 역순 |
| `GET /api/notifications?limit=20&before_id=123&unread_only=true` | 페이지 조회. `limit`은 1~100, 기본 50 |
| `GET /api/notifications/unread-count` | `{ "count": 3 }` 형태의 안 읽은 수 |
| `POST /api/notifications/{id}/read` | 내 알림 읽음 처리. 반복 호출 가능 |

기존 API와 동일한 `X-User-Id` 헤더로 현재 사용자를 결정합니다. 로그인 구현 전의 개발용 사용자 식별 방식입니다.
예를 들어 PowerShell에서 `Invoke-RestMethod http://localhost:8000/api/notifications -Headers @{ 'X-User-Id' = '1' }`로 확인합니다.
응답 필드는 `id`, `kind`, `match_id`, `message_id`, `created_at`, `read_at`입니다. 읽지 않았으면 `read_at`은 null입니다.
다른 사용자의 알림을 읽음 처리하면 존재하지 않는 알림과 동일하게 404를 반환합니다.

| kind | 수신자 |
|---|---|
| `match_proposed` | 새 추천 양측 |
| `match_accepted` | 처음 수락한 사용자의 상대방 |
| `match_confirmed` | 확정된 양측 |
| `match_rejected`, `match_cancelled` | 거절·취소한 사용자의 상대방 |
| `match_expired` | 만료된 양측 |
| `message_created` | 메시지 발신자를 제외한 상대방 |

차단 사실을 알리는 알림은 만들지 않습니다. REST, WebSocket, 개발용 상대 메시지는 공통 저장 경로에서 알림을 만듭니다.
채팅방을 읽으면 그 시점까지의 메시지 알림도 읽음 처리됩니다. 알림만 읽는 것은 채팅방 읽음 상태를 바꾸지 않습니다.
앱 상단의 종 버튼에서 알림 목록과 안 읽은 수를 확인할 수 있습니다. 알림을 누르면 읽음 처리 후 추천 목록이나 해당 대화방으로 이동합니다. 종료된 대화방은 최신 추천 목록으로 안내합니다. 기존 채팅 토스트는 유지하며 중복 토스트는 추가하지 않습니다. 이메일·브라우저 푸시는 구현하지 않았습니다.

상태 변경/메시지와 알림은 같은 트랜잭션으로 저장하며 `(recipient_id, event_key)` DB 고유 제약으로 같은 이벤트의 알림 재생성을 막습니다.
서로 다른 Message ID로 저장된 클라이언트 재전송까지 합치지는 않습니다.
만료·거절·취소·차단 저장 후 재배정이 실패하면 같은 트랜잭션에 남긴 대기 기록을 다음 예약 실행에서 재처리합니다.
재배정 실패는 서버 로그에 남습니다. 예약 작업을 꺼 둔 경우 재활성화하거나 다음 배정 요청에서 복구됩니다.
매칭 후보가 없으면 해당 배정 요청은 완료되며, 이후 후보 변화는 기존 프로필 저장·새로고침 경로를 따릅니다.

테스트는 실제 서비스 DB 대신 임시 파일 SQLite를 사용하고 일반 테스트에서는 예약 작업을 끕니다.
`cd backend` 후 `python -m pytest`로 기존 흐름, 알림 권한/중복/롤백, API와 작업의 동시 실행, 실제 예약 시작/종료, 장애 복구를 확인할 수 있습니다.

### 알림 UI 확인 및 테스트

백엔드와 프론트를 기존 실행 방법대로 켜면 사용자 정보 조회 후 앱 상단에 종 버튼이 표시됩니다.
안 읽은 수는 약 10초마다 조회하고, 목록은 패널을 열거나 새로고침할 때도 갱신합니다. 이전 알림은 50개씩 더 볼 수 있습니다.
사용자를 전환하면 기존 알림 요청을 취소하고 새 계정의 목록을 사용합니다. 조회·읽음·이동 실패 시 패널 안에서 다시 시도할 수 있습니다.
화면 문구는 기존 5개 언어를 지원합니다. 구현은 `frontend/src/features/notifications/`에 모았으며 공통 파일 변경은 `App.tsx`의 버튼·이동 연결에 한정합니다.

- 프론트 로직 테스트: `cd frontend` 후 `node --test tests/notifications.test.mjs`
- 타입 검사 및 프로덕션 빌드: `cd frontend` 후 `npm run build`
- 독립 미리보기: 개발 서버의 `/src/features/notifications/preview.html`. 기본은 예시 데이터이며 빈 목록·오류·실제 백엔드 모드를 선택할 수 있습니다.
- 수동 흐름 확인: 사용자 1로 추천 수락 → 상대 사용자로 전환 → 알림 패널에서 수락 알림 확인 → 양측 수락 후 확정 알림으로 대화방 이동 → 메시지 전송 후 수신자 알림 확인.
- 기한 만료·취소 등으로 종료된 만남의 메시지 알림을 누르면 다른 대화방을 열지 않고 추천 목록으로 이동하는지 확인합니다.
- 기존 DB의 과거 추천에는 알림을 소급 생성하지 않으므로 처음에는 목록이 비어 있을 수 있습니다. 이후 발생하는 수락·메시지 등으로 확인하세요.

## 아직 안 된 것

- 로그인 (학교 메일 인증): `backend/app/main.py` 의 `me_dep()` 와 `frontend/src/api.ts` 의 헤더만 바꾸면 붙일 수 있게 분리해 두었습니다.
- 다국어 임베딩: 지금은 설치 없이 도는 글자 n-gram 방식입니다. `backend/app/ai.py` 의 `embed()` 한 함수를 다국어 임베딩 API로 바꾸고, 필요하면 pgvector에 저장하세요.
- 외부 푸시: 인앱 알림 UI·서버 API·추천 만료 예약 작업은 구현되어 있습니다. 이메일·브라우저 푸시는 후속 개발입니다.
- 다음 활동 제안 보내기, 정기 만남 일정 정하기: 화면 버튼만 있고 동작은 안 합니다.
- 그룹 매칭, 운영자 현황 화면, 버디 프로그램 연동: 기획서대로 후속 개발입니다.

## 같이 작업하는 규칙

- `main` 에 바로 올리지 말고 기능별 브랜치(`feature/chat`, `feature/brief` 등)에서 작업한 뒤 합칩니다.
- 기능마다 담당 폴더를 정해 그 안에서만 수정합니다. 공통 파일(`models.py`, `db.py`, `constants.py`, `types.ts`, `api.ts`, `App.tsx`)은 팀장과 상의 후 수정합니다.
- 합치기 전에 `python -m pytest` 와 `npm run build` 가 통과하는지 확인합니다.
- 실제 학생 정보(이름, 학번, 연락처)와 API 키는 저장소에 올리지 않습니다. 기획서 PDF도 `.gitignore` 에 넣어 두었습니다.
