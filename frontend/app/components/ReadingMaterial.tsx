import ReactMarkdown from "react-markdown";
import { BookMarked } from "lucide-react";

import type { ReadingMaterialSource } from "../lib/studentSubmissions";

export type ReadingMaterialProps = {
  material?:
    | {
        content_md?: string | null;
        sources?: ReadingMaterialSource[];
      }
    | null;
};

// C7/S3: the student sees the material the LLM wrote for them, never the verdict's
// citation list. A `null` material (SC, or a non-READY row) renders nothing —
// no placeholder, no "material unavailable" box.
export default function ReadingMaterial({ material }: ReadingMaterialProps) {
  if (!material) return null;

  const sources = material.sources ?? [];

  return (
    <div className="sm:col-span-2">
      <div className="rounded-lg border border-outline-variant/40 bg-surface-container-lowest p-3.5">
        <div className="flex items-center gap-1.5 text-xs font-bold tracking-wider text-on-surface">
          <BookMarked size={14} className="text-primary" />
          Materi Bacaan
        </div>

        {material.content_md && (
          <div className="rte-content mt-2.5 text-sm leading-relaxed text-on-surface">
            <ReactMarkdown>{material.content_md}</ReactMarkdown>
          </div>
        )}

        {sources.length > 0 && (
          <div className="mt-3 border-t border-outline-variant/20 pt-3">
            <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-on-surface-variant">
              Sumber Materi ({sources.length})
            </p>
            <ul className="space-y-1">
              {sources.map((src, index) => (
                <li
                  key={`${src.chunk_id}-${index}`}
                  className="flex items-center justify-between gap-2 rounded border border-outline-variant/30 bg-surface-container px-3 py-1.5 text-xs"
                >
                  <span className="min-w-0 truncate font-semibold text-on-surface">
                    {src.document_title || "Sumber tidak dikenal"}
                  </span>
                  <span className="shrink-0 font-mono-ui text-[10px] text-on-surface-variant">
                    {typeof src.page === "number" ? `hal. ${src.page}` : "—"}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
