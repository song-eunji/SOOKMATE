import { useEffect, useRef, type ReactNode } from "react";

export default function NoteDialog({ title, onClose, children, wide = false }: {title: string; onClose: () => void; children: ReactNode; wide?: boolean}) {
  const ref = useRef<HTMLDialogElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const element = ref.current;
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    element?.showModal();
    return () => { element?.close(); document.body.style.overflow = overflow; previous?.focus(); };
  }, []);
  return <dialog className={`note-dialog ${wide ? "note-dialog-wide" : ""}`} ref={ref} aria-labelledby="note-dialog-title" onCancel={(event) => {event.preventDefault(); close.current();}}>
    <header className="note-dialog-head"><h2 id="note-dialog-title">{title}</h2><button className="note-close" aria-label="닫기" onClick={onClose}>✕</button></header>
    <div className="note-dialog-body">{children}</div>
  </dialog>;
}
