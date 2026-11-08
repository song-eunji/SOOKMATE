import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { LogoMark } from "../components";
import { isLang, useI18n } from "../i18n";
import type { Options } from "../types";

interface Props {
  opts: Options;
  onLoggedIn: (token: string) => void;
  onDev: () => void;
}

const RESEND_SECONDS = 60; // 서버의 재요청 대기 시간과 같게 둔다

/** 숙명 메일로만 로그인한다. 메일 아이디를 넣고, 메일로 받은 6자리 코드를 입력하면 들어온다. */
export default function LoginPage({ opts, onLoggedIn, onDev }: Props) {
  const { t, lang, setLang } = useI18n();
  const [step, setStep] = useState<"mail" | "code">("mail");
  const [mail, setMail] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [wait, setWait] = useState(0); // 코드를 다시 받을 수 있을 때까지 남은 초
  const [devCode, setDevCode] = useState(""); // 개발 모드에서만 서버가 알려 준다
  const codeInput = useRef<HTMLInputElement>(null);

  const domain = opts.login_domain;
  const local = mail.trim();
  const email = local.includes("@") ? local : `${local}@${domain}`;

  useEffect(() => {
    if (wait <= 0) return;
    const id = window.setTimeout(() => setWait((w) => w - 1), 1000);
    return () => window.clearTimeout(id);
  }, [wait]);

  useEffect(() => {
    if (step === "code") codeInput.current?.focus();
  }, [step]);

  const sendCode = async () => {
    setBusy(true);
    setError("");
    try {
      const r = await api.requestCode(email);
      setDevCode(r.dev_code ?? "");
      setCode("");
      setStep("code");
      setWait(RESEND_SECONDS);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const verify = async () => {
    setBusy(true);
    setError("");
    try {
      const r = await api.verifyCode(email, code, lang);
      onLoggedIn(r.token);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="login">
      <div className="login-top">
        <label className="langselect">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
            <circle cx="12" cy="12" r="9" />
            <path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9S14.5 18.4 12 21c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z" />
          </svg>
          <select aria-label={t("화면 언어")} value={lang} onChange={(e) => isLang(e.target.value) && setLang(e.target.value)}>
            {opts.ui_langs.map(([c, label]) => (
              <option key={c} value={c}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="login-body">
        <div className="login-brand">
          <LogoMark size={76} />
          <span className="login-word">SOOKMATE</span>
          <p className="login-tag">{t("숙명여자대학교 메일로 시작해요")}</p>
        </div>

        {step === "mail" ? (
          <form
            className="login-form"
            onSubmit={(e) => {
              e.preventDefault();
              if (local) sendCode();
            }}
          >
            <div className="mailfield">
              <input
                type="text"
                inputMode="email"
                autoComplete="email"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                aria-label={t("학교 메일")}
                value={mail}
                onChange={(e) => setMail(e.target.value)}
                placeholder={t("학교 메일 아이디")}
              />
              {!local.includes("@") && <span className="suffix">@{domain}</span>}
            </div>
            {error && <p className="login-error">{t(error)}</p>}
            <button className="btn" type="submit" disabled={!local || busy}>
              {busy ? t("메일을 보내는 중") : t("인증 코드 받기")}
            </button>
          </form>
        ) : (
          <form
            className="login-form"
            onSubmit={(e) => {
              e.preventDefault();
              if (code.length === 6) verify();
            }}
          >
            <div className="login-step">
              <h1>{t("인증 코드를 입력해 주세요")}</h1>
              <p className="sent">{t("{email}로 보낸 6자리 코드를 입력해 주세요.", { email })}</p>
            </div>
            <div className="otp" onClick={() => codeInput.current?.focus()}>
              {Array.from({ length: 6 }, (_, i) => (
                <div key={i} className={`box ${i === code.length ? "on" : ""}`}>
                  {code[i] ?? ""}
                </div>
              ))}
              <input
                ref={codeInput}
                className="otp-input"
                aria-label={t("인증 코드 6자리")}
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              />
            </div>
            {devCode && (
              <p className="login-dev">
                {t("개발 모드: 인증 코드는 {code} 예요", { code: devCode })}{" "}
                <button type="button" className="link" onClick={() => setCode(devCode)}>
                  {t("코드 채우기")}
                </button>
              </p>
            )}
            {error && <p className="login-error">{t(error)}</p>}
            <button className="btn" type="submit" disabled={code.length !== 6 || busy}>
              {busy ? t("확인하는 중") : t("로그인")}
            </button>
            <div className="login-links">
              <button type="button" className="link" disabled={wait > 0 || busy} onClick={sendCode}>
                {wait > 0 ? t("{n}초 뒤에 다시 받을 수 있어요", { n: wait }) : t("코드 다시 받기")}
              </button>
              <button
                type="button"
                className="link"
                onClick={() => {
                  setStep("mail");
                  setError("");
                  setDevCode("");
                }}
              >
                {t("메일 주소 바꾸기")}
              </button>
            </div>
          </form>
        )}
      </div>

      {opts.dev_mode && (
        <button className="link devlink" onClick={onDev}>
          {t("개발용 사용자로 둘러보기")}
        </button>
      )}
    </div>
  );
}
