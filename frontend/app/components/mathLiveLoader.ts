/**
 * Lazy MathLive runtime loader.
 *
 * MathLive ships two builds: a DOM-free one for Node (selected through its
 * `node` export condition) and a browser build that registers the
 * `<math-field>` custom element and injects its stylesheets. Because the
 * browser build touches `document`/`window` at import time, it must only be
 * imported on the client — hence the dynamic `import()` cached here instead of
 * a top-level import in the components.
 */
type MathLiveModule = typeof import("mathlive");

let mathLivePromise: Promise<MathLiveModule> | null = null;

export function loadMathLive(): Promise<MathLiveModule> {
  if (!mathLivePromise) {
    mathLivePromise = import("mathlive");
  }
  return mathLivePromise;
}

/**
 * Convert a LaTeX string into static HTML markup (MathLive static renderer).
 * Returns an empty string for empty input or when the client runtime is not
 * available yet, so callers can render a plain-text fallback until hydration.
 */
export async function latexToMarkup(latex: string): Promise<string> {
  const value = latex?.trim();
  if (!value) return "";
  try {
    const { convertLatexToMarkup } = await loadMathLive();
    return convertLatexToMarkup(value);
  } catch {
    return "";
  }
}

/**
 * Heuristic: a stored answer is treated as raw LaTeX when it contains a LaTeX
 * command, a braced script, or a `\placeholder{}` slot rather than plain prose.
 */
export function looksLikeLatex(value: string): boolean {
  return /\\[a-zA-Z]+|\^\{|_\{|\\placeholder/.test(value);
}
