"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, BrainCircuit, ClipboardList, TriangleAlert } from "lucide-react";

import { useAuth } from "../../components/AuthProvider";
import PageHeader from "../../components/PageHeader";
import { apiFetch } from "../../lib/api";

type SubmissionDetail = {
  id: string;
  status: string;
  submitted_at: string;
  attempt_no: number;
  student: { id: string; name: string; email: string };
  subject: { id: string; name: string };
  set: { id: string; code: string; title: string };
  question: {
    version_number: number;
    prompt: string;
    model_answer: string;
    reference_answers: { id: string; answer_key: string | null; text: string }[];
    indicators: { order_index: number; label: string; description: string; weight: string }[];
  };
  answer_text: string;
  current_analysis: {
    id: string;
    percentage_correct: string;
    tier_level: number;
    tier_label: string;
    confidence: string;
    validation: { status: string; lecturer_name: string; validated_at: string | null } | null;
  } | null;
};

const STATUS_LABEL: Record<string, string> = {
  SUBMITTED: "Dikirim", ANALYZING: "Menganalisis", ANALYSIS_FAILED: "Analisis gagal",
  PENDING_VALIDATION: "Menunggu validasi", VALIDATED: "Tervalidasi", REJECTED: "Ditolak",
};

export default function SubmissionDetailPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const submissionId = params?.id;
  const [data, setData] = useState<SubmissionDetail | null>(null);
  const [fetching, setFetching] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!submissionId) return;
    setFetching(true); setError("");
    try { setData(await apiFetch<SubmissionDetail>(`/lecturer/submissions/${submissionId}`)); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Gagal memuat jawaban."); }
    finally { setFetching(false); }
  }, [submissionId]);

  useEffect(() => {
    if (loading) return;
    if (!user) { router.replace("/login"); return; }
    void load();
  }, [loading, user, router, load]);

  if (loading || !user) return null;
  const analysisMessage = data?.status === "ANALYZING" ? "Analisis AI sedang diproses. Jawaban asli tetap dapat ditinjau di halaman ini." : data?.status === "ANALYSIS_FAILED" ? "Analisis AI gagal. Jawaban asli tetap tersedia untuk ditinjau." : "Analisis AI belum tersedia untuk jawaban ini.";

  return <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
    <Link href="/submissions" className="inline-flex items-center gap-2 text-sm font-semibold text-primary no-underline hover:underline"><ArrowLeft size={16} /> Kembali ke jawaban mahasiswa</Link>
    {data && <PageHeader className="mt-4" title={data.student.name} description={`${data.set.title} · ${data.subject.name}`} icon={ClipboardList} action={<span className="badge badge-role">{STATUS_LABEL[data.status] ?? data.status}</span>} />}
    {error && <div role="alert" className="mt-6 flex items-center gap-3 rounded-lg border border-error/40 bg-error-container p-4 text-sm text-on-error-container"><TriangleAlert size={20} />{error}</div>}
    {fetching ? <p className="mt-8 text-sm text-on-surface-variant">Memuat jawaban mahasiswa...</p> : data && <div className="mt-8 space-y-5">
      <section className="glass-card rounded-xl p-5"><p className="text-sm text-on-surface-variant">{data.student.email} · Percobaan {data.attempt_no}</p><h2 className="mt-4 text-base font-bold text-on-surface">Soal</h2><p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-on-surface">{data.question.prompt}</p><h2 className="mt-6 text-base font-bold text-on-surface">Jawaban mahasiswa</h2><p className="mt-2 whitespace-pre-wrap rounded-lg border border-outline-variant/40 bg-surface-container-low p-4 text-sm leading-6 text-on-surface">{data.answer_text || "Tidak ada teks jawaban."}</p></section>
      <section className="glass-card rounded-xl p-5"><h2 className="text-base font-bold text-on-surface">Jawaban referensi</h2><p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-on-surface">{data.question.model_answer}</p>{data.question.indicators.length > 0 && <><h3 className="mt-5 text-sm font-bold text-on-surface">Indikator penilaian</h3><ul className="mt-2 space-y-2 text-sm text-on-surface-variant">{data.question.indicators.map((indicator) => <li key={indicator.order_index}><strong className="text-on-surface">{indicator.order_index}. {indicator.label}</strong> ({Number(indicator.weight) * 100}%) {indicator.description}</li>)}</ul></>}</section>
      <section className="rounded-xl border border-outline-variant/40 bg-surface-container-low p-5"><div className="flex items-start gap-3"><BrainCircuit className="mt-0.5 text-primary" size={20} /><div className="min-w-0 flex-1"><h2 className="text-base font-bold text-on-surface">Analisis AI</h2>{data.current_analysis ? <><p className="mt-2 text-sm text-on-surface-variant">Skor {Number(data.current_analysis.percentage_correct).toFixed(1)}% · {data.current_analysis.tier_label} · Kepercayaan {(Number(data.current_analysis.confidence) * 100).toFixed(0)}%</p>{data.current_analysis.validation && <p className="mt-1 text-sm text-on-surface-variant">Validasi: {data.current_analysis.validation.status} oleh {data.current_analysis.validation.lecturer_name}</p>}<Link href={`/validation/${data.current_analysis.id}`} className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-primary no-underline hover:underline">Buka detail validasi <ArrowRight size={15} /></Link></> : <p className="mt-2 text-sm text-on-surface-variant">{analysisMessage}</p>}</div></div></section>
    </div>}
  </div>;
}
