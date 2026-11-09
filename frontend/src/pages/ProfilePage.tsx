import { useEffect, useState } from "react";
import { api } from "../api";
import { Avatar, Chip, TagInput } from "../components";
import { useI18n } from "../i18n";
import BasicForm from "./BasicForm";
import type { Me, Options } from "../types";

interface Props {
  me: Me;
  opts: Options;
  onSaved: () => Promise<void>;
  onLogout: () => void;
  flash: (msg: string) => void;
}

function fromMe(me: Me) {
  return {
    interests: me.interests,
    times: me.times,
    langs: me.langs,
    teach: me.teach,
    learn: me.learn,
    prefs: me.prefs,
    nationality: me.nationality ?? "",
  };
}

export default function ProfilePage({ me, opts, onSaved, onLogout, flash }: Props) {
  const { t } = useI18n();
  const [f, setF] = useState(fromMe(me));
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);

  // 사용자를 바꿨을 때만 폼을 다시 채운다 (4초마다 오는 새로고침에는 반응하지 않음)
  useEffect(() => setF(fromMe(me)), [me.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((s) => ({ ...s, [k]: v }));
  const toggleLang = (v: string) => set("langs", f.langs.includes(v) ? f.langs.filter((x) => x !== v) : [...f.langs, v]);

  const valid = f.times.length > 0 && f.langs.length > 0;

  const save = async () => {
    setSaving(true);
    try {
      await api.saveProfile({ ...f, nationality: f.nationality.trim() || null });
      flash("저장했어요. 새 추천을 확인해 보세요.");
      await onSaved();
    } catch (e) {
      flash((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <h1>{t("내 프로필")}</h1>

      <section className="sec block">
        {editing ? (
          <BasicForm
            me={me}
            opts={opts}
            flash={flash}
            onCancel={() => setEditing(false)}
            onSaved={async () => {
              await onSaved();
              setEditing(false);
            }}
          />
        ) : (
          <div className="who">
            <Avatar name={me.name} size="lg" />
            <div className="grow">
              <b>{me.name}</b>
              <span className="m">{me.bio || t("한 줄 소개를 적어 보세요")}</span>
            </div>
            <button className="btn ghost small" onClick={() => setEditing(true)}>
              {t("수정")}
            </button>
          </div>
        )}
      </section>

      <section className="sec block">
        <h2>
          {t("대화할 수 있는 언어")}
        </h2>
        <div className="chips">
          {opts.languages.map((v) => (
            <Chip key={v} on={f.langs.includes(v)} onClick={() => toggleLang(v)}>
              {v}
            </Chip>
          ))}
        </div>
      </section>

      <section className="sec block">
        <h2>
          {t("이번 주 가능한 시간")}
        </h2>
        <TimePicker days={opts.days} slots={opts.slots} value={f.times} onChange={(v) => set("times", v)} />
      </section>

      <section className="sec block">
        <h2>
          {t("좋아하는 것")}
        </h2>
        <TagInput
          values={f.interests}
          onChange={(v) => set("interests", v)}
          suggestions={opts.interests}
          placeholder={t("예: 뜨개질")}
        />
      </section>

      <section className="sec">
        <h2 className="plain">
          {t("서로 하나씩 알려줘요")}
        </h2>
        <div className="exchange">
          <div className="xcard give">
            <b>{t("알려줄 수 있어요")}</b>
            <TagInput
              values={f.teach}
              onChange={(v) => set("teach", v)}
              suggestions={opts.topics}
              placeholder={t("예: 학교 앞 맛집")}
            />
          </div>
          <div className="xcard take">
            <b>{t("배우고 싶어요")}</b>
            <TagInput
              tone="warm"
              values={f.learn}
              onChange={(v) => set("learn", v)}
              suggestions={opts.topics}
              placeholder={t("예: 일본어 인사말")}
            />
          </div>
        </div>
      </section>

      <section className="sec block">
        <h2>
          {t("만나기 전 알려둘 내 취향")}
        </h2>
        <TagInput
          values={f.prefs}
          onChange={(v) => set("prefs", v)}
          placeholder={t("예: 조용한 장소가 좋아요, 매운 음식은 피해요")}
          max={5}
          maxLen={40}
        />
      </section>

      <section className="sec block field">
        <label htmlFor="nat">
          {t("국적")} <span className="opt">{t("선택")}</span>
        </label>
        <input id="nat" value={f.nationality} maxLength={40} onChange={(e) => set("nationality", e.target.value)} />
      </section>

      {!valid && <div className="banner err">{t("가능한 시간과 대화 언어를 하나 이상 골라 주세요.")}</div>}
      <button className="btn" disabled={!valid || saving} onClick={save}>
        {saving ? t("저장하는 중") : t("저장하고 추천 받기")}
      </button>

      <div className="account">
        {me.email && !me.email.endsWith("@example.com") && (
          <p className="hint">
            {t("로그인한 메일")}: {me.email}
          </p>
        )}
        <button className="link" onClick={onLogout}>
          {t("로그아웃")}
        </button>
      </div>
    </>
  );
}

/** 요일별 한 줄 + 빠른 선택. 칸마다 라벨이 있어서 무슨 시간인지 바로 읽힌다. */
function TimePicker({ days, slots, value, onChange }: { days: string[]; slots: string[]; value: string[]; onChange: (v: string[]) => void }) {
  const { t } = useI18n();
  const all = days.flatMap((d) => slots.map((s) => `${d} ${s}`));
  const toggle = (k: string) => onChange(value.includes(k) ? value.filter((x) => x !== k) : [...value, k]);
  const only = (slot: string) => onChange(all.filter((k) => k.endsWith(` ${slot}`)));

  return (
    <div className="times">
      <div className="quick">
        {slots.map((s) => (
          <button key={s} type="button" className="sg" onClick={() => only(s)}>
            {t(`${s}만`)}
          </button>
        ))}
        <button type="button" className="sg" onClick={() => onChange(all)}>
          {t("모두")}
        </button>
        <button type="button" className="sg" onClick={() => onChange([])}>
          {t("비우기")}
        </button>
      </div>
      {days.map((d) => (
        <div className="trow" key={d}>
          <span className="d">{t(d)}</span>
          {slots.map((s) => {
            const k = `${d} ${s}`;
            const on = value.includes(k);
            return (
              <button key={k} type="button" className={`tcell ${on ? "on" : ""}`} aria-pressed={on} aria-label={`${t(d)} ${t(s)}`} onClick={() => toggle(k)}>
                {t(s)}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}
