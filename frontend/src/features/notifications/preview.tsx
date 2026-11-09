import { StrictMode, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { Logo } from "../../components";
import { I18nProvider, useI18n, type Lang } from "../../i18n";
import "../../styles.css";
import NotificationPanel from "./NotificationPanel";
import type { NotificationApi } from "./api";
import type { AppNotification } from "./types";
import { notificationDestination } from "./types";

const kinds = ["message_created", "match_proposed", "match_accepted", "match_confirmed", "match_expired", "match_cancelled", "match_rejected"];

function demoApi(empty: boolean): NotificationApi {
  const data = new Map<number, AppNotification[]>();
  const rows = (uid: number) => {
    if (!data.has(uid)) data.set(uid, empty ? [] : Array.from({ length: 55 }, (_, i) => ({
      id: uid * 1000 + 55 - i, kind: kinds[i % kinds.length], match_id: i % 2 === 0 ? 14 : 99,
      message_id: i % kinds.length === 0 ? i + 1 : null,
      created_at: new Date(Date.now() - i * 3_600_000).toISOString(),
      read_at: i < 6 ? null : new Date().toISOString(),
    })));
    return data.get(uid)!;
  };
  return {
    list: async (uid, _signal, before) => rows(uid).filter((row) => before === undefined || row.id < before).slice(0, 50).map((row) => ({ ...row })),
    count: async (uid) => rows(uid).filter((row) => row.read_at === null).length,
    read: async (uid, id) => {
      const row = rows(uid).find((item) => item.id === id);
      if (row) row.read_at = new Date().toISOString();
    },
  };
}

function Preview() {
  const { lang, setLang } = useI18n();
  const [userId, setUserId] = useState(1);
  const [mode, setMode] = useState("demo");
  const [destination, setDestination] = useState("");
  const client = useMemo(() => {
    if (mode === "server") return undefined;
    if (mode === "error") {
      const fail = async (): Promise<never> => { throw new Error("preview failure"); };
      return { list: fail, count: fail, read: fail };
    }
    return demoApi(mode === "empty");
  }, [mode]);
  return (
    <div className="app">
      <header className="top">
        <Logo />
        <div className="notification-header-actions">
          <label className="dev">
            <select aria-label="미리보기 사용자" value={userId} onChange={(event) => { setUserId(Number(event.target.value)); setDestination(""); }}>
              <option value={1}>사용자 1</option><option value={27}>사용자 27</option>
            </select>
          </label>
          <NotificationPanel key={`${userId}:${mode}`} userId={userId} client={client} onNavigate={async (item) => {
            let matches = [{ id: 14, status: "confirmed" }];
            if (mode === "server") {
              const response = await fetch("/api/matches", { headers: { "X-User-Id": String(userId) } });
              if (!response.ok) throw new Error("Could not load matches");
              matches = await response.json();
            }
            const target = notificationDestination(item, matches);
            setDestination(target.tab === "chat" ? `대화방 #${target.matchId}로 이동` : target.unavailable ? "종료된 만남이어서 추천 목록으로 이동" : "추천 목록으로 이동");
          }} />
        </div>
      </header>
      <main>
        <h1>알림 미리보기</h1>
        <p className="lead">상단의 종 버튼을 눌러 알림을 확인해 보세요.</p>
        <section className="block notification-preview-controls">
          <label>데이터
            <select value={mode} onChange={(event) => { setMode(event.target.value); setDestination(""); }}>
              <option value="demo">예시 알림 55개</option><option value="empty">알림 없음</option>
              <option value="error">조회 실패</option><option value="server">실제 백엔드 API</option>
            </select>
          </label>
          <label>화면 언어
            <select value={lang} onChange={(event) => setLang(event.target.value as Lang)}>
              <option value="ko">한국어</option><option value="en">English</option><option value="ja">日本語</option><option value="zh">中文</option><option value="vi">Tiếng Việt</option>
            </select>
          </label>
          <p className="hint">{mode === "server" ? "실제 알림을 읽음 처리합니다. 백엔드를 실행한 뒤 확인하세요." : "예시 데이터로만 동작합니다. 서버 데이터는 변경하지 않습니다."}</p>
        </section>
        {destination && <p className="banner ok" role="status">{destination}</p>}
        <p className="hint">이 화면은 독립 미리보기입니다. 알림을 누르면 이동할 위치를 표시합니다. 실제 앱에서는 추천 목록이나 해당 대화방으로 이동합니다.</p>
      </main>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<StrictMode><I18nProvider><Preview /></I18nProvider></StrictMode>);
