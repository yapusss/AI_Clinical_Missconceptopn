"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { KeyRound, TriangleAlert } from "lucide-react";

import { useAuth } from "../components/AuthProvider";
import PageHeader from "../components/PageHeader";
import MySubmissions from "../components/MySubmissions";
import { apiFetch } from "../lib/api";

type StudentQuestion = {
  question_id: string;
  order_index: number;
  version_id: string;
  version_number: number;
  prompt: string;
  latest_submission: {
    submission_id: string;
    attempt_no: number;
    status: string;
    submitted_at: string;
  } | null;
};

type StudentSet = {
  id: string;
  code: string;
  title: string;
  description: string;
  subject_id: string;
  subject_name: string;
  is_active: boolean;
  questions: StudentQuestion[];
};

const errMsg = (err: unknown) => (err instanceof Error ? err.message : String(err));

export default function SoalPage() {
  const { user, loading } = useAuth();
  const router = useRouter();

  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [user, loading, router]);

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
      router.push(`/sets/${data.id}?code=${encodeURIComponent(data.code)}`);
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setSubmitting(false);
    }
  }

  if (loading || !user) return null;

  return (
    <div style={{ maxWidth: "1080px", margin: "0 auto" }}>
      <PageHeader title="Soal Konseptual" description="Masukkan kode soal dari dosen untuk mengerjakan lembar evaluasi, lalu pantau jawaban yang sudah Anda kumpulkan di bawah ini." icon={KeyRound} eyebrow={<span className="inline-flex items-center gap-2 rounded-full border border-primary-fixed-dim bg-primary-fixed/60 px-3 py-1 text-xs font-bold uppercase tracking-wider text-primary"><KeyRound size={14} aria-hidden="true" /> Evaluasi Mahasiswa</span>} />

      {error && (
        <div
          role="alert"
          className="mt-6 flex items-center gap-3 rounded-lg border border-error/40 bg-error-container p-4 text-sm text-on-error-container"
        >
          <TriangleAlert size={20} />
          <span>{error}</span>
        </div>
      )}

      <div
        className="glass-panel mt-8 rounded-xl border border-outline-variant/40 p-6 shadow-sm"
        style={{ maxWidth: "560px" }}
      >
        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold uppercase text-on-surface-variant">
              Kode Soal
            </label>
            <input
              type="text"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="Contoh: FIS-NEWTON-01"
              required
              className="mt-1 block w-full rounded-lg border border-outline-variant/60 bg-surface-container-lowest px-3 py-2 font-mono-ui text-sm text-on-surface focus:border-primary focus:outline-none"
            />
            <p className="mt-1 text-[11px] text-on-surface-variant">
              Huruf besar, angka, dan tanda hubung (-). Kode ini bersifat unik untuk setiap bank soal.
            </p>
          </div>

          <button
            type="submit"
            disabled={submitting}
            style={{ color: "#ffffff" }}
            className="w-full rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold shadow-sm transition-colors hover:bg-primary-container focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-50"
          >
            {submitting ? "Membuka lembar evaluasi..." : "Buka Lembar Evaluasi"}
          </button>
        </form>
      </div>

      <section id="pengumpulan" className="mt-6 scroll-mt-6">
        <hr className="border-outline-variant/40" />
        <div className="mt-5">
          <MySubmissions />
        </div>
      </section>
    </div>
  );
}
