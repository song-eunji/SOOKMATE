import type { NotificationApi } from "./api";
import type { AppNotification } from "./types";

export interface NotificationState {
  open: boolean;
  items: AppNotification[];
  unreadCount: number | null;
  loading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  pendingId: number | null;
  error: "refresh" | "read" | "more" | null;
}

export function createNotificationStore(userId: number, api: NotificationApi, interval = 10_000) {
  let state: NotificationState = {
    open: false, items: [], unreadCount: null, loading: false, loadingMore: false,
    hasMore: false, pendingId: null, error: null,
  };
  let active = false;
  let pages = 1;
  let version = 0;
  let timer: ReturnType<typeof setInterval> | undefined;
  let query: AbortController | undefined;
  let reading: AbortController | undefined;
  const listeners = new Set<() => void>();
  const update = (change: Partial<NotificationState>) => {
    state = { ...state, ...change };
    listeners.forEach((listener) => listener());
  };
  const cancelQuery = () => {
    version += 1;
    query?.abort();
    query = undefined;
  };

  async function refresh() {
    if (!active || state.pendingId !== null) return;
    cancelQuery();
    const current = version;
    const controller = new AbortController();
    query = controller;
    const includeList = state.open;
    update({ loading: includeList, loadingMore: false });
    try {
      // 열어 본 페이지까지 갱신해 채팅 읽음으로 바뀐 과거 알림도 동기화한다.
      const list = async () => {
        const items: AppNotification[] = [];
        let lastPage: AppNotification[] = [];
        for (let page = 0; page < pages; page += 1) {
          const beforeId = items[items.length - 1]?.id;
          lastPage = await api.list(userId, controller.signal, beforeId);
          items.push(...lastPage);
          if (lastPage.length < 50) break;
        }
        return { items, hasMore: lastPage.length === 50 };
      };
      const [count, result] = await Promise.all([
        api.count(userId, controller.signal),
        includeList ? list() : Promise.resolve(null),
      ]);
      if (!active || current !== version) return;
      update({
        unreadCount: count, ...(result ?? {}), loading: false, error: null,
      });
    } catch {
      if (active && current === version && !controller.signal.aborted) {
        update({ loading: false, error: "refresh" });
      }
    } finally {
      if (query === controller) query = undefined;
    }
  }

  async function loadMore() {
    if (!active || !state.open || !state.hasMore || state.loading || state.loadingMore || state.pendingId !== null) return;
    cancelQuery();
    const current = version;
    const controller = new AbortController();
    query = controller;
    update({ loadingMore: true, error: null });
    try {
      const more = await api.list(userId, controller.signal, state.items[state.items.length - 1]?.id);
      if (!active || current !== version) return;
      const known = new Set(state.items.map((item) => item.id));
      pages += 1;
      update({
        items: [...state.items, ...more.filter((item) => !known.has(item.id))],
        hasMore: more.length === 50, loadingMore: false,
      });
    } catch {
      if (active && current === version && !controller.signal.aborted) update({ loadingMore: false, error: "more" });
    } finally {
      if (query === controller) query = undefined;
    }
  }

  async function markRead(item: AppNotification): Promise<boolean> {
    if (!active || state.pendingId !== null) return false;
    const latest = state.items.find((row) => row.id === item.id) ?? item;
    if (latest.read_at !== null) return true;
    cancelQuery();
    const controller = new AbortController();
    reading = controller;
    update({ pendingId: item.id, loading: false, loadingMore: false, error: null });
    try {
      await api.read(userId, item.id, controller.signal);
      if (!active || controller.signal.aborted) return false;
      update({
        items: state.items.map((row) => row.id === item.id ? { ...row, read_at: new Date().toISOString() } : row),
        unreadCount: state.unreadCount === null ? null : Math.max(0, state.unreadCount - 1),
        pendingId: null,
      });
      void refresh();
      return true;
    } catch {
      if (active && !controller.signal.aborted) update({ pendingId: null, error: "read" });
      return false;
    } finally {
      if (reading === controller) reading = undefined;
    }
  }

  return {
    getSnapshot: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    start() {
      if (active) return;
      active = true;
      // StrictMode의 effect 재실행에도 이전 요청 상태를 가져오지 않는다.
      update({ pendingId: null, loadingMore: false });
      void refresh();
      timer = setInterval(() => {
        if (!query && !state.loading && !state.loadingMore) void refresh();
      }, interval);
    },
    stop() {
      active = false;
      cancelQuery();
      reading?.abort();
      clearInterval(timer);
    },
    setOpen(open: boolean) {
      update({ open });
      if (open) void refresh();
    },
    refresh,
    loadMore,
    markRead,
  };
}
