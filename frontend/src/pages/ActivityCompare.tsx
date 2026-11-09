import { useState } from "react";
import { saveActivityRatings } from "../api";
import { ActivityBody } from "./ActivityResults";
import type { SavedActivity } from "../types";

interface Props { matchId: number; stored: SavedActivity; onBack: () => void }

const SIDES = [
  {id: "retrieval", label: "📚 자료를 찾아보고 만든 추천", short: "자료 찾아봄"},
  {id: "baseline", label: "📝 기록만 보고 만든 추천", short: "기록만 봄"},
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
    <p className="notes-muted">같은 기록으로 추천을 두 번 만들었어요. 한 번은 <strong>활동 자료집·위키백과를 찾아보고</strong>, 한 번은 <strong>기록만 보고</strong> 만들었어요. 다른 조건은 모두 같아요. 자료를 찾아보는 게 정말 도움이 되는지 확인해 보세요.</p>
    {!stored.comparable && <p className="banner wait">이번 추천은 자료를 인용하지 않아서 두 방식의 차이를 비교하기 어려워요. 참고용으로만 보세요.</p>}

    {judge ? <section className="judge-card" aria-label="AI 블라인드 심사 결과">
      <small className="notes-eyebrow">AI 심사 결과</small>
      <h3>{judge.winner === "tie" ? "두 추천이 비슷하다고 봤어요" : `${judge.winner === "retrieval" ? "자료를 찾아보고 만든" : "기록만 보고 만든"} 추천이 더 낫다고 봤어요`}</h3>
      <p className="hint">공정하게 보도록, 심사한 AI에게는 어느 쪽이 자료를 찾아봤는지 알려주지 않았고 보여주는 순서도 섞었어요.</p>
      <div className="bars">{CRITERIA.map((key, i) => <div className="bar-row" key={key}>
        <span>{rubric[i]}</span>
        {SIDES.map((side) => <div className={`bar ${side.id}`} key={side.id} aria-label={`${side.short} ${judge.scores[side.id][key]}점`}>
          <i style={{width: `${judge.scores[side.id][key] * 20}%`}} /><b>{side.short} {judge.scores[side.id][key]}점</b>
        </div>)}
      </div>)}</div>
      <p className="judge-total">합계 · 자료 찾아봄 {judge.totals.retrieval}점 / 기록만 봄 {judge.totals.baseline}점 (20점 만점)</p>
      {judge.reason && <p>“{judge.reason}”</p>}
    </section> : <p className="banner wait">AI 심사를 완료하지 못했어요 (무료 한도 등). 아래에서 직접 평가할 수 있어요.</p>}

    {auto && <section className="metric-table" aria-label="자동 지표">
      <h4>숫자로 본 차이 <small>규칙으로 계산한 참고 지표</small></h4>
      <table><thead><tr><th scope="col">지표</th><th scope="col">자료 찾아봄</th><th scope="col">기록만 봄</th></tr></thead><tbody>
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
