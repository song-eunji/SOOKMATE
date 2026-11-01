import { useEffect, useState } from "react";
import { api } from "../api";
import { Lock, MatchPicker } from "../components";
import { useI18n } from "../i18n";
import type { MatchView, NextActivity, NoteData, NotesResponse } from "../types";

interface Props {
  active: MatchView | null;
  confirmed: MatchView[];
  onPick: (id: number) => void;
  goRec: () => void;
  flash: (msg: string) => void;
}

const EMPTY: NoteData = { expr: "", fact: "", next_text: "", share_expr: false, share_fact: false, share_next: false };

const FIELDS: { key: "expr" | "fact" | "next_text"; share: "share_expr" | "share_fact" | "share_next"; label: string; ph: string }[] = [
  { key: "expr", share: "share_expr", label: "새로 배운 표현", ph: "예: 주문할게요 → お願いします" },
  { key: "fact", share: "share_fact", label: "새로 알게 된 것", ph: "예: 도서관은 학생증으로 들어가요" },
  { key: "next_text", share: "share_next", label: "다음에 하고 싶은 것", ph: "예: 도서관 이용법 알려주기" },
];

export default function NotesPage({ active, confirmed, onPick, goRec, flash }: Props) {
  const { t } = useI18n();
  const [note, setNote] = useState<NoteData>(EMPTY);
  const [theirs, setTheirs] = useState<NotesResponse["partner_shared"]>(null);
  const [next, setNext] = useState<NextActivity | null>(null);
  const [saved, setSaved] = useState(false);
  const matchId = active?.id ?? null;

  useEffect(() => {
    if (matchId === null) return;
    let alive = true;
    setNote(EMPTY);
    setNext(null);
    setSaved(false);
    api
      .notes(matchId)
      .then((r) => {
        if (!alive) return;
        setTheirs(r.partner_shared);
        if (r.mine) {
          setNote(r.mine);
          setSaved(true);
          api.nextActivity(matchId).then((n) => alive && setNext(n));
        }
      })
      .catch((e) => flash((e as Error).message));
    return () => {
      alive = false;
    };
  }, [matchId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!active) {
    return <Lock title={t("교류 노트는 만남 뒤에 쓸 수 있어요")} text={t("추천 탭에서 먼저 상대를 수락해 보세요.")} action={t("추천 보러 가기")} onAction={goRec} />;
  }
  const name = active.partner.name;
  const empty = !note.expr.trim() && !note.fact.trim() && !note.next_text.trim();

  const save = async () => {
    try {
      await api.saveNote(active.id, note);
      setNext(await api.nextActivity(active.id));
      setSaved(true);
      flash(t("노트를 저장했어요"));
    } catch (e) {
      flash((e as Error).message);
    }
  };

  const remove = async () => {
    try {
      await api.deleteNote(active.id);
      setNote(EMPTY);
      setNext(null);
      setSaved(false);
      flash(t("노트를 삭제했어요"));
    } catch (e) {
      flash((e as Error).message);
    }
  };

  const sharedItems = theirs
    ? FIELDS.filter((f) => theirs[f.key]).map((f) => ({ label: t(f.label), value: theirs[f.key] as string }))
    : [];

  return (
    <>
      <MatchPicker matches={confirmed} activeId={active.id} onPick={onPick} />
      <div>
        <h1>{t("{name}님과의 교류 노트", { name })}</h1>
        <p className="lead">{t("기본은 비공개예요. 공유를 켠 항목만 상대에게 보여요.")}</p>
      </div>

      <div className="list">
        {FIELDS.map((f) => (
          <div className="share" key={f.key}>
            <div className="field">
              <label htmlFor={`note-${f.key}`}>{t(f.label)}</label>
              <input
                id={`note-${f.key}`}
                value={note[f.key]}
                maxLength={200}
                placeholder={t(f.ph)}
                onChange={(e) => {
                  setSaved(false);
                  setNote((n) => ({ ...n, [f.key]: e.target.value }));
                }}
              />
            </div>
            <div className="line">
              <span>{t("상대에게 공유")}</span>
              <button
                type="button"
                className={`sw ${note[f.share] ? "on" : ""}`}
                role="switch"
                aria-checked={note[f.share]}
                aria-label={t("{label} 공유", { label: t(f.label) })}
                onClick={() => {
                  setSaved(false);
                  setNote((n) => ({ ...n, [f.share]: !n[f.share] }));
                }}
              />
            </div>
          </div>
        ))}
      </div>

      {sharedItems.length > 0 && (
        <section className="sec">
          <h2>{t("{name}님이 공유한 노트", { name })}</h2>
          <ul className="list">
            {sharedItems.map((s) => (
              <li key={s.label}>
                {s.value}
                <small>{s.label}</small>
              </li>
            ))}
          </ul>
        </section>
      )}

      {!saved ? (
        <button className="btn" disabled={empty} onClick={save}>
          {t("노트 저장하고 다음 활동 받기")}
        </button>
      ) : (
        <div className="banner ok">{t("노트를 저장했어요. 삭제는 언제든 할 수 있어요.")}</div>
      )}

      {next && (
        <section className="sec">
          <h2>{t("다음 활동 제안")}</h2>
          <div className="act">
            <h3>{next.title}</h3>
            <p>{next.desc}</p>
            <div className="row">
              <button className="btn" onClick={() => flash(t("다음 활동 제안은 아직 연결되지 않았어요"))}>
                {t("제안 보내기")}
              </button>
              <button className="btn ghost" onClick={() => flash(t("정기 만남 일정 정하기는 아직 연결되지 않았어요"))}>
                {t("정기 만남 정하기")}
              </button>
            </div>
          </div>
        </section>
      )}

      {saved && (
        <button className="link" onClick={remove}>
          {t("내 노트 삭제")}
        </button>
      )}
    </>
  );
}
