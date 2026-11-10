import { useEffect, useState } from "react";
import { api } from "../api";
import { Lock, MatchPicker, TranslateButton } from "../components";
import { useI18n } from "../i18n";
import type { ActivityCard, Brief, MatchView } from "../types";

interface Props {
  active: MatchView | null;
  confirmed: MatchView[];
  onPick: (id: number) => void;
  goRec: () => void;
  goNote: () => void;
  goChat?: () => void;
  flash: (msg: string) => void;
  /** 눌러서 대화로 가져갈 질문 (상대별로 App 이 들고 있어서 대화 탭과 같이 쓴다) */
  picked?: string[];
  onPicked?: (qs: string[]) => void;
}

export default function BriefPage({ active, confirmed, onPick, goRec, goNote, goChat, flash, picked = [], onPicked }: Props) {
  const { t, tv, lang } = useI18n();
  const [brief, setBrief] = useState<Brief | null>(null);
  const [card, setCard] = useState<ActivityCard | null>(null);
  const matchId = active?.id ?? null;

  useEffect(() => {
    if (matchId === null) return;
    let alive = true;
    setBrief(null);
    setCard(null);
    api.brief(matchId).then((b) => alive && setBrief(b)).catch((e) => flash((e as Error).message));
    api.activityCard(matchId).then((c) => alive && setCard(c)).catch((e) => flash((e as Error).message));
    return () => {
      alive = false;
    };
  }, [matchId, lang]); // 화면 언어를 바꾸면 그 언어로 다시 받는다 // eslint-disable-line react-hooks/exhaustive-deps

  if (!active) {
    return <Lock title={t("브리핑은 만남이 확정되면 보여요")} text={t("추천 탭에서 먼저 상대를 수락해 보세요.")} action={t("추천 보러 가기")} onAction={goRec} />;
  }
  const name = active.partner.name;
  const e = active.explain;
  const myTopic = e.my_topic ?? card?.mine.topic;
  const theirTopic = e.partner_topic ?? card?.theirs.topic;
  const togglePick = (q: string) => onPicked?.(picked.includes(q) ? picked.filter((x) => x !== q) : [...picked, q]);

  return (
    <>
      <MatchPicker matches={confirmed} activeId={active.id} onPick={onPick} />
      <div className="brief-scroll">
        <section className="sec">
          <h2>{t("이번 만남에서 서로 알려줄 것")}</h2>
          {myTopic || theirTopic ? (
            <div className="swap slim">
              <div className="a">
                <b>{myTopic ? tv(myTopic) : t("정해지지 않았어요")}</b>
              </div>
              <span className="x" aria-hidden="true">⇄</span>
              <div className="b">
                <b>{theirTopic ? tv(theirTopic) : t("정해지지 않았어요")}</b>
              </div>
            </div>
          ) : (
            <p className="hint">{t("정해지지 않았어요")}</p>
          )}
          {card && (
            <p className="hint">
              {card.title}
              {card.mode === "fallback" ? ` ${t("(기본 카드)")}` : ""}
            </p>
          )}
        </section>

        <section className="sec">
          <h2>{t("이야기 나눌 만한 공통점")}</h2>
          <div className="chips">
            {e.common_interests.map((v) => (
              <span className="tag" key={v}>
                {tv(v)}
              </span>
            ))}
            {(e.similar_interests ?? []).map((x) => (
              <span className="tag" key={`${x.mine}-${x.theirs}`}>
                {tv(x.mine)} ≈ {tv(x.theirs)}
              </span>
            ))}
            {e.common_interests.length + (e.similar_interests?.length ?? 0) === 0 && <span className="hint">{t("겹치는 관심사가 없어요")}</span>}
          </div>
        </section>

        {!brief && (
          <div className="banner wait">
            <span className="spin" />
            {t("브리핑을 준비하는 중이에요.")}
          </div>
        )}

        {brief && (
          <>
            <section className="sec">
              <h2>{t("물어볼 질문 · 눌러서 대화로 가져가요")}</h2>
              <div className="qlist">
                {brief.questions.map((q) => {
                  const on = picked.includes(q);
                  return (
                    <button key={q} type="button" className={`q ${on ? "on" : ""}`} aria-pressed={on} onClick={() => togglePick(q)}>
                      {on && <i>{t("선택됨")}</i>}
                      {q}
                    </button>
                  );
                })}
              </div>
            </section>

            <section className="sec">
              <h2>{t("{name}님이 알려준 것", { name })}</h2>
              {brief.prefs.length ? (
                <div className="avoid">
                  {brief.prefs.map((p) => (
                    <span key={p}>{p}</span>
                  ))}
                  <TranslateButton text={brief.prefs.join(" / ")} />
                </div>
              ) : (
                <p className="hint">{t("공개한 선호가 없어요. 직접 물어보면 좋아요.")}</p>
              )}
              <p className="hint">{t("개인 선호가 문화 일반 정보보다 우선이에요. 국적으로 성향을 추정하지 않아요.")}</p>
            </section>

            {brief.tips.length > 0 && (
              <section className="sec">
                <h2>{t("참고할 문화 정보")}</h2>
                <ul className="list">
                  {brief.tips.map((tip) => (
                    <li key={tip.source_id}>
                      {tip.text}
                      <small>{t("출처 · {source}", { source: tip.source })}</small>
                    </li>
                  ))}
                </ul>
                {brief.mode === "fallback" && <p className="hint">{t("AI가 만든 문장이 아니라 검토 자료를 그대로 보여주는 기본 안내예요.")}</p>}
              </section>
            )}
          </>
        )}

        <button className="link center" onClick={goNote}>
          {t("만난 뒤 교류 노트 쓰기")}
        </button>
      </div>

      <div className="dock">
        <button className="btn" onClick={goChat ?? goNote}>
          {t("대화에서 질문하기")}
        </button>
      </div>
    </>
  );
}
