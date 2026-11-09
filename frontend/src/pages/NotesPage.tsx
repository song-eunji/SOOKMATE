import { useEffect, useRef, useState } from "react";
import { api, compareActivities, generateActivity, loadActivity } from "../api";
import ActivityResults from "./ActivityResults";
import NoteDialog from "./NoteDialog";
import { Lock, MatchPicker } from "../components";
import type { MatchView, NoteData, NotesResponse, SavedActivity } from "../types";

interface Props { active: MatchView | null; confirmed: MatchView[]; onPick: (id: number) => void; goRec: () => void; flash: (msg: string) => void; developerMode?: boolean }
const EMPTY: NoteData = {expr: "", fact: "", next_text: "", share_expr: false, share_fact: false, share_next: false};
const FIELDS = [
  {key: "expr", share: "share_expr", label: "새로 배운 표현", ph: "예: 주문할게요, 고마워요처럼 함께 배운 표현"},
  {key: "fact", share: "share_fact", label: "함께하며 알게 된 것", ph: "예: 도서관에서 책을 빌리는 방법을 배웠어요"},
  {key: "next_text", share: "share_next", label: "다음에 나누고 싶은 것", ph: "예: 도서관 이용법과 관련 표현을 서로 알려주고 싶어요"},
] as const;

export default function NotesPage({active, confirmed, onPick, goRec, flash, developerMode = false}: Props) {
  const [mine, setMine] = useState<NoteData | null>(null);
  const [draft, setDraft] = useState<NoteData>(EMPTY);
  const [theirs, setTheirs] = useState<NotesResponse["partner_shared"]>(null);
  const [stored, setStored] = useState<SavedActivity | null>(null);
  const [screen, setScreen] = useState<"edit" | "activity" | "experiment" | "delete" | null>(null);
  const [busy, setBusy] = useState(false);
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
  const sharedCount = FIELDS.filter((f) => mine?.[f.share] && mine[f.key].trim()).length + FIELDS.filter((f) => theirs?.[f.key]).length;
  const close = () => { if (!saving) {setScreen(null); setError("");} };
  const save = async () => {
    const token = version.current;
    setSaving(true); setError("");
    try {
      const normalized = {...draft};
      for (const field of FIELDS) if (!normalized[field.key].trim()) normalized[field.share] = false;
      const result = await api.saveNote(active.id, normalized);
      if (token !== version.current) return;
      setMine(result); setStored(null); setScreen(null); flash("기록을 저장했어요");
    } catch (e) { if (token === version.current) setError((e as Error).message); }
    finally { if (token === version.current) setSaving(false); }
  };
  const recommend = async (compare: boolean) => {
    const token = version.current;
    setBusy(true); setError("");
    try {
      const response = await (compare ? compareActivities(active.id) : generateActivity(active.id));
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
  return <div className="notes-home">
    <MatchPicker matches={confirmed} activeId={active.id} onPick={onPick} />
    <header className="notes-intro"><span className="notes-eyebrow">함께한 순간, 다음 만남으로</span><h1>{name}님과의<br />교류 노트</h1><p>서로 배운 것을 남기고,<br />다음에 나눌 이야기를 찾아보세요.</p></header>
    {loading ? <p role="status">우리 기록을 불러오는 중이에요…</p> : <>
      <section className="notes-panel"><div className="notes-section-head"><h2>내가 남긴 기록</h2><button className="link" onClick={() => {setDraft(mine ? {...mine} : {...EMPTY}); setError(""); setScreen("edit");}}>{mine ? "수정하기" : "기록하기"} ↗</button></div>
        {mine ? <div className="notes-entries">{FIELDS.filter((f) => mine[f.key].trim()).map((f) => <article key={f.key}><div className="notes-entry-label"><span>{f.label}</span><small className={mine[f.share] ? "note-shared" : "note-private"}>{mine[f.share] ? "상대와 공유 중" : "나만 보기"}</small></div><p>{mine[f.key]}</p></article>)}</div>
        : <div className="notes-empty"><span aria-hidden="true">✎</span><h3>오늘 서로 무엇을 배웠나요?</h3><p>짧은 한 문장이면 충분해요.<br />공유할 내용은 직접 선택할 수 있어요.</p><button className="btn" onClick={() => {setDraft({...EMPTY}); setScreen("edit");}}>첫 기록 남기기</button></div>}
      </section>
      <section className="notes-panel"><h2>{name}님이 나눈 기록</h2>{FIELDS.some((f) => theirs?.[f.key]) ? <div className="notes-entries">{FIELDS.filter((f) => theirs?.[f.key]).map((f) => <article key={f.key}><small>{f.label}</small><p>{theirs?.[f.key]}</p></article>)}</div> : <p className="notes-muted">아직 공유한 기록이 없어요.<br />상대가 나누기로 선택한 내용만 여기에 보여요.</p>}</section>
      <section className="notes-next"><span className="notes-eyebrow">다음 만남</span><h2>{stored ? stored.retrieval.title : "우리, 다음엔 무엇을 나눌까요?"}</h2><p>{stored ? "공유한 기록으로 만든 활동이 보관되어 있어요." : "공유된 기록을 바탕으로 서로 배우는 짧은 만남을 제안해요."}</p><button className="btn" disabled={sharedCount === 0} onClick={() => {setError(""); setScreen("activity");}}>{stored ? "다음 활동 보기" : "다음 활동 찾아보기"} <span aria-hidden="true">→</span></button>{sharedCount === 0 && <small>추천에 사용할 기록을 하나 이상 공유해 주세요.</small>}</section>
      {developerMode && <details className="notes-dev-tools"><summary>개발자용 추천 평가</summary><p className="notes-muted">참고 자료를 사용한 추천과 기록만 사용한 추천을 비교하는 평가 도구입니다.</p><button className="btn ghost" onClick={() => {setError(""); setScreen("experiment");}}>두 추천 나란히 평가하기</button></details>}
    </>}
    {!screen && error && <p className="banner" role="alert">{error}</p>}
    {screen === "edit" && <NoteDialog title={mine ? "내 기록 수정" : "만남 기록하기"} onClose={close}>
      <p className="notes-muted">{name}님과 함께 배운 표현과 경험을 남겨보세요. 모든 항목은 선택이에요.</p>
      <form className="notes-editor" onSubmit={(e) => {e.preventDefault(); if (!saving) void save();}}>
        {FIELDS.map((f) => <div className="field" key={f.key}><label htmlFor={`note-${f.key}`}>{f.label}</label><textarea id={`note-${f.key}`} rows={3} maxLength={200} placeholder={f.ph} disabled={saving} value={draft[f.key]} onChange={(e) => setDraft((old) => ({...old, [f.key]: e.target.value}))} /><small>{draft[f.key].length}/200</small></div>)}
        <fieldset className="notes-sharing"><legend>상대와 나눌 기록</legend><p>선택한 항목은 {name}님에게 보이고 다음 활동 추천에도 사용돼요. 저장해야 적용됩니다.</p>{FIELDS.map((f) => <label key={f.key}><input type="checkbox" checked={draft[f.share]} disabled={saving || !draft[f.key].trim()} onChange={(e) => setDraft((old) => ({...old, [f.share]: e.target.checked}))} />{f.label}</label>)}</fieldset>
        {error && <p role="alert" className="banner">{error}</p>}
        <button className="btn" disabled={saving || !FIELDS.some((f) => draft[f.key].trim())}>{saving ? "저장하는 중…" : "기록 저장하기"}</button><button type="button" className="btn ghost" disabled={saving} onClick={close}>취소</button>
        {mine && <button type="button" className="link notes-danger" disabled={saving} onClick={() => setScreen("delete")}>내 기록 삭제</button>}
      </form>
    </NoteDialog>}
    {screen === "delete" && <NoteDialog title="내 기록을 삭제할까요?" onClose={close}><p>내 기록과 이 기록으로 만든 추천·평가가 삭제됩니다. 이미 보낸 채팅은 남아요.</p>{error && <p role="alert">{error}</p>}<button className="btn" disabled={saving} onClick={remove}>{saving ? "삭제 중…" : "삭제하기"}</button><button className="btn ghost" disabled={saving} onClick={() => setScreen("edit")}>돌아가기</button></NoteDialog>}
    {(screen === "activity" || screen === "experiment") && <NoteDialog title={screen === "activity" ? "다음 교류 활동" : "참고 자료의 도움 평가하기"} wide onClose={close}>
      {screen === "experiment" && <p className="notes-muted">한쪽은 기록과 참고 자료를, 다른 쪽은 기록만 보고 만들었어요. 자료가 추천에 도움이 됐는지 평가해 주세요. 추천 결과는 함께 보관되고, 평가 점수는 사용자별로 저장됩니다.</p>}
      {busy && <div className="notes-loading" role="status"><div className="notes-spinner" /><h3>다음 만남을 준비하고 있어요</h3><p>기록을 읽고 활동 자료를 찾아요.<br />완료까지 몇 분 걸릴 수 있어요. 닫아도 기록은 유지됩니다.</p></div>}
      {error && <p className="banner" role="alert">{error}</p>}
      {!busy && (!stored || (screen === "experiment" && !stored.baseline)) && <section className="notes-empty"><h3>{screen === "activity" ? "공유한 기록에서 이어지는 다음 만남" : "참고 자료가 추천에 도움이 될까요?"}</h3><p>추천에 사용할 공유 기록 {sharedCount}개<br />{screen === "activity" ? "결과는 자동으로 보관되어 다시 볼 수 있어요." : "기존 추천이 있다면 재사용하고 비교 결과만 추가해요."}</p><button className="btn" disabled={sharedCount === 0} onClick={() => recommend(screen === "experiment")}>{error ? "다시 시도하기" : screen === "activity" ? "활동 추천받기" : "비교 시작하기"}</button></section>}
      {stored && !busy && <ActivityResults key={`${stored.run_id}-${screen}-${Boolean(stored.baseline)}`} matchId={active.id} result={stored.retrieval} comparison={screen === "experiment" && stored.baseline ? {retrieval: stored.retrieval, baseline: stored.baseline, comparable: Boolean(stored.comparable), rubric: stored.rubric ?? []} : null} stored={stored} />}
    </NoteDialog>}
  </div>;
}
