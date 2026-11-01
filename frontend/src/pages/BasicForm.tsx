import { useState } from "react";
import { api } from "../api";
import { Avatar } from "../components";
import { isLang, useI18n } from "../i18n";
import type { Me, Options } from "../types";

interface Props {
  me: Me;
  opts: Options;
  first?: boolean; // 처음 입력하는 화면이면 true
  onSaved: () => Promise<void>;
  onCancel?: () => void;
  flash: (msg: string) => void;
}

/** 화면 언어, 닉네임, 한 줄 소개. 처음 한 번 정하고 프로필에서 고칠 수 있다. */
export default function BasicForm({ me, opts, first, onSaved, onCancel, flash }: Props) {
  const { t, lang, setLang } = useI18n();
  const [name, setName] = useState(me.onboarded ? me.name : "");
  const [bio, setBio] = useState(me.bio);
  const [saving, setSaving] = useState(false);

  const ok = name.trim().length > 0;

  // 언어는 누르는 즉시 화면에 적용하고 계정에도 저장한다 (저장이 안 돼도 이 기기에서는 바뀐 채로 둔다)
  const pickLang = (code: string) => {
    if (!isLang(code)) return;
    setLang(code);
    api.saveLanguage(code).catch(() => undefined);
  };

  const save = async () => {
    setSaving(true);
    try {
      await api.saveBasic({ name, bio });
      flash(first ? "반가워요! 이제 프로필을 채워 볼까요?" : "저장했어요.");
      await onSaved();
    } catch (e) {
      flash((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={`basic ${first ? "first" : ""}`}>
      <div className="langpick" role="radiogroup" aria-label={t("화면 언어")}>
        {opts.ui_langs.map(([code, label]) => (
          <button key={code} type="button" role="radio" aria-checked={lang === code} className={`chip ${lang === code ? "on" : ""}`} onClick={() => pickLang(code)}>
            {label}
          </button>
        ))}
      </div>

      {first ? <h1>{t("먼저 나를 소개해 주세요")}</h1> : <h2 className="plain">{t("기본 정보")}</h2>}

      <div className="basic-preview">
        <Avatar name={name} size="lg" />
        <div>
          <b>{name.trim() || t("닉네임")}</b>
          <span className="m">{bio.trim() || t("한 줄 소개")}</span>
        </div>
      </div>

      <div className="field">
        <label htmlFor="nick">{t("닉네임")}</label>
        <input id="nick" value={name} maxLength={opts.name_max_len} onChange={(e) => setName(e.target.value)} placeholder={t("상대에게 보여요")} />
      </div>
      <div className="field">
        <label htmlFor="bio">
          {t("한 줄 소개")} <span className="opt">{t("선택")}</span>
        </label>
        <input id="bio" value={bio} maxLength={opts.bio_max_len} onChange={(e) => setBio(e.target.value)} placeholder={t("예: 카페 투어가 취미예요")} />
        <span className="count">
          {bio.length}/{opts.bio_max_len}
        </span>
      </div>

      <div className="row">
        {onCancel && (
          <button className="btn ghost" onClick={onCancel}>
            {t("닫기")}
          </button>
        )}
        <button className="btn" disabled={!ok || saving} onClick={save}>
          {saving ? t("저장하는 중") : first ? t("시작하기") : t("저장")}
        </button>
      </div>
    </div>
  );
}
