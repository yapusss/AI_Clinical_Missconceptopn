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
let keyboardCustomized = false;

/**
 * Minimal structural view of MathLive's keyboard, used to rewrite the layout
 * without depending on its internal (non-exported) layout types.
 */
type Keycap = {
  latex?: string;
  insert?: string;
  label?: string;
  tooltip?: string;
  class?: string;
  width?: number;
  [key: string]: unknown;
};

type KeyboardLike = {
  normalizedLayouts: Array<{
    layers: Array<{ id?: string; rows: Array<Array<Keycap | string>> }>;
    [key: string]: unknown;
  }>;
  layouts: unknown;
};

/** Keycap that inserts a two-slot fraction, drawn as the fraction template. */
const FRACTION_KEY: Keycap = {
  // `#@` marks the caret inside the numerator, `#?` the denominator slot.
  // MathLive renders both as placeholder boxes on the key face.
  latex: "\\frac{#@}{#?}",
  tooltip: "Pecahan",
};

/**
 * Swap `∀` for a fraction key, but only on the "123" (numeric) layer the user
 * works from. Other layers keep their original symbol set.
 */
function customizeMathKeyboard() {
  if (keyboardCustomized) return;
  const keyboard = window.mathVirtualKeyboard as unknown as KeyboardLike | undefined;
  if (!keyboard?.normalizedLayouts?.length) return;

  try {
    const layouts = keyboard.normalizedLayouts.map((layout) => {
      const isNumericLayer =
        layout.label === "123" || layout.tooltip === "keyboard.tooltip.numeric";
      if (!isNumericLayer) return layout;

      return {
        ...layout,
        layers: layout.layers.map((layer) => ({
          ...layer,
          rows: layer.rows.map((row) =>
            row.map((key) =>
              typeof key === "object" && key?.latex === "\\forall"
                ? FRACTION_KEY
                : key,
            ),
          ),
        })),
      };
    });

    keyboard.layouts = layouts;
    keyboardCustomized = true;
  } catch {
    // A failed customization must never break formula input: keep the stock
    // keyboard instead.
    keyboard.layouts = ["default"];
  }
}

export function loadMathLive(): Promise<MathLiveModule> {
  if (!mathLivePromise) {
    mathLivePromise = import("mathlive").then((module) => {
      customizeMathKeyboard();
      return module;
    });
  }
  return mathLivePromise;
}

/** True on phones/tablets (and any device without a precise pointer). */
export function isCoarsePointer(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia?.("(pointer: coarse)")?.matches ?? false;
}

/**
 * Open MathLive's on-screen keyboard. Safe to call on desktop: the keyboard is
 * a DOM panel, no native input is involved.
 */
export async function showMathKeyboard(): Promise<void> {
  await loadMathLive();
  window.mathVirtualKeyboard?.show({ animate: true });
}

/** Dismiss the on-screen keyboard (no-op when it was never created). */
export function hideMathKeyboard(): void {
  if (typeof window === "undefined") return;
  window.mathVirtualKeyboard?.hide({ animate: false });
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
