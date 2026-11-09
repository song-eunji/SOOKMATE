import { Fragment, useEffect, useRef, useState } from "react";
import { api } from "../api";
import type { ActivitySource, GeneratedActivity, SavedActivity } from "../types";

interface Props {
  matchId: number;
  partnerName: string;
  stored: SavedActivity;
  onRegenerate: () => void;
  onCompare: () => void;
  onGoChat: () => void;
}

export const FIELD_LABEL: Record<string, string> = {expr: "배운 표현", fact: "알게 된 것", next_text: "다음 희망"};
export const PROVIDER: Record<string, {label: string; note: string}> = {
  library: {label: "활동 자료집", note: "SOOKMATE 팀이 정리한 교류 활동 방법"},
  wikipedia: {label: "위키백과", note: "문화 배경 설명 · 원문 링크 있음"},
  google: {label: "Google 검색", note: "검색에 근거한 AI 요약"},
};
const PROVIDER_STATUS: Record<string, string> = {
  ok: "찾음", empty: "관련 자료 없음", failed: "연결 실패", timeout: "응답 지연", disabled: "사용 안 함", no_topic: "검색할 문화 주제 없음",
};

/** "… 연습해요 [S1]" 의 [S1] 을 아래 자료로 이동하는 작은 링크로 바꾼다. */
export function StepText({text, sources}: {text: string; sources: ActivitySource[]}) {
  // "[S1]" 과 "[S2, S4]" 둘 다 처리한다.
  const parts = text.split(/\[(S\d+(?:\s*,\s*S\d+)*)\]/);
  return <>{parts.map((part, i) => {
    if (i % 2 === 0) return <Fragment key={i}>{part}</Fragment>;
    return <Fragment key={i}>{part.split(/\s*,\s*/).map((id) => {
      const source = sources.find((s) => s.id === id);
      // 주소창 해시(#note 등)는 탭 이동에 쓰이므로 바꾸지 않고, 아래 자료 목록이 있을 때만 스크롤한다.
      return source ? <a key={id} className="cite" href={`#src-${id}`} title={source.title} onClick={(e) => {
        e.preventDefault();
        document.getElementById(`src-${id}`)?.scrollIntoView({behavior: "smooth", block: "center"});
      }}>{PROVIDER[source.provider ?? ""]?.label ?? id}</a> : null;
    })}</Fragment>;
  })}</>;
}

/** 채팅으로 보낼 제안 문구. 출처 표시([S1])는 상대에게 의미가 없어 뺀다. */
export function proposalText(activity: GeneratedActivity) {
  const steps = activity.steps.map((s, i) => `${i + 1}. ${s.replace(/\s*\[S\d+(?:\s*,\s*S\d+)*\]/g, "")}`).join("\n");
  return `[다음 교류 활동 제안]\n${activity.title}${activity.minutes ? ` (${activity.minutes}분)` : ""}\n\n${steps}\n\n괜찮다면 다음에 같이 해볼까요? 바꾸고 싶은 부분이 있으면 편하게 말해 주세요!`.slice(0, 500);
}

export function ActivityBody({activity}: {activity: GeneratedActivity}) {
  return <>
    <h3>{activity.title}</h3>
    <div className="chips">
      {activity.minutes && <span className="chip">⏱ {activity.minutes}분</span>}
      {activity.prep && <span className="chip">준비물 · {activity.prep}</span>}
    </div>
    <p>{activity.desc}</p>
    <h4>함께하는 순서</h4>
    <ol className="activity-steps">{activity.steps.map((step, i) => <li key={i}><StepText text={step} sources={activity.sources} /></li>)}</ol>
  </>;
}

