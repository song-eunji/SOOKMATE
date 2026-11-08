import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import type { ActivityComparison, GeneratedActivity } from "../types";

interface Props {
  matchId: number;
  result: GeneratedActivity;
  comparison: ActivityComparison | null;
}

const STATUS: Record<string, string> = {
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
const KINDS: Record<string, string> = {wish: "하고 싶은 활동", previous: "이전 활동", constraint: "함께 고려할 조건", interest: "관심사"};
const FIELDS: Record<string, string> = {expr: "배운 표현", fact: "알게 된 것", next_text: "다음 활동"};

export default function ActivityResults({ matchId, result, comparison }: Props) {
  const [ratings, setRatings] = useState<Record<string, string>>({});
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);
  const cards = comparison
    ? [{id: "retrieval", label: "검색 기반 추천", activity: result}, {id: "baseline", label: "검색 없는 추천", activity: comparison.baseline}]
    : [{id: "retrieval", label: "다음 만남 제안", activity: result}];
  const analysis = result.analysis;
  const completed = comparison?.comparable && Object.keys(ratings).length === comparison.rubric.length * 2;

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

  return <div className="activity-results">
    {analysis && <section className="activity-context">
      <h3>우리 기록에서 찾은 연결점</h3>
      <p className="hint">공유된 항목 {analysis.entries.length}개 · {analysis.mode === "llm" ? "AI가 정리한 내용이에요. 원문과 함께 확인해 주세요." : "기본 키워드 분석이에요. AI 분석은 완료되지 않았어요."}</p>
      {analysis.signals.map((signal, i) => {
        const entry = analysis.entries.find((item) => item.id === signal.note_id);
        return <div className="activity-signal" key={i}>
          <small>{KINDS[signal.kind]} · 참여자 {entry?.participant} · {FIELDS[entry?.field ?? ""] ?? "공유 기록"}</small>
          <p>{signal.text}</p><blockquote>“{signal.quote}”</blockquote>
        </div>;
      })}
      <div className="chips">{analysis.keywords.map((keyword) => <span className="chip" key={keyword}>{keyword}</span>)}</div>
    </section>}
    <p className="hint" role="status">{STATUS[result.search_status ?? ""]}</p>
    {result.grounding && result.grounding.segments.length > 0 && <details>
      <summary>Google 검색으로 확인한 자료 요약</summary>
      {result.grounding.segments.map((segment, i) => <p key={i}>{segment.text} {segment.source_ids.map((id) => {
        const source = result.retrieved_sources?.find((item) => item.id === id);
        return source ? <a key={id} href={source.url} target="_blank" rel="noopener noreferrer"> [{id}]</a> : null;
      })}</p>)}
      <p className="hint">검색에 근거한 AI 요약이며 원문 발췌가 아닙니다.</p>
    </details>}
    {result.grounding?.search_entry_html && <iframe title="Google 검색 제안" className="google-search-suggestions" sandbox="allow-popups allow-popups-to-escape-sandbox" referrerPolicy="no-referrer" srcDoc={result.grounding.search_entry_html} />}
    {result.query && <details><summary>검색에 사용한 문장</summary><p>{result.query}</p></details>}
    {comparison && <p className="banner">{comparison.comparable
      ? "동일한 노트·분석 결과·모델을 사용했어요. 검색 자료의 유무에 따른 차이를 평가해 주세요."
      : "비교 실험 미완료: 자료를 인용한 AI 추천과 검색 없는 AI 추천이 모두 필요해요. 현재 결과로 우수성을 판단할 수 없어요."}</p>}
    {cards.map(({id, label, activity}) => <article className="act activity-card" key={id}>
      <small>{label} · {activity.generation_mode === "llm" ? "AI 생성" : "기본 제안"} · {(activity.generation_ms / 1000).toFixed(1)}초</small>
      {activity.llm && <small>{activity.llm.provider} · {activity.llm.model}</small>}
      {activity.generation_mode === "fallback" && <p className="banner" role="status">{AI_STATUS[activity.llm_status?.status ?? ""] ?? "AI 추천을 완료하지 못해 기본 제안을 표시했어요."}</p>}
      <h3>{activity.title}</h3>
      <p>{activity.desc}</p>
      <p><strong>이 활동을 제안하는 이유</strong><br />{activity.reason}</p>
      <ol>{activity.steps.map((step, i) => <li key={i}>{step}</li>)}</ol>
      {activity.sources.length > 0 && <div>
        <h4>추천에 참고한 자료</h4>
        {activity.sources.map((source) => <details key={source.id}>
          <summary>[{source.id}] {source.title}</summary><small>{source.text_kind === "grounded_summary" ? "Google 검색에 근거한 AI 요약" : "참고 자료"}</small><p>{source.text}</p>
          <a href={source.url} target="_blank" rel="noopener noreferrer">원문 확인하기 ↗</a>
        </details>)}
        <p className="hint">운영 시간·가격·예약 여부와 추천 내용의 근거는 원문에서 확인해 주세요.</p>
      </div>}
      <button className="btn" disabled={sending} onClick={() => {
        setDraft(`[다음 교류 활동 제안]\n${activity.title}\n${activity.desc}\n\n함께 해볼까요?`.slice(0, 500));
        setSent(false); setError("");
      }}>이 활동 제안하기</button>
      {comparison?.comparable && <fieldset className="activity-ratings"><legend>추천 평가 · 1점 낮음 / 5점 높음</legend>
        {comparison.rubric.map((criterion, index) => <div className="field" key={criterion}>
          <label htmlFor={`rating-${id}-${index}`}>{criterion}</label>
          <select id={`rating-${id}-${index}`} value={ratings[`${id}-${index}`] ?? ""} onChange={(e) => {
            const value = e.target.value;
            setRatings((old) => { const next = {...old}; if (value) next[`${id}-${index}`] = value; else delete next[`${id}-${index}`]; return next; });
          }}><option value="">평가 선택</option>{[1,2,3,4,5].map((score) => <option value={score} key={score}>{score}점</option>)}</select>
        </div>)}
        <p className="hint">검색 없는 추천의 근거는 공유 노트에 충실한지 평가해 주세요.</p>
      </fieldset>}
    </article>)}
    {draft && <section className="activity-context">
      <h3>상대에게 보낼 제안</h3>
      <label className="hint" htmlFor="activity-message">채팅으로 전송됩니다. 내용을 확인하고 수정해 주세요.</label>
      <textarea id="activity-message" maxLength={500} rows={6} value={draft} disabled={sending || sent} onChange={(e) => setDraft(e.target.value)} />
      <small>{draft.length} / 500</small>
      <button className="btn" disabled={sending || sent || !draft.trim()} onClick={send}>{sent ? "채팅으로 제안을 보냈어요" : sending ? "보내는 중…" : "채팅으로 제안 보내기"}</button>
      {sent && <p role="status">대화 탭에서 보낸 제안과 상대의 답변을 확인하세요.</p>}
      {error && <p role="alert">{error}</p>}
    </section>}
    {comparison && <button className="btn ghost" onClick={() => {
      const url = URL.createObjectURL(new Blob([JSON.stringify({match_id: matchId, evaluated_at: new Date().toISOString(), evaluation_complete: Boolean(completed), ...comparison, ratings}, null, 2)], {type: "application/json"}));
      const link = document.createElement("a"); link.href = url; link.download = `activity-evaluation-${matchId}.json`; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }}>{completed ? "완료한 평가 내려받기" : "추천·평가 초안 내려받기"}</button>}
  </div>;
}
