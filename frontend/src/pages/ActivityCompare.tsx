import { useState } from "react";
import { saveActivityRatings } from "../api";
import { ActivityBody } from "./ActivityResults";
import type { SavedActivity } from "../types";

interface Props { matchId: number; stored: SavedActivity; onBack: () => void }

const SIDES = [
  {id: "retrieval", label: "A · 기록 + 참고 자료", short: "자료 참고"},
  {id: "baseline", label: "B · 기록만", short: "기록만"},
] as const;
const CRITERIA = ["relevance", "feasibility", "specificity", "novelty"] as const;
const DEFAULT_RUBRIC = ["노트 내용과의 관련성", "실제로 해보기 쉬움", "구체성", "새로움(지난 활동과의 차별성)"];

export default function ActivityCompare({matchId, stored, onBack}: Props) {
  const baseline = stored.baseline!;
  const rubric = stored.rubric?.length === 4 ? stored.rubric : DEFAULT_RUBRIC;
  const judge = stored.evaluation?.judge ?? null;
  const auto = stored.evaluation?.auto;
  const [ratings, setRatings] = useState<Record<string, number>>(() => ({...stored.ratings}));
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const activities = {retrieval: stored.retrieval, baseline};
  const humanTotal = (side: string) => CRITERIA.reduce((sum, _, i) => sum + (ratings[`${side}-${i}`] ?? 0), 0);
  const ratedAll = SIDES.every((s) => CRITERIA.every((_, i) => ratings[`${s.id}-${i}`]));

  const save = async () => {
    setError("");
    try { await saveActivityRatings(matchId, stored.run_id, ratings); setSaved(true); }
    catch (e) { setError((e as Error).message); }
  };

  return <div className="activity-results compare">
    <button type="button" className="link" onClick={onBack}>← 추천으로 돌아가기</button>
    <p className="notes-muted">같은 공유 기록과 같은 AI 모델로 두 번 만들었어요. <strong>A</strong>는 활동 자료집·위키백과에서 찾은 자료를 함께 읽었고, <strong>B</strong>는 기록만 봤어요. 다른 조건은 모두 같아요.</p>
    {!stored.comparable && <p className="banner wait">A가 인용한 자료가 없어 공정한 비교가 아니에요. 참고용으로만 보세요.</p>}

    {judge ? <section className="judge-card" aria-label="AI 블라인드 심사 결과">
      <small className="notes-eyebrow">AI 블라인드 심사 · {judge.model ?? "AI"}</small>
      <h3>{judge.winner === "tie" ? "두 추천이 비슷해요" : `${judge.winner === "retrieval" ? "A · 자료 참고" : "B · 기록만"} 추천이 더 좋았어요`}</h3>
      <p className="hint">심사 AI는 어느 쪽이 자료를 썼는지 모르고, 순서도 무작위로 섞어서 봤어요. 기록만 보고 판단했어요.</p>
      <div className="bars">{CRITERIA.map((key, i) => <div className="bar-row" key={key}>
        <span>{rubric[i]}</span>
        {SIDES.map((side) => <div className={`bar ${side.id}`} key={side.id} aria-label={`${side.short} ${judge.scores[side.id][key]}점`}>
          <i style={{width: `${judge.scores[side.id][key] * 20}%`}} /><b>{side.id === "retrieval" ? "A" : "B"} {judge.scores[side.id][key]}</b>
        </div>)}
      </div>)}</div>
      <p className="judge-total">합계 A {judge.totals.retrieval} : B {judge.totals.baseline} / 20</p>
      {judge.reason && <p>“{judge.reason}”</p>}
    </section> : <p className="banner wait">AI 심사를 완료하지 못했어요 (무료 한도 등). 아래에서 직접 평가할 수 있어요.</p>}

    {auto && <section className="metric-table" aria-label="자동 지표">
      <h4>숫자로 본 차이 <small>규칙으로 계산한 참고 지표</small></h4>
      <table><thead><tr><th scope="col">지표</th><th scope="col">A</th><th scope="col">B</th></tr></thead><tbody>
        {(["note_coverage", "source_support", "concrete_details", "steps"] as const).map((key) => <tr key={key}>
          <th scope="row">{auto.retrieval[key].label}</th>
          {SIDES.map((s) => <td key={s.id}>{auto[s.id][key].value}{auto[s.id][key].total !== undefined ? ` / ${auto[s.id][key].total}` : ""}</td>)}
        </tr>)}
      </tbody></table>
    </section>}

    <div className="compare-grid">{SIDES.map((side) => <article className="act activity-card" key={side.id}>
      <small className={`notes-eyebrow side-${side.id}`}>{side.label}</small>
      <ActivityBody activity={activities[side.id]} />
      <fieldset className="activity-ratings"><legend>내 평가 (1 낮음 · 5 높음)</legend>
        {rubric.map((criterion, i) => <div className="rate-row" key={criterion} role="radiogroup" aria-label={`${side.short} ${criterion}`}>
          <span>{criterion}</span>
          <div>{[1, 2, 3, 4, 5].map((score) => <button type="button" key={score} role="radio" aria-checked={ratings[`${side.id}-${i}`] === score}
            className={ratings[`${side.id}-${i}`] === score ? "on" : ""}
            onClick={() => {setSaved(false); setRatings((old) => ({...old, [`${side.id}-${i}`]: score}));}}>{score}</button>)}</div>
        </div>)}
        <small>내 합계 {humanTotal(side.id)} / 20</small>
      </fieldset>
    </article>)}</div>

    <button className="btn" disabled={!stored.comparable || !Object.keys(ratings).length} onClick={save}>{saved ? "평가를 저장했어요 ✓" : ratedAll ? "평가 저장하기" : "평가 저장하기 (일부만 해도 돼요)"}</button>
    {error && <p role="alert" className="banner err">{error}</p>}
    <p className="hint">사람 평가와 AI 심사는 따로 저장돼요. 표본이 적은 탐색용 비교이며, 어느 방식이 항상 낫다는 증명은 아니에요.</p>
  </div>;
}
