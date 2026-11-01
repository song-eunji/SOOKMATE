@echo off
chcp 65001 >nul
cd /d "%~dp0"

where python >nul 2>nul
if errorlevel 1 (
  echo Python을 찾을 수 없어요. Python 3.11 이상을 설치한 뒤 다시 실행해 주세요.
  pause
  exit /b 1
)
where npm >nul 2>nul
if errorlevel 1 (
  echo Node.js를 찾을 수 없어요. Node 20 이상을 설치한 뒤 다시 실행해 주세요.
  pause
  exit /b 1
)

echo [1/2] 백엔드 준비 중... (처음에는 몇 분 걸려요)
cd backend
if not exist .venv (
  python -m venv .venv
)
call .venv\Scripts\activate.bat
pip install -r requirements.txt
if errorlevel 1 (
  echo 백엔드 패키지 설치에 실패했어요. 위 오류 메시지를 확인해 주세요.
  pause
  exit /b 1
)
start "SOOKMATE backend" /d "%~dp0backend" cmd /k "call .venv\Scripts\activate.bat && uvicorn app.main:app --reload"
cd ..

echo [2/2] 프론트엔드 준비 중...
cd frontend
if not exist node_modules (
  call npm install
  if errorlevel 1 (
    echo 프론트엔드 패키지 설치에 실패했어요. 위 오류 메시지를 확인해 주세요.
    pause
    exit /b 1
  )
)
start "SOOKMATE frontend" /d "%~dp0frontend" cmd /k "npm run dev"
cd ..

echo 잠시 뒤 브라우저가 열려요. 서버를 끄려면 새로 열린 두 창을 닫으세요.
timeout /t 8 >nul
start http://localhost:5173
