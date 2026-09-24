import type { FormEventHandler, ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { X } from "lucide-react";

type Props = {
  title: string;
  subtitle: string;
  icon: LucideIcon;
  onClose: () => void;
  onSubmit: FormEventHandler<HTMLFormElement>;
  children: ReactNode;
  footer: ReactNode;
  maxWidth?: "max-w-md" | "max-w-xl" | "max-w-2xl" | "max-w-3xl";
  closeLabel?: string;
};

export default function FormModal({
  title,
  subtitle,
  icon: Icon,
  onClose,
  onSubmit,
  children,
  footer,
  maxWidth = "max-w-xl",
  closeLabel = "Tutup formulir",
}: Props) {
  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="form-modal-title"
    >
      <form
        onSubmit={onSubmit}
        className={`flex max-h-[calc(100dvh-2rem)] w-full ${maxWidth} flex-col rounded-2xl border border-outline-variant/40 bg-surface-container-lowest shadow-2xl`}
      >
        <header className="flex shrink-0 items-start gap-3 border-b border-outline-variant/30 px-5 py-4 sm:px-6 sm:py-5">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary-fixed text-primary">
            <Icon size={20} aria-hidden="true" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 id="form-modal-title" className="font-display text-xl font-bold leading-6 text-on-surface">
              {title}
            </h2>
            <p className="mt-1 text-sm text-on-surface-variant">{subtitle}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={closeLabel}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-on-surface-variant transition-colors hover:bg-surface-container focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            <X size={20} aria-hidden="true" />
          </button>
        </header>
        <div className="min-h-0 overflow-y-auto px-5 py-3 sm:px-6 sm:py-3">{children}</div>
        <footer className="flex shrink-0 flex-col-reverse gap-3 border-t border-outline-variant/30 bg-surface-container-low px-5 py-3 sm:flex-row sm:justify-end sm:px-6 sm:py-3">
          {footer}
        </footer>
      </form>
    </div>
  );
}
