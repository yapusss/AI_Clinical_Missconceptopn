"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, KeyRound, TriangleAlert, X } from "lucide-react";

import { useAuth } from "../components/AuthProvider";
import PageHeader from "../components/PageHeader";
import MySubmissions from "../components/MySubmissions";
import { apiFetch } from "../lib/api";

type StudentSet = {
  id: string;
  code: string;
  title: string;
  description: string;
  subject_id: string;
  subject_name: string;
  is_active: boolean;
  questions: unknown[];
};

const errMsg = (err: unknown) => (err instanceof Error ? err.message : String(err));

export default function SoalPage() {
  const { user, loading } = useAuth();
  const router = useRouter();

  const [showModal, setShowModal] = useState(false);
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [user, loading, router]);

  // Close modal on Escape key press
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && showModal) {
        setShowModal(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [showModal]);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const value = code.trim().toUpperCase();
    if (!value) return;

    setError("");
    setSubmitting(true);
    try {
      const data = await apiFetch<StudentSet>(`/student/sets?code=${encodeURIComponent(value)}`);
      if (!data.questions || data.questions.length === 0) {
        setError("Soal belum dipublikasikan oleh dosen. Hubungi dosen pengampu Anda.");
        return;
      }
      setShowModal(false);
      router.push(`/sets/${data.id}?code=${encodeURIComponent(data.code)}`);
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setSubmitting(false);
    }
  }

  const openModal = () => {
    setCode("");
    setError("");
    setShowModal(true);
  };

  if (loading || !user) return null;

  return (
    <div style={{ maxWidth: "1080px", margin: "0 auto" }}>
      {/* Clean Header: Key Icon vertically centered with Title and Description */}
      <PageHeader
        title="Soal Konseptual"
        description="Buka lembar evaluasi menggunakan kode dari dosen atau pantau hasil evaluasi jawaban Anda."
        icon={KeyRound}
      />

      {/* Section: Pengumpulan Saya with "Mulai Evaluasi" aligned on top-right */}
      <section id="pengumpulan" className="mt-8">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-3">
          <div>
            <h2 className="font-display text-lg font-bold text-on-surface">
              Pengumpulan Saya
            </h2>
            <p className="text-xs text-on-surface-variant mt-0.5">
              Lihat, cari, dan pantau hasil evaluasi jawaban Anda.
            </p>
          </div>

          {/* Option B: Button on top right of table with extended width */}
          <button
            type="button"
            onClick={openModal}
            className="btn-primary !py-2.5 !px-7 text-xs font-semibold shadow-sm inline-flex items-center justify-center gap-2 shrink-0 min-w-[155px]"
          >
            <KeyRound size={15} />
            <span>Mulai Evaluasi</span>
          </button>
        </div>

        <MySubmissions compactHeading />
      </section>

      {/* Pop-up Modal for Entering the Code */}
      {showModal && (
        <div
          className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs"
          role="dialog"
          aria-modal="true"
          aria-labelledby="modal-code-title"
        >
          <div className="w-full max-w-md rounded-2xl border border-outline-variant/40 bg-surface-container-lowest p-6 shadow-2xl animate-fade-in">
            {/* Modal Header */}
            <div className="flex items-start justify-between gap-3 border-b border-outline-variant/30 pb-3.5">
              <div className="flex items-center gap-2.5">
                <div className="flex size-9 items-center justify-center rounded-lg bg-primary-fixed text-primary">
                  <KeyRound size={18} />
                </div>
                <div>
                  <h2 id="modal-code-title" className="font-display text-base font-bold text-on-surface">
                    Mulai Evaluasi Soal
                  </h2>
                  <p className="text-xs text-on-surface-variant">
                    Masukkan kode unik yang diberikan oleh dosen.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowModal(false)}
                className="rounded-lg p-1 text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface transition-colors"
                aria-label="Tutup pop up"
              >
                <X size={18} />
              </button>
            </div>

            {/* Error Banner inside Modal */}
            {error && (
              <div
                role="alert"
                className="mt-4 flex items-center gap-2.5 rounded-xl border border-error/40 bg-error-container p-3 text-xs text-on-error-container"
              >
                <TriangleAlert size={16} className="shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {/* Code Input Form */}
            <form onSubmit={onSubmit} className="mt-4 space-y-4">
              <div>
                <label
                  htmlFor="modal-input-code"
                  className="block text-xs font-bold uppercase tracking-wider text-on-surface-variant mb-1.5"
                >
                  Kode Soal
                </label>
                <input
                  id="modal-input-code"
                  type="text"
                  value={code}
                  onChange={(e) => setCode(e.target.value.toUpperCase())}
                  placeholder="Contoh: FIS-NEWTON-01"
                  required
                  autoFocus
                  className="w-full rounded-xl border border-outline-variant/60 bg-surface-container-low px-3.5 py-2.5 font-mono-ui text-sm text-on-surface uppercase placeholder:text-on-surface-variant/50 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                />
                <p className="mt-1.5 text-[11px] text-on-surface-variant">
                  Kode paket bersifat unik untuk setiap evaluasi konseptual.
                </p>
              </div>

              {/* Modal Actions */}
              <div className="flex items-center justify-end gap-2.5 border-t border-outline-variant/30 pt-4">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  disabled={submitting}
                  className="btn-secondary !py-2 !px-4 text-xs font-semibold"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="btn-primary !py-2 !px-4 text-xs font-semibold inline-flex items-center gap-1.5 disabled:opacity-50"
                >
                  {submitting ? "Memeriksa..." : "Buka Lembar Evaluasi"}
                  <ArrowRight size={14} />
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}