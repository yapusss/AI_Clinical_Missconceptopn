"use client";

import { useEffect, useMemo, useRef } from "react";
import DOMPurify from "dompurify";
import type { MathfieldElement } from "mathlive";
import { loadMathLive } from "./mathLiveLoader";
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

export default function RichTextContent({ html, className }: { html?: string | null; className?: string }) {
  const containerRef = useRef<HTMLDivElement | null>(null);

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

  if (!html) return null;

  return (
    <div
      ref={containerRef}
      className={`rte-content ${className ?? ""}`}
      dangerouslySetInnerHTML={{ __html: clean }}
    />
  );
}
