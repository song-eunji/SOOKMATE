import { useEffect, useRef, useState } from "react";
import { saveActivityRatings } from "../api";
import { api } from "../api";
import type { ActivityComparison, GeneratedActivity, SavedActivity } from "../types";

interface Props {
  matchId: number;
  result: GeneratedActivity;
  comparison: ActivityComparison | null;
  stored: SavedActivity | null;
}

const STATUS: Record<string, string> = {
  disabled: "테스트 설정으로 외부 검색을 꺼둔 상태예요",
  ok: "자료 검색 완료", not_configured: "Gemini API 키가 설정되지 않았어요",
  failed: "자료 검색에 실패했어요. 다시 시도해 주세요", empty: "참고할 자료를 찾지 못했어요",
  daily_quota_exhausted: "Google 검색에 사용하는 모델의 일일 무료 한도를 소진했어요. 한도가 초기화된 뒤 이용해 주세요",
  minute_quota_exhausted: "Google 검색의 순간 호출 한도에 도달했어요. 잠시 뒤 시도해 주세요",
  rate_limited: "Google 검색 호출 한도에 도달했어요. 프로젝트 한도를 확인해 주세요",
  permission_denied: "Google 검색을 사용할 권한이 없어요",
  unsupported: "이 모델 또는 요청에서 Google 검색을 사용할 수 없어요",
  authentication: "Google 검색 키 인증에 실패했어요",
  timeout: "Google 검색 응답 대기 시간이 초과됐어요",
  invalid_model: "검색 모델 설정을 확인해 주세요",
  no_query: "검색할 관심사가 부족해요. 공유할 다음 활동을 기록해 주세요",
};
const AI_STATUS: Record<string, string> = {
  not_configured: "AI API 키가 설정되지 않았어요.",
  service_unavailable: "AI 서비스가 일시적으로 응답하지 않아요. 잠시 뒤 다시 시도해 주세요.",
  daily_quota_exhausted: "이 모델의 일일 무료 호출 한도를 소진했어요. 지금 재시도해도 생성되지 않아요. 한도가 초기화된 뒤 이용해 주세요.",
  minute_quota_exhausted: "분당 AI 호출 한도에 도달했어요. 잠시 뒤 다시 시도해 주세요.",
  rate_limited: "AI 호출 한도에 도달했어요. 프로젝트의 무료 한도를 확인해 주세요.",
  timeout: "AI 응답 대기 시간이 초과됐어요. 다시 시도해 주세요.",
  authentication: "AI 키 인증에 실패했어요. 서버의 키 설정을 확인해 주세요.",
  permission_denied: "설정한 모델에 접근할 권한이 없어요.",
  model_unavailable: "설정한 모델을 사용할 수 없어요. 모델명을 확인해 주세요.",
  connection_error: "AI 서비스와 연결하지 못했어요.",
  invalid_request: "AI 요청 설정을 확인해야 해요.",
  incomplete_response: "AI가 완전한 답변을 반환하지 않았어요. 다시 시도해 주세요.",
  invalid_response: "AI 답변이 추천 형식에 맞지 않아 기본 제안으로 표시했어요.",
};
const FIELDS: Record<string, string> = {expr: "배운 표현", fact: "알게 된 것", next_text: "다음 활동"};

