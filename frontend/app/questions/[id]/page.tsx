"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  ClipboardList,
  GraduationCap,
} from "lucide-react";

import { useAuth } from "../../components/AuthProvider";
import PageHeader from "../../components/PageHeader";
import PageContainer from "../../components/PageContainer";
import { apiFetch } from "../../lib/api";
import FeedbackModal from "../../components/FeedbackModal";

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
const STUDENTS_PER_PAGE = 10;

const VALIDATION_TABS: { id: ValidationTabId; label: string }[] = [
  { id: "PENDING", label: "Belum Divalidasi" },
  { id: "VALIDATED", label: "Sudah Validasi" },
  { id: "ALL", label: "Semua" },
];

function resolveValidationState(
  student: StudentProgress,
): "PENDING" | "VALIDATED" {
  if (student.validation_state) return student.validation_state;
  const submissions = student.all_submissions;
  if (!submissions.length) return "PENDING";
  return submissions.every(
    (submission) => submission.validation_status === "VALIDATED",
  )
    ? "VALIDATED"
    : "PENDING";
}

function resolvePackageStatus(student: StudentProgress): string {
  const statuses = student.all_submissions.map(
    (submission) => submission.status,
  );
  if (resolveValidationState(student) === "VALIDATED") return "VALIDATED";
  if (statuses.includes("PENDING_VALIDATION")) return "PENDING_VALIDATION";
  if (statuses.includes("ANALYZING")) return "ANALYZING";
  if (statuses.includes("SUBMITTED")) return "SUBMITTED";
  if (statuses.includes("ANALYSIS_FAILED")) return "ANALYSIS_FAILED";
  return statuses[0] ?? "SUBMITTED";
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

export default function QuestionSetReviewPage({
  examPackage = false,
}: {
  examPackage?: boolean;
}) {
  const { user, loading } = useAuth();
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const setId = params?.id;
  const [data, setData] = useState<QuestionSetReview | null>(null);
  const [fetching, setFetching] = useState(true);
  const [error, setError] = useState("");
  const [activeTab, setActiveTab] = useState<ValidationTabId>("PENDING");
  const [page, setPage] = useState(1);

  const load = useCallback(async () => {
    if (!setId) return;
    setFetching(true);
    setError("");
    try {
      setData(
        await apiFetch<QuestionSetReview>(
          `/${examPackage ? "exam-packages" : "questions"}/${setId}/review`,
        ),
      );
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Gagal memuat progres mahasiswa.",
      );
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
  const pendingStudents = students.filter(
    (student) => resolveValidationState(student) === "PENDING",
  );
  const validatedStudents = students.filter(
    (student) => resolveValidationState(student) === "VALIDATED",
  );
  const visibleStudents =
    activeTab === "PENDING"
      ? pendingStudents
      : activeTab === "VALIDATED"
        ? validatedStudents
        : students;
  const tabCount: Record<ValidationTabId, number> = {
    PENDING: pendingStudents.length,
    VALIDATED: validatedStudents.length,
    ALL: students.length,
  };
  const totalPages = Math.max(
    1,
    Math.ceil(visibleStudents.length / STUDENTS_PER_PAGE),
  );
  const safePage = Math.min(page, totalPages);
  const pageStudents = visibleStudents.slice(
    (safePage - 1) * STUDENTS_PER_PAGE,
    safePage * STUDENTS_PER_PAGE,
  );

  return (
    <PageContainer>
      <Link
        href={data ? `/admin/subjects/${data.subject_id}` : "/admin/subjects"}
        className="inline-flex items-center gap-2 text-sm font-semibold text-primary no-underline hover:underline"
      >
        <ArrowLeft size={16} /> Kembali ke mata kuliah
      </Link>

      {data && (
        <PageHeader
          className="mt-4"
          title={data.title}
          description={
            data.description ||
            "Pantau jawaban dan hasil analisis mahasiswa pada paket ini."
          }
          icon={ClipboardList}
          eyebrow={
            <span className="inline-flex items-center gap-2 rounded-full border border-primary-fixed-dim bg-primary-fixed/60 px-3 py-1 text-xs font-bold uppercase tracking-wider text-primary">
              <GraduationCap size={14} /> Progres Mahasiswa
            </span>
          }
          action={
            <div className="rounded-lg border border-outline-variant/40 bg-surface-container-low px-4 py-3 text-right text-xs text-on-surface-variant">
              <div className="font-mono-ui font-bold text-primary">
                {data.code}
              </div>
              <div>
                {data.subject_name} · {data.published_question_count} soal
                terbit
              </div>
            </div>
          }
        />
      )}

      {fetching ? (
        <p className="mt-8 text-sm text-on-surface-variant">
          Memuat progres mahasiswa...
        </p>
      ) : (
        data && (
          <div className="mt-8 space-y-4">
            <div className="flex border-b border-outline-variant/40">
              {VALIDATION_TABS.map((tab) => {
                const active = activeTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => {
                      setActiveTab(tab.id);
                      setPage(1);
                    }}
                    aria-pressed={active}
                    className={`inline-flex cursor-pointer items-center justify-center gap-2 border-b-2 px-5 py-3 text-sm font-semibold transition-colors ${active ? "border-primary text-primary" : "border-transparent text-on-surface-variant hover:text-on-surface"}`}
                  >
                    {tab.label}
                    <span
                      className={`inline-flex min-w-5 items-center justify-center rounded-full px-1.5 py-0.5 text-[11px] font-bold ${active ? "bg-primary/10 text-primary" : "bg-surface-container text-on-surface-variant"}`}
                    >
                      {tabCount[tab.id]}
                    </span>
                  </button>
                );
              })}
            </div>

            {data.unsubmitted_roster_available === false && (
              <p className="text-xs text-on-surface-variant">
                Menampilkan mahasiswa yang sudah mengumpulkan jawaban. Mahasiswa
                yang belum mengumpulkan akan muncul setelah data roster paket
                tersedia.
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
            ) : (
              <section className="overflow-hidden rounded-xl border border-outline-variant/40 bg-surface-container-lowest">
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[760px] text-left text-sm">
                    <thead className="bg-surface-container-low text-xs font-semibold uppercase text-on-surface-variant">
                      <tr>
                        <th className="px-5 py-3">Mahasiswa</th>
                        <th className="px-5 py-3">Jawaban</th>
                        <th className="px-5 py-3">Status</th>
                        <th className="px-5 py-3">Percobaan</th>
                        <th className="px-5 py-3 text-right">Aksi</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-outline-variant/30">
                      {pageStudents.map((student) => {
                        const packageStatus = resolvePackageStatus(student);
                        const statusMeta = STATUS_META[packageStatus] ?? {
                          label: packageStatus,
                          badge: "badge-role",
                        };
                        return (
                          <tr
                            key={student.student_id}
                            className="transition-colors hover:bg-surface-container-low"
                          >
                            <td className="px-5 py-4">
                              <p className="font-semibold text-on-surface">
                                {student.student_name}
                              </p>
                              <p className="mt-1 text-xs text-on-surface-variant">
                                {student.student_email}
                              </p>
                            </td>
                            <td className="px-5 py-4 font-mono-ui text-on-surface">
                              {student.answered_count}/
                              {student.published_question_count}
                            </td>
                            <td className="px-5 py-4">
                              <span className={`badge ${statusMeta.badge}`}>
                                {statusMeta.label}
                              </span>
                            </td>
                            <td className="px-5 py-4">
                              <span className="badge badge-role font-mono-ui">
                                {student.total_attempts_count}
                              </span>
                            </td>
                            <td className="px-5 py-4 text-right">
                              <Link
                                href={`/${examPackage ? "exam-packages" : "questions"}/${setId}/students/${student.student_id}`}
                                className="btn-primary inline-flex !px-3 !py-2 text-xs font-semibold"
                              >
                                Tinjau <ArrowRight size={15} />
                              </Link>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-outline-variant/30 px-5 py-3">
                  <span className="text-xs text-on-surface-variant">
                    Halaman {safePage}/{totalPages} · menampilkan{" "}
                    {pageStudents.length} dari {visibleStudents.length}{" "}
                    mahasiswa
                  </span>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      disabled={safePage <= 1}
                      onClick={() => setPage(safePage - 1)}
                      className="btn-secondary !px-3 !py-1.5 text-xs disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      Sebelumnya
                    </button>
                    <button
                      type="button"
                      disabled={safePage >= totalPages}
                      onClick={() => setPage(safePage + 1)}
                      className="btn-secondary !px-3 !py-1.5 text-xs disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      Berikutnya
                    </button>
                  </div>
                </div>
              </section>
            )}
          </div>
        )
      )}
      <FeedbackModal
        open={!!error}
        message={error}
        onClose={() => setError("")}
      />
    </PageContainer>
  );
}
