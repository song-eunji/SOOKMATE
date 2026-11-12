"""배포용: 빌드한 프론트엔드를 API 서버가 함께 내보내는지 확인한다."""
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.static_site import mount_frontend


def site(tmp_path, monkeypatch):
    (tmp_path / "assets").mkdir()
    (tmp_path / "index.html").write_text("<title>SOOKMATE</title>", encoding="utf-8")
    (tmp_path / "assets" / "app.js").write_text("console.log(1)", encoding="utf-8")
    (tmp_path / "favicon.svg").write_text("<svg/>", encoding="utf-8")
    secret = tmp_path.parent / "secret.txt"
    secret.write_text("비밀", encoding="utf-8")
    monkeypatch.setenv("STATIC_DIR", str(tmp_path))
    app = FastAPI()

    @app.get("/api/ping")
    def ping():
        return {"ok": True}

    assert mount_frontend(app) is True
    return TestClient(app)


def test_serves_page_assets_and_falls_back_to_the_page(tmp_path, monkeypatch):
    c = site(tmp_path, monkeypatch)
    assert "SOOKMATE" in c.get("/").text
    assert c.get("/assets/app.js").text == "console.log(1)"
    assert "immutable" in c.get("/assets/app.js").headers["cache-control"]
    assert c.get("/favicon.svg").text == "<svg/>"
    assert "SOOKMATE" in c.get("/any/page").text  # 화면 안 주소는 화면으로


def test_api_routes_win_and_unknown_api_is_404(tmp_path, monkeypatch):
    c = site(tmp_path, monkeypatch)
    assert c.get("/api/ping").json() == {"ok": True}
    assert c.get("/api/missing").status_code == 404
    assert c.get("/ws/missing").status_code == 404


def test_cannot_read_files_outside_the_site(tmp_path, monkeypatch):
    c = site(tmp_path, monkeypatch)
    for path in ("/../secret.txt", "/%2e%2e/secret.txt", "/..%2fsecret.txt"):
        r = c.get(path)
        assert "비밀" not in r.text


def test_does_nothing_without_a_build(tmp_path, monkeypatch):
    monkeypatch.setenv("STATIC_DIR", str(tmp_path / "none"))
    assert mount_frontend(FastAPI()) is False
