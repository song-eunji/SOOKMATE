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

/** SOOKMATE 로고: 파랑(나) 티켓과 분홍(상대) 티켓이 겹치고, 겹친 곳이 노랑 */
const TICKET = "M6 0H42a6 6 0 0 1 6 6V12a4 4 0 0 0 0 8V26a6 6 0 0 1-6 6H6a6 6 0 0 1-6-6V20a4 4 0 0 0 0-8V6A6 6 0 0 1 6 0Z";
export function LogoMark({ size = 32 }: { size?: number }) {
  return (
    <svg className="logomark" width={size} height={(size * 40) / 56} viewBox="0 0 56 40" aria-hidden="true">
      <defs>
        <clipPath id="logo-overlap">
          <path transform="translate(2,3) scale(.78)" d={TICKET} />
        </clipPath>
      </defs>
      <path transform="translate(2,3) scale(.78)" d={TICKET} fill="#3a3fe4" />
      <path transform="translate(16,13) scale(.78)" d={TICKET} fill="#ff8ac0" />
      <g clipPath="url(#logo-overlap)">
        <path transform="translate(16,13) scale(.78)" d={TICKET} fill="#ffe552" />
      </g>
    </svg>
  );
}

export function Logo() {
  return (
    <span className="logo" role="img" aria-label="SOOKMATE">
      <LogoMark size={40} />
      <span className="wordmark" aria-hidden="true">
        SOOK<b>MATE</b>
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
