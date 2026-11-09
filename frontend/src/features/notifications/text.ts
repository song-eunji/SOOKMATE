import type { Lang } from "../../i18n";

type Words = readonly [string, string, string, string, string];
const column: Record<Lang, number> = { ko: 0, en: 1, ja: 2, zh: 3, vi: 4 };
const words = {
  title: ["알림", "Notifications", "通知", "通知", "Thông báo"],
  close: ["닫기", "Close", "閉じる", "关闭", "Đóng"],
  refresh: ["새로고침", "Refresh", "更新", "刷新", "Làm mới"],
  loading: ["알림을 불러오는 중이에요.", "Loading notifications…", "通知を読み込み中です。", "正在加载通知…", "Đang tải thông báo…"],
  empty: ["아직 알림이 없어요", "No notifications yet", "通知はまだありません", "暂无通知", "Chưa có thông báo"],
  emptyHint: ["새 추천이나 메시지가 도착하면 여기에 알려드릴게요.", "New matches and messages will appear here.", "新しいおすすめやメッセージをお知らせします。", "新推荐和消息会显示在这里。", "Gợi ý và tin nhắn mới sẽ xuất hiện ở đây."],
  unread: ["안 읽음", "Unread", "未読", "未读", "Chưa đọc"],
  count: ["안 읽은 알림 {n}개", "{n} unread notifications", "未読の通知{n}件", "{n}条未读通知", "{n} thông báo chưa đọc"],
  more: ["이전 알림 더 보기", "Load older notifications", "以前の通知を表示", "加载更早通知", "Xem thông báo cũ"],
  refreshError: ["알림을 불러오지 못했어요. 다시 시도해 주세요.", "Couldn't load notifications. Please try again.", "通知を読み込めませんでした。もう一度お試しください。", "无法加载通知，请重试。", "Không tải được thông báo. Vui lòng thử lại."],
  readError: ["읽음 처리하지 못했어요. 알림을 다시 눌러 주세요.", "Couldn't mark as read. Please select the notification again.", "既読にできませんでした。通知をもう一度選んでください。", "无法标记已读，请再次点击通知。", "Không đánh dấu đã đọc được. Hãy chọn lại thông báo."],
  navigateError: ["화면을 열지 못했어요. 알림을 다시 눌러 주세요.", "Couldn't open this screen. Please try again.", "画面を開けませんでした。もう一度お試しください。", "无法打开页面，请重试。", "Không mở được màn hình. Vui lòng thử lại."],
  match_proposed: ["새 추천이 도착했어요", "You have a new match", "新しいおすすめが届きました", "有新的推荐", "Bạn có gợi ý mới"],
  match_accepted: ["상대가 추천을 수락했어요", "Your partner accepted", "相手がおすすめを承諾しました", "对方已接受推荐", "Đối phương đã chấp nhận"],
  match_confirmed: ["만남이 확정됐어요", "Your meeting is confirmed", "会う予定が確定しました", "见面已确认", "Buổi gặp đã được xác nhận"],
  match_rejected: ["추천이 종료됐어요", "This match has ended", "おすすめが終了しました", "推荐已结束", "Gợi ý đã kết thúc"],
  match_cancelled: ["만남이 취소됐어요", "Your meeting was cancelled", "会う予定がキャンセルされました", "见面已取消", "Buổi gặp đã bị hủy"],
  match_expired: ["추천 기한이 지났어요", "This match has expired", "おすすめの期限が過ぎました", "推荐已过期", "Gợi ý đã hết hạn"],
  message_created: ["새 메시지가 도착했어요", "You have a new message", "新しいメッセージが届きました", "收到新消息", "Bạn có tin nhắn mới"],
  fallback: ["새 알림이 도착했어요", "You have a new notification", "新しい通知が届きました", "有新通知", "Bạn có thông báo mới"],
  recHint: ["추천 목록에서 확인해 보세요.", "See your matches.", "おすすめ一覧をご確認ください。", "请查看推荐列表。", "Xem danh sách gợi ý."],
  chatHint: ["대화방에서 확인해 보세요.", "Open your chat to see more.", "トークでご確認ください。", "请前往聊天查看。", "Mở phòng chat để xem thêm."],
} satisfies Record<string, Words>;

export function notificationText(lang: Lang, key: string, n?: number): string {
  const values = (words as Record<string, Words>)[key] ?? words.fallback;
  return values[column[lang]].replace("{n}", String(n ?? 0));
}

export function notificationDate(iso: string, lang: Lang): string {
  const value = new Date(/(?:Z|[+-]\d{2}:\d{2})$/i.test(iso) ? iso : iso + "Z");
  if (Number.isNaN(value.getTime())) return "";
  return new Intl.DateTimeFormat(lang, {
    month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  }).format(value);
}
