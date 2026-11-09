import { useEffect, useRef, useState } from "react";
import { api, compareActivities, generateActivity, loadActivity } from "../api";
import ActivityResults from "./ActivityResults";
import ActivityCompare from "./ActivityCompare";
import NoteDialog from "./NoteDialog";
import { Lock, MatchPicker } from "../components";
import type { MatchView, NoteData, NotesResponse, SavedActivity } from "../types";

interface Props { active: MatchView | null; confirmed: MatchView[]; onPick: (id: number) => void; goRec: () => void; flash: (msg: string) => void; developerMode?: boolean }
const EMPTY: NoteData = {expr: "", fact: "", next_text: "", share_expr: false, share_fact: false, share_next: false};
const FIELDS = [
  {key: "expr", share: "share_expr", label: "새로 배운 표현", ph: "예: '아이스 아메리카노 한 잔 주세요'라는 주문 표현"},
  {key: "fact", share: "share_fact", label: "함께하며 알게 된 것", ph: "예: 직원이 말이 빨라서 포장인지 묻는 걸 못 알아들었어요"},
  {key: "next_text", share: "share_next", label: "다음에 나누고 싶은 것", ph: "예: 윷놀이 같은 한국 전통 놀이를 배워 보고 싶어요"},
] as const;

type Screen = "edit" | "activity" | "compare" | "delete" | null;

// 생성은 한 번의 요청이라 서버 단계를 실시간으로 받지는 않는다. 보통 걸리는 순서를 시간에 맞춰 보여준다.
const PIPELINE = ["공유한 기록 읽기", "활동 자료집·위키백과에서 자료 찾기", "두 사람에게 맞는 활동 만들기"];
const COMPARE_PIPELINE = ["자료를 참고한 추천 준비", "자료 없이 기록만 보고 한 번 더 만들기", "어느 쪽이 나은지 블라인드 심사"];

function Pipeline({steps}: {steps: string[]}) {
  const [at, setAt] = useState(0);
  useEffect(() => {
    const timers = steps.slice(1).map((_, i) => window.setTimeout(() => setAt(i + 1), (i + 1) * 3500));
    return () => timers.forEach(clearTimeout);
  }, [steps]);
  return <div className="notes-loading" role="status" aria-live="polite">
    <div className="notes-spinner" />
    <h3>다음 만남을 준비하고 있어요</h3>
    <ol className="pipeline">{steps.map((step, i) => <li key={step} className={i < at ? "done" : i === at ? "now" : ""}>{step}</li>)}</ol>
    <p>보통 10~30초 걸려요. 창을 닫아도 기록은 그대로예요.</p>
  </div>;
}

