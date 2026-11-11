import { useEffect, useRef, useState } from "react";
import { getAppointment, proposeAppointment, respondAppointment, type AppointmentState } from "../api";
import { useI18n } from "../i18n";
import "./appointment.css";

export default function AppointmentCard({ matchId }: { matchId: number }) {
  const { t, lang } = useI18n();
  const [state, setState] = useState<AppointmentState | null>(null);
  const [date, setDate] = useState("");
  const [slot, setSlot] = useState("");
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const alive = useRef(false);
  const pending = useRef(false);
  useEffect(() => {
    alive.current = true;
    const refresh = () => {
      if (pending.current || document.visibilityState !== "visible") return;
      getAppointment(matchId).then((result) => { if (alive.current && !pending.current) { setState(result); setError(""); } })
        .catch((e: Error) => { if (alive.current) setError(e.message); });
    };
    refresh();
    const timer = window.setInterval(refresh, 10000);
    window.addEventListener("focus", refresh);
    return () => { alive.current = false; clearInterval(timer); window.removeEventListener("focus", refresh); };
  }, [matchId]);
  const run = async (job: () => Promise<AppointmentState>) => {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError("");
    try { const result = await job(); if (alive.current) { setState(result); setEditing(false); } }
    catch (e) {
      if (alive.current) setError((e as Error).message);
      try { const result = await getAppointment(matchId); if (alive.current) setState(result); } catch { /* 원래 오류 유지 */ }
    } finally { pending.current = false; if (alive.current) setBusy(false); }
  };
  const proposal = state?.proposal;
  const active = proposal && !proposal.past && ["proposed", "confirmed"].includes(proposal.status);
  const dates = state?.available ?? [];
  const slots = dates.find((day) => day.date === date)?.slots ?? [];
  const formatDate = (value: string) => new Date(`${value}T12:00:00+09:00`).toLocaleDateString(lang, {month: "short", day: "numeric", weekday: "short", timeZone: "Asia/Seoul"});
  return <section className="appointment-card" aria-label={t("만남 약속")}>
    <div className="appointment-heading"><h2>{t("만남 약속")}</h2><small>{t("한국 시간 기준")}</small></div>
    {error && <p role="alert" className="appointment-error">{t(error)}</p>}
    {!state ? <button type="button" className="link" onClick={() => void run(() => getAppointment(matchId))}>{t(error ? "다시 시도하기" : "불러오는 중…")}</button> : active ? <>
      <p className="appointment-time">{formatDate(proposal.date)} · {proposal.slot}</p>
      <p role="status">{t(proposal.status === "confirmed" ? "약속이 확정됐어요" : proposal.mine ? "상대의 수락을 기다리고 있어요" : "상대가 만남 시간을 제안했어요")}</p>
      <div className="row">
        {proposal.status === "proposed" && !proposal.mine ? <>
          <button className="btn ghost small" disabled={busy} onClick={() => void run(() => respondAppointment(matchId, "decline", proposal.version))}>{t("거절하기")}</button>
          <button className="btn small" disabled={busy} onClick={() => void run(() => respondAppointment(matchId, "accept", proposal.version))}>{t("이 시간에 만나요")}</button>
        </> : <button className="link" disabled={busy} onClick={() => void run(() => respondAppointment(matchId, "cancel", proposal.version))}>{t(proposal.status === "confirmed" ? "약속 취소" : "제안 취소")}</button>}
      </div>
    </> : editing ? <form onSubmit={(event) => { event.preventDefault(); if (date && slots.includes(slot)) void run(() => proposeAppointment(matchId, date, slot, proposal?.version ?? 0)); }}>
      <label>{t("날짜")}<select value={date} disabled={busy} required onChange={(event) => { setDate(event.target.value); setSlot(""); }}><option value="">{t("날짜 선택")}</option>{dates.map((day) => <option key={day.date} value={day.date}>{formatDate(day.date)}</option>)}</select></label>
      <label>{t("시간")}<select value={slot} disabled={busy || !date} required onChange={(event) => setSlot(event.target.value)}><option value="">{t("시간 선택")}</option>{slots.map((value) => <option key={value}>{value}</option>)}</select></label>
      <div className="row"><button type="button" className="btn ghost small" disabled={busy} onClick={() => setEditing(false)}>{t("취소")}</button><button className="btn small" disabled={busy || !slots.includes(slot)}>{t(busy ? "보내는 중…" : "시간 제안하기")}</button></div>
    </form> : <>
      <p>{t(proposal?.past ? "지난 약속 이후 다음 만남을 정해 보세요" : proposal?.status === "declined" ? "상대가 제안을 거절했어요. 다른 시간을 골라 보세요" : proposal?.status === "cancelled" ? "약속이 취소됐어요. 다시 제안할 수 있어요" : "겹치는 시간으로 약속을 잡아 보세요")}</p>
      {dates.length ? <button className="btn small" onClick={() => {setDate(""); setSlot(""); setEditing(true);}}>{t("시간 제안하기")}</button> : <p className="hint">{t("앞으로 2주 안에 겹치는 시간이 없어요. 프로필의 가능 시간을 확인해 주세요.")}</p>}
    </>}
  </section>;
}
