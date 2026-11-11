import { useEffect, useState } from "react";
import { translateActivity } from "../api";
import { useI18n } from "../i18n";
import type { SavedActivity } from "../types";

const pending = new Map<string, Promise<SavedActivity>>();
const cache = new Map<string, SavedActivity>();
export default function useLocalizedActivity(matchId: number, stored: SavedActivity | null | undefined) {
  const { lang } = useI18n();
  const key = `${matchId}:${stored?.run_id}:${stored?.created_at}:${lang}:${Boolean(stored?.baseline)}`;
  const [state, setState] = useState<{key: string; value: SavedActivity | null; loading: boolean; failed: boolean}>({key: "", value: null, loading: false, failed: false});
  useEffect(() => {
    let alive = true;
    if (!stored || lang === "ko") return;
    const cached = cache.get(key);
    if (cached) { setState({key, value: cached, loading: false, failed: false}); return; }
    setState({key, value: null, loading: true, failed: false});
    let request = pending.get(key);
    if (!request) {
      request = translateActivity(matchId, stored.run_id, lang).then((value) => {
        if (value.retrieval.translation_status !== "failed" && value.baseline?.translation_status !== "failed") {
          if (cache.size >= 32) cache.clear();
          cache.set(key, value);
        }
        return value;
      }).finally(() => pending.delete(key));
      pending.set(key, request);
    }
    request.then((value) => { if (alive) setState({key, value, loading: false, failed: value.retrieval.translation_status === "failed" || value.baseline?.translation_status === "failed"}); })
      .catch(() => { if (alive) setState({key, value: null, loading: false, failed: true}); });
    return () => { alive = false; };
  }, [key, matchId, stored?.run_id, lang]);
  const applicable = state.key === key && lang !== "ko";
  return { localized: applicable && state.value && stored ? { ...stored, retrieval: state.value.retrieval, baseline: state.value.baseline } : null, loading: Boolean(stored && lang !== "ko" && (!applicable || state.loading)), failed: applicable && state.failed };
}
