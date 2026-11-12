import type { CSSProperties } from "react";
import { Pin, MessageCircle, Clock3, FlaskConical, NotebookPen, BookOpen, Check, X, ArrowLeftRight, ChevronUp, ChevronDown } from "lucide-react";

const icons = { pin: Pin, chat: MessageCircle, clock: Clock3, flask: FlaskConical, note: NotebookPen, book: BookOpen, check: Check, close: X, swap: ArrowLeftRight, up: ChevronUp, down: ChevronDown };

/** Lucide 공식 아이콘을 정적 import하여 필요한 아이콘만 번들에 포함한다. */
export default function Icon({ name, size = 18, style }: { name: keyof typeof icons; size?: number; style?: CSSProperties }) {
  const Component = icons[name];
  return <Component className="ui-icon" size={size} strokeWidth={1.8} aria-hidden="true" style={style} />;
}
