"use client";

import { useEffect } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";

export default function ExamRouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[exam-route]", error);
  }, [error]);

  return (
    <main className="flex min-h-[70vh] items-center justify-center p-6">
      <div className="w-full max-w-md rounded-2xl border border-error/40 bg-surface-container-lowest p-6 text-center shadow-xl">
        <div className="mx-auto mb-4 flex size-14 items-center justify-center rounded-full bg-error-container text-on-error-container">
          <AlertTriangle size={28} />
        </div>
        <h1 className="font-display text-lg font-extrabold text-on-surface">
          Ujian gagal dimuat
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-on-surface-variant">
          Data ujian atau jawaban lama tidak dapat dibaca. Coba muat ulang
          halaman. Jika masih gagal, buka tab baru atau hapus data situs untuk
          localhost.
        </p>
        <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-center">
          <button
            type="button"
            onClick={() => reset()}
            className="btn-secondary inline-flex items-center justify-center gap-2"
          >
            Coba Lagi
          </button>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="btn-primary inline-flex items-center justify-center gap-2"
          >
            <RefreshCw size={16} />
            Muat Ulang Halaman
          </button>
        </div>
      </div>
    </main>
  );
}
