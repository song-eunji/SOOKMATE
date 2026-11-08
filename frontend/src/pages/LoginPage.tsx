import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { LogoMark } from "../components";
import { isLang, useI18n } from "../i18n";
import type { DevUser, Options } from "../types";

interface Props {
  opts: Options;
  onLoggedIn: (token: string) => void;
  onDev: () => void;
}

const RESEND_SECONDS = 60; // 서버의 재요청 대기 시간과 같게 둔다
// 서버가 돌려주는 안내 문장. 이 말이 오면 "회원가입으로" / "로그인으로" / "비밀번호 설정" 버튼을 같이 보여준다.
const NOT_REGISTERED = "가입된 메일이 아니에요. 회원가입을 해 주세요.";
const ALREADY_REGISTERED = "이미 가입된 메일이에요. 로그인해 주세요.";
const NO_PASSWORD_YET = "아직 비밀번호가 없는 계정이에요. '비밀번호 찾기'로 먼저 설정해 주세요.";
const PW_MIN = 8;
const PW_MAX = 64;

type View = "login" | "signup" | "reset";
type Step = "mail" | "code" | "password";

/** 첫 화면은 로그인(메일 + 비밀번호). 처음이면 회원가입: 숙명 메일 코드를 한 번 확인하고 비밀번호를 정한다. */
export default function LoginPage({ opts, onLoggedIn, onDev }: Props) {
  const { t, lang, setLang } = useI18n();
  const [view, setView] = useState<View>("login");
  const [step, setStep] = useState<Step>("mail");
  const [mail, setMail] = useState("");
  const [password, setPassword] = useState("");
  const [again, setAgain] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [wait, setWait] = useState(0); // 코드를 다시 받을 수 있을 때까지 남은 초
  const [devCode, setDevCode] = useState(""); // 개발 모드에서만 서버가 알려 준다
  const codeInput = useRef<HTMLInputElement>(null);

  // 개발자 입장(스위치가 켜졌을 때만): 이메일 없이 가짜 프로필 계정으로 들어간다
  const [devUsers, setDevUsers] = useState<DevUser[]>([]);
  const [devPick, setDevPick] = useState(0);
  const [devOpen, setDevOpen] = useState(false);

  const domain = opts.login_domain;
  const local = mail.trim();
  const email = local.includes("@") ? local : `${local}@${domain}`;
  const signup = view === "signup";
  const reset = view === "reset";

  useEffect(() => {
    if (!opts.dev_login) return;
    api
      .devUsers()
      .then((rows) => {
        setDevUsers(rows);
        setDevPick((rows.find((u) => u.name === "수아") ?? rows[0])?.id ?? 0);
      })
      .catch(() => undefined);
  }, [opts.dev_login]);

  useEffect(() => {
    if (wait <= 0) return;
    const id = window.setTimeout(() => setWait((w) => w - 1), 1000);
    return () => window.clearTimeout(id);
  }, [wait]);

  useEffect(() => {
    if (step === "code") codeInput.current?.focus();
  }, [step]);

  const switchView = (next: View) => {
    setView(next);
    setStep("mail");
    setError("");
    setCode("");
    setDevCode("");
    setPassword("");
    setAgain("");
  };

  const run = async (job: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await job();
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy(false);
  };

  const sendCode = () =>
    run(async () => {
      const r = await api.requestCode(email, reset ? "reset" : "signup");
      setDevCode(r.dev_code ?? "");
      setCode("");
      setStep("code");
      setWait(RESEND_SECONDS);
    });

  const logIn = () => run(async () => onLoggedIn((await api.login(email, password)).token));

  // 코드는 한 번만 쓸 수 있어서, 코드와 비밀번호를 마지막에 함께 보낸다
  const finish = async () => {
    setBusy(true);
    setError("");
    try {
      const r = reset ? await api.resetPassword(email, code, password) : await api.signup(email, code, password, lang);
      onLoggedIn(r.token);
    } catch (e) {
      const msg = (e as Error).message;
      setError(msg);
      setBusy(false);
      if (msg.includes("코드") || msg.includes("만료")) {
        setCode("");
        setStep("code");
      }
    }
  };

  const pwProblem =
    password.length < PW_MIN || password.length > PW_MAX
      ? t("{min}자 이상 {max}자 이하로 정해 주세요", { min: PW_MIN, max: PW_MAX })
      : !/[A-Za-z]/.test(password) || !/\d/.test(password)
        ? t("영문과 숫자를 모두 넣어 주세요")
        : again && again !== password
          ? t("비밀번호가 서로 달라요")
          : "";
  const canFinish = !pwProblem && again === password && !busy;

  const devEnter = (id: number) => run(async () => onLoggedIn((await api.devLogin(id)).token));

  const errorBox = error && (
    <div className="login-error-box">
      <p className="login-error">{t(error)}</p>
      {error === NOT_REGISTERED && (
        <button type="button" className="link" onClick={() => switchView("signup")}>
          {t("회원가입하기")}
        </button>
      )}
      {error === ALREADY_REGISTERED && (
        <button type="button" className="link" onClick={() => switchView("login")}>
          {t("로그인하기")}
        </button>
      )}
      {error === NO_PASSWORD_YET && (
        <button type="button" className="link" onClick={() => switchView("reset")}>
          {t("비밀번호 설정하기")}
        </button>
      )}
    </div>
  );

  const mailField = (
    <div className="mailfield">
      <input
        type="text"
        inputMode="email"
        autoComplete="username"
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
  );

  const pwField = (label: string, value: string, set: (v: string) => void, auto: string) => (
    <div className="mailfield">
      <input
        type={showPw ? "text" : "password"}
        autoComplete={auto}
        aria-label={label}
        value={value}
        onChange={(e) => set(e.target.value)}
        placeholder={label}
        maxLength={PW_MAX + 10}
      />
      <button type="button" className="link pwshow" onClick={() => setShowPw((v) => !v)}>
        {showPw ? t("숨기기") : t("보기")}
      </button>
    </div>
  );

  const tagline = signup
    ? t("숙명여자대학교 메일로만 가입할 수 있어요")
    : reset
      ? t("메일로 코드를 받아 새 비밀번호를 정해요")
      : t("숙명여자대학교 메일로 로그인해요");

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
          <p className="login-tag">{tagline}</p>
        </div>

        {view === "login" && (
          <form
            className="login-form"
            onSubmit={(e) => {
              e.preventDefault();
              if (local && password && !busy) logIn();
            }}
          >
            {mailField}
            {pwField(t("비밀번호"), password, setPassword, "current-password")}
            {errorBox}
            <button className="btn" type="submit" disabled={!local || !password || busy}>
              {busy ? t("확인하는 중") : t("로그인")}
            </button>
            <div className="login-links">
              <button type="button" className="link" onClick={() => switchView("reset")}>
                {t("비밀번호를 잊었어요")}
              </button>
            </div>
          </form>
        )}

        {view !== "login" && step === "mail" && (
          <form
            className="login-form"
            onSubmit={(e) => {
              e.preventDefault();
              if (local && !busy) sendCode();
            }}
          >
            <h1 className="login-title">{reset ? t("비밀번호 찾기") : t("회원가입")}</h1>
            {mailField}
            {errorBox}
            <button className="btn" type="submit" disabled={!local || busy}>
              {busy ? t("메일을 보내는 중") : t("인증 코드 받기")}
            </button>
          </form>
        )}

        {view !== "login" && step === "code" && (
          <form
            className="login-form"
            onSubmit={(e) => {
              e.preventDefault();
              if (code.length === 6) setStep("password");
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
            {errorBox}
            <button className="btn" type="submit" disabled={code.length !== 6 || busy}>
              {t("다음")}
            </button>
            <div className="login-links">
              <button type="button" className="link" disabled={wait > 0 || busy} onClick={sendCode}>
                {wait > 0 ? t("{n}초 뒤에 다시 받을 수 있어요", { n: wait }) : t("코드 다시 받기")}
              </button>
              <button type="button" className="link" onClick={() => switchView(view)}>
                {t("메일 주소 바꾸기")}
              </button>
            </div>
          </form>
        )}

        {view !== "login" && step === "password" && (
          <form
            className="login-form"
            onSubmit={(e) => {
              e.preventDefault();
              if (canFinish) finish();
            }}
          >
            <div className="login-step">
              <h1>{reset ? t("새 비밀번호를 정해 주세요") : t("비밀번호를 정해 주세요")}</h1>
              <p className="sent">{t("로그인할 때 {email}와 이 비밀번호를 써요.", { email })}</p>
            </div>
            {pwField(t("비밀번호"), password, setPassword, "new-password")}
            {pwField(t("비밀번호 확인"), again, setAgain, "new-password")}
            <p className={`pwhint ${password && pwProblem ? "bad" : ""}`}>
              {password && pwProblem ? pwProblem : t("{min}자 이상, 영문과 숫자를 함께 넣어 주세요", { min: PW_MIN })}
            </p>
            {errorBox}
            <button className="btn" type="submit" disabled={!canFinish}>
              {busy ? t("확인하는 중") : reset ? t("비밀번호 바꾸고 로그인") : t("가입하기")}
            </button>
            <div className="login-links">
              <button type="button" className="link" onClick={() => setStep("code")}>
                {t("코드 다시 입력하기")}
              </button>
            </div>
          </form>
        )}

        {view === "login" ? (
          <p className="login-switch">
            {t("아직 계정이 없나요?")}{" "}
            <button type="button" className="link strong" onClick={() => switchView("signup")}>
              {t("회원가입")}
            </button>
          </p>
        ) : (
          step === "mail" && (
            <p className="login-switch">
              {signup ? t("이미 계정이 있나요?") : t("비밀번호가 기억났나요?")}{" "}
              <button type="button" className="link strong" onClick={() => switchView("login")}>
                {t("로그인")}
              </button>
            </p>
          )
        )}
      </div>

      {opts.dev_login && devUsers.length > 0 && (
        <div className="devpanel">
          <p className="devtitle">{t("개발자 입장")}</p>
          <button type="button" className="link" onClick={() => setDevOpen((v) => !v)}>
            {devOpen ? t("접기") : t("프로필 골라서 들어가기")}
          </button>
          {devOpen && (
            <div className="devpick">
              <select aria-label={t("가짜 프로필 고르기")} value={devPick} onChange={(e) => setDevPick(Number(e.target.value))}>
                {(["domestic", "international"] as const).map((kind) => (
                  <optgroup key={kind} label={kind === "domestic" ? t("국내 학생") : t("유학생")}>
                    {devUsers
                      .filter((u) => u.kind === kind)
                      .map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.name}
                          {u.nationality ? ` · ${u.nationality}` : ""} · {u.dept}
                        </option>
                      ))}
                  </optgroup>
                ))}
              </select>
              <button type="button" className="btn" disabled={busy || !devPick} onClick={() => devEnter(devPick)}>
                {t("이 프로필로 입장")}
              </button>
            </div>
          )}
          <p className="devnote">{t("시연 전 개발용이에요. 가짜 프로필 계정으로만 들어갈 수 있어요.")}</p>
        </div>
      )}

      {opts.dev_mode && (
        <button className="link devlink" onClick={onDev}>
          {t("개발용 사용자로 둘러보기")}
        </button>
      )}
    </div>
  );
}
