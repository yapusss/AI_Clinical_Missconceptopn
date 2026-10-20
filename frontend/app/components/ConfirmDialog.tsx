"use client";

import { TriangleAlert, X } from "lucide-react";

type Props = {
  open: boolean;
  title: string;
  description: string;
  /** Optional located details, rendered as a list under the description. */
  details?: string[];
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
};

export default function ConfirmDialog({
  open,
  title,
  description,
  details,
  confirmLabel,
  onConfirm,
  onCancel,
}: Props) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-[250] flex items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-dialog-title"
    >
      <div className="w-full max-w-lg rounded-2xl border border-error/30 bg-surface-container-lowest p-6 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <span className="rounded-full bg-error-container p-2 text-error">
              <TriangleAlert size={20} aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <h2
                id="confirm-dialog-title"
                className="font-display text-lg font-bold text-on-surface"
              >
                {title}
              </h2>
              <p className="mt-2 text-sm leading-6 text-on-surface-variant">
                {description}
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
          </div>
          <button
            type="button"
            onClick={onCancel}
            aria-label="Tutup konfirmasi"
            className="text-on-surface-variant hover:text-on-surface"
          >
            <X size={20} />
          </button>
        </div>
        <div className="mt-6 flex justify-end gap-3">
          <button type="button" onClick={onCancel} className="btn-secondary">
            Batal
          </button>
          <button type="button" onClick={onConfirm} className="btn-danger">
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
