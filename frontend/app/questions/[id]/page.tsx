"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, ClipboardList, GraduationCap, TriangleAlert } from "lucide-react";

import { useAuth } from "../../components/AuthProvider";
import PageHeader from "../../components/PageHeader";
import PageContainer from "../../components/PageContainer";
import { apiFetch } from "../../lib/api";

type StudentSubmissionItem = {
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
  total_attempts_count: number;
  all_submissions: StudentSubmissionItem[];
  validation_state?: "PENDING" | "VALIDATED";
  roster_member?: boolean;
};

type QuestionSetReview = {
  id: string;
  code: string;
  title: string;
  description: string;
  subject_id: string;
  subject_name: string;
  is_active: boolean;
  published_question_count: number;
  roster_scope?: string;
  unsubmitted_roster_available?: boolean;
  students: StudentProgress[];
};

type ValidationTabId = "PENDING" | "VALIDATED" | "ALL";

const VALIDATION_TABS: { id: ValidationTabId; label: string }[] = [
  { id: "PENDING", label: "Belum Divalidasi" },
  { id: "VALIDATED", label: "Sudah Validasi" },
  { id: "ALL", label: "Semua" },
];

function resolveValidationState(student: StudentProgress): "PENDING" | "VALIDATED" {
  if (student.validation_state) return student.validation_state;
  const submissions = student.all_submissions;
  if (!submissions.length) return "PENDING";
  return submissions.every((submission) => submission.validation_status === "VALIDATED") ? "VALIDATED" : "PENDING";
}

function isRosterMember(student: StudentProgress): boolean {
  return student.roster_member ?? true;
}

const STATUS_META: Record<string, { label: string; badge: string }> = {
  SUBMITTED: { label: "Dikirim", badge: "badge-draft" },
  ANALYZING: { label: "Menganalisis", badge: "badge-review" },
  ANALYSIS_FAILED: { label: "Analisis gagal", badge: "badge-revoked" },
  PENDING_VALIDATION: { label: "Menunggu validasi", badge: "badge-review" },
  VALIDATED: { label: "Tervalidasi", badge: "badge-active" },
  REJECTED: { label: "Ditolak", badge: "badge-revoked" },
};

export default function QuestionSetReviewPage({ examPackage = false }: { examPackage?: boolean }) {
  const { user, loading } = useAuth();
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const setId = params?.id;
  const [data, setData] = useState<QuestionSetReview | null>(null);
  const [fetching, setFetching] = useState(true);
  const [error, setError] = useState("");
  const [activeTab, setActiveTab] = useState<ValidationTabId>("PENDING");

  const load = useCallback(async () => {
    if (!setId) return;
    setFetching(true);
    setError("");
    try {
      setData(await apiFetch<QuestionSetReview>(`/${examPackage ? "exam-packages" : "questions"}/${setId}/review`));
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

  const students = (data?.students ?? []).filter(isRosterMember);
  const pendingStudents = students.filter((student) => resolveValidationState(student) === "PENDING");
  const validatedStudents = students.filter((student) => resolveValidationState(student) === "VALIDATED");
  const visibleStudents =
    activeTab === "PENDING" ? pendingStudents : activeTab === "VALIDATED" ? validatedStudents : students;
  const tabCount: Record<ValidationTabId, number> = {
    PENDING: pendingStudents.length,
    VALIDATED: validatedStudents.length,
    ALL: students.length,
  };

  return (
    <PageContainer>
      <Link href={data ? `/admin/subjects/${data.subject_id}` : "/admin/subjects"} className="inline-flex items-center gap-2 text-sm font-semibold text-primary no-underline hover:underline">
        <ArrowLeft size={16} /> Kembali ke mata kuliah
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
          <div className="flex flex-wrap items-center gap-1.5 rounded-xl border border-outline-variant/40 bg-surface-container-lowest p-1.5">
            {VALIDATION_TABS.map((tab) => {
              const active = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  aria-pressed={active}
                  className={`inline-flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition-colors sm:flex-none ${active ? "bg-primary text-white shadow-sm" : "text-on-surface-variant hover:bg-surface-container hover:text-on-surface"}`}
                >
                  {tab.label}
                  <span className={`inline-flex min-w-5 items-center justify-center rounded-full px-1.5 py-0.5 text-[11px] font-bold ${active ? "bg-white/20 text-white" : "bg-surface-container text-on-surface-variant"}`}>
                    {tabCount[tab.id]}
                  </span>
                </button>
              );
            })}
          </div>

          {data.unsubmitted_roster_available === false && (
            <p className="text-xs text-on-surface-variant">
              Menampilkan mahasiswa yang sudah mengumpulkan jawaban. Mahasiswa yang belum mengumpulkan akan muncul setelah data roster paket tersedia.
            </p>
          )}

          {visibleStudents.length === 0 ? (
            <div className="glass-panel rounded-xl border border-outline-variant/40 p-8 text-center text-sm text-on-surface-variant">
              {students.length === 0
                ? "Belum ada mahasiswa yang mengumpulkan respons untuk paket ujian ini."
                : activeTab === "PENDING"
                  ? "Tidak ada mahasiswa yang perlu divalidasi."
                  : activeTab === "VALIDATED"
                    ? "Belum ada mahasiswa yang tervalidasi."
                    : "Tidak ada mahasiswa pada paket ini."}
            </div>
          ) : visibleStudents.map((student) => {
            const counts = student.all_submissions.reduce<Record<string, number>>((acc, sub) => {
              acc[sub.status] = (acc[sub.status] ?? 0) + 1;
              return acc;
            }, {});

            return (
              <article key={student.student_id} className="glass-card rounded-xl p-5">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <h2 className="font-display text-lg font-bold text-on-surface">{student.student_name}</h2>
                    <p className="mt-1 text-sm text-on-surface-variant">{student.student_email}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="badge badge-active">
                      Terjawab {student.answered_count} / {student.published_question_count} Soal
                    </span>
                    <span className="badge badge-role font-mono-ui">
                      {student.total_attempts_count} Percobaan Total
                    </span>
                  </div>
                </div>

                <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-t border-outline-variant/20 pt-4">
                  <div className="flex flex-wrap gap-2">
                    {Object.entries(counts).map(([status, count]) => {
                      const meta = STATUS_META[status] ?? { label: status, badge: "badge-role" };
                      return (
                        <span key={status} className={`badge ${meta.badge}`}>
                          {count} {meta.label}
                        </span>
                      );
                    })}
                  </div>

                  <Link href={`/${examPackage ? "exam-packages" : "questions"}/${setId}/students/${student.student_id}`} className="btn-primary !py-2 !px-4 text-xs font-semibold inline-flex items-center gap-1.5 shadow-sm">
                    Tinjau &amp; Validasi Jawaban <ArrowRight size={15} />
                  </Link>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </PageContainer>
  );
}
