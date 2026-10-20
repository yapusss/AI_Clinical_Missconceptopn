"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight, ExternalLink, Loader2, X } from "lucide-react";

import { getApiBase, getAuthToken } from "../lib/api";

type Props = {
  open: boolean;
  onClose: () => void;
  documentId: string | null;
  page: number | null;
  title: string;
};

type Ticket = { ticket: string; pages: number | null };

/**
 * Read a reference document at its cited page.
 *
 * The corpus is whole textbooks (the deployed one holds 53 MB and 63 MB files), so
 * fetching the PDF before showing anything is minutes of blank modal on a slow
 * link. This renders ONE page — the cited one — as an image, and keeps the full
 * book one click away. Both URLs are addressed by a short-lived, document-scoped
 * ticket because `<img>` and a new tab cannot send the auth header.
 */
export default function PdfViewerDialog({
  open,
  onClose,
  documentId,
  page,
  title,
}: Props) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const [mounted, setMounted] = useState(false);
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [pageNo, setPageNo] = useState(1);
  const [imgLoading, setImgLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setMounted(true), []);

  // Exchange the Bearer token for a ticket whenever the target changes.
  useEffect(() => {
    if (!open || !documentId) {
      setTicket(null);
      setError(null);
      setImgLoading(false);
      return;
    }

    let cancelled = false;
    setTicket(null);
    setError(null);
    setImgLoading(true);
    setPageNo(page && page > 0 ? page : 1);

    void (async () => {
      const token = getAuthToken();
      let res: Response;
      try {
        res = await fetch(`${getApiBase()}/materials/${documentId}/ticket`, {
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        });
      } catch {
        if (!cancelled) {
          setError("Tidak dapat menghubungi server.");
          setImgLoading(false);
        }
        return;
      }

      if (!res.ok) {
        let detail = "Gagal membuka dokumen.";
        try {
          const data = (await res.json()) as { detail?: string };
          if (typeof data.detail === "string") detail = data.detail;
        } catch {
          // Not JSON: keep the fallback message.
        }
        if (!cancelled) {
          setError(detail);
          setImgLoading(false);
        }
        return;
      }

      const data = (await res.json()) as { ticket?: string; pages?: number | null };
      if (cancelled) return;
      if (!data.ticket) {
        setError("Gagal membuka dokumen.");
        setImgLoading(false);
        return;
      }
      // The image's own onLoad clears the spinner.
      setTicket({ ticket: data.ticket, pages: data.pages ?? null });
    })();

    return () => {
      cancelled = true;
    };
  }, [open, documentId, page]);

  // Focus management, Escape-to-close and background scroll lock (FeedbackModal's
  // accessibility contract).
  useEffect(() => {
    if (!open || !mounted) return;

    previousFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    panelRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    const previousOverflow = document.body.style.overflow;
    window.addEventListener("keydown", handleKeyDown);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      previousFocusRef.current?.focus();
    };
  }, [mounted, open, onClose]);

  const goToPage = useCallback(
    (delta: number) => {
      setImgLoading(true);
      setPageNo((current) => {
        const total = ticket?.pages ?? Number.POSITIVE_INFINITY;
        return Math.min(Math.max(current + delta, 1), total);
      });
    },
    [ticket?.pages],
  );

  if (!open || !mounted) return null;

  const query = ticket ? `ticket=${encodeURIComponent(ticket.ticket)}` : null;
  const pageImageSrc =
    ticket && documentId
      ? `${getApiBase()}/materials/${documentId}/page?n=${pageNo}&${query}`
      : null;
  const fullPdfHref =
    ticket && documentId ? `${getApiBase()}/materials/${documentId}/file?${query}` : null;
  const total = ticket?.pages ?? null;

  return createPortal(
    <div
      className="fixed inset-0 z-[300] flex items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        className="flex h-[calc(100dvh-2rem)] w-full max-w-4xl flex-col overflow-hidden rounded-lg border border-outline-variant/40 bg-surface-container-lowest shadow-2xl focus:outline-none"
      >
        <header className="flex shrink-0 items-center gap-2 border-b border-outline-variant/30 px-4 py-2.5">
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="truncate text-sm font-bold text-on-surface">
              {title}
            </h2>
            {/* The citation's `page` is the PDF page index, which is NOT the number
                printed on the page (a 1450-page book starts its printed numbering
                ~26 pages in). Say "halaman PDF" so the two cannot be confused. */}
            <p className="font-mono-ui text-[10px] text-on-surface-variant">
              halaman PDF {pageNo}
              {total ? ` / ${total}` : ""}
            </p>
          </div>

          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={() => goToPage(-1)}
              disabled={pageNo <= 1}
              aria-label="Halaman sebelumnya"
              className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg border border-outline-variant/40 text-on-surface-variant transition-colors hover:bg-surface-container disabled:cursor-default disabled:opacity-40"
            >
              <ChevronLeft size={16} aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={() => goToPage(1)}
              disabled={total !== null && pageNo >= total}
              aria-label="Halaman berikutnya"
              className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg border border-outline-variant/40 text-on-surface-variant transition-colors hover:bg-surface-container disabled:cursor-default disabled:opacity-40"
            >
              <ChevronRight size={16} aria-hidden="true" />
            </button>
          </div>

          <a
            href={fullPdfHref ?? undefined}
            target="_blank"
            rel="noopener"
            aria-disabled={!fullPdfHref}
            className={`inline-flex shrink-0 items-center gap-1 rounded-lg border border-outline-variant/40 px-2.5 py-1.5 text-[11px] font-semibold no-underline transition-colors hover:bg-surface-container ${
              fullPdfHref
                ? "text-on-surface"
                : "pointer-events-none text-on-surface opacity-50"
            }`}
          >
            <ExternalLink size={13} aria-hidden="true" />
            PDF lengkap
          </a>

          <button
            type="button"
            onClick={onClose}
            aria-label="Tutup pratinjau"
            className="flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-lg text-on-surface-variant transition-colors hover:bg-surface-container focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            <X size={18} aria-hidden="true" />
          </button>
        </header>

        <div className="relative flex min-h-0 flex-1 flex-col overflow-auto bg-surface-container-lowest">
          {!error && (
            <div className="relative flex min-h-full items-start justify-center p-3">
              {imgLoading && (
                <div
                  role="status"
                  className="absolute inset-0 flex items-center justify-center gap-2 bg-surface-container-lowest/80 text-on-surface-variant"
                >
                  <Loader2 size={20} className="animate-spin text-primary" />
                  <span className="text-xs">Memuat halaman…</span>
                </div>
              )}
              {pageImageSrc && (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  key={pageImageSrc}
                  src={pageImageSrc}
                  alt={`${title} — halaman ${pageNo}`}
                  className="max-w-full rounded border border-outline-variant/30 bg-white"
                  onLoad={() => setImgLoading(false)}
                  onError={() => {
                    setImgLoading(false);
                    setError("Halaman ini tidak dapat ditampilkan.");
                  }}
                />
              )}
            </div>
          )}

          {error && (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
              <p className="text-sm text-on-surface">{error}</p>
              <button type="button" onClick={onClose} className="btn-secondary">
                Tutup
              </button>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
