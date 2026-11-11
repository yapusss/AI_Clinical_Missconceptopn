"use client";

import { MonitorUp, ShieldAlert } from "lucide-react";

export default function ExamProctorOverlay({
  open,
  message,
  mobile,
  reducedAssurance,
  onResume,
}: {
  open: boolean;
  message: string;
  mobile: boolean;
  reducedAssurance: boolean;
  onResume: () => void | Promise<unknown>;
}) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[600] flex items-center justify-center bg-black/90 p-4"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="exam-proctor-title"
      aria-describedby="exam-proctor-message"
    >
      <div className="w-full max-w-md rounded-2xl border border-outline-variant/50 bg-surface-container-lowest p-6 text-center shadow-2xl">
        <div className="mx-auto mb-4 flex size-14 items-center justify-center rounded-full bg-error-container text-on-error-container">
          <ShieldAlert size={28} />
        </div>
        <h2
          id="exam-proctor-title"
          className="font-display text-lg font-extrabold text-on-surface"
        >
          Ujian dijeda
        </h2>
        <p
          id="exam-proctor-message"
          className="mt-2 text-sm leading-relaxed text-on-surface-variant"
        >
          {message ||
            "Kembali ke layar penuh dan fokus ke jendela ujian untuk melanjutkan."}
        </p>
        {reducedAssurance && (
          <p className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
            Mode perangkat seluler: sebagian pemeriksaan layar penuh tidak
            tersedia. Sinyal perpindahan aplikasi tetap dicatat.
          </p>
        )}
        <button
          type="button"
          onClick={() => void onResume()}
          className="btn-primary mt-5 inline-flex w-full items-center justify-center gap-2"
        >
          <MonitorUp size={17} />
          {mobile ? "Kembali ke Ujian" : "Masuk Layar Penuh & Lanjutkan"}
        </button>
      </div>
    </div>
  );
}
