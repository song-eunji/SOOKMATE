import { useState, type ReactNode } from "react";
import { api } from "../api";
import { Avatar, TranslateButton } from "../components";
import { useI18n } from "../i18n";
import type { MatchView } from "../types";

export type RoomTab = "chat" | "brief" | "note";

// 신고 사유는 서버에 한국어 그대로 저장하고, 화면에서만 번역해서 보여준다
const REPORT_REASONS = ["부적절한 말이나 행동", "불쾌한 요청", "기타"];

const SUBTABS: [RoomTab, string][] = [
  ["chat", "대화"],
  ["brief", "준비"],
  ["note", "노트"],
];

interface Props {
  active: MatchView;
  sub: RoomTab;
  onSub: (s: RoomTab) => void;
  onBack: () => void;
  onChanged: () => Promise<void>;
  flash: (msg: string) => void;
  children: ReactNode;
}

/** 만남 한 명의 방: 위에 상대 정보, 그 아래 대화 · 준비 · 노트 탭. 상대마다 따로 열린다. */
export default function RoomView({ active, sub, onSub, onBack, onChanged, flash, children }: Props) {
  const { t } = useI18n();
  const [menu, setMenu] = useState(false);
  const partner = active.partner;

  const report = async (reason: string) => {
    try {
      await api.report(partner.id, active.id, reason);
      flash("신고를 접수했어요");
      setMenu(false);
    } catch (e) {
      flash((e as Error).message);
    }
  };

  const block = async () => {
    try {
      await api.block(partner.id);
      setMenu(false);
      await onChanged();
      flash(t("{name}님을 차단했어요.", { name: partner.name }));
      onBack();
    } catch (e) {
      flash((e as Error).message);
    }
  };

  return (
    <div className="room-view">
      <div className="roomhead">
        <button className="back" onClick={onBack} aria-label={t("만남 목록으로")}>
          ‹
        </button>
        <Avatar name={partner.name} />
        <div className="grow">
          <b>{partner.name}</b>
          <span className="m">{partner.bio || t("연락처 공개 없이 대화해요")}</span>
          {partner.bio && <TranslateButton text={partner.bio} />}
        </div>
        <button className="link" onClick={() => setMenu((v) => !v)} aria-expanded={menu}>
          {t("신고·차단")}
        </button>
      </div>

      {menu && (
        <div className="menu">
          <span className="hint" style={{ width: "100%" }}>
            {t("신고 사유를 고르거나 차단할 수 있어요.")}
          </span>
          {REPORT_REASONS.map((r) => (
            <button key={r} className="btn ghost small" onClick={() => report(r)}>
              {t("신고:")} {t(r)}
            </button>
          ))}
          <button className="btn small" onClick={block}>
            {t("차단하기")}
          </button>
        </div>
      )}

      <div className="subtabs" role="tablist">
        {SUBTABS.map(([k, label]) => (
          <button key={k} role="tab" aria-selected={sub === k} className={sub === k ? "on" : ""} onClick={() => onSub(k)}>
            {t(label)}
          </button>
        ))}
      </div>

      <div className={`roombody ${sub}`}>{children}</div>
    </div>
  );
}
