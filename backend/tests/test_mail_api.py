"""인증 메일을 SMTP 대신 Brevo 메일 API(HTTPS)로 보내는지 확인한다."""
import httpx
import pytest

from app import auth


class Reply:
    def __init__(self, status=201, text="{}"):
        self.status_code, self.text = status, text


def test_sends_through_the_api_when_a_key_is_set(monkeypatch):
    seen = {}

    def fake_post(url, headers, json, timeout):
        seen.update(url=url, headers=headers, json=json, timeout=timeout)
        return Reply(201)

    monkeypatch.setenv("BREVO_API_KEY", "xkeysib-test")
    monkeypatch.setenv("MAIL_FROM", "sender@gmail.com")
    monkeypatch.delenv("SMTP_HOST", raising=False)
    monkeypatch.setattr(httpx, "post", fake_post)
    auth.send_code_mail("student@sookmyung.ac.kr", "123456")
    assert seen["url"] == "https://api.brevo.com/v3/smtp/email"
    assert seen["headers"]["api-key"] == "xkeysib-test"
    assert seen["json"]["sender"]["email"] == "sender@gmail.com"
    assert seen["json"]["to"] == [{"email": "student@sookmyung.ac.kr"}]
    assert "123456" in seen["json"]["textContent"] and "123456" in seen["json"]["subject"]


def test_api_error_is_raised_with_the_reason_but_not_the_key(monkeypatch):
    monkeypatch.setenv("BREVO_API_KEY", "xkeysib-secret")
    monkeypatch.setenv("MAIL_FROM", "sender@gmail.com")
    monkeypatch.setattr(httpx, "post", lambda *a, **k: Reply(401, '{"message":"Key not found"}'))
    with pytest.raises(RuntimeError) as e:
        auth.send_mail("a@sookmyung.ac.kr", "제목", "본문")
    assert "401" in str(e.value) and "Key not found" in str(e.value) and "xkeysib-secret" not in str(e.value)


def test_api_needs_a_sender_address(monkeypatch):
    monkeypatch.setenv("BREVO_API_KEY", "xkeysib-test")
    monkeypatch.delenv("MAIL_FROM", raising=False)
    monkeypatch.delenv("SMTP_USER", raising=False)
    with pytest.raises(auth.MailNotConfigured):
        auth.send_mail("a@sookmyung.ac.kr", "제목", "본문")


def test_without_a_key_it_still_uses_smtp_and_reports_missing_setup(monkeypatch):
    monkeypatch.delenv("BREVO_API_KEY", raising=False)
    monkeypatch.delenv("SMTP_HOST", raising=False)
    with pytest.raises(auth.MailNotConfigured):
        auth.send_mail("a@sookmyung.ac.kr", "제목", "본문")
