import { useState, type ReactNode } from "react";
import { api } from "./api";
import { useI18n } from "./i18n";
import type { MatchView } from "./types";

export function Chip({ on, onClick, warm, children }: { on: boolean; onClick: () => void; warm?: boolean; children: ReactNode }) {
  return (
    <button type="button" className={`chip ${warm ? "warm" : ""} ${on ? "on" : ""}`} onClick={onClick} aria-pressed={on}>
      {children}
    </button>
  );
}

/** 직접 입력 + 추천 칩으로 고르는 태그 입력. tone 은 파랑(알려줄 수 있는 것) / 따뜻한 색(배우고 싶은 것) */
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

/** SOOKMATE 로고: 서로 말을 건네는 두 말풍선(파랑 = 알려줄 수 있는 것, 코랄 = 배우고 싶은 것) + 글자 */
export function LogoMark({ size = 32 }: { size?: number }) {
  return (
    <svg className="logomark" width={size} height={size * 0.9} viewBox="0 0 40 36" aria-hidden="true">
      <path d="M8 3h16a7 7 0 0 1 7 7v7a7 7 0 0 1-7 7H14l-6 5v-5a7 7 0 0 1-5-6.7V10a7 7 0 0 1 5-7z" fill="var(--accent)" />
      <path d="M16 12h16a7 7 0 0 1 7 7v6a7 7 0 0 1-3 5.7V35l-6-4.5H23a7 7 0 0 1-7-7V19a7 7 0 0 1 0-7z" fill="var(--warm)" fillOpacity="0.92" />
      <circle cx="12" cy="13" r="1.6" fill="#fff" />
      <circle cx="18" cy="13" r="1.6" fill="#fff" />
      <circle cx="24.5" cy="22" r="1.6" fill="#fff" />
      <circle cx="30.5" cy="22" r="1.6" fill="#fff" />
    </svg>
  );
}

export function Logo() {
  return (
    <span className="logo" role="img" aria-label="SOOKMATE">
      <LogoMark size={38} />
      <span className="wordmark" aria-hidden="true">
        SOOKMATE
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

/** 이름 첫 글자를 둥근 원에 담은 아바타 */
export function Avatar({ name, size }: { name: string; size?: "lg" }) {
  return <div className={`av ${size ?? ""}`}>{name.trim().slice(0, 1) || "?"}</div>;
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

// 같은 문장을 같은 언어로 다시 번역하지 않도록 화면에서도 기억해 둔다
const trCache = new Map<string, string>();

/** 사람이 쓴 글 아래에 붙이는 '번역 보기' 버튼. 원문은 그대로 두고 번역문만 아래에 보여준다. */
export function TranslateButton({ text }: { text: string }) {
  const { t, lang } = useI18n();
  const key = `${lang}\u0000${text}`;
  const [shown, setShown] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  if (!text.trim()) return null;

  const toggle = async () => {
    if (shown !== null) return setShown(null);
    const hit = trCache.get(key);
    if (hit) return setShown(hit);
    setBusy(true);
    setFailed(false);
    try {
      const r = await api.translate(text);
      if (r.translated) {
        trCache.set(key, r.text);
        setShown(r.text);
      } else {
        setFailed(true);
      }
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <span className="tr">
      <button type="button" className="tr-btn" onClick={toggle} disabled={busy}>
        {busy ? t("번역하는 중") : shown !== null ? t("원문만 보기") : t("번역 보기")}
      </button>
      {shown !== null && <span className="tr-text">{shown}</span>}
      {failed && <span className="tr-fail">{t("지금은 번역할 수 없어요")}</span>}
    </span>
  );
}