export default function ActivityResults({ matchId, result, comparison, stored }: Props) {
  const [ratings, setRatings] = useState<Record<string, string>>(() => Object.fromEntries(Object.entries(stored?.ratings ?? {}).map(([k,v]) => [k, String(v)])));
  const [evaluationSaved, setEvaluationSaved] = useState(false);
  const [draft, setDraft] = useState("");
  const [composerOpen, setComposerOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  const alive = useRef(true);
  const messageInput = useRef<HTMLTextAreaElement>(null);
  const composing = composerOpen;
  useEffect(() => {
    if (composing) {
      messageInput.current?.focus();
      messageInput.current?.scrollIntoView({block: "center"});
    }
  }, [composing]);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);
  const cards = comparison
    ? [{id: "retrieval", label: "기록 + 참고 자료로 만든 제안", activity: result}, {id: "baseline", label: "기록만 보고 만든 제안", activity: comparison.baseline}]
    : [{id: "retrieval", label: "다음 만남 제안", activity: result}];
  const analysis = result.analysis;


  const send = async () => {
    if (sending || !draft.trim()) return;
    setSending(true);
    setError("");
    try {
      await api.sendMessage(matchId, draft.trim());
      if (alive.current) setSent(true);
    } catch (e) {
      if (alive.current) setError((e as Error).message);
    } finally {
      if (alive.current) setSending(false);
    }
  };

  if (composerOpen) return <section className="activity-context" aria-label="활동 제안 작성" lang="ko">
    <button type="button" className="link" disabled={sending} onClick={() => {setComposerOpen(false); setError("");}}>← 활동으로 돌아가기</button>
    <h3>상대에게 보낼 제안</h3>
    <label className="hint" htmlFor="activity-message">아래 내용을 확인하고 수정한 뒤 보내 주세요. 채팅으로 전송됩니다.</label>
    <textarea ref={messageInput} id="activity-message" maxLength={500} rows={8} value={draft} disabled={sending || sent} onChange={(e) => setDraft(e.target.value)} />
    <small>{draft.length} / 500</small>
    <button type="button" className="btn" disabled={sending || sent || !draft.trim()} onClick={send}>{sent ? "채팅으로 제안을 보냈어요" : sending ? "보내는 중…" : "채팅으로 제안 보내기"}</button>
    {sent && <p role="status">대화 탭에서 보낸 제안과 상대의 답변을 확인하세요.</p>}
    {error && <p role="alert">{error}</p>}
  </section>;

  return <div className="activity-results">
    {comparison && <p className="banner">{comparison.comparable
      ? "같은 기록을 사용한 두 제안입니다. 참고 자료가 있을 때 더 구체적이고 유용해졌는지 평가해 주세요."
      : "비교 실험 미완료: 자료를 인용한 AI 추천과 검색 없는 AI 추천이 모두 필요해요. 현재 결과로 우수성을 판단할 수 없어요."}</p>}
    {cards.map(({id, label, activity}) => <article className="act activity-card" key={id}>
      <small className="notes-eyebrow">{label}</small>
      {activity.llm && <details><summary>생성 정보</summary><p>{activity.llm.model} · {(activity.generation_ms / 1000).toFixed(1)}초 · {activity.search_status === "disabled" || result.search_status === "disabled" ? "외부 검색 없이 생성" : "AI가 작성한 제안"}</p></details>}
      {activity.generation_mode === "fallback" && <p className="banner" role="status">{AI_STATUS[activity.llm_status?.status ?? ""] ?? "AI 추천을 완료하지 못해 기본 제안을 표시했어요."}</p>}
      <h3>{activity.title}</h3>
      <p>{activity.desc}</p>
      <details><summary>이 활동을 제안하는 이유</summary><p>{activity.reason}</p></details>
      <h4>함께하는 순서</h4><ol>{activity.steps.map((step, i) => <li key={i}>{step}</li>)}</ol>
      {activity.sources.length > 0 && <details><summary>참고한 자료 {activity.sources.length}개</summary>
        <h4>추천에 참고한 자료</h4>
        {activity.sources.map((source) => <details key={source.id}>
          <summary>[{source.id}] {source.title}</summary><small>{source.text_kind === "grounded_summary" ? "Google 검색에 근거한 AI 요약" : "참고 자료"}</small><p>{source.text}</p>
          <a href={source.url} target="_blank" rel="noopener noreferrer">원문 확인하기 ↗</a>
        </details>)}
        <p className="hint">운영 시간·가격·예약 여부와 추천 내용의 근거는 원문에서 확인해 주세요.</p>
      </details>}
      <button type="button" className="btn" disabled={sending} onClick={() => {
        setComposerOpen(true);
        setDraft(`[다음 교류 활동 제안]\n${activity.title}\n${activity.desc}\n\n함께 해볼까요?`.slice(0, 500));
        setSent(false); setError("");
      }}>이 활동 제안하기</button>
      {comparison?.comparable && <fieldset className="activity-ratings"><legend>추천 평가 · 1점 낮음 / 5점 높음</legend>
        {comparison.rubric.map((criterion, index) => <div className="field" key={criterion}>
          <label htmlFor={`rating-${id}-${index}`}>{criterion}</label>
          <select id={`rating-${id}-${index}`} value={ratings[`${id}-${index}`] ?? ""} onChange={(e) => {
            setEvaluationSaved(false);
            const value = e.target.value;
            setRatings((old) => { const next = {...old}; if (value) next[`${id}-${index}`] = value; else delete next[`${id}-${index}`]; return next; });
          }}><option value="">평가 선택</option>{[1,2,3,4,5].map((score) => <option value={score} key={score}>{score}점</option>)}</select>
        </div>)}
        <p className="hint">검색 없는 추천의 근거는 공유 노트에 충실한지 평가해 주세요.</p>
      </fieldset>}
    </article>)}
    <details className="notes-evidence"><summary>이 기록을 참고했어요</summary>
      {analysis?.entries.map((entry) => <article className="notes-used-entry" key={entry.id}>
        <small>{FIELDS[entry.field] ?? "공유한 기록"}</small><p>“{entry.text}”</p>
      </article>)}
      {!analysis?.entries.length && <p>공유한 기록이 없습니다.</p>}
    </details>
    {result.grounding?.segments.length ? <details className="notes-evidence"><summary>활동을 구체화할 때 참고한 자료</summary>
      <p className="hint">아래는 검색을 참고해 AI가 정리한 내용입니다. 활동 후보 목록이나 원문 인용이 아닙니다.</p>
      {result.grounding.segments.map((segment, index) => <p key={index}>{segment.text} {segment.source_ids.map((id) => {
        const source = result.retrieved_sources?.find((item) => item.id === id);
        return source ? <a key={id} href={source.url} target="_blank" rel="noopener noreferrer">[{id}]</a> : null;
      })}</p>)}
    </details> : null}
    {result.search_status !== "ok" && <p className="hint">{STATUS[result.search_status ?? ""]} · 현재 제안은 기록을 바탕으로 만들었어요.</p>}
    {result.grounding?.search_entry_html && <section className="notes-search-attribution"><small>Google에서 더 찾아보기 · 활동 추천과 별개인 검색 링크입니다</small><iframe title="Google에서 관련 자료 더 찾아보기" className="google-search-suggestions" sandbox="allow-popups allow-popups-to-escape-sandbox" referrerPolicy="no-referrer" srcDoc={result.grounding.search_entry_html} /></section>}
    {comparison?.comparable && stored && <button className="btn ghost" onClick={async () => {
      try { await saveActivityRatings(matchId, stored.run_id, Object.fromEntries(Object.entries(ratings).map(([k,v]) => [k, Number(v)]))); setEvaluationSaved(true); }
      catch (e) { setError((e as Error).message); }
    }}>{evaluationSaved ? "평가를 저장했어요" : "평가 저장하기"}</button>}
    {error && <p role="alert">{error}</p>}

  </div>;
}
