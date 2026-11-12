import Icon from "../Icon";
import { useEffect, useRef, useState } from "react";
import { api, loadActivity, wsUrl } from "../api";
import { ActivityBody, proposalText } from "./ActivityResults";
import { TranslateButton } from "../components";
import { useI18n } from "../i18n";
import type { ChatMessage, MatchView, Me, SavedActivity } from "../types";

interface Props {
  me: Me;
  active: MatchView;
  onChanged: () => Promise<void>;
  flash: (msg: string) => void;
  goNote: () => void;
  /** 준비 탭에서 골라 온 질문 */
  picked?: string[];
}

// 빠른 답장은 보내는 사람의 화면 언어로 나간다
const QUICK = ["수요일 오후 2시 어때요?", "학생회관 카페에서 볼까요?"];

type WsEvent =
  | ({ type: "message" } & ChatMessage)
  | { type: "read"; reader_id: number; last_read_id: number };

/** 대화방 위에 고정되는 '다음 활동 추천' 카드. 노트 탭에 가지 않아도 추천을 보고 바로 제안할 수 있다. */
function ActivityPin({ matchId, partnerName, onSend, goNote }: { matchId: number; partnerName: string; onSend: (text: string) => Promise<boolean>; goNote: () => void }) {
  const { t } = useI18n();
  const [stored, setStored] = useState<SavedActivity | null | undefined>(undefined);
  const [open, setOpen] = useState(false);
  const [sent, setSent] = useState(false);
  useEffect(() => {
    let alive = true;
    setStored(undefined); setOpen(false); setSent(false);
    const load = () => loadActivity(matchId).then((r) => { if (alive) setStored(r); }).catch(() => { if (alive) setStored(null); });
    load();
    // 노트 탭이나 다른 창에서 새로 추천받았을 수 있어 돌아올 때마다 다시 읽는다.
    window.addEventListener("focus", load);
    return () => { alive = false; window.removeEventListener("focus", load); };
  }, [matchId]);
  if (stored === undefined) return null;
  if (!stored) return (
    <section className="chat-pin empty" aria-label={t("다음 활동 추천")}>
      <button className="chat-pin-head" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <span><small>{t("다음 활동 추천")}</small></span>
        <span className="chat-pin-toggle" aria-hidden="true"><Icon name={open ? "up" : "down"} /></span>
      </button>
      {open && (
        <div className="chat-pin-body">
          <p>{t("아직 다음 활동 추천이 없어요. 교류 노트에 기록을 공유하면 추천받을 수 있어요.")}</p>
          <button className="link" onClick={goNote}>{t("노트 쓰러 가기 →")}</button>
        </div>
      )}
    </section>
  );
  const act = stored.retrieval;
  return (
    <section className={`chat-pin${open ? " open" : ""}`} aria-label={t("다음 활동 추천")}>
      <button className="chat-pin-head" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <span><small>{t("다음 활동 추천")}</small><b>{act.title}</b></span>
        <span className="chat-pin-toggle" aria-hidden="true"><Icon name={open ? "up" : "down"} /></span>
      </button>
      {open && (
        <div className="chat-pin-body">
          <ActivityBody activity={act} />
          <button className="btn" disabled={sent} onClick={async () => { if (await onSend(proposalText(act))) setSent(true); }}>
            <Icon name={sent ? "check" : "chat"} /> {sent ? t("채팅에 제안을 보냈어요") : t("{name}님에게 이 활동 제안하기", { name: partnerName })}
          </button>
          <button className="link" onClick={goNote}>{t("노트에서 다른 추천 받기 · 근거 자료 보기 →")}</button>
        </div>
      )}
    </section>
  );
}

