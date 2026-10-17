"use client";

import RichTextContent from "./RichTextContent";
import StaticMath from "./StaticMath";
import { looksLikeLatex } from "./mathLiveLoader";
import { findQuoteRange } from "./evidence";

type Props = {
  value?: string | null;
  className?: string;
  /** Shown when the value is empty. */
  fallback?: string;
  /** Sentence to tint, exactly as stored in `evidence_span.quote`. */
  highlightQuote?: string;
};

const HTML_PATTERN =
  /<(p|br|div|span|ul|ol|li|strong|b|em|i|h[1-6]|img|a|blockquote|pre|code)[\s/>]/i;

/**
 * Renders a stored answer that may be rich text HTML (with inline math nodes),
 * a raw LaTeX formula from a MathLive field, or plain prose. Used by read-only
 * review screens so formulas display as math instead of source code.
 */
export default function MathContent({
  value,
  className,
  fallback = "-",
  highlightQuote,
}: Props) {
  const raw = (value ?? "").trim();
  if (!raw) return <>{fallback}</>;

  if (HTML_PATTERN.test(raw)) {
    return (
      <RichTextContent
        html={raw}
        className={className}
        highlightQuote={highlightQuote}
      />
    );
  }

  if (looksLikeLatex(raw)) {
    return <StaticMath latex={raw} className={className} />;
  }

  // Plain prose: no DOM walker needed — split the single string at the located
  // quote and wrap that slice. A miss renders the text untouched.
  const range = findQuoteRange(raw, highlightQuote);
  return (
    <span className={`whitespace-pre-wrap ${className ?? ""}`}>
      {range ? (
        <>
          {raw.slice(0, range[0])}
          <mark className="evidence-mark">{raw.slice(range[0], range[1])}</mark>
          {raw.slice(range[1])}
        </>
      ) : (
        raw
      )}
    </span>
  );
}
