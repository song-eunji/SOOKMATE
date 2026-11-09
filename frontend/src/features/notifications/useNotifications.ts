import { useEffect, useMemo, useSyncExternalStore } from "react";
import { createNotificationApi, type NotificationApi } from "./api";
import { createNotificationStore } from "./store";

const api = createNotificationApi();

export function useNotifications(userId: number, client: NotificationApi = api) {
  const store = useMemo(() => createNotificationStore(userId, client), [userId, client]);
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  useEffect(() => {
    store.start();
    return () => store.stop();
  }, [store]);
  return { state, store };
}
