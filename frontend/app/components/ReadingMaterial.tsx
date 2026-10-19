import { useState } from "react";
import ReactMarkdown from "react-markdown";
import { BookMarked, BookOpen, Loader2 } from "lucide-react";

import type {
  EvidenceSpan,
  MissingConcept,
  ReadingMaterialSource,
} from "../lib/studentSubmissions";
import EvidenceQuote, { resolveEvidenceSentence } from "./EvidenceQuote";
import MissingConcepts from "./MissingConcepts";
import PdfViewerDialog from "./PdfViewerDialog";

export type ReadingMaterialProps = {
  material?:
    | {
        status?: string | null;
        content_md?: string | null;
        sources?: ReadingMaterialSource[];
      }
    | null;
  /** v3.2: the student's misconception sentence, rendered above the header. */
  evidence?: EvidenceSpan | null;
  /** Phase 6: the "Konsep yang belum dikuasai" list, above the material. */
  missingConcepts?: MissingConcept[] | null;
};

// C7/S3: the student sees the material the LLM wrote for them, never the verdict's
// citation list. A `null` material (SC, a Benar verdict, or an absent/FAILED row)
// renders nothing — no placeholder, no "material unavailable" box.
//
// A row that exists but is not READY yet is NOT `null`: it renders the header plus a
// "being prepared" line, because the student otherwise cannot tell "on its way" from
// "never coming" — the two look identical when both are silence.
//
// v3.2: the evidence block is about the ANSWER, not the material, so it renders
// even when the material is missing/PENDING. When only the evidence exists there
// is no material header to sit above — the card holds the block alone.
// Phase 6 adds the missing-concept list in the same block, above "Materi Bacaan".
export default function ReadingMaterial({
  material,
  evidence,
  missingConcepts,
}: ReadingMaterialProps) {
  const [viewer, setViewer] = useState<{
    documentId: string;
    page: number;
    title: string;
  } | null>(null);
  const hasEvidence = resolveEvidenceSentence(evidence) !== "";
  const hasMissing = (missingConcepts ?? []).length > 0;
  if (!material && !hasEvidence && !hasMissing) return null;

  const sources = material?.sources ?? [];
  const generating =
    !material?.content_md &&
    (material?.status === "PENDING" || material?.status === "STALE");

  return (
    <div className="sm:col-span-2">
      <div className="rounded-lg border border-outline-variant/40 bg-surface-container-lowest p-3.5">
        {hasEvidence && (
          <div
            className={
              material || hasMissing
                ? "mb-3 border-b border-outline-variant/20 pb-3"
                : ""
            }
          >
            <EvidenceQuote evidence={evidence} />
          </div>
        )}

        {hasMissing && (
          <div className={material ? "mb-3 border-b border-outline-variant/20 pb-3" : ""}>
            <MissingConcepts concepts={missingConcepts} />
          </div>
        )}

        {material && (
          <>
            <div className="flex items-center gap-1.5 text-xs font-bold tracking-wider text-on-surface">
              <BookMarked size={14} className="text-primary" />
              Materi Bacaan
            </div>

            {generating && (
              <p
                className="mt-2 flex items-center gap-1.5 text-xs text-on-surface-variant"
                role="status"
              >
                <Loader2 size={13} className="animate-spin text-primary" />
                {material.status === "STALE"
                  ? "Materi bacaan sedang diperbarui…"
                  : "Materi bacaan sedang disiapkan…"}
              </p>
            )}

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
                  {sources.map((src, index) => {
                    const rowClass =
                      "flex items-center justify-between gap-2 rounded border border-outline-variant/30 bg-surface-container px-3 py-1.5 text-xs";
                    const pageLabel = (
                      <span className="shrink-0 font-mono-ui text-[10px] text-on-surface-variant">
                        {typeof src.page === "number" ? `hal. ${src.page}` : "—"}
                      </span>
                    );
                    // Only a cited document can be opened; an unresolved source stays
                    // the inert row it always was.
                    if (!src.document_id) {
                      return (
                        <li key={`${src.chunk_id}-${index}`} className={rowClass}>
                          <span className="min-w-0 truncate font-semibold text-on-surface">
                            {src.document_title || "Sumber tidak dikenal"}
                          </span>
                          {pageLabel}
                        </li>
                      );
                    }
                    const documentId = src.document_id;
                    const page = src.page ?? 1;
                    const title = src.document_title ?? "Referensi";
                    return (
                      <li key={`${src.chunk_id}-${index}`}>
                        <button
                          type="button"
                          onClick={() => setViewer({ documentId, page, title })}
                          title={`Buka ${title} hal. ${page}`}
                          className={`${rowClass} w-full cursor-pointer text-left transition-colors hover:bg-surface-container-high`}
                        >
                          <span className="flex min-w-0 items-center gap-1.5">
                            <BookOpen
                              size={12}
                              className="shrink-0 text-primary"
                              aria-hidden="true"
                            />
                            <span className="min-w-0 truncate font-semibold text-on-surface">
                              {src.document_title || "Sumber tidak dikenal"}
                            </span>
                          </span>
                          {pageLabel}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </>
        )}
      </div>

      <PdfViewerDialog
        open={viewer !== null}
        onClose={() => setViewer(null)}
        documentId={viewer?.documentId ?? null}
        page={viewer?.page ?? null}
        title={viewer?.title ?? "Referensi"}
      />
    </div>
  );
}
