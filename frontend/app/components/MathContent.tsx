"use client";

import RichTextContent from "./RichTextContent";
import StaticMath from "./StaticMath";
import { looksLikeLatex } from "./mathLiveLoader";

type Props = {
  value?: string | null;
  className?: string;
  /** Shown when the value is empty. */
  fallback?: string;
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
}: Props) {
  const raw = (value ?? "").trim();
  if (!raw) return <>{fallback}</>;

  if (HTML_PATTERN.test(raw)) {
    return <RichTextContent html={raw} className={className} />;
  }

  if (looksLikeLatex(raw)) {
    return <StaticMath latex={raw} className={className} />;
  }

  // Plain prose: render the text untouched.
  return (
    <span className={`whitespace-pre-wrap ${className ?? ""}`}>{raw}</span>
  );
}
