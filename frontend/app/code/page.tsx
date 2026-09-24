"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, KeyRound, TriangleAlert } from "lucide-react";

import { useAuth } from "../components/AuthProvider";
import PageHeader from "../components/PageHeader";
import PageContainer from "../components/PageContainer";
import MySubmissions from "../components/MySubmissions";
import FormModal from "../components/FormModal";
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
    <PageContainer>
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
        <FormModal
          title="Mulai Evaluasi Soal"
          subtitle="Masukkan kode unik yang diberikan oleh dosen."
          icon={KeyRound}
          onClose={() => setShowModal(false)}
          onSubmit={onSubmit}
          maxWidth="max-w-md"
          closeLabel="Tutup pop up"
          footer={<><button type="button" onClick={() => setShowModal(false)} disabled={submitting} className="btn-secondary w-full sm:w-auto !py-2 !px-4 text-xs font-semibold">Batal</button><button type="submit" disabled={submitting} className="btn-primary w-full sm:w-auto !py-2 !px-4 text-xs font-semibold disabled:opacity-50">{submitting ? "Memeriksa..." : "Buka Lembar Evaluasi"}<ArrowRight size={14} /></button></>}
        >
          <section className="rounded-xl border border-outline-variant/50 p-4">
            {error && (
              <div
                role="alert"
                className="mb-4 flex items-center gap-2.5 rounded-xl border border-error/40 bg-error-container p-3 text-xs text-on-error-container"
              >
                <TriangleAlert size={16} className="shrink-0" />
                <span>{error}</span>
              </div>
            )}

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
          </section>
        </FormModal>
      )}
    </PageContainer>
  );
}
