import type {
  ActivityCard,
  BasicInput,
  Brief,
  ChatMessage,
  ChatRoom,
  MatchView,
  Me,
  NextActivity,
  NoteData,
  NotesResponse,
  Options,
  ProfileInput,
  UserLite,
} from "./types";

// 로그인하면 세션 토큰을 localStorage 에 두고 Authorization 헤더로 보낸다.
// 서버가 개발 모드일 때만 '개발용 사용자'(X-User-Id 헤더)로도 들어올 수 있다.
const store = {
  get(key: string): string | null {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key: string, value: string) {
    try {
      localStorage.setItem(key, value);
    } catch {
      /* 저장이 막혀 있어도 동작에는 문제 없음 */
    }
  },
  remove(key: string) {
    try {
      localStorage.removeItem(key);
    } catch {
      /* 무시 */
    }
  },
};

export const getToken = () => store.get("token");
export const setToken = (t: string) => store.set("token", t);
export const clearToken = () => store.remove("token");

/** 개발용 사용자 번호. "개발용 사용자로 둘러보기"를 누른 적이 없으면 null.
 *  예전 버전이 남겨 둔 "userId" 값은 읽지 않는다(그 값 때문에 로그인 없이 수아로 들어가던 문제). */
const DEV_KEY = "devUserId";
export function getUserId(): number | null {
  const v = Number(store.get(DEV_KEY));
  return v > 0 ? v : null;
}
export const setUserId = (id: number) => store.set(DEV_KEY, String(id));
export const clearUserId = () => {
  store.remove(DEV_KEY);
  store.remove("userId"); // 예전 버전이 남긴 값도 같이 지운다
};

/** 세션이 끝났을 때(401) 화면이 로그인으로 돌아가도록 알린다 */
export const SESSION_ENDED = "sookmate:session-ended";

function authHeaders(): Record<string, string> {
  const token = getToken();
  if (token) return { Authorization: `Bearer ${token}` };
  const uid = getUserId();
  return uid ? { "X-User-Id": String(uid) } : {};
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
    try {
      const body = await res.json();
      msg = typeof body.detail === "string" ? body.detail : "요청을 처리하지 못했어요.";
    } catch {
      /* 본문이 JSON 이 아니면 statusText 사용 */
    }
    if (res.status === 401 && path !== "/auth/verify") window.dispatchEvent(new Event(SESSION_ENDED));
    throw new Error(msg);
  }
  return res.json() as Promise<T>;
}

const post = <T>(path: string, body?: unknown) =>
  req<T>(path, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) });

export const api = {
  requestCode: (email: string) => post<{ sent: boolean; dev_code?: string }>("/auth/request-code", { email }),
  verifyCode: (email: string, code: string, lang: string) => post<{ token: string; is_new: boolean }>("/auth/verify", { email, code, lang }),
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
