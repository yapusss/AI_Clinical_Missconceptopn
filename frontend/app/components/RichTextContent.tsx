"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import DOMPurify from "dompurify";
import type { MathfieldElement } from "mathlive";
import { loadMathLive } from "./mathLiveLoader";
import { buildNormalized, foldQuotes } from "./evidence";
import "mathlive/static.css";

const ALLOWED_TAGS = [
  "p", "br", "strong", "b", "em", "i", "u", "s", "strike", "del", "code", "pre",
  "ul", "ol", "li", "blockquote", "h1", "h2", "h3", "h4", "a", "img", "hr", "span",
  // Native MathLive formula element. Stored read-only; MathLive renders it as
  // math once its runtime is loaded.
  "math-field",
];

const ALLOWED_ATTR = [
  "href", "target", "rel", "src", "alt", "title", "width", "height", "class", "style",
  // Math node: `data-latex` holds the LaTeX source, `data-type` is kept for
  // content written by the previous span-based renderer.
  "data-type", "data-latex", "read-only",
];

const SAFE_STYLE_PROPERTY = /^(width|max-width)\s*:\s*[0-9.]+\s*(%|px|em|rem)?$/i;
let styleHookReady = false;

function ensureStyleHook() {
  if (styleHookReady || typeof window === "undefined") return;
  DOMPurify.addHook("uponSanitizeAttribute", (_node, data) => {
    if (data.attrName !== "style") return;
    const safe = String(data.attrValue ?? "")
      .split(";")
      .map((part) => part.trim())
      .filter((part) => part && SAFE_STYLE_PROPERTY.test(part))
      .join("; ");
    if (safe) {
      data.attrValue = safe;
    } else {
      data.keepAttr = false;
    }
  });
  styleHookReady = true;
}

type TextSpan = { node: Text; start: number; end: number };

/**
 * One concatenated plain string of every rendered text node (outside a
 * `math-field`, whose LaTeX is not student prose) plus the per-node offsets used
 * to map a match back onto the nodes.
 */
function collectText(root: HTMLElement): { text: string; spans: TextSpan[] } {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => {
      const parent = (node as Text).parentElement;
      if (parent && parent.closest("math-field")) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  let text = "";
  const spans: TextSpan[] = [];
  let current = walker.nextNode();
  while (current) {
    const node = current as Text;
    const start = text.length;
    text += node.data;
    spans.push({ node, start, end: text.length });
    current = walker.nextNode();
  }
  return { text, spans };
}

/** Undo a previous pass so the effect is idempotent (and MathLive survives). */
function clearMarks(root: HTMLElement) {
  root.querySelectorAll("mark.evidence-mark").forEach((mark) => {
    const parent = mark.parentNode;
    if (!parent) return;
    while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
    parent.removeChild(mark);
  });
  root.normalize();
}

/** Wrap the located quote's original characters in `<mark class="evidence-mark">`. */
function applyHighlight(root: HTMLElement, quote: string): boolean {
  const { text, spans } = collectText(root);
  if (!text) return false;
  const { value, indexMap } = buildNormalized(text);
  const cleanQuote = foldQuotes(quote).toLowerCase().replace(/\s+/g, " ").trim();
  if (!cleanQuote) return false;
  const at = value.indexOf(cleanQuote);
  if (at < 0) return false;

  const start = indexMap[at];
  const end = indexMap[at + cleanQuote.length - 1] + 1;

  const segments: { node: Text; start: number; end: number }[] = [];
  for (const span of spans) {
    const segStart = Math.max(start, span.start);
    const segEnd = Math.min(end, span.end);
    if (segStart < segEnd) {
      segments.push({ node: span.node, start: segStart - span.start, end: segEnd - span.start });
    }
  }
  if (!segments.length) return false;

  // Apply last-to-first so splitting an earlier node cannot invalidate a later
  // segment's recorded offsets.
  for (let i = segments.length - 1; i >= 0; i -= 1) {
    const seg = segments[i];
    const range = document.createRange();
    range.setStart(seg.node, seg.start);
    range.setEnd(seg.node, seg.end);
    const mark = document.createElement("mark");
    mark.className = "evidence-mark";
    range.surroundContents(mark);
  }
  return true;
}

export default function RichTextContent({
  html,
  className,
  highlightQuote,
  highlightReason,
}: {
  html?: string | null;
  className?: string;
  /** Sentence to tint, exactly as stored in `evidence_span.quote`. */
  highlightQuote?: string;
  /** One-line model reason, rendered only when the quote was actually located. */
  highlightReason?: string;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [highlighted, setHighlighted] = useState(false);

  const clean = useMemo(() => {
    const value = html ?? "";
    if (!value) return "";
    if (typeof window === "undefined") return "";
    ensureStyleHook();
    return DOMPurify.sanitize(value, {
      ALLOWED_TAGS,
      ALLOWED_ATTR,
      FORBID_TAGS: ["script", "style", "iframe", "object", "embed", "form", "input"],
      FORBID_ATTR: ["onerror", "onload", "onclick", "onmouseover"],
    });
  }, [html]);

  // Loading MathLive upgrades the `<math-field>` elements allowed through the
  // sanitizer; setting the value from `data-latex` guarantees the formula shows
  // even if MathLive did not pick it up from the element's text content.
  useEffect(() => {
    const root = containerRef.current;
    if (!root) return;
    const fields = root.querySelectorAll<MathfieldElement>("math-field");
    if (fields.length === 0) return;
    let active = true;
    void loadMathLive()
      .then(() => {
        if (!active) return;
        fields.forEach((field) => {
          const latex = field.getAttribute("data-latex");
          if (latex && field.value !== latex) field.value = latex;
        });
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [clean]);

  // The tint runs after the HTML is mounted. A miss renders nothing at all — no
  // mark and no reason line, so the model's claim never appears without the
  // student text it points at.
  useEffect(() => {
    const root = containerRef.current;
    if (!root) return;
    clearMarks(root);
    if (!highlightQuote) {
      setHighlighted(false);
      return;
    }
    let ok = false;
    try {
      ok = applyHighlight(root, highlightQuote);
    } catch {
      ok = false;
    }
    setHighlighted(ok);
  }, [clean, highlightQuote]);

  if (!html) return null;

  return (
    <>
      <div
        ref={containerRef}
        className={`rte-content ${className ?? ""}`}
        dangerouslySetInnerHTML={{ __html: clean }}
      />
      {highlighted && highlightReason ? (
        <p className="evidence-reason">{highlightReason}</p>
      ) : null}
    </>
  );
}
