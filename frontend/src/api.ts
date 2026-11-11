import type {
  ActivityCard,
  BasicInput,
  Brief,
  ChatMessage,
  ChatRoom,
  DevUser,
  MatchView,
  Me,
  NextActivity,
  NoteData,
  NotesResponse,
  Options,
  TranslateResult,
  ProfileInput,
  UserLite,
} from "./types";

// 로그인하면 세션 토큰을 localStorage 에 두고 Authorization 헤더로 보낸다(브라우저를 닫아도 유지).
// 서버가 개발 모드일 때만 '개발용 사용자'(X-User-Id 헤더)로도 들어올 수 있고, 이 값은 sessionStorage 에만 둔다.
// 그래서 창이나 탭을 새로 열면 늘 로그인 화면부터 시작한다.
function makeStore(kind: "localStorage" | "sessionStorage") {
  const area = () => window[kind];
  return {
    get(key: string): string | null {
      try {
        return area().getItem(key);
      } catch {
        return null;
      }
    },
    set(key: string, value: string) {
      try {
        area().setItem(key, value);
      } catch {
        /* 저장이 막혀 있어도 동작에는 문제 없음 */
      }
    },
    remove(key: string) {
      try {
        area().removeItem(key);
      } catch {
        /* 무시 */
      }
    },
  };
}
const store = makeStore("localStorage");
const tabStore = makeStore("sessionStorage");

export const getToken = () => store.get("token");
export const setToken = (t: string) => store.set("token", t);
export const clearToken = () => store.remove("token");

/** 개발용 사용자 번호. "개발용 사용자로 둘러보기"를 누른 탭에서만 유지된다(없으면 null).
 *  예전 버전이 localStorage 에 남긴 "userId", "devUserId" 값은 읽지 않고 지운다. */
const DEV_KEY = "devUserId";
export function getUserId(): number | null {
  const v = Number(tabStore.get(DEV_KEY));
  return v > 0 ? v : null;
}
export const setUserId = (id: number) => tabStore.set(DEV_KEY, String(id));
export const clearUserId = () => {
  tabStore.remove(DEV_KEY);
  store.remove(DEV_KEY); // 예전 버전이 남긴 값도 같이 지운다
  store.remove("userId");
};

/** 세션이 끝났을 때(401) 화면이 로그인으로 돌아가도록 알린다 */
export const SESSION_ENDED = "sookmate:session-ended";

function authHeaders(): Record<string, string> {
  const token = getToken();
  if (token) return { Authorization: `Bearer ${token}` };
  const uid = getUserId();
  return uid ? { "X-User-Id": String(uid) } : {};
}

/** 화면이 상태별로 다르게 처리할 수 있게 HTTP 상태와 서버 상태 코드를 함께 담는다. */
export class ApiError extends Error {
  constructor(message: string, public status: number, public code?: string) { super(message); }
}

async function req<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(),
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) {
    let msg = res.statusText;
    let code: string | undefined;
    try {
      const body = await res.json();
      msg = typeof body.detail === "string" ? body.detail : body.detail?.message ?? "요청을 처리하지 못했어요.";
      code = typeof body.detail === "object" ? body.detail?.status : undefined;
    } catch {
      /* 본문이 JSON 이 아니면 statusText 사용 */
    }
    if (res.status === 401 && !path.startsWith("/auth/")) window.dispatchEvent(new Event(SESSION_ENDED));
    throw new ApiError(msg, res.status, code);
  }
  return res.json() as Promise<T>;
}

const post = <T>(path: string, body?: unknown) =>
  req<T>(path, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) });

