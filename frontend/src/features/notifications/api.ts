import type { AppNotification } from "./types";

export interface NotificationApi {
  list: (userId: number, signal: AbortSignal, beforeId?: number) => Promise<AppNotification[]>;
  count: (userId: number, signal: AbortSignal) => Promise<number>;
  read: (userId: number, id: number, signal: AbortSignal) => Promise<void>;
}

/** 로그인해서 받은 세션 토큰(있으면). 서버가 개발 모드가 아닐 때는 X-User-Id 만으로는 들어올 수 없다. */
function loginToken(): string | null {
  try {
    return localStorage.getItem("token");
  } catch {
    return null;
  }
}

export function createNotificationApi(fetcher: typeof fetch = fetch): NotificationApi {
  async function request<T>(userId: number, path: string, signal: AbortSignal, method = "GET"): Promise<T> {
    // 사용자 ID를 요청 시작 시 고정한다. 사용자 전환 후 이전 알림을 새 계정으로 읽지 않는다.
    const response = await fetcher(`/api/notifications${path}`, {
      method,
      signal,
      headers: { "X-User-Id": String(userId), ...(loginToken() ? { Authorization: `Bearer ${loginToken()}` } : {}) },
    });
    if (!response.ok) throw new Error(`Notification request failed: ${response.status}`);
    return response.json() as Promise<T>;
  }
  return {
    list: (userId, signal, beforeId) =>
      request(userId, `?limit=50${beforeId === undefined ? "" : `&before_id=${beforeId}`}`, signal),
    count: async (userId, signal) =>
      (await request<{ count: number }>(userId, "/unread-count", signal)).count,
    read: async (userId, id, signal) => {
      await request(userId, `/${id}/read`, signal, "POST");
    },
  };
}
