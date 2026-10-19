"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ExternalLink, Loader2, X } from "lucide-react";

import { getApiBase, getAuthToken } from "../lib/api";

type Props = {
  open: boolean;
  onClose: () => void;
  documentId: string | null;
  page: number | null;
  title: string;
};

// Above this the browser's PDF viewer can take a while to lay out the book, so the
// header suggests "Buka di tab baru" instead of waiting on the inline frame.
const LARGE_PDF_BYTES = 25 * 1024 * 1024;

/**
 * Read a reference PDF at its cited page, without exposing the token.
 *
 * The bytes arrive via the authenticated API and are turned into a blob URL, so the
 * iframe is same-origin to the app: the token never appears in the URL the browser
 * navigates to, and the API origin's `X-Frame-Options` never applies.
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
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [large, setLarge] = useState(false);

  useEffect(() => setMounted(true), []);

  // Fetch on open and whenever the target changes; the blob URL is revoked on
  // cleanup so a closed or re-targeted dialog never leaks the object.
  useEffect(() => {
    if (!open || !documentId) {
      setUrl(null);
      setError(null);
      setLoading(false);
      setLarge(false);
      return;
    }

    let cancelled = false;
    let created: string | null = null;
    setUrl(null);
    setError(null);
    setLarge(false);
    setLoading(true);

    void (async () => {
      const token = getAuthToken();
      let res: Response;
      try {
        res = await fetch(`${getApiBase()}/materials/${documentId}/file`, {
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        });
      } catch {
        if (!cancelled) {
          setError("Tidak dapat menghubungi server.");
          setLoading(false);
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
          setLoading(false);
        }
        return;
      }

      const blob = await res.blob();
      if (cancelled) return;
      const headerLength = Number(res.headers.get("content-length") ?? "");
      setLarge(
        blob.size > LARGE_PDF_BYTES ||
          (Number.isFinite(headerLength) && headerLength > LARGE_PDF_BYTES),
      );
      created = URL.createObjectURL(blob);
      setUrl(created);
      setLoading(false);
    })();

    return () => {
      cancelled = true;
      if (created) URL.revokeObjectURL(created);
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

  if (!open || !mounted) return null;

  const targetPage = page ?? 1;

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
        className="flex h-[calc(100dvh-2rem)] w-full max-w-5xl flex-col overflow-hidden rounded-lg border border-outline-variant/40 bg-surface-container-lowest shadow-2xl focus:outline-none"
      >
        <header className="flex shrink-0 items-center gap-2 border-b border-outline-variant/30 px-4 py-2.5">
          <div className="min-w-0 flex-1">
            <h2
              id={titleId}
              className="truncate text-sm font-bold text-on-surface"
            >
              {title}
            </h2>
            <p className="font-mono-ui text-[10px] text-on-surface-variant">
              hal. {targetPage}
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              if (url) window.open(url, "_blank", "noopener");
            }}
            disabled={!url}
            className="inline-flex shrink-0 cursor-pointer items-center gap-1 rounded-lg border border-outline-variant/40 px-2.5 py-1.5 text-[11px] font-semibold text-on-surface transition-colors hover:bg-surface-container disabled:cursor-default disabled:opacity-50"
          >
            <ExternalLink size={13} aria-hidden="true" />
            Buka di tab baru
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="Tutup pratinjau"
            className="flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-lg text-on-surface-variant transition-colors hover:bg-surface-container focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            <X size={18} aria-hidden="true" />
          </button>
        </header>

        <div className="relative flex min-h-0 flex-1 flex-col bg-surface-container-lowest">
          {loading && (
            <div
              role="status"
              className="absolute inset-0 flex items-center justify-center gap-2 text-on-surface-variant"
            >
              <Loader2 size={22} className="animate-spin text-primary" />
              <span className="text-xs">Memuat dokumen…</span>
            </div>
          )}

          {error && !loading && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center">
              <p className="text-sm text-on-surface">{error}</p>
              <button type="button" onClick={onClose} className="btn-secondary">
                Tutup
              </button>
            </div>
          )}

          {url && !error && (
            <>
              {large && (
                <p className="shrink-0 border-b border-outline-variant/30 bg-surface-container px-4 py-1.5 text-[11px] leading-relaxed text-on-surface-variant">
                  Dokumen ini lebih dari 25 MB sehingga mungkin terbuka lambat. Untuk
                  hasil terbaik, gunakan “Buka di tab baru”.
                </p>
              )}
              <iframe
                src={`${url}#page=${targetPage}&view=FitH`}
                className="min-h-0 w-full flex-1"
                title={title}
              />
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
