import { useState } from "react";
import { api } from "../api";
import { Avatar, TranslateButton } from "../components";
import { useI18n } from "../i18n";

/** 점수를 원형 링과 숫자로 보여준다 */
function ScoreRing({ value }: { value: number }) {
  const { t } = useI18n();
  const C = 2 * Math.PI * 25;
  return (
    <div className="ring" role="img" aria-label={t("{value}점", { value })}>
      <svg width="60" height="60" viewBox="0 0 60 60" aria-hidden="true">
        <circle cx="30" cy="30" r="25" fill="none" stroke="var(--line)" strokeWidth="7" />
        <circle cx="30" cy="30" r="25" fill="none" stroke="var(--accent)" strokeWidth="7" strokeLinecap="round" strokeDasharray={`${(value / 100) * C} ${C}`} transform="rotate(-90 30 30)" />
      </svg>
      <b>{value}</b>
    </div>
  );
}
import type { MatchView, Me, Options } from "../types";

interface Props {
  me: Me;
  opts: Options;
  matches: MatchView[];
  onChanged: () => Promise<void>;
  onOpenChat: (id: number) => void;
  flash: (msg: string) => void;
}

function hoursLeft(iso: string): number {
  return Math.max(0, Math.ceil((new Date(iso + "Z").getTime() - Date.now()) / 3_600_000));
}

export default function RecommendPage({ opts, matches, onChanged, onOpenChat, flash }: Props) {
  const { t, tv } = useI18n();
  const [busy, setBusy] = useState<number | null>(null);

  const act = async (id: number, fn: () => Promise<unknown>, done?: string) => {
    setBusy(id);
    try {
      await fn();
      await onChanged();
      if (done) flash(done);
    } catch (e) {
      flash((e as Error).message);
      await onChanged().catch(() => undefined);
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <div>
        <h1>{t("이번 주 추천 상대")}</h1>
        <p className="lead">{t("양쪽이 모두 수락하면 만남이 확정돼요.")}</p>
      </div>

      {matches.length === 0 && (
        <div className="lock">
          <h1>{t("지금 추천할 상대가 없어요")}</h1>
          <p>{t("프로필의 가능한 시간이나 언어를 늘리면 후보가 더 생겨요.")}</p>
          <button
            className="btn"
            onClick={() =>
              api
                .refresh()
                .then((r) => onChanged().then(() => flash(r.created ? t("새 추천이 생겼어요") : t("아직 새 후보가 없어요"))))
                .catch((e) => flash((e as Error).message))
            }
          >
            {t("다시 찾아보기")}
          </button>
        </div>
      )}

      {matches.map((m) => {
        const p = m.partner;
        const confirmed = m.status === "confirmed";
        const waiting = !confirmed && m.my_accepted;
        const e = m.explain;
        return (
          <section key={m.id} className="sec" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <article className="card">
              <div className="who">
                <Avatar name={p.name} />
                <div className="grow">
                  <b>{p.name}</b>
                  <span className="m">
                    {p.dept} · {p.langs.join(", ")}
                  </span>
                </div>
                <ScoreRing value={m.score.total} />
              </div>
              {p.bio && (
                <p className="bio">
                  “{p.bio}”
                  <TranslateButton text={p.bio} />
                </p>
              )}

              <div className="reason">
                <small>{t("추천 이유")}</small>
                {e.reason}
                <TranslateButton text={e.reason} />
              </div>

              <div>
                <div className="chips">
                  {e.common_interests.map((v) => (
                    <span className="tag" key={v}>
                      {tv(v)}
                    </span>
                  ))}
                  {(e.similar_interests ?? []).map((s) => (
                    <span className="tag" key={`${s.mine}-${s.theirs}`} title={t("글자는 달라도 뜻이 가까운 관심사예요")}>
                      {tv(s.mine)} ≈ {tv(s.theirs)}
                    </span>
                  ))}
                  {e.common_times.map((v) => (
                    <span className="tag neutral" key={v}>
                      {tv(v)}
                    </span>
                  ))}
                  {e.common_interests.length + (e.similar_interests?.length ?? 0) + e.common_times.length === 0 && <span className="hint">{t("겹치는 항목이 없어요")}</span>}
                </div>
              </div>

              {(e.my_topic || e.partner_topic) && (
                <div className="swap">
                  <div className="a">
                    <small>{t("내가 알려줄 것")}</small>
                    {e.my_topic ? tv(e.my_topic) : t("정해지지 않았어요")}
                  </div>
                  <span className="x">⇄</span>
                  <div className="b">
                    <small>{t("{name}님이 알려줄 것", { name: p.name })}</small>
                    {e.partner_topic ? tv(e.partner_topic) : t("정해지지 않았어요")}
                  </div>
                </div>
              )}
            </article>

            {waiting && (
              <div className="banner wait">
                <span className="spin" />
                {t("{name}님의 수락을 기다리는 중이에요. 자리를 임시로 잡아 두었고, 약 {h}시간 안에 답이 없으면 풀려요.", { name: p.name, h: hoursLeft(m.expires_at) })}
              </div>
            )}
            {waiting && opts.dev_mode && (
              <button className="btn ghost" disabled={busy === m.id} onClick={() => act(m.id, () => api.partnerAccept(m.id), t("{name}님이 수락했어요", { name: p.name }))}>
                상대 수락 시뮬레이션 (개발용)
              </button>
            )}

            {confirmed && (
              <>
                <div className="banner ok">{t("양쪽이 수락했어요. 1:1 대화방이 열렸어요.")}</div>
                <button className="btn" onClick={() => onOpenChat(m.id)}>
                  {t("대화방 열기")}
                </button>
              </>
            )}

            {!confirmed && !waiting && (
              <>
                <div className="row">
                  <button className="btn ghost" disabled={busy === m.id} onClick={() => act(m.id, () => api.reject(m.id), t("예약을 풀고 다음 추천을 찾았어요"))}>
                    {t("다른 추천 보기")}
                  </button>
                  <button className="btn" disabled={busy === m.id} onClick={() => act(m.id, () => api.accept(m.id))}>
                    {t("수락하기")}
                  </button>
                </div>
                <p className="hint">{t("거절하면 예약이 풀리고, 미매칭자만 다시 배정돼요. 수락 기한은 약 {h}시간 남았어요.", { h: hoursLeft(m.expires_at) })}</p>
              </>
            )}
          </section>
        );
      })}
    </>
  );
}
