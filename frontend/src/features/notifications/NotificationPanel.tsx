import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "../../i18n";
import type { NotificationApi } from "./api";
import type { AppNotification } from "./types";
import { notificationDate, notificationText } from "./text";
import { useNotifications } from "./useNotifications";
import "./notifications.css";

interface Props {
  userId: number;
  client?: NotificationApi;
  onNavigate: (notification: AppNotification) => Promise<void> | void;
}

function Bell() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
      <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9Z" strokeLinejoin="round" />
      <path d="M9.5 20a2.8 2.8 0 0 0 5 0" strokeLinecap="round" />
    </svg>
  );
}

export default function NotificationPanel({ userId, onNavigate, client }: Props) {
  const { lang } = useI18n();
  const { state, store } = useNotifications(userId, client);
  const [navigationError, setNavigationError] = useState(false);
  const [navigating, setNavigating] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const identity = useRef(userId);
  identity.current = userId;
  const mounted = useRef(false);
  const titleId = useId();
  const panelId = useId();
  const text = (key: string, n?: number) => notificationText(lang, key, n);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  useEffect(() => {
    setNavigationError(false);
    setNavigating(false);
  }, [userId]);
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (state.open && !element.open) {
      setNavigationError(false);
      element.showModal();
    } else if (!state.open && element.open) {
      element.close();
      trigger.current?.focus();
    }
  }, [state.open]);

  const activate = async (item: AppNotification) => {
    if (navigating || state.pendingId !== null) return;
    const owner = userId;
    setNavigationError(false);
    setNavigating(true);
    try {
      if (!await store.markRead(item) || !mounted.current || identity.current !== owner) return;
      await onNavigate(item);
      if (mounted.current && identity.current === owner) store.setOpen(false);
    } catch {
      if (mounted.current && identity.current === owner) setNavigationError(true);
    } finally {
      if (mounted.current && identity.current === owner) setNavigating(false);
    }
  };

  return (
    <>
      <button
        ref={trigger} className="notification-trigger" type="button"
        aria-label={state.unreadCount ? text("count", state.unreadCount) : text("title")}
        aria-haspopup="dialog" aria-expanded={state.open} aria-controls={panelId}
        onClick={() => store.setOpen(true)}
      >
        <Bell />
        {state.unreadCount !== null && state.unreadCount > 0 && (
          <span className="notification-badge" aria-hidden="true">{state.unreadCount > 99 ? "99+" : state.unreadCount}</span>
        )}
      </button>
      {createPortal(
        <dialog
          ref={dialog} id={panelId} className="notification-dialog" aria-labelledby={titleId}
          onCancel={(event) => { event.preventDefault(); store.setOpen(false); }}
          onClose={() => store.setOpen(false)}
          onClick={(event) => {
            if (event.target !== event.currentTarget) return;
            const box = event.currentTarget.getBoundingClientRect();
            if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) store.setOpen(false);
          }}
        >
          <div className="notification-heading">
            <div>
              <h2 id={titleId}>{text("title")}</h2>
              {state.unreadCount !== null && <p>{text("count", state.unreadCount)}</p>}
            </div>
            <div className="notification-tools">
              <button type="button" onClick={() => void store.refresh()} disabled={state.loading || state.pendingId !== null || navigating}>{text("refresh")}</button>
              <button type="button" aria-label={text("close")} onClick={() => store.setOpen(false)}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="m6 6 12 12M6 18 18 6" /></svg>
              </button>
            </div>
          </div>
          <div className="notification-content" aria-busy={state.loading || state.loadingMore}>
            {(state.error || navigationError) && (
              <p className="notification-error" role="alert">{text(navigationError ? "navigateError" : state.error === "read" ? "readError" : "refreshError")}</p>
            )}
            {state.loading && state.items.length === 0 && <p className="notification-status" role="status">{text("loading")}</p>}
            {!state.loading && !state.error && state.items.length === 0 && (
              <div className="notification-empty"><span><Bell /></span><h3>{text("empty")}</h3><p>{text("emptyHint")}</p></div>
            )}
            {state.items.length > 0 && (
              <ul className="notification-list">
                {state.items.map((item) => (
                  <li key={item.id}>
                    <button
                      type="button" className={`notification-item${item.read_at === null ? " is-unread" : ""}`}
                      disabled={state.pendingId !== null || navigating} onClick={() => void activate(item)}
                    >
                      <span className="notification-marker" aria-hidden="true" />
                      <span className="notification-copy">
                        <strong>{text(item.kind)}</strong>
                        <span>{text(item.kind === "message_created" || item.kind === "match_confirmed" ? "chatHint" : "recHint")}</span>
                        <time dateTime={item.created_at}>{notificationDate(item.created_at, lang)}</time>
                      </span>
                      {item.read_at === null && <span className="notification-unread-label">{text("unread")}</span>}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {state.hasMore && <button className="notification-more" type="button" disabled={state.loading || state.loadingMore || navigating || state.pendingId !== null} onClick={() => void store.loadMore()}>{text(state.loadingMore ? "loading" : "more")}</button>}
          </div>
        </dialog>, document.body,
      )}
    </>
  );
}
