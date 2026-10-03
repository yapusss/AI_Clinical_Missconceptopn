"use client";

import { useMemo } from "react";
import DOMPurify from "dompurify";

const ALLOWED_TAGS = [
  "p", "br", "strong", "b", "em", "i", "u", "s", "strike", "del", "code", "pre",
  "ul", "ol", "li", "blockquote", "h1", "h2", "h3", "h4", "a", "img", "hr", "span",
];

const ALLOWED_ATTR = ["href", "target", "rel", "src", "alt", "title", "width", "height", "class"];

export default function RichTextContent({ html, className }: { html?: string | null; className?: string }) {
  const clean = useMemo(() => {
    const value = html ?? "";
    if (!value) return "";
    if (typeof window === "undefined") return "";
    return DOMPurify.sanitize(value, {
      ALLOWED_TAGS,
      ALLOWED_ATTR,
      FORBID_TAGS: ["script", "style", "iframe", "object", "embed", "form", "input"],
      FORBID_ATTR: ["onerror", "onload", "onclick", "onmouseover", "style"],
    });
  }, [html]);

  if (!html) return null;

  return <div className={`rte-content ${className ?? ""}`} dangerouslySetInnerHTML={{ __html: clean }} />;
}
