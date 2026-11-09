import { useCallback, useEffect, useRef, useState } from "react";
import { SESSION_ENDED, api, clearToken, clearUserId, getToken, getUserId, setToken, setUserId } from "./api";
import type { ChatRoom, MatchView, Me, Options, UserLite } from "./types";
import { Logo } from "./components";
import { isLang, useI18n } from "./i18n";
import ProfilePage from "./pages/ProfilePage";
import RecommendPage from "./pages/RecommendPage";
import ChatPage from "./pages/ChatPage";
import ChatListPage from "./pages/ChatListPage";
import BriefPage from "./pages/BriefPage";
import NotesPage from "./pages/NotesPage";
import BasicForm from "./pages/BasicForm";
import LoginPage from "./pages/LoginPage";
import NotificationPanel from "./features/notifications/NotificationPanel";
import { navigateFromNotification } from "./features/notifications/navigate";
import type { AppNotification } from "./features/notifications/types";

type Tab = "profile" | "rec" | "chat" | "brief" | "note";

const TABS: [Tab, string, string][] = [
  ["profile", "프로필", '<circle cx="12" cy="8" r="3.5"/><path d="M5 20c1-4 4-5.5 7-5.5s6 1.5 7 5.5"/>'],
  ["rec", "추천", '<path d="M12 3l2.2 5.4 5.8.5-4.4 3.8 1.4 5.6L12 15.2 7 18.3l1.4-5.6L4 8.9l5.8-.5z"/>'],
  ["chat", "대화", '<path d="M4 5h16v11H9l-5 4z"/>'],
  ["brief", "브리핑", '<path d="M6 3h9l4 4v14H6z"/><path d="M9 12h7M9 16h7"/>'],
  ["note", "노트", '<path d="M5 4h14v16H5z"/><path d="M9 4v16M12 9h4"/>'],
];

function initialTab(): Tab {
  const h = location.hash.replace("#", "") as Tab;
  return TABS.some(([k]) => k === h) ? h : "profile";
}

