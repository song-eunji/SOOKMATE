// 백엔드 응답 모양. 백엔드(app/views.py, app/main.py)를 바꾸면 여기도 같이 바꿔 주세요.

export type Kind = "domestic" | "international";

export interface Options {
  days: string[];
  slots: string[];
  time_slots: string[];
  interests: string[];
  languages: string[];
  topics: string[];
  ui_langs: [string, string][]; // [코드, 표시 이름]
  login_domain: string; // 로그인할 수 있는 메일 도메인
  name_max_len: number;
  bio_max_len: number;
  weights: Record<string, number>;
  dev_mode: boolean;
  dev_login: boolean; // 개발자 입장 버튼(가짜 프로필 계정으로 바로 입장)을 보여줄지
}

export interface DevUser {
  id: number;
  name: string;
  kind: string;
  dept: string;
  nationality: string | null;
  bio: string;
}

export interface UserLite {
  id: number;
  name: string;
  kind: Kind;
}

export interface Partner {
  id: number;
  name: string;
  bio: string;
  kind: Kind;
  dept: string;
  langs: string[];
  interests: string[];
  teach: string[];
  learn: string[];
}

export interface Me extends Omit<Partner, "kind"> {
  kind: Kind | ""; // 새로 가입한 사람은 처음 설정 전까지 비어 있다
  email: string;
  times: string[];
  prefs: string[];
  nationality: string | null;
  onboarded: boolean;
  ui_lang: string; // 화면 언어 코드 (ko, en, ja, zh, vi)
  weekly_cap: number;
  used_this_week: number;
}

export interface ProfileInput {
  interests: string[];
  times: string[];
  langs: string[];
  teach: string[];
  learn: string[];
  prefs: string[];
  nationality: string | null;
}

export interface BasicInput {
  name: string;
  bio: string;
  kind?: Kind; // 새로 가입한 사람만, 처음 한 번
}

export interface Explain {
  common_interests: string[];
  similar_interests?: { mine: string; theirs: string }[];
  common_times: string[];
  common_langs: string[];
  my_topic: string | null;
  partner_topic: string | null;
  mutual: boolean;
  reason: string;
}

export interface MatchView {
  id: number;
  status: "proposed" | "confirmed";
  my_accepted: boolean;
  partner_accepted: boolean;
  expires_at: string;
  score: { I: number; T: number; L: number; R: number; total: number };
  partner: Partner;
  explain: Explain;
}

export interface ChatMessage {
  id: number;
  match_id: number;
  sender_id: number;
  text: string;
  read: boolean; // 상대가 읽었는지 (내가 보낸 메시지에서 의미 있음)
  created_at: string;
}

export interface ChatRoom {
  match_id: number;
  partner: Partner;
  last_message: { text: string; created_at: string; sender_id: number } | null;
  unread: number;
}

export interface Brief {
  prefs: string[];
  tips: { text: string; source: string; source_id: string }[];
  questions: string[];
  mode: "llm" | "fallback";
  note: string | null;
}

export interface ActivitySide {
  topic: string;
  minutes: number;
  desc: string;
}

export interface TranslateResult {
  text: string;
  translated: boolean;
  lang: string;
}

export interface ActivityCard {
  title: string;
  mine: ActivitySide;
  theirs: ActivitySide;
  mode: "llm" | "fallback";
}

export interface NoteData {
  expr: string;
  fact: string;
  next_text: string;
  share_expr: boolean;
  share_fact: boolean;
  share_next: boolean;
}

export interface NotesResponse {
  mine: NoteData | null;
  partner_shared: { expr: string | null; fact: string | null; next_text: string | null } | null;
}

export interface NextActivity {
  title: string;
  desc: string;
  basis: "shared_notes" | "common_interest" | "default";
}

export interface ActivitySource {
  id: string; title: string; url: string; text: string; text_kind?: string;
  provider?: "library" | "wikipedia" | "google"; matched?: string[]; minutes?: number; cost?: string;
}
export interface GeneratedActivity extends NextActivity {
  analysis?: NoteAnalysis;
  reason: string;
  steps: string[];
  sources: ActivitySource[];
  source_ids: string[];
  generation_mode: "llm" | "fallback";
  llm?: { provider: string; model: string };
  llm_status?: { status: string; http_status?: number };
  generation_ms: number;
  total_ms?: number;
  minutes?: number;
  prep?: string;
  search_providers?: Record<string, string>;
  avoided?: string[];
  novel?: boolean;
  search_status?: string;
  search_provider?: string;
  grounding?: { queries: string[]; segments: { text: string; source_ids: string[] }[]; search_entry_html: string } | null;
  query?: string;
  retrieved_sources?: ActivitySource[];
}
export interface ActivityComparison {
  retrieval: GeneratedActivity;
  baseline: GeneratedActivity;
  comparable: boolean;
  rubric: string[];
}

export interface NoteAnalysis {
  mode: "llm" | "fallback";
  entries: { id: string; participant: string; field: string; text: string }[];
  signals: { kind: string; text: string; note_id: string; quote: string }[];
  keywords: string[];
  topics?: string[];
  query: string;
}

export interface Metric { value: number; total?: number; label: string }
export type ActivityMetrics = Record<"note_coverage" | "concrete_details" | "steps" | "source_support" | "cited_sources", Metric>;
export interface JudgeResult {
  scores: Record<"retrieval" | "baseline", Record<"relevance" | "feasibility" | "specificity" | "novelty", number>>;
  totals: Record<"retrieval" | "baseline", number>;
  winner: "retrieval" | "baseline" | "tie";
  reason: string;
  order: string[];
  criteria: Record<string, string>;
  model?: string;
}
export interface ActivityEvaluation {
  auto: Record<"retrieval" | "baseline", ActivityMetrics>;
  judge: JudgeResult | null;
}

export interface SavedActivity {
  run_id: number;
  cached: boolean;
  created_at: string;
  ratings: Record<string, number>;
  retrieval: GeneratedActivity;
  baseline?: GeneratedActivity;
  comparable?: boolean;
  rubric?: string[];
  evaluation?: ActivityEvaluation;
}
