"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, CheckCircle2, X } from "lucide-react";

type Props = {
  open: boolean;
  message: string;
  /** Optional located details, rendered as a list under the message. */
  details?: string[];
  variant?: "error" | "warning" | "success";
  onClose: () => void;
};

export default function FeedbackModal({
  open,
  message,
  details,
  variant = "error",
  onClose,
}: Props) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const descriptionId = useId();
  const [mounted, setMounted] = useState(false);
  const isSuccess = variant === "success";
  const title = isSuccess
    ? "Berhasil"
    : variant === "warning"
      ? "Peringatan"
      : "Terjadi kesalahan";

  const iconClass = isSuccess
    ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
    : variant === "warning"
      ? "bg-amber-500/15 text-amber-600 dark:text-amber-400"
      : "bg-error-container text-error";

  const borderClass = isSuccess
    ? "border-emerald-500/30"
    : variant === "warning"
      ? "border-amber-500/30"
      : "border-error/30";

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open || !mounted) return;

    previousFocusRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    closeButtonRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      previousFocusRef.current?.focus();
    };
  }, [mounted, open, onClose]);

  if (!open || !mounted) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[300] flex items-center justify-center bg-black/60 p-4"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      onKeyDown={(event) => {
        if (event.key === "Tab") {
          event.preventDefault();
          closeButtonRef.current?.focus();
        }
      }}
    >
      <div className={`w-full max-w-lg rounded-2xl border bg-surface-container-lowest p-6 shadow-2xl ${borderClass}`}>
        <div className="flex items-start gap-3">
          <span className={`rounded-full p-2 ${iconClass}`}>
            {isSuccess ? (
              <CheckCircle2 size={20} aria-hidden="true" />
            ) : (
              <AlertTriangle size={20} aria-hidden="true" />
            )}
          </span>
          <div className="min-w-0 flex-1">
            <h2
              id={titleId}
              className="font-display text-lg font-bold text-on-surface"
            >
              {title}
            </h2>
            <p
              id={descriptionId}
              className="mt-2 text-sm leading-6 text-on-surface-variant"
            >
              {message}
            </p>
            {details && details.length > 0 && (
              <ul className="mt-3 max-h-72 space-y-2 overflow-y-auto pr-1 text-left text-sm leading-6 text-on-surface-variant">
                {details.map((detail, index) => (
                  <li key={`${index}-${detail}`} className="flex gap-2">
                    <span
                      aria-hidden="true"
                      className="mt-2.5 h-1.5 w-1.5 shrink-0 rounded-full bg-current opacity-60"
                    />
                    <span className="min-w-0">{detail}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            aria-label="Tutup pesan"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-on-surface-variant transition-colors hover:bg-surface-container focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            <X size={20} aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
