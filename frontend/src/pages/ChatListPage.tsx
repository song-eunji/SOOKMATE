import { Avatar, Lock } from "../components";
import { useI18n } from "../i18n";
import type { ChatRoom, Me } from "../types";

interface Props {
  me: Me;
  rooms: ChatRoom[];
  onOpen: (matchId: number) => void;
  goRec: () => void;
}

/** 열려 있는 대화방 목록. 최근 대화가 위에 오고, 안 읽은 메시지는 숫자로 보인다. */
export default function ChatListPage({ me, rooms, onOpen, goRec }: Props) {
  const { t, clock } = useI18n();

  if (rooms.length === 0) {
    return <Lock title={t("대화방은 양쪽이 수락하면 열려요")} text={t("추천 탭에서 마음에 드는 상대를 수락해 보세요.")} action={t("추천 보러 가기")} onAction={goRec} />;
  }

  return (
    <>
      <div>
        <h1>{t("만남")}</h1>
        <p className="lead">{t("상대를 누르면 대화 · 준비 · 노트가 나와요.")}</p>
      </div>
      <ul className="rooms">
        {rooms.map((r) => {
          const last = r.last_message;
          return (
            <li key={r.match_id}>
              <button className="room" onClick={() => onOpen(r.match_id)}>
                <Avatar name={r.partner.name} />
                <span className="rbody">
                  <span className="rtop">
                    <b>{r.partner.name}</b>
                    {last && <time>{clock(last.created_at)}</time>}
                  </span>
                  <span className={`rlast ${r.unread ? "new" : ""}`}>
                    {last ? `${last.sender_id === me.id ? `${t("나:")} ` : ""}${last.text}` : t("대화를 시작해 보세요")}
                  </span>
                </span>
                {r.unread > 0 && (
                  <span className="badge" aria-label={t("안 읽은 메시지 {n}개", { n: r.unread })}>
                    {r.unread > 99 ? "99+" : r.unread}
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </>
  );
}
