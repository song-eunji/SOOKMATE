import Icon from "./Icon";
import "./DevUserPicker.css";
import { useId, useRef, useState } from "react";
import type { UserLite } from "./types";

/** 개발 계정 목록은 화면을 덮는 OS 선택 메뉴 대신, 검색 가능한 제한 높이 창으로 표시한다. */
export default function DevUserPicker({ users, value, onChange }: { users: UserLite[]; value: number | null; onChange: (id: number) => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [query, setQuery] = useState("");
  const selected = users.find((user) => user.id === value);
  const results = users.filter((user) => `${user.name} ${user.kind === "domestic" ? "국내" : "유학생"}`.includes(query.trim()));

  return (
    <>
      <button className="dev-user-trigger" type="button" aria-haspopup="dialog" onClick={() => { setQuery(""); dialog.current?.showModal(); }}>
        <span>{selected?.name ?? "사용자"}</span>
        <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="m5 8 5 5 5-5" /></svg>
      </button>
      <dialog className="dev-user-dialog" ref={dialog} aria-labelledby={titleId} onClick={(event) => { if (event.target === event.currentTarget) dialog.current?.close(); }}>
        <div className="dev-user-content">
          <div className="dev-user-heading">
            <div><h2 id={titleId}>개발용 사용자 전환</h2><p>테스트할 계정을 선택하세요.</p></div>
            <button type="button" aria-label="닫기" onClick={() => dialog.current?.close()}>×</button>
          </div>
          <input autoFocus type="search" aria-label="이름 또는 국내·유학생 검색" placeholder="이름 또는 국내·유학생 검색" value={query} onChange={(event) => setQuery(event.target.value)} />
          <ul className="dev-user-results">
            {results.map((user) => (
              <li key={user.id}>
                <button type="button" aria-current={user.id === value ? "true" : undefined} onClick={() => { onChange(user.id); dialog.current?.close(); }}>
                  <span>{user.name}<small>{user.kind === "domestic" ? "국내" : "유학생"}</small></span>
                  {user.id === value && <span aria-label="현재 사용자"><Icon name="check" size={16} /></span>}
                </button>
              </li>
            ))}
            {results.length === 0 && <li className="dev-user-empty">검색 결과가 없어요.</li>}
          </ul>
        </div>
      </dialog>
    </>
  );
}