export default function NotesPage({active, confirmed, onPick, goRec, flash}: Props) {
  const [mine, setMine] = useState<NoteData | null>(null);
  const [draft, setDraft] = useState<NoteData>(EMPTY);
  const [theirs, setTheirs] = useState<NotesResponse["partner_shared"]>(null);
  const [stored, setStored] = useState<SavedActivity | null>(null);
  const [screen, setScreen] = useState<Screen>(null);
  const [busy, setBusy] = useState<false | "activity" | "compare">(false);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const version = useRef(0);
  const matchId = active?.id;
  useEffect(() => {
    const token = ++version.current;
    setMine(null); setTheirs(null); setStored(null); setScreen(null); setError(""); setBusy(false); setSaving(false); setLoading(true);
    if (!matchId) { setLoading(false); return; }
    Promise.all([api.notes(matchId), loadActivity(matchId)]).then(([notes, result]) => {
      if (token !== version.current) return;
      setMine(notes.mine); setTheirs(notes.partner_shared); setStored(result);
    }).catch((e) => {if (token === version.current) setError((e as Error).message);})
      .finally(() => {if (token === version.current) setLoading(false);});
    return () => {version.current++;};
  }, [matchId]);
  useEffect(() => {
    if (!matchId || screen || busy || saving) return;
    let alive = true;
    const refresh = () => {
      if (document.visibilityState !== "visible") return;
      const token = version.current;
      Promise.all([api.notes(matchId), loadActivity(matchId)]).then(([notes, result]) => {
        if (!alive || token !== version.current) return;
        setMine(notes.mine); setTheirs(notes.partner_shared); setStored(result);
      }).catch(() => { /* 기존 기록을 유지하고 명시적 요청 오류만 표시합니다. */ });
    };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      alive = false;
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [matchId, screen, busy, saving]);
  if (!active) return <Lock title="만남 뒤, 함께한 순간을 남겨요" text="서로 수락한 상대와 교류 노트를 쓸 수 있어요." action="상대 추천 보기" onAction={goRec} />;
  const name = active.partner.name;
  const mineShared = FIELDS.filter((f) => mine?.[f.share] && mine[f.key].trim()).length;
  const theirsShared = FIELDS.filter((f) => theirs?.[f.key]).length;
  const sharedCount = mineShared + theirsShared;
  const hasMine = Boolean(mine && FIELDS.some((f) => mine[f.key].trim()));
  const step = !hasMine && sharedCount === 0 ? 0 : sharedCount === 0 ? 1 : stored ? 3 : 2;

  const openEditor = () => {setDraft(mine ? {...mine} : {...EMPTY}); setError(""); setScreen("edit");};
  const close = () => { if (!saving) {setScreen(null); setError("");} };
  const save = async () => {
    const token = version.current;
    setSaving(true); setError("");
    try {
      const normalized = {...draft};
      for (const field of FIELDS) if (!normalized[field.key].trim()) normalized[field.share] = false;
      const result = await api.saveNote(active.id, normalized);
      if (token !== version.current) return;
      setMine(result); setStored(null); setScreen(null);
      flash(FIELDS.some((f) => result[f.share]) ? "기록을 저장했어요. 이제 다음 활동을 추천받을 수 있어요" : "기록을 저장했어요 (공유한 항목 없음)");
    } catch (e) { if (token === version.current) setError((e as Error).message); }
    finally { if (token === version.current) setSaving(false); }
  };
  const recommend = async (mode: "activity" | "compare", regenerate = false) => {
    const token = version.current;
    setScreen(mode); setBusy(mode); setError("");
    try {
      const response = await (mode === "compare" ? compareActivities(active.id) : generateActivity(active.id, regenerate));
      if (token === version.current) setStored(response);
    } catch (e) {
      if (token === version.current) {
        setError((e as Error).message);
        try {
          const previous = await loadActivity(active.id);
          if (token === version.current) setStored(previous);
        } catch { /* 원래 생성 오류를 유지합니다. */ }
      }
    }
    finally {if (token === version.current) setBusy(false);}
  };
  const remove = async () => {
    setSaving(true); setError(""); const token = version.current;
    try { await api.deleteNote(active.id); if (token === version.current) {setMine(null); setStored(null); setScreen(null); flash("내 기록을 삭제했어요");} }
    catch (e) {if (token === version.current) setError((e as Error).message);}
    finally {if (token === version.current) setSaving(false);}
  };

  const steps = [
    {title: "만남 기록 남기기", sub: hasMine ? "기록했어요" : theirsShared ? `${name}님이 기록했어요 · 나도 남기면 더 잘 맞춰져요` : "배운 표현이나 알게 된 것을 한 줄로"},
    {title: "추천에 쓸 기록 공유하기", sub: sharedCount ? `공유 ${sharedCount}개 · 나 ${mineShared} · ${name}님 ${theirsShared}` : "공유한 항목만 추천에 쓰여요"},
    {title: "다음 활동 추천받기", sub: stored ? "추천이 준비됐어요" : "기록 + 참고 자료로 20~30분 활동 제안"},
  ];
  const cta = step === 0 ? {label: "첫 기록 남기기", run: openEditor}
    : step === 1 ? {label: "공유할 항목 고르기", run: openEditor}
    : step === 2 ? {label: "다음 활동 추천받기", run: () => void recommend("activity")}
    : {label: "추천받은 활동 보기", run: () => {setError(""); setScreen("activity");}};

  return <div className="notes-home">
    <MatchPicker matches={confirmed} activeId={active.id} onPick={onPick} />
    <header className="notes-intro"><span className="notes-eyebrow">함께한 순간, 다음 만남으로</span><h1>{name}님과의<br />교류 노트</h1><p>서로 배운 것을 남기면,<br />그 기록을 바탕으로 다음에 함께할 활동을 찾아드려요.</p></header>
    {loading ? <p role="status">우리 기록을 불러오는 중이에요…</p> : <>
      <section className="notes-steps" aria-label="다음 활동 추천까지의 단계">
        <ol>{steps.map((s, i) => <li key={s.title} className={i < step ? "done" : i === step ? "now" : ""} aria-current={i === step ? "step" : undefined}>
          <span className="notes-step-dot" aria-hidden="true">{i < step ? "✓" : i + 1}</span>
          <div><strong>{s.title}</strong><small>{s.sub}</small></div>
        </li>)}</ol>
        <button className="btn" onClick={cta.run}>{cta.label} <span aria-hidden="true">→</span></button>
      </section>

      {stored && <section className="notes-next">
        <span className="notes-eyebrow">다음 만남 제안</span>
        <h2>{stored.retrieval.title}</h2>
        <div className="chips">{stored.retrieval.minutes && <span className="chip">⏱ {stored.retrieval.minutes}분</span>}{stored.retrieval.prep && <span className="chip">준비물 · {stored.retrieval.prep}</span>}</div>
        <p>{stored.retrieval.desc}</p>
        <button className="btn ghost" onClick={() => {setError(""); setScreen("activity");}}>자세히 보고 채팅으로 제안하기</button>
      </section>}

      <section className="notes-panel"><div className="notes-section-head"><h2>내가 남긴 기록</h2><button className="link" onClick={openEditor}>{mine ? "수정하기" : "기록하기"} ↗</button></div>
        {mine ? <div className="notes-entries">{FIELDS.filter((f) => mine[f.key].trim()).map((f) => <article key={f.key}><div className="notes-entry-label"><span>{f.label}</span><small className={mine[f.share] ? "note-shared" : "note-private"}>{mine[f.share] ? "공유 · 추천에 사용" : "나만 보기"}</small></div><p>{mine[f.key]}</p></article>)}</div>
        : <div className="notes-empty"><span aria-hidden="true">✎</span><h3>오늘 서로 무엇을 배웠나요?</h3><p>짧은 한 문장이면 충분해요.<br />공유할 내용은 직접 선택할 수 있어요.</p></div>}
      </section>
      <section className="notes-panel"><h2>{name}님이 나눈 기록</h2>{theirsShared ? <div className="notes-entries">{FIELDS.filter((f) => theirs?.[f.key]).map((f) => <article key={f.key}><small>{f.label}</small><p>{theirs?.[f.key]}</p></article>)}</div> : <p className="notes-muted">아직 공유한 기록이 없어요. 한쪽 기록만 있어도 추천받을 수 있어요.</p>}</section>

      {sharedCount > 0 && <button className="notes-experiment-link" onClick={() => {setError(""); if (stored?.baseline) setScreen("compare"); else void recommend("compare");}}>
        <strong>🔬 자료 검색이 정말 도움이 될까?</strong>
        <span>같은 기록으로 자료 없이도 만들어 보고, 두 추천을 블라인드로 비교·평가해요.</span>
      </button>}
    </>}
    {!screen && error && <p className="banner err" role="alert">{error}</p>}

    {screen === "edit" && <NoteDialog title={mine ? "내 기록 수정" : "만남 기록하기"} onClose={close}>
      <p className="notes-muted">{name}님과 함께 배운 표현과 경험을 남겨보세요. 모든 항목은 선택이에요.</p>
      <form className="notes-editor" onSubmit={(e) => {e.preventDefault(); if (!saving) void save();}}>
        {FIELDS.map((f) => <div className="field" key={f.key}>
          <label htmlFor={`note-${f.key}`}>{f.label}</label>
          <textarea id={`note-${f.key}`} rows={3} maxLength={200} placeholder={f.ph} disabled={saving} value={draft[f.key]} onChange={(e) => setDraft((old) => ({...old, [f.key]: e.target.value, [f.share]: e.target.value.trim() ? (old[f.key].trim() ? old[f.share] : true) : false}))} />
          <label className="notes-share-toggle"><input type="checkbox" checked={draft[f.share]} disabled={saving || !draft[f.key].trim()} onChange={(e) => setDraft((old) => ({...old, [f.share]: e.target.checked}))} />{name}님과 공유하고 추천에 사용<small>{draft[f.key].length}/200</small></label>
        </div>)}
        <p className="hint">공유한 항목만 {name}님에게 보이고 다음 활동 추천에 쓰여요. 이름·연락처는 적지 마세요.</p>
        {error && <p role="alert" className="banner err">{error}</p>}
        <button className="btn" disabled={saving || !FIELDS.some((f) => draft[f.key].trim())}>{saving ? "저장하는 중…" : "기록 저장하기"}</button><button type="button" className="btn ghost" disabled={saving} onClick={close}>취소</button>
        {mine && <button type="button" className="link notes-danger" disabled={saving} onClick={() => setScreen("delete")}>내 기록 삭제</button>}
      </form>
    </NoteDialog>}
    {screen === "delete" && <NoteDialog title="내 기록을 삭제할까요?" onClose={close}><p>내 기록과 이 기록으로 만든 추천·평가가 삭제됩니다. 이미 보낸 채팅은 남아요.</p>{error && <p role="alert">{error}</p>}<button className="btn" disabled={saving} onClick={remove}>{saving ? "삭제 중…" : "삭제하기"}</button><button className="btn ghost" disabled={saving} onClick={() => setScreen("edit")}>돌아가기</button></NoteDialog>}

    {(screen === "activity" || screen === "compare") && <NoteDialog title={screen === "activity" ? "다음 교류 활동" : "자료 검색 효과 비교"} wide onClose={close}>
      {busy && <Pipeline steps={busy === "compare" ? COMPARE_PIPELINE : PIPELINE} />}
      {!busy && error && <div className="notes-error"><p className="banner err" role="alert">{error}</p>
        <button className="btn" onClick={() => void recommend(screen)}>다시 시도하기</button></div>}
      {!busy && stored && screen === "activity" && <ActivityResults key={stored.run_id} matchId={active.id} partnerName={name} stored={stored}
        onRegenerate={() => void recommend("activity", true)} onCompare={() => {if (stored.baseline) setScreen("compare"); else void recommend("compare");}} />}
      {!busy && stored?.baseline && screen === "compare" && <ActivityCompare key={`${stored.run_id}-c`} matchId={active.id} stored={stored} onBack={() => setScreen("activity")} />}
    </NoteDialog>}
  </div>;
}
