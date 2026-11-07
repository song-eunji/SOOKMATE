import { useEffect, useRef, useState } from "react";
import { api, compareActivities } from "../api";
import { Lock, MatchPicker } from "../components";
import { useI18n } from "../i18n";
import type { ActivityComparison, MatchView, NextActivity, NoteData, NotesResponse } from "../types";

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
  const [comparison, setComparison] = useState<ActivityComparison | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [ratings, setRatings] = useState<Record<string, string>>({});
  const requestVersion = useRef(0);
  const [saved, setSaved] = useState(false);
  const matchId = active?.id ?? null;

  useEffect(() => {
    if (matchId === null) return;
    let alive = true;
    requestVersion.current += 1;
    setComparison(null);
    setRatings({});
    setBusy(false);
    setError("");
    setTheirs(null);
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
          api.nextActivity(matchId).then((n) => alive && setNext(n)).catch((e) => alive && flash((e as Error).message));
        }
      })
      .catch((e) => flash((e as Error).message));
    return () => {
      alive = false;
      requestVersion.current += 1;
    };
  }, [matchId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!active) {
    return <Lock title={t("교류 노트는 만남 뒤에 쓸 수 있어요")} text={t("추천 탭에서 먼저 상대를 수락해 보세요.")} action={t("추천 보러 가기")} onAction={goRec} />;
  }
  const name = active.partner.name;
  const empty = !note.expr.trim() && !note.fact.trim() && !note.next_text.trim();

  const compare = async () => {
    const version = ++requestVersion.current;
    setBusy(true);
    setError("");
    setComparison(null);
    setRatings({});
    try {
      const result = await compareActivities(active.id);
      if (version === requestVersion.current) setComparison(result);
    } catch (e) {
      if (version === requestVersion.current) setError((e as Error).message);
    } finally {
      if (version === requestVersion.current) setBusy(false);
    }
  };

  const invalidate = () => {
    requestVersion.current += 1;
    setComparison(null);
    setRatings({});
    setError("");
    setBusy(false);
    setSaved(false);
  };

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
      invalidate();
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
                  invalidate();
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
                  invalidate();
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

      {saved && (
        <section className="sec" aria-busy={busy}>
          <h2>노트에서 다음 만남으로</h2>
          <p className="lead">두 사람이 공유한 항목으로 활동 자료를 찾고, 검색 없는 추천과 비교해요.</p>
          <button className="btn" disabled={busy} onClick={compare}>
            {busy ? "자료를 찾고 두 추천을 만드는 중…" : "자료 검색하고 추천 비교하기"}
          </button>
          {busy && <p role="status">최대 1분 정도 걸릴 수 있어요.</p>}
          {error && <p role="alert">{error} 다시 시도해 주세요.</p>}
          {comparison && <>
            <p className="banner">{comparison.comparable
              ? "같은 노트와 모델로 생성했어요. 각 항목을 1~5점으로 평가해 보세요."
              : "비교 실험 미완료: 검색 자료를 인용한 AI 추천과 검색 없는 AI 추천이 모두 필요해요. 기본 제안은 평가 점수로 해석하지 마세요."}</p>
            <p>검색 상태: {({ok: "검색 완료", not_configured: "검색 키 미설정", failed: "검색 실패", empty: "검색 결과 없음", no_query: "관련 검색어 없음"} as Record<string, string>)[comparison.retrieval.search_status ?? ""]}</p>
            {comparison.retrieval.query && <p><small>검색어: {comparison.retrieval.query}</small></p>}
            {(["retrieval", "baseline"] as const).map((mode) => {
              const activity = comparison[mode];
              return <article className="act" key={mode}>
                <small>{mode === "retrieval" ? "검색 기반 추천" : "검색 없는 추천"} · {activity.generation_mode === "llm" ? "AI 생성" : "기본 제안"} · {(activity.generation_ms / 1000).toFixed(1)}초</small>
                <h3>{activity.title}</h3>
                <p>{activity.desc}</p>
                <p><strong>추천 이유</strong> · {activity.reason}</p>
                <ol>{activity.steps.map((step, index) => <li key={index}>{step}</li>)}</ol>
                {activity.sources.map((source) => <details key={source.id}>
                  <summary>참고 자료 [{source.id}] {source.title}</summary>
                  <p>{source.text}</p>
                  <a href={source.url} target="_blank" rel="noopener noreferrer">원문 확인하기 ↗</a>
                </details>)}
                {comparison.comparable && comparison.rubric.map((criterion, index) => <div className="field" key={criterion}>
                  <label htmlFor={`rating-${mode}-${index}`}>{criterion}</label>
                  <select id={`rating-${mode}-${index}`} value={ratings[`${mode}-${index}`] ?? ""}
                    onChange={(e) => setRatings((old) => ({...old, [`${mode}-${index}`]: e.target.value}))}>
                    <option value="">평가 선택</option>
                    {[1, 2, 3, 4, 5].map((score) => <option key={score} value={score}>{score}점</option>)}
                  </select>
                </div>)}
              </article>;
            })}
            <button className="btn ghost" onClick={() => {
              const url = URL.createObjectURL(new Blob([JSON.stringify({match_id: active.id, evaluated_at: new Date().toISOString(), ...comparison, ratings}, null, 2)], {type: "application/json"}));
              const link = document.createElement("a"); link.href = url; link.download = `activity-evaluation-${active.id}.json`; link.click();
              setTimeout(() => URL.revokeObjectURL(url), 1000);
            }}>추천·평가 결과 내려받기</button>
          </>}
        </section>
      )}

      {next && !comparison && (
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