export const api = {
  requestCode: (email: string, purpose: "signup" | "reset") => post<{ sent: boolean; dev_code?: string }>("/auth/request-code", { email, purpose }),
  signup: (email: string, code: string, password: string, lang: string) =>
    post<{ token: string; is_new: boolean }>("/auth/signup", { email, code, password, lang }),
  login: (email: string, password: string) => post<{ token: string; is_new: boolean }>("/auth/login", { email, password }),
  resetPassword: (email: string, code: string, password: string) =>
    post<{ token: string; is_new: boolean }>("/auth/reset-password", { email, code, password }),
  devUsers: () => req<DevUser[]>("/auth/dev-users"),
  devLogin: (userId: number) => post<{ token: string; is_new: boolean }>("/auth/dev-login", { user_id: userId }),
  logout: () => post<{ ok: boolean }>("/auth/logout"),
  options: () => req<Options>("/options"),
  users: () => req<UserLite[]>("/users"),
  me: () => req<Me>("/me"),
  saveLanguage: (lang: string) => req<Me>("/me/language", { method: "PUT", body: JSON.stringify({ lang }) }),
  saveBasic: (b: BasicInput) => req<Me>("/me/basic", { method: "PUT", body: JSON.stringify(b) }),
  saveProfile: (p: ProfileInput) => req<Me>("/me/profile", { method: "PUT", body: JSON.stringify(p) }),
  refresh: () => post<{ created: number }>("/recommendations/refresh"),
  matches: () => req<MatchView[]>("/matches"),
  accept: (id: number) => post<MatchView>(`/matches/${id}/accept`),
  reject: (id: number) => post<{ ok: boolean }>(`/matches/${id}/reject`),
  cancel: (id: number) => post<{ ok: boolean }>(`/matches/${id}/cancel`),
  chats: () => req<ChatRoom[]>("/chats"),
  markRead: (id: number) => post<{ ok: boolean }>(`/matches/${id}/read`),
  messages: (id: number) => req<ChatMessage[]>(`/matches/${id}/messages`),
  sendMessage: (id: number, text: string) => post<ChatMessage>(`/matches/${id}/messages`, { text }),
  brief: (id: number) => req<Brief>(`/matches/${id}/brief`),
  activityCard: (id: number) => req<ActivityCard>(`/matches/${id}/activity-card`),
  notes: (id: number) => req<NotesResponse>(`/matches/${id}/notes`),
  saveNote: (id: number, n: NoteData) => req<NoteData>(`/matches/${id}/notes`, { method: "PUT", body: JSON.stringify(n) }),
  deleteNote: (id: number) => req<{ ok: boolean }>(`/matches/${id}/notes`, { method: "DELETE" }),
  nextActivity: (id: number) => req<NextActivity>(`/matches/${id}/next-activity`),
  translate: (text: string, target?: string) => post<TranslateResult>("/translate", { text, target }),
  block: (userId: number) => post<{ ok: boolean }>("/blocks", { user_id: userId }),
  report: (userId: number, matchId: number, reason: string) =>
    post<{ ok: boolean }>("/reports", { user_id: userId, match_id: matchId, reason }),
  partnerAccept: (id: number) => post<{ ok: boolean }>(`/dev/matches/${id}/partner-accept`),
};

export function wsUrl(matchId: number): string {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  const token = getToken();
  const who = token ? `token=${encodeURIComponent(token)}` : `user_id=${getUserId() ?? ""}`;
  return `${proto}://${location.host}/ws/matches/${matchId}?${who}`;
}

export const compareActivities = (id: number) => req<import("./types").SavedActivity>(
  `/matches/${id}/next-activity?compare=true`, { method: "POST" },
);

export const generateActivity = (id: number, regenerate = false) => req<import("./types").SavedActivity>(
  `/matches/${id}/next-activity${regenerate ? "?regenerate=true" : ""}`, { method: "POST" },
);

export const loadActivity = (id: number) => req<import("./types").SavedActivity | null>(`/matches/${id}/activity-result`);
export const saveActivityRatings = (id: number, run_id: number, ratings: Record<string, number>) => req<{ok: boolean}>(`/matches/${id}/activity-ratings`, {method: "PUT", body: JSON.stringify({run_id, ratings})});

export interface AppointmentState {
  timezone: string;
  available: {date: string; slots: string[]}[];
  proposal: {date: string; slot: string; status: "proposed" | "confirmed" | "declined" | "cancelled"; version: number; mine: boolean; past: boolean} | null;
}
export const getAppointment = (id: number) => req<AppointmentState>(`/matches/${id}/appointment`);
export const proposeAppointment = (id: number, date: string, slot: string, version: number) => post<AppointmentState>(`/matches/${id}/appointment`, {date, slot, version});
export const respondAppointment = (id: number, action: "accept" | "decline" | "cancel", version: number) => post<AppointmentState>(`/matches/${id}/appointment/respond`, {action, version});

export const translateActivity = (id: number, runId: number, target: string) => post<import("./types").SavedActivity>(`/matches/${id}/activity-result/translation`, {run_id: runId, target});
