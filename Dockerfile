# 배포용: 프론트엔드를 빌드한 뒤 백엔드(FastAPI)가 함께 내보내는 서버 한 개 이미지.
FROM node:20-slim AS web
WORKDIR /web
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM python:3.11-slim
ENV PYTHONUNBUFFERED=1 PYTHONUTF8=1
WORKDIR /app/backend
COPY backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY backend/ ./
COPY --from=web /web/dist /app/frontend/dist
# 실제 서비스 기본값: 개발용 로그인·자동 수락(가짜 상대)·인증 코드 화면 표시를 모두 끈다.
ENV DEV_MODE=0 DEV_LOGIN=0 DEMO_PARTNERS=0
EXPOSE 8000
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
