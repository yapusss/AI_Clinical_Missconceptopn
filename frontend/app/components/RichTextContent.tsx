"use client";

import { useMemo } from "react";
import DOMPurify from "dompurify";

const ALLOWED_TAGS = [
  "p", "br", "strong", "b", "em", "i", "u", "s", "strike", "del", "code", "pre",
  "ul", "ol", "li", "blockquote", "h1", "h2", "h3", "h4", "a", "img", "hr", "span",
];

const ALLOWED_ATTR = ["href", "target", "rel", "src", "alt", "title", "width", "height", "class", "style"];

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

  if (!html) return null;

  return <div className={`rte-content ${className ?? ""}`} dangerouslySetInnerHTML={{ __html: clean }} />;
}
