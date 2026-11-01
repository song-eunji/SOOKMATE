import { useEffect, useState } from "react";
import { api } from "../api";
import { Lock, MatchPicker } from "../components";
import { useI18n } from "../i18n";
import type { ActivityCard, Brief, MatchView } from "../types";

interface Props {
  active: MatchView | null;
  confirmed: MatchView[];
  onPick: (id: number) => void;
  goRec: () => void;
  goNote: () => void;
  flash: (msg: string) => void;
}

export default function BriefPage({ active, confirmed, onPick, goRec, goNote, flash }: Props) {
  const { t } = useI18n();
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
  }, [matchId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!active) {
    return <Lock title={t("브리핑은 만남이 확정되면 보여요")} text={t("추천 탭에서 먼저 상대를 수락해 보세요.")} action={t("추천 보러 가기")} onAction={goRec} />;
  }
  const name = active.partner.name;

  return (
    <>
      <MatchPicker matches={confirmed} activeId={active.id} onPick={onPick} />
      <div>
        <h1>{t("{name}님을 만나기 전에", { name })}</h1>
        <p className="lead">{t("개인 선호가 문화 일반 정보보다 우선이에요. 국적으로 성향을 추정하지 않아요.")}</p>
      </div>

      {!brief && <div className="banner wait"><span className="spin" />{t("브리핑을 준비하는 중이에요.")}</div>}

      {brief && (
        <>
          <section className="sec">
            <h2>{t("{name}님이 공개한 선호", { name })}</h2>
            {brief.prefs.length ? (
              <div className="chips">
                {brief.prefs.map((p) => (
                  <span className="tag" key={p}>
                    {p}
                  </span>
                ))}
              </div>
            ) : (
              <p className="hint">{t("공개한 선호가 없어요. 직접 물어보면 좋아요.")}</p>
            )}
          </section>

          <section className="sec">
            <h2>{t("참고할 문화 정보")}</h2>
            {brief.tips.length ? (
              <ul className="list">
                {brief.tips.map((tip) => (
                  <li key={tip.source_id}>
                    {tip.text}
                    <small>{t("출처 · {source}", { source: tip.source })}</small>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="hint">{brief.note}</p>
            )}
            {brief.mode === "fallback" && <p className="hint" style={{ marginTop: 6 }}>{t("AI가 만든 문장이 아니라 검토 자료를 그대로 보여주는 기본 안내예요.")}</p>}
          </section>

          <section className="sec">
            <h2>{t("직접 물어볼 만한 질문")}</h2>
            <ul className="list q">
              {brief.questions.map((q) => (
                <li key={q}>{q}</li>
              ))}
            </ul>
          </section>
        </>
      )}

      {card && (
        <section className="sec">
          <h2>{t("서로 하나씩 알려주기")}</h2>
          <div className="act">
            <h3>{card.title}</h3>
            <div className="swap">
              <div className="a">
                <small>{t("나 · {n}분", { n: card.mine.minutes })}</small>
                <b>{card.mine.topic}</b>
                <div style={{ marginTop: 4 }}>{card.mine.desc}</div>
              </div>
              <span className="x">⇄</span>
              <div className="b">
                <small>
                  {t("{name} · {n}분", { name, n: card.theirs.minutes })}
                </small>
                <b>{card.theirs.topic}</b>
                <div style={{ marginTop: 4 }}>{card.theirs.desc}</div>
              </div>
            </div>
            <p className="hint">{t("국적이 아니라 각자 고른 주제로 역할이 정해져요.")}{card.mode === "fallback" ? ` ${t("(기본 카드)")}` : ""}</p>
          </div>
        </section>
      )}

      <button className="btn" onClick={goNote}>
        {t("만난 뒤 교류 노트 쓰기")}
      </button>
    </>
  );
}
