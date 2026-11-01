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

// 로그인이 없는 동안은 '지금 사용자'를 localStorage 에 저장하고 X-User-Id 헤더로 보냅니다.
// 로그인을 붙일 때는 이 파일의 헤더 부분과 backend/app/main.py 의 me_dep() 만 바꾸면 됩니다.
export function getUserId(): number {
  try {
    return Number(localStorage.getItem("userId")) || 1;
  } catch {
    return 1;
  }
}

export function setUserId(id: number) {
  try {
    localStorage.setItem("userId", String(id));
  } catch {
    /* 저장이 막혀 있어도 동작에는 문제 없음 */
  }
}

async function req<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "X-User-Id": String(getUserId()),
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
    throw new Error(msg);
  }
  return res.json() as Promise<T>;
}

const post = <T>(path: string, body?: unknown) =>
  req<T>(path, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) });

export const api = {
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
  return `${proto}://${location.host}/ws/matches/${matchId}?user_id=${getUserId()}`;
}