export default function ChatPage({ me, active, onChanged, flash, goNote, picked = [] }: Props) {
  const { t, clock } = useI18n();
  const [msgs, setMsgs] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const ws = useRef<WebSocket | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);
  const matchId = active.id;

  useEffect(() => {
    let alive = true;
    let partnerReadThrough = 0;
    const visible = () => document.visibilityState === "visible" && document.hasFocus();
    const markRead = () => {
      if (!alive || !visible()) return;
      api.markRead(matchId).then(() => { if (alive) return onChanged(); }).catch(() => undefined);
    };
    // 조회 응답과 실시간 메시지가 겹쳐도 누락되거나 읽음이 되돌아가지 않게 합친다.
    const merge = (rows: ChatMessage[]) => {
      if (!alive) return;
      setMsgs((previous) => {
        const merged = new Map(previous.map((message) => [message.id, message]));
        for (const message of rows) {
          const old = merged.get(message.id);
          merged.set(message.id, { ...message, read: Boolean(message.read || old?.read || (message.sender_id === me.id && message.id <= partnerReadThrough)) });
        }
        return [...merged.values()].sort((a, b) => a.id - b.id);
      });
    };
    const refresh = () => {
      if (!alive) return;
      api.messages(matchId).then((rows) => { merge(rows); markRead(); })
        .catch((e) => { if (alive) flash((e as Error).message); });
    };
    const onVisible = () => { if (visible()) refresh(); };
    setMsgs([]);
    const sock = new WebSocket(wsUrl(matchId));
    sock.onopen = refresh;
    sock.onmessage = (event) => {
      if (!alive) return;
      let data: WsEvent;
      try { data = JSON.parse(event.data) as WsEvent; } catch { return; }
      if (data.type === "read") {
        if (data.reader_id !== me.id) {
          partnerReadThrough = Math.max(partnerReadThrough, data.last_read_id);
          setMsgs((previous) => previous.map((message) => message.sender_id === me.id && message.id <= partnerReadThrough ? { ...message, read: true } : message));
        }
        return;
      }
      if (data.type !== "message") return;
      merge([data]);
      if (data.sender_id !== me.id) markRead();
    };
    refresh();
    window.addEventListener("focus", onVisible);
    document.addEventListener("visibilitychange", onVisible);
    ws.current = sock;
    return () => {
      alive = false;
      window.removeEventListener("focus", onVisible);
      document.removeEventListener("visibilitychange", onVisible);
      sock.close();
      if (ws.current === sock) ws.current = null;
    };
  }, [matchId, me.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "nearest" });
  }, [msgs.length]);

  const partner = active.partner;

  const send = async (text: string) => {
    const msg = text.trim();
    if (!msg) return false;
    setDraft("");
    try {
      if (ws.current && ws.current.readyState === WebSocket.OPEN) {
        ws.current.send(JSON.stringify({ text: msg }));
      } else {
        const m = await api.sendMessage(active.id, msg);
        setMsgs((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev, m]));
      }
      return true;
    } catch (e) {
      flash((e as Error).message);
      return false;
    }
  };

  return (
    <div className="chat">
      <ActivityPin matchId={matchId} partnerName={partner.name} onSend={send} goNote={goNote} />

      <div className="log">
        <div className="msg sys">{t("양쪽이 수락해서 대화방이 열렸어요. 시간과 장소를 정해 보세요.")}</div>
        {msgs.map((m) => {
          const mine = m.sender_id === me.id;
          return (
            <div key={m.id} className={`line ${mine ? "me" : "them"}`}>
              {mine && (
                <span className="meta">
                  {!m.read && <span className="unseen" aria-label={t("안 읽음")} title={t("안 읽음")}>1</span>}
                  <time>{clock(m.created_at)}</time>
                </span>
              )}
              <div className={`msg ${mine ? "me" : "them"}`}>
                {m.text}
                {!mine && <TranslateButton text={m.text} />}
              </div>
              {!mine && (
                <span className="meta">
                  <time>{clock(m.created_at)}</time>
                </span>
              )}
            </div>
          );
        })}
        <div ref={endRef} />
      </div>

      <div className="chatfoot">
        {picked.length > 0 && <p className="picked-label">{t("준비에서 가져온 질문")}</p>}
        <div className="quick-replies">
          {picked.map((q) => (
            <button key={q} className="chip picked-q" onClick={() => send(q)}>
              {q}
            </button>
          ))}
          {QUICK.map((q) => (
            <button key={q} className="chip" onClick={() => send(t(q))}>
              {t(q)}
            </button>
          ))}
        </div>
        <form
          className="compose"
          onSubmit={(e) => {
            e.preventDefault();
            send(draft);
          }}
        >
          <input id="chat-input" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={t("메시지 입력")} autoComplete="off" maxLength={500} />
          <button className="btn" type="submit">
            {t("보내기")}
          </button>
        </form>
      </div>
    </div>
  );
}
