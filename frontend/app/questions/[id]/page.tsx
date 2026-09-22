"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, ClipboardList, GraduationCap, TriangleAlert } from "lucide-react";

import { useAuth } from "../../components/AuthProvider";
import PageHeader from "../../components/PageHeader";
import { apiFetch } from "../../lib/api";

type LatestSubmission = {
  question_id: string;
  order_index: number;
  question_prompt_preview: string;
  submission_id: string;
  attempt_no: number;
  status: string;
  submitted_at: string;
  analysis_id: string | null;
  validation_status: string | null;
};

type StudentProgress = {
  student_id: string;
  student_name: string;
  student_email: string;
  answered_count: number;
  published_question_count: number;
  latest_submissions: LatestSubmission[];
};

type QuestionSetReview = {
  id: string;
  code: string;
  title: string;
  description: string;
  subject_name: string;
  is_active: boolean;
  published_question_count: number;
  students: StudentProgress[];
};

const STATUS_META: Record<string, { label: string; badge: string }> = {
  SUBMITTED: { label: "Dikirim", badge: "badge-draft" },
  ANALYZING: { label: "Menganalisis", badge: "badge-review" },
  ANALYSIS_FAILED: { label: "Analisis gagal", badge: "badge-revoked" },
  PENDING_VALIDATION: { label: "Menunggu validasi", badge: "badge-review" },
  VALIDATED: { label: "Tervalidasi", badge: "badge-active" },
  REJECTED: { label: "Ditolak", badge: "badge-revoked" },
};

export default function QuestionSetReviewPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const setId = params?.id;
  const [data, setData] = useState<QuestionSetReview | null>(null);
  const [fetching, setFetching] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!setId) return;
    setFetching(true);
    setError("");
    try {
      setData(await apiFetch<QuestionSetReview>(`/questions/${setId}/review`));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Gagal memuat progres mahasiswa.");
    } finally {
      setFetching(false);
    }
  }, [setId]);

  useEffect(() => {
    if (loading) return;
    if (!user) {
      router.replace("/login");
      return;
    }
    void load();
  }, [loading, user, router, load]);

  if (loading || !user) return null;

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
      <Link href="/questions" className="inline-flex items-center gap-2 text-sm font-semibold text-primary no-underline hover:underline">
        <ArrowLeft size={16} /> Kembali ke paket ujian
      </Link>

      {data && (
        <PageHeader
          className="mt-4"
          title={data.title}
          description={data.description || "Pantau jawaban dan hasil analisis mahasiswa pada paket ini."}
          icon={ClipboardList}
          eyebrow={<span className="inline-flex items-center gap-2 rounded-full border border-primary-fixed-dim bg-primary-fixed/60 px-3 py-1 text-xs font-bold uppercase tracking-wider text-primary"><GraduationCap size={14} /> Progres Mahasiswa</span>}
          action={<div className="rounded-lg border border-outline-variant/40 bg-surface-container-low px-4 py-3 text-right text-xs text-on-surface-variant"><div className="font-mono-ui font-bold text-primary">{data.code}</div><div>{data.subject_name} · {data.published_question_count} soal terbit</div></div>}
        />
      )}

      {error && <div role="alert" className="mt-6 flex items-center gap-3 rounded-lg border border-error/40 bg-error-container p-4 text-sm text-on-error-container"><TriangleAlert size={20} />{error}</div>}
      {fetching ? <p className="mt-8 text-sm text-on-surface-variant">Memuat progres mahasiswa...</p> : data && (
        <div className="mt-8 space-y-4">
          {data.students.length === 0 ? (
            <div className="glass-panel rounded-xl border border-outline-variant/40 p-8 text-center text-sm text-on-surface-variant">Belum ada mahasiswa yang terdaftar pada mata kuliah ini.</div>
          ) : data.students.map((student) => (
            <article key={student.student_id} className="glass-card rounded-xl p-5">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div><h2 className="font-display text-lg font-bold text-on-surface">{student.student_name}</h2><p className="mt-1 text-sm text-on-surface-variant">{student.student_email}</p></div>
                <span className={`badge ${student.answered_count === student.published_question_count && student.published_question_count > 0 ? "badge-active" : "badge-draft"}`}>Terjawab {student.answered_count} / {student.published_question_count}</span>
              </div>
              <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                {student.latest_submissions.length === 0 ? <p className="text-sm text-on-surface-variant">Belum ada jawaban dikumpulkan.</p> : <div className="flex flex-wrap gap-2">{Object.entries(student.latest_submissions.reduce<Record<string, number>>((counts, submission) => ({ ...counts, [submission.status]: (counts[submission.status] ?? 0) + 1 }), {})).map(([status, count]) => { const meta = STATUS_META[status] ?? { label: status, badge: "badge-role" }; return <span key={status} className={`badge ${meta.badge}`}>{count} {meta.label}</span>; })}</div>}
                {student.answered_count > 0 && <Link href={`/questions/${setId}/students/${student.student_id}`} className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-white no-underline">Review paket <ArrowRight size={15} /></Link>}
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
