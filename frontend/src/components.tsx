import { textLanguage, translateText } from "./translation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useI18n } from "./i18n";
import type { MatchView } from "./types";

export function Chip({ on, onClick, warm, children }: { on: boolean; onClick: () => void; warm?: boolean; children: ReactNode }) {
  return (
    <button type="button" className={`chip ${warm ? "warm" : ""} ${on ? "on" : ""}`} onClick={onClick} aria-pressed={on}>
      {children}
    </button>
  );
}

/** 직접 입력 + 추천 칩으로 고르는 태그 입력. tone은 기본색(알려줄 수 있는 것) / 포인트색(배우고 싶은 것) */
export function TagInput({
  values,
  onChange,
  suggestions = [],
  tone = "blue",
  placeholder,
  max = 10,
  maxLen = 30,
}: {
  values: string[];
  onChange: (next: string[]) => void;
  suggestions?: string[];
  tone?: "blue" | "warm";
  placeholder: string;
  max?: number;
  maxLen?: number;
}) {
  const { t, tv } = useI18n();
  const [text, setText] = useState("");
  const full = values.length >= max;

  const add = (raw: string) => {
    const v = raw.trim().slice(0, maxLen);
    if (!v || full || values.includes(v)) return;
    onChange([...values, v]);
    setText("");
  };
  const remove = (v: string) => onChange(values.filter((x) => x !== v));
  const rest = suggestions.filter((s) => !values.includes(s));

  return (
    <div className={`taginput ${tone}`}>
      {values.length > 0 && (
        <div className="picked">
          {values.map((v) => (
            <button key={v} type="button" className="pill" onClick={() => remove(v)} aria-label={t("{v} 빼기", { v: tv(v) })}>
              {tv(v)}
              <span aria-hidden="true">×</span>
            </button>
          ))}
        </div>
      )}
      <div className="addrow">
        <input
          value={text}
          maxLength={maxLen}
          disabled={full}
          placeholder={full ? t("최대 {max}개까지 담을 수 있어요", { max }) : placeholder}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.nativeEvent.isComposing) {
              e.preventDefault();
              add(text);
            }
          }}
        />
        <button type="button" className="addbtn" disabled={full || !text.trim()} onClick={() => add(text)}>
          {t("추가")}
        </button>
      </div>
      {!full && rest.length > 0 && (
        <div className="sugg">
          {rest.map((s) => (
            <button key={s} type="button" className="sg" onClick={() => add(s)}>
              + {tv(s)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** 작은 헤더에서도 선명하게 보이도록 단순화한 블루·버터 대화 심벌. */
export function LogoMark({ size = 32 }: { size?: number }) {
  return (
    <svg className="logomark bean-logo" width={size * 1.25} height={size} viewBox="0 0 60 48" fill="none" aria-hidden="true">
      <path d="M27 7C17 2 5 8 4 21c-1 8 3 13 8 16l-3 7 11-4c13 2 21-7 20-18C39 15 34 10 27 7Z" fill="#86bafa" />
      <path d="M43 12c-10-4-20 3-20 14 0 10 9 16 19 13l12 4-4-8c9-9 5-19-7-23Z" fill="#f8df8d" />
      <g fill="#34445c">
        <circle cx="13.5" cy="18" r="1.7" />
        <circle cx="21.5" cy="18" r="1.7" />
        <circle cx="35.5" cy="22" r="1.7" />
        <circle cx="43.5" cy="22" r="1.7" />
      </g>
      <path d="M14 24c2 3 5 3 7 0M36 28c2 3 5 3 7 0" stroke="#34445c" strokeWidth="2.3" strokeLinecap="round" />
    </svg>
  );
}

export function Logo() {
  return (
    <span className="logo" role="img" aria-label="SOOKMATE">
      <LogoMark size={40} />
      <span className="wordmark" aria-hidden="true">
        sookmate
      </span>
    </span>
  );
}

export function Lock({ title, text, action, onAction }: { title: string; text: string; action: string; onAction: () => void }) {
  return (
    <div className="lock">
      <h1>{title}</h1>
      <p>{text}</p>
      <button className="btn" onClick={onAction}>
        {action}
      </button>
    </div>
  );
}

/** 이름으로 고정된 캐릭터를 선택해 모든 화면에서 같은 기본 프사를 보여준다. */
export function Avatar({ name, size }: { name: string; size?: "lg" }) {
  const normalized = name.trim().normalize("NFC");
  let hash = 0;
  for (const letter of normalized) hash = (Math.imul(hash, 31) + letter.codePointAt(0)!) >>> 0;
  const variant = hash % 4;
  return (
    <div className={`av bean-avatar ${size ?? ""}`} role="img" aria-label={`${name || "사용자"} 프로필`}>
      <span className="bean-avatar-sprite" aria-hidden="true" style={{ backgroundPosition: `${variant % 2 === 0 ? 0 : 100}% ${variant < 2 ? 0 : 100}%` }} />
    </div>
  );
}

/** 확정된 만남이 여럿일 때 상대를 고르는 줄 */
export function MatchPicker({ matches, activeId, onPick }: { matches: MatchView[]; activeId: number | null; onPick: (id: number) => void }) {
  if (matches.length < 2) return null;
  return (
    <div className="picker">
      {matches.map((m) => (
        <Chip key={m.id} on={m.id === activeId} onClick={() => onPick(m.id)}>
          {m.partner.name}
        </Chip>
      ))}
    </div>
  );
}

/** 원문과 화면 언어가 다를 때만 번역 버튼을 표시한다. */
export function TranslateButton({ text }: { text: string }) {
  const { t, lang } = useI18n();
  const [shown, setShown] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const request = useRef(0);
  useEffect(() => { request.current++; setShown(null); setBusy(false); setFailed(false); return () => { request.current++; }; }, [text, lang]);
  const source = textLanguage(text);
  if (!text.trim() || source === lang || !source) return null;
  const toggle = async () => {
    if (shown !== null) return setShown(null);
    const token = ++request.current;
    setBusy(true); setFailed(false);
    try {
      const translated = await translateText(text, lang);
      if (token !== request.current) return;
      if (translated) setShown(translated); else setFailed(true);
    } catch { if (token === request.current) setFailed(true); }
    finally { if (token === request.current) setBusy(false); }
  };
  return <span className="tr">
    <button type="button" className="tr-btn" onClick={() => void toggle()} disabled={busy}>{busy ? t("번역하는 중") : shown !== null ? t("원문만 보기") : t("번역 보기")}</button>
    {shown !== null && <span className="tr-text" lang={lang}>{shown}</span>}
    {failed && <span className="tr-fail">{t("지금은 번역할 수 없어요")}</span>}
  </span>;
}

/** 받은 채팅은 내 언어의 번역문을 먼저 보여주며, 원문은 언제든 확인할 수 있다. */
export function LocalizedMessage({ text }: { text: string }) {
  const { t, lang } = useI18n();
  const [translated, setTranslated] = useState<string | null>(null);
  const [original, setOriginal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  const source = textLanguage(text);
  const needsTranslation = Boolean(source && source !== lang);
  useEffect(() => {
    let alive = true;
    setTranslated(null); setOriginal(false); setFailed(false); setBusy(false);
    if (needsTranslation) {
      setBusy(true);
      translateText(text, lang).then((result) => { if (alive) { setTranslated(result); setFailed(!result); } })
        .catch(() => { if (alive) setFailed(true); }).finally(() => { if (alive) setBusy(false); });
    }
    return () => { alive = false; };
  }, [text, lang, needsTranslation, retry]);
  return <>
    <span lang={translated && !original ? lang : source ?? undefined}>{translated && !original ? translated : text}</span>
    {busy && <span className="tr-text" role="status">{t("번역하는 중")}</span>}
    {translated && <span className="tr"><button className="tr-btn" type="button" onClick={() => setOriginal((value) => !value)}>{t(original ? "번역 보기" : "원문 보기")}</button></span>}
    {failed && <span className="tr"><span className="tr-fail">{t("번역하지 못해 원문을 표시해요")}</span><button className="tr-btn" type="button" onClick={() => setRetry((value) => value + 1)}>{t("다시 시도하기")}</button></span>}
  </>;
}
