import { useState } from "react";
import { api } from "../api";
import { Avatar, TranslateButton } from "../components";
import { useI18n } from "../i18n";

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

const SHOWN_TIMES = 3;

/** "월 18:00–19:00" 같은 한 시간 단위 시간을 이어지는 구간으로 합친다.
 *  같은 구간을 가진 요일은 한 칩으로 묶는다 (예: 월~금 18:00–22:00). 읽을 수 없는 값은 그대로 둔다. */
function mergeTimes(times: string[], days: string[], tDay: (d: string) => string): string[] {
  const byDay = new Map<string, number[]>();
  const rest: string[] = [];
  for (const v of times) {
    const m = v.match(/^(\S+) (\d{2}):00–(\d{2}):00$/);
    if (!m || !days.includes(m[1])) {
      rest.push(v);
      continue;
    }
    byDay.set(m[1], [...(byDay.get(m[1]) ?? []), Number(m[2])]);
  }

  // 요일별로 연속한 시각을 구간으로 합친다
  const rangeOf = new Map<string, string>();
  for (const [day, hours] of byDay) {
    const sorted = [...new Set(hours)].sort((a, b) => a - b);
    const parts: string[] = [];
    let start = sorted[0];
    let prev = start;
    for (const h of [...sorted.slice(1), Infinity]) {
      if (h !== prev + 1) {
        parts.push(`${String(start).padStart(2, "0")}:00–${String(prev + 1).padStart(2, "0")}:00`);
        start = h;
      }
      prev = h;
    }
    rangeOf.set(day, parts.join(", "));
  }

  // 구간이 같은 요일끼리 묶는다. 이어지는 요일이면 "월~금", 아니면 "월·수·금"
  const dayGroups = new Map<string, string[]>();
  for (const d of days) {
    const r = rangeOf.get(d);
    if (r) dayGroups.set(r, [...(dayGroups.get(r) ?? []), d]);
  }
  const out: string[] = [];
  for (const [range, group] of dayGroups) {
    const idx = group.map((d) => days.indexOf(d));
    const run = group.length >= 3 && idx.every((x, i) => i === 0 || x === idx[i - 1] + 1);
    const label = run ? `${tDay(group[0])}~${tDay(group[group.length - 1])}` : group.map(tDay).join("·");
    out.push(`${label} ${range}`);
  }
  return [...out, ...rest];
}

export default function RecommendPage({ opts, matches, onChanged, onOpenChat, flash }: Props) {
  const { t, tv } = useI18n();
  const [busy, setBusy] = useState<number | null>(null);
  const [openTimes, setOpenTimes] = useState<Set<number>>(new Set());
  // 수락 여부를 고르는 추천이 있으면, 맨 아래에 안내를 한 번만 보여준다 (기한은 가장 빠른 것 기준)
  const undecided = matches.filter((m) => m.status !== "confirmed" && !m.my_accepted);

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
            <article className="ticket">
              <div className="tt">
                <div className="who">
                  <Avatar name={p.name} />
                  <div className="grow">
                    <b>{p.name}</b>
                    <span className="m">{[p.dept, p.langs.join(", ")].filter(Boolean).join(" · ")}</span>
                  </div>
                </div>
                {p.bio && (
                  <p className="bio">
                    “{p.bio}”
                    <TranslateButton text={p.bio} />
                  </p>
                )}
              </div>

              {(e.my_topic || e.partner_topic) && (
                <>
                  <div className="cut" aria-hidden="true" />
                  <div className="tm">
                    <p className="cap">{t("서로 하나씩 알려줘요")}</p>
                    <div className="swap">
                      <div className="a">
                        <small>{t("내가 알려줄 것")}</small>
                        <b>{e.my_topic ? tv(e.my_topic) : t("정해지지 않았어요")}</b>
                      </div>
                      <span className="x" aria-hidden="true">⇄</span>
                      <div className="b">
                        <small>{t("{name}님이 알려줄 것", { name: p.name })}</small>
                        <b>{e.partner_topic ? tv(e.partner_topic) : t("정해지지 않았어요")}</b>
                      </div>
                    </div>
                  </div>
                </>
              )}

              <div className="cut" aria-hidden="true" />
              <div className="tb">
                <div className="reason">
                  <small>{t("추천 이유")}</small>
                  {e.reason}
                  <TranslateButton text={e.reason} />
                </div>
                <div className="overlap">
                  <div className="chips">
                    <span className="lab">{t("겹치는 것")}</span>
                    {e.common_interests.map((v) => (
                      <span className="tag" key={v}>
                        {tv(v)}
                      </span>
                    ))}
                    {(e.similar_interests ?? []).map((x) => (
                      <span className="tag" key={`${x.mine}-${x.theirs}`} title={t("글자는 달라도 뜻이 가까운 관심사예요")}>
                        {tv(x.mine)} ≈ {tv(x.theirs)}
                      </span>
                    ))}
                    {e.common_interests.length + (e.similar_interests?.length ?? 0) === 0 && <span className="hint">{t("겹치는 관심사가 없어요")}</span>}
                  </div>
                  <div className="chips">
                    <span className="lab">{t("겹치는 시간")}</span>
                    {(() => {
                      const merged = mergeTimes(e.common_times, opts.days, t);
                      const open = openTimes.has(m.id);
                      const shown = open ? merged : merged.slice(0, SHOWN_TIMES);
                      return (
                        <>
                          {shown.map((v) => (
                            <span className="tag" key={v}>
                              {v}
                            </span>
                          ))}
                          {merged.length > SHOWN_TIMES && (
                            <button
                              type="button"
                              className="tag more"
                              aria-expanded={open}
                              onClick={() =>
                                setOpenTimes((s) => {
                                  const n = new Set(s);
                                  if (n.has(m.id)) n.delete(m.id);
                                  else n.add(m.id);
                                  return n;
                                })
                              }
                            >
                              {open ? t("접기") : t("{n}개 더 보기", { n: merged.length - SHOWN_TIMES })}
                            </button>
                          )}
                        </>
                      );
                    })()}
                    {e.common_times.length === 0 && <span className="hint">{t("겹치는 시간이 없어요")}</span>}
                  </div>
                </div>
              </div>
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
                    {t("거절하기")}
                  </button>
                  <button className="btn" disabled={busy === m.id} onClick={() => act(m.id, () => api.accept(m.id))}>
                    {t("수락하기")}
                  </button>
                </div>
              </>
            )}
          </section>
        );
      })}

      {undecided.length > 0 && (
        <p className="hint">{t("거절하면 예약이 풀리고, 미매칭자만 다시 배정돼요. 수락 기한은 약 {h}시간 남았어요.", { h: Math.min(...undecided.map((m) => hoursLeft(m.expires_at))) })}</p>
      )}

      {matches.length > 0 && (
        <button
          className="btn ghost more-rec"
          onClick={() =>
            api
              .refresh()
              .then((r) => onChanged().then(() => flash(r.created ? t("새 추천이 생겼어요") : t("아직 새 후보가 없어요"))))
              .catch((e) => flash((e as Error).message))
          }
        >
          {t("다른 추천 보기")}
        </button>
      )}
    </>
  );
}
