import { api } from "./api";
import type { Lang } from "./i18n";

/** 지원 언어의 명확한 문자 패턴만 사용한다. 국적이나 사용자 이름으로 추정하지 않는다. */
export function textLanguage(text: string): Lang | null {
  const count = (pattern: RegExp) => (text.match(pattern) ?? []).length;
  if (count(/[\u3040-\u30ff]/g)) return "ja";
  const ko = count(/[가-힣]/g), zh = count(/[\u4e00-\u9fff]/g), latin = count(/[A-Za-z]/g);
  if (ko && ko >= latin / 2 && ko >= zh) return "ko";
  if (zh && zh >= latin / 2) return "zh";
  if (/[ăâđêôơưĂÂĐÊÔƠƯ\u1ea0-\u1ef9]/.test(text)) return "vi";
  return latin >= 4 ? "en" : null;
}

const cache = new Map<string, string>();
const inflight = new Map<string, Promise<string | null>>();
export function translateText(text: string, lang: Lang): Promise<string | null> {
  const key = `${lang}\u0000${text}`;
  const cached = cache.get(key);
  if (cached) return Promise.resolve(cached);
  const pending = inflight.get(key);
  if (pending) return pending;
  const request = api.translate(text, lang).then((result) => {
    if (!result.translated || result.text.trim() === text.trim()) return null;
    if (cache.size >= 256) cache.clear();
    cache.set(key, result.text);
    return result.text;
  }).finally(() => inflight.delete(key));
  inflight.set(key, request);
  return request;
}
