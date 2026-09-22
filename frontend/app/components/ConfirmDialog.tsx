"use client";

import { TriangleAlert, X } from "lucide-react";

type Props = { open: boolean; title: string; description: string; confirmLabel: string; onConfirm: () => void; onCancel: () => void };

export default function ConfirmDialog({ open, title, description, confirmLabel, onConfirm, onCancel }: Props) {
  if (!open) return null;
  return <div className="fixed inset-0 z-[250] flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-labelledby="confirm-dialog-title"><div className="w-full max-w-md rounded-2xl border border-error/30 bg-surface-container-lowest p-6 shadow-2xl"><div className="flex items-start justify-between gap-4"><div className="flex items-start gap-3"><span className="rounded-full bg-error-container p-2 text-error"><TriangleAlert size={20} aria-hidden="true" /></span><div><h2 id="confirm-dialog-title" className="font-display text-lg font-bold text-on-surface">{title}</h2><p className="mt-2 text-sm leading-6 text-on-surface-variant">{description}</p></div></div><button type="button" onClick={onCancel} aria-label="Tutup konfirmasi" className="text-on-surface-variant hover:text-on-surface"><X size={20} /></button></div><div className="mt-6 flex justify-end gap-3"><button type="button" onClick={onCancel} className="btn-secondary">Batal</button><button type="button" onClick={onConfirm} className="btn-danger">{confirmLabel}</button></div></div></div>;
}
