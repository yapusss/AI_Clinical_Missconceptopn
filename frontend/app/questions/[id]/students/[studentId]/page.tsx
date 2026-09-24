"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, BrainCircuit, ClipboardList, TriangleAlert } from "lucide-react";

import { useAuth } from "../../../../components/AuthProvider";
import PageHeader from "../../../../components/PageHeader";
import PageContainer from "../../../../components/PageContainer";
import { apiFetch } from "../../../../lib/api";

type PackageReview = {
  package: { id: string; code: string; title: string; description: string; subject_name: string };
  student: { id: string; name: string; email: string };
  published_question_count: number;
  answered_count: number;
  questions: {
    question_id: string; order_index: number; prompt: string; model_answer: string; status: string;
    reference_answers: { id: string; answer_key: string | null; answer_text: string; answer_type: string; is_primary: boolean }[];
    indicators: { id: string; label: string; description: string; weight: string; order_index: number }[];
    submission: { id: string; answer_text: string; attempt_no: number; submitted_at: string; status: string } | null;
    analysis: { id: string; percentage_correct: string; tier_level: number; tier_label: string; confidence: string; explanation: string; validation: { status: string; final_percentage: string | null; final_feedback: string | null; lecturer_name: string; validated_at: string | null } | null } | null;
  }[];
};

const STATUS_LABEL: Record<string, string> = { SUBMITTED: "Dikirim", ANALYZING: "Menganalisis", ANALYSIS_FAILED: "Analisis gagal", PENDING_VALIDATION: "Menunggu validasi", VALIDATED: "Tervalidasi", REJECTED: "Ditolak", UNANSWERED: "Belum dijawab" };

export default function StudentPackageReviewPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const params = useParams<{ id: string; studentId: string }>();
  const setId = params?.id;
  const studentId = params?.studentId;
  const [data, setData] = useState<PackageReview | null>(null);
  const [fetching, setFetching] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!setId || !studentId) return;
    setFetching(true); setError("");
    try { setData(await apiFetch<PackageReview>(`/questions/${setId}/students/${studentId}/review`)); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Gagal memuat review paket."); }
    finally { setFetching(false); }
  }, [setId, studentId]);

  useEffect(() => {
    if (loading) return;
    if (!user) { router.replace("/login"); return; }
    void load();
  }, [loading, user, router, load]);

  if (loading || !user) return null;
  return <PageContainer>
    <Link href={`/questions/${setId}`} className="inline-flex items-center gap-2 text-sm font-semibold text-primary no-underline hover:underline"><ArrowLeft size={16} /> Kembali ke progres mahasiswa</Link>
    {data && <PageHeader className="mt-4" title={data.student.name} description={`${data.package.title} · ${data.package.subject_name}`} icon={ClipboardList} eyebrow={<span className="font-mono-ui text-xs font-bold uppercase tracking-wider text-primary">{data.package.code}</span>} action={<span className="badge badge-role">Terjawab {data.answered_count} / {data.published_question_count}</span>} />}
    {error && <div role="alert" className="mt-6 flex items-center gap-3 rounded-lg border border-error/40 bg-error-container p-4 text-sm text-on-error-container"><TriangleAlert size={20} />{error}</div>}
    {fetching ? <p className="mt-8 text-sm text-on-surface-variant">Memuat review paket...</p> : data && <div className="mt-8 space-y-5">{data.questions.map((question) => <article key={question.question_id} className="glass-card rounded-xl p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div><p className="text-xs font-bold uppercase tracking-wider text-primary">Soal {question.order_index}</p><h2 className="mt-2 whitespace-pre-wrap text-base font-bold leading-6 text-on-surface">{question.prompt}</h2></div><span className={`badge ${question.submission ? "badge-active" : "badge-draft"}`}>{STATUS_LABEL[question.status] ?? question.status}</span></div>
      <section className="mt-5"><h3 className="text-sm font-bold text-on-surface">Jawaban mahasiswa</h3><p className="mt-2 whitespace-pre-wrap rounded-lg border border-outline-variant/40 bg-surface-container-low p-4 text-sm leading-6 text-on-surface">{question.submission?.answer_text || "Belum ada jawaban."}</p>{question.submission && <p className="mt-2 text-xs text-on-surface-variant">Percobaan {question.submission.attempt_no}</p>}</section>
      <section className="mt-5 border-t border-outline-variant/30 pt-5"><h3 className="text-sm font-bold text-on-surface">Jawaban referensi</h3><p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-on-surface">{question.model_answer}</p>{question.indicators.length > 0 && <ul className="mt-3 space-y-1 text-sm text-on-surface-variant">{question.indicators.map((indicator) => <li key={indicator.id}><strong className="text-on-surface">{indicator.order_index}. {indicator.label}</strong> ({Number(indicator.weight) * 100}%) {indicator.description}</li>)}</ul>}</section>
      {question.analysis && <section className="mt-5 rounded-lg border border-outline-variant/40 bg-surface-container-low p-4"><div className="flex gap-3"><BrainCircuit className="mt-0.5 shrink-0 text-primary" size={19} /><div><h3 className="text-sm font-bold text-on-surface">Analisis AI</h3><p className="mt-1 text-sm text-on-surface-variant">Skor {Number(question.analysis.percentage_correct).toFixed(1)}% · {question.analysis.tier_label} · Kepercayaan {(Number(question.analysis.confidence) * 100).toFixed(0)}%</p>{question.analysis.explanation && <p className="mt-2 whitespace-pre-wrap text-sm text-on-surface-variant">{question.analysis.explanation}</p>}{question.analysis.validation && <p className="mt-2 text-sm text-on-surface-variant">Validasi: {question.analysis.validation.status} oleh {question.analysis.validation.lecturer_name}</p>}</div></div></section>}
    </article>)}</div>}
  </PageContainer>;
}
