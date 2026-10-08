"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, X } from "lucide-react";

type Props = {
  open: boolean;
  message: string;
  variant?: "error" | "warning";
  onClose: () => void;
};

export default function FeedbackModal({
  open,
  message,
  variant = "error",
  onClose,
}: Props) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const descriptionId = useId();
  const [mounted, setMounted] = useState(false);
  const title = variant === "warning" ? "Peringatan" : "Terjadi kesalahan";

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
      <div className="w-full max-w-md rounded-2xl border border-error/30 bg-surface-container-lowest p-6 shadow-2xl">
        <div className="flex items-start gap-3">
          <span className="rounded-full bg-error-container p-2 text-error">
            <AlertTriangle size={20} aria-hidden="true" />
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
