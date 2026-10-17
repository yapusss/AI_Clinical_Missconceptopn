"use client";

import { useEffect, useState } from "react";
import { latexToMarkup } from "./mathLiveLoader";
import "mathlive/static.css";

type Props = {
  latex: string;
  className?: string;
  /** Render as a standalone block formula rather than inline math. */
  display?: boolean;
};

/**
 * Read-only rendering of a LaTeX string using MathLive's static markup
 * converter. The MathLive runtime is loaded lazily on the client, so a plain
 * monospace fallback is shown during the first paint (and on the server) to
 * avoid an SSR/hydration mismatch.
 */
export default function StaticMath({ latex, className, display = false }: Props) {
  const [markup, setMarkup] = useState("");

  useEffect(() => {
    let active = true;
    setMarkup("");
    void latexToMarkup(latex).then((html) => {
      if (active) setMarkup(html);
    });
    return () => {
      active = false;
    };
  }, [latex]);

  if (!latex?.trim()) return null;

  if (!markup) {
    return (
      <span
        className={`math-static math-static-pending ${className ?? ""}`}
        title={latex}
      >
        {latex}
      </span>
    );
  }

  return (
    <span
      className={`math-static ${display ? "math-static-display" : ""} ${className ?? ""}`}
      dangerouslySetInnerHTML={{ __html: markup }}
    />
  );
}
