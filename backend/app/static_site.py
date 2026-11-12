"""빌드한 프론트엔드(frontend/dist)를 API 서버가 함께 내보낸다.

배포할 때 서버 하나(같은 주소)로 화면·API·WebSocket 을 다 내기 위한 것이다. 개발 중에는 dist 가 없어서 아무 일도 하지 않는다.
STATIC_DIR 환경변수로 위치를 바꿀 수 있다(기본: 저장소의 frontend/dist).
"""
import os
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse


def mount_frontend(app: FastAPI) -> bool:
    root = Path(os.getenv("STATIC_DIR") or Path(__file__).resolve().parents[2] / "frontend" / "dist").resolve()
    index = root / "index.html"
    if not index.is_file():
        return False

    @app.get("/{path:path}", include_in_schema=False)
    def frontend(path: str):
        if path.startswith(("api/", "ws/")):  # 없는 API 주소는 화면이 아니라 404 로 알린다
            raise HTTPException(404)
        target = (root / path).resolve()
        if path and target.is_file() and root in target.parents:
            headers = {"Cache-Control": "public, max-age=31536000, immutable"} if path.startswith("assets/") else {}
            return FileResponse(target, headers=headers)
        return FileResponse(index, headers={"Cache-Control": "no-cache"})

    return True
