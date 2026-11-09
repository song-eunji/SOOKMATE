export interface AppNotification {
  id: number;
  kind: string;
  match_id: number;
  message_id: number | null;
  created_at: string;
  read_at: string | null;
}

export type NotificationDestination =
  | { tab: "chat"; matchId: number }
  | { tab: "rec"; unavailable: boolean };

export function notificationDestination(
  notification: AppNotification,
  matches: readonly { id: number; status: string }[],
): NotificationDestination {
  const isChat = notification.kind === "message_created" || notification.kind === "match_confirmed";
  if (isChat && matches.some((match) => match.id === notification.match_id && match.status === "confirmed")) {
    return { tab: "chat", matchId: notification.match_id };
  }
  return { tab: "rec", unavailable: isChat };
}