export default function App() {
  const { t, setLang } = useI18n();
  const [opts, setOpts] = useState<Options | null>(null);
  const [users, setUsers] = useState<UserLite[]>([]);
  const [userId, setUid] = useState<number | null>(getUserId());
  // token = 학교 메일로 로그인, dev = 개발용 사용자(서버가 개발 모드일 때만), null = 로그인 전
  const [mode, setMode] = useState<"token" | "dev" | null>(() => (getToken() ? "token" : getUserId() !== null ? "dev" : null));
  const [me, setMe] = useState<Me | null>(null);
  const [matches, setMatches] = useState<MatchView[]>([]);
  const [rooms, setRooms] = useState<ChatRoom[]>([]);
  const [inRoom, setInRoom] = useState(false);
  const unreadRef = useRef(-1); // -1 = 아직 한 번도 불러오지 않음 (처음 불러올 때는 알리지 않는다)
  const [tab, setTabState] = useState<Tab>(initialTab());
  const [activeId, setActiveId] = useState<number | null>(null);
  const [toast, setToast] = useState("");
  const [loadError, setLoadError] = useState("");
  const timer = useRef<number>();

  // 알림 문구는 한국어 문구나 서버 오류 문구를 그대로 받아 현재 화면 언어로 바꿔 보여준다
  const flash = useCallback(
    (msg: string) => {
      setToast(t(msg));
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setToast(""), 2600);
    },
    [t]
  );

  const setTab = (t: Tab) => {
    setTabState(t);
    history.replaceState(null, "", `#${t}`);
    window.scrollTo(0, 0);
  };

  const roomOpenRef = useRef(false);
  const tabRef = useRef<Tab>(tab);
  roomOpenRef.current = inRoom;
  tabRef.current = tab;

  const reload = useCallback(async () => {
    const requestedUser = getUserId();
    const [m, ms, rs] = await Promise.all([api.me(), api.matches(), api.chats()]);
    if (getUserId() !== requestedUser) return;
    setMe(m);
    setMatches(ms);
    setRooms(rs);
    // 방 밖에서 새 메시지가 오면 알려 준다
    const total = rs.reduce((n, r) => n + r.unread, 0);
    if (unreadRef.current >= 0 && total > unreadRef.current && !(roomOpenRef.current && tabRef.current === "chat")) flash("새 메시지가 왔어요");
    unreadRef.current = total;
    setLoadError("");
  }, [flash]);

  // 사용자가 정해 둔 화면 언어는 계정을 열 때(또는 사용자를 바꿀 때) 한 번 적용한다
  useEffect(() => {
    if (me && isLang(me.ui_lang)) setLang(me.ui_lang);
  }, [me?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    api.options().then(setOpts).catch(() => setLoadError("서버에 연결하지 못했어요. 백엔드가 켜져 있는지 확인해 주세요."));
  }, []);

  useEffect(() => {
    if (opts?.dev_mode) api.users().then(setUsers).catch(() => undefined);
  }, [opts]);

  useEffect(() => {
    if (!mode) return;
    reload().catch(() => setLoadError("서버에 연결하지 못했어요. 백엔드가 켜져 있는지 확인해 주세요."));
    // 상대가 수락했는지 보려고 몇 초마다 가볍게 새로고침
    const timer = window.setInterval(() => reload().catch(() => undefined), 4000);
    return () => window.clearInterval(timer);
  }, [mode, userId, reload]);

  const resetData = () => {
    setActiveId(null);
    setInRoom(false);
    unreadRef.current = -1;
    setMe(null);
    setMatches([]);
    setRooms([]);
  };

  // 세션이 끝나면(로그아웃, 만료) 로그인 화면으로 돌아간다
  const endSession = useCallback(() => {
    clearToken();
    clearUserId();
    setUid(null);
    setMode(null);
    setActiveId(null);
    setInRoom(false);
    unreadRef.current = -1;
    setMe(null);
    setMatches([]);
    setRooms([]);
  }, []);

  useEffect(() => {
    const onEnded = () => {
      endSession();
      flash("로그인이 필요해요.");
    };
    window.addEventListener(SESSION_ENDED, onEnded);
    return () => window.removeEventListener(SESSION_ENDED, onEnded);
  }, [endSession, flash]);

  const onLoggedIn = (token: string) => {
    setToken(token);
    clearUserId();
    setUid(null);
    resetData();
    setMode("token");
  };

  const startAsDevUser = () => {
    clearToken();
    setUserId(1);
    setUid(1);
    resetData();
    setMode("dev");
  };

  const logout = () => {
    if (getToken()) api.logout().catch(() => undefined);
    endSession();
    flash("로그아웃했어요");
  };

  const switchUser = (id: number) => {
    setUserId(id);
    setUid(id);
    resetData();
  };

  const confirmed = matches.filter((m) => m.status === "confirmed");
  const active = confirmed.find((m) => m.id === activeId) ?? confirmed[0] ?? null;

  const openChat = (id: number) => {
    setActiveId(id);
    setInRoom(true);
    setTab("chat");
  };

  const meIdRef = useRef<number | null>(null);
  meIdRef.current = me?.id ?? null;

  const openNotification = async (notification: AppNotification) => {
    const owner = me?.id;
    if (owner === undefined) return;
    await navigateFromNotification<MatchView>(notification, {
      userId: owner,
      currentUserId: () => meIdRef.current ?? -1,
      loadMatches: api.matches,
      onMatches: setMatches,
      onChat: openChat,
      onRecommendations: () => {
        setInRoom(false);
        setTab("rec");
      },
      onUnavailable: () => flash("만남을 찾을 수 없어요."),
    });
  };

  const inChat = tab === "chat" && inRoom && !!active;
  const totalUnread = rooms.reduce((n, r) => n + r.unread, 0);

  return (
    <div className={`app ${inChat ? "chatmode" : ""} ${!mode ? "loginmode" : ""}`}>
      <header className="top">
        <Logo />
        <div className="notification-header-actions">
          {mode === "dev" && opts?.dev_mode && users.length > 0 && (
            <label className="dev" title="개발용 사용자 전환">
              <select id="dev-user" aria-label="개발용 사용자" value={userId ?? ""} onChange={(e) => switchUser(Number(e.target.value))}>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name} · {u.kind === "domestic" ? "국내" : "유학생"}
                  </option>
                ))}
              </select>
            </label>
          )}
          {me && <NotificationPanel key={me.id} userId={me.id} onNavigate={openNotification} />}
        </div>
      </header>

      <main>
        {loadError && <div className="banner err">{t(loadError)}</div>}
        {!loadError && opts && !mode && <LoginPage opts={opts} onLoggedIn={onLoggedIn} onDev={startAsDevUser} />}
        {!loadError && (!opts || (mode && !me)) && (
          <div className="banner wait">
            <span className="spin" />
            {t("불러오는 중이에요.")}
          </div>
        )}
        {me && opts && !me.onboarded && <BasicForm me={me} opts={opts} first flash={flash} onSaved={reload} />}
        {me && opts && me.onboarded && (
          <>
            {tab === "profile" && <ProfilePage me={me} opts={opts} flash={flash} onLogout={logout} onSaved={async () => { await reload(); setTab("rec"); }} />}
            {tab === "rec" && <RecommendPage me={me} opts={opts} matches={matches} onChanged={reload} onOpenChat={openChat} flash={flash} />}
            {tab === "chat" && (inRoom && active ? (
              <ChatPage me={me} active={active} onBack={() => setInRoom(false)} onChanged={reload} flash={flash} goNote={() => setTab("note")} />
            ) : (
              <ChatListPage me={me} rooms={rooms} onOpen={openChat} goRec={() => setTab("rec")} />
            ))}
            {tab === "brief" && <BriefPage active={active} confirmed={confirmed} onPick={setActiveId} goRec={() => setTab("rec")} goNote={() => setTab("note")} flash={flash} />}
            {tab === "note" && <NotesPage developerMode={Boolean(opts?.dev_mode)} active={active} confirmed={confirmed} onPick={setActiveId} goRec={() => setTab("rec")} goChat={openChat} flash={flash} />}
          </>
        )}
      </main>

      {me?.onboarded && (
        <nav>
          {TABS.map(([k, label, svg]) => (
            <button
              key={k}
              className={tab === k ? "on" : ""}
              onClick={() => {
                if (k === "chat") setInRoom(false); // 대화 탭을 누르면 항상 목록부터
                setTab(k);
              }}
            >
              <span className="ico">
                <svg viewBox="0 0 24 24" aria-hidden="true" dangerouslySetInnerHTML={{ __html: svg }} />
                {k === "chat" && totalUnread > 0 && <span className="badge dot">{totalUnread > 99 ? "99+" : totalUnread}</span>}
              </span>
              {t(label)}
            </button>
          ))}
        </nav>
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
