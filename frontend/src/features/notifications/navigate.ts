import type { AppNotification } from "./types";
import { notificationDestination } from "./types";

interface NavigationContext<T extends { id: number; status: string }> {
  userId: number;
  currentUserId: () => number;
  loadMatches: () => Promise<T[]>;
  onMatches: (matches: T[]) => void;
  onChat: (matchId: number) => void;
  onRecommendations: () => void;
  onUnavailable: () => void;
}

export async function navigateFromNotification<T extends { id: number; status: string }>(
  notification: AppNotification,
  context: NavigationContext<T>,
): Promise<void> {
  // 사용자 전환 전에 시작한 비동기 작업이 새 사용자의 화면을 바꾸지 않도록 한다.
  if (context.currentUserId() !== context.userId) return;
  const matches = await context.loadMatches();
  if (context.currentUserId() !== context.userId) return;
  context.onMatches(matches);
  const target = notificationDestination(notification, matches);
  if (target.tab === "chat") {
    context.onChat(target.matchId);
  } else {
    context.onRecommendations();
    if (target.unavailable) context.onUnavailable();
  }
}
