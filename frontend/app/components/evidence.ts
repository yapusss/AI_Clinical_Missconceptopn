/**
 * Sentence-level evidence highlighting (v3.2).
 *
 * The backend stores an `evidence_span` whose `quote` was copied from a
 * plain-text projection of the answer (tags stripped, whitespace collapsed,
 * case preserved). Locating it inside the evidence block's sentence therefore
 * needs a match that ignores case, whitespace runs and curly-vs-straight quotes,
 * then maps the match back to the original characters so the tint wraps the real
 * text. The student's own answer is never tinted.
 */

const CURLY_QUOTES: Record<string, string> = {
  "\u2018": "'",
  "\u2019": "'",
  "\u201a": "'",
  "\u201b": "'",
  "\u201c": '"',
  "\u201d": '"',
  "\u201e": '"',
  "\u201f": '"',
  "\u2039": "<",
  "\u203a": ">",
  "\u00ab": '"',
  "\u00bb": '"',
};

/** Fold curly quotes to their straight forms (matches the backend guard). */
export function foldQuotes(value: string): string {
  let out = "";
  for (const ch of value) out += CURLY_QUOTES[ch] ?? ch;
  return out;
}

/** The normalization the backend guard applies, so both sides agree. */
export function normalizeForMatch(value: string): string {
  return foldQuotes(value).toLowerCase().replace(/\s+/g, " ").trim();
}

export type NormalizedText = {
  /** Normalized text (lowercase, single spaces, no leading/trailing space). */
  value: string;
  /** `indexMap[i]` is the index in the source string of `value[i]`. */
  indexMap: number[];
};

/**
 * Normalize a source string into a comparable form, keeping a per-character map
 * back to the source so a match can be mapped onto the original characters.
 * Runs of whitespace collapse to one space; a collapsed space maps to the first
 * character of the run it separated (so a match never starts on virtual space).
 */
export function buildNormalized(text: string): NormalizedText {
  let value = "";
  const indexMap: number[] = [];
  let pendingSpace = false;
  let started = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (/\s/.test(ch)) {
      if (started) pendingSpace = true;
      continue;
    }
    if (pendingSpace) {
      value += " ";
      indexMap.push(i);
      pendingSpace = false;
    }
    value += foldQuotes(ch).toLowerCase();
    indexMap.push(i);
    started = true;
  }
  return { value, indexMap };
}

/**
 * The `[start, end)` range of `quote` inside `text`, or `null` when absent.
 * Case-, whitespace- and curly-quote-insensitive.
 */
export function findQuoteRange(
  text: string,
  quote: string | null | undefined,
): [number, number] | null {
  const clean = normalizeForMatch(quote ?? "");
  if (!clean) return null;
  const { value, indexMap } = buildNormalized(text);
  if (!value) return null;
  const at = value.indexOf(clean);
  if (at < 0) return null;
  return [indexMap[at], indexMap[at + clean.length - 1] + 1];
}