export default function ActivityResults({matchId, partnerName, stored, onRegenerate, onCompare, onGoChat}: Props) {
  const result = stored.retrieval;
  const [draft, setDraft] = useState("");
  const [composerOpen, setComposerOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  const alive = useRef(true);
  const messageInput = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (composerOpen) { messageInput.current?.focus(); messageInput.current?.scrollIntoView({block: "center"}); }
  }, [composerOpen]);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const analysis = result.analysis;
  const retrieved = result.retrieved_sources ?? result.sources;
  const cited = new Set(result.source_ids);
  const counts = retrieved.reduce<Record<string, number>>((acc, s) => ({...acc, [s.provider ?? "google"]: (acc[s.provider ?? "google"] ?? 0) + 1}), {});

  const send = async () => {
    if (sending || !draft.trim()) return;
    setSending(true); setError("");
    try { await api.sendMessage(matchId, draft.trim()); if (alive.current) setSent(true); }
    catch (e) { if (alive.current) setError((e as Error).message); }
    finally { if (alive.current) setSending(false); }
  };

  if (composerOpen) return <section className="activity-context" aria-label="활동 제안 작성" lang="ko">
    <button type="button" className="link" disabled={sending} onClick={() => {setComposerOpen(false); setError("");}}>← 활동으로 돌아가기</button>
    <h3>{partnerName}님에게 보낼 제안</h3>
    <label className="hint" htmlFor="activity-message">편하게 고쳐서 보내세요. 보내기를 눌러야 채팅으로 전송돼요.</label>
    <textarea ref={messageInput} id="activity-message" maxLength={500} rows={9} value={draft} disabled={sending || sent} onChange={(e) => setDraft(e.target.value)} />
    <small>{draft.length} / 500</small>
    <button type="button" className="btn" disabled={sending || sent || !draft.trim()} onClick={send}>{sent ? "채팅으로 제안을 보냈어요 ✓" : sending ? "보내는 중…" : "채팅으로 제안 보내기"}</button>
    {sent && <><p role="status" className="banner ok">채팅으로 보냈어요. {partnerName}님의 답은 대화방에서 확인할 수 있어요.</p>
      <button type="button" className="btn ghost" onClick={onGoChat}>💬 {partnerName}님과의 대화방으로 가기 →</button></>}
    {error && <p role="alert" className="banner err">{error}</p>}
  </section>;

  return <div className="activity-results">
    <article className="act activity-card">
      <small className="notes-eyebrow">다음 만남 제안{stored.cached ? " · 저장된 추천" : ""}</small>
      {result.avoided?.length ? (result.novel
        ? <p className="hint">↻ 직전 추천 「{result.avoided[result.avoided.length - 1]}」과 장소·소재가 다른 활동으로 만들었어요.</p>
        : <p className="hint">공유한 기록이 한 가지 주제라 이전 추천과 비슷하게 나왔어요. 다른 경험이나 다음 희망을 기록에 더하면 더 다양한 활동을 받을 수 있어요.</p>) : null}
      <ActivityBody activity={result} />
      <button type="button" className="btn" onClick={() => {
        setDraft(proposalText(result));
        setSent(false); setError(""); setComposerOpen(true);
      }}>💬 {partnerName}님에게 채팅으로 제안하기</button>
      <div className="row"><button type="button" className="btn ghost small" onClick={onRegenerate}>↻ 다른 활동 추천받기</button></div>
    </article>

    <section className="activity-why">
      <h4>왜 이 활동이에요?</h4>
      <p>{result.reason}</p>
      {analysis?.entries.length ? <ul className="quote-list">{analysis.entries.map((entry) => <li key={entry.id}>
        <small>{entry.participant === "unknown" ? "공유 기록" : FIELD_LABEL[entry.field] ?? "공유 기록"}</small>“{entry.text}”</li>)}</ul> : null}
    </section>

    {retrieved.length > 0 && <section className="activity-sources" aria-label="참고한 자료">
      <h4>참고한 자료</h4>
      <p className="hint">추천을 만들 때 아래 자료를 찾아 함께 읽었어요. 표시된 자료가 실제로 인용됐어요.</p>
      {retrieved.map((source) => <details key={source.id} id={`src-${source.id}`} className={cited.has(source.id) ? "cited" : ""} open={cited.has(source.id) && source.provider === "library"}>
        <summary><span className={`badge ${source.provider ?? "google"}`}>{PROVIDER[source.provider ?? "google"]?.label}</span>{source.title}{cited.has(source.id) && <em>인용</em>}</summary>
        <small>{PROVIDER[source.provider ?? "google"]?.note}{source.minutes ? ` · 약 ${source.minutes}분` : ""}{source.cost ? ` · ${source.cost}` : ""}</small>
        <p>{source.text}</p>
        {source.url && <a href={source.url} target="_blank" rel="noopener noreferrer">원문 확인하기 ↗</a>}
      </details>)}
    </section>}

    <details className="activity-trace">
      <summary>이 추천은 이렇게 만들어졌어요</summary>
      <ol>
        <li><strong>기록 읽기</strong> 공유된 기록 {analysis?.entries.length ?? 0}개만 사용 (비공개 항목은 쓰지 않음)</li>
        <li><strong>핵심 찾기</strong> <span className="chips">{(analysis?.keywords ?? []).map((k) => <span className="chip" key={k}>{k}</span>)}{(analysis?.topics ?? []).map((k) => <span className="chip alt" key={`t-${k}`}>{k}</span>)}</span></li>
        <li><strong>자료 찾기</strong> {Object.entries(result.search_providers ?? {}).filter(([name]) => name !== "google" || result.search_providers?.google !== "disabled").map(([name, state]) =>
          `${PROVIDER[name]?.label ?? name} ${state === "ok" ? `${counts[name] ?? 0}개` : PROVIDER_STATUS[state] ?? state}`).join(" · ") || "자료 없음"}</li>
        <li><strong>활동 만들기</strong> {result.llm?.model ?? "AI"}{result.total_ms ? ` · ${(result.total_ms / 1000).toFixed(1)}초` : ""}</li>
      </ol>
      <p className="hint">운영 시간·가격·예약은 원문에서 다시 확인해 주세요. 추천은 제안일 뿐, {partnerName}님과 함께 정하면 돼요.</p>
    </details>

    <button className="notes-experiment-link" onClick={onCompare}>
      <strong>🔬 자료 없이 만들었다면 어땠을까?</strong>
      <span>{stored.baseline ? "비교 결과 보기" : "같은 기록으로 자료 없이 만든 추천과 나란히 비교해요 (AI 호출 2회 추가)"}</span>
    </button>
    {error && <p role="alert" className="banner err">{error}</p>}
  </div>;
}
