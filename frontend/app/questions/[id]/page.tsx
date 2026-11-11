"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowRight,
  ClipboardList,
  GraduationCap,
  ShieldAlert,
  X,
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
  proctor?: {
    serious_count: number;
    tab_switches: number;
    focus_losses: number;
    fullscreen_exits: number;
    copy_paste_attempts: number;
    multi_monitor: boolean;
    vm_signal: boolean;
    second_session: boolean;
    mobile: boolean;
    reduced_assurance: boolean;
    session_count: number;
    last_seen_at: string | null;
    submitted_via: string | null;
  } | null;
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

type ProctorEventItem = {
  id: string;
  type: string;
  severity: number;
  occurred_at: string | null;
  recorded_at: string;
  metadata: Record<string, unknown>;
};

type ProctorTimeline = {
  attempt_id: string;
  attempt_number: number;
  submitted_at: string | null;
  submitted_via: string | null;
  last_seen_at: string | null;
  events: ProctorEventItem[];
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
  if (
    !submissions.length ||
    student.answered_count < student.published_question_count
  ) {
    return "PENDING";
  }

  const latestByQuestion = new Map<string, StudentSubmissionItem>();
  for (const submission of submissions) {
    const latest = latestByQuestion.get(submission.question_id);
    if (!latest || submission.attempt_no > latest.attempt_no) {
      latestByQuestion.set(submission.question_id, submission);
    }
  }

  const validatedStatuses = new Set(["ACCEPTED", "EDITED", "VALIDATED"]);
  return latestByQuestion.size === student.published_question_count &&
    [...latestByQuestion.values()].every((submission) =>
      validatedStatuses.has(submission.validation_status ?? ""),
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
  const [proctorStudent, setProctorStudent] = useState<StudentProgress | null>(null);
  const [proctorTimeline, setProctorTimeline] = useState<ProctorTimeline | null>(null);
  const [proctorLoading, setProctorLoading] = useState(false);

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

  const openProctor = useCallback(
    async (student: StudentProgress) => {
      if (!examPackage || !setId) return;
      setProctorStudent(student);
      setProctorTimeline(null);
      setProctorLoading(true);
      try {
        setProctorTimeline(
          await apiFetch<ProctorTimeline>(
            `/exam-packages/${setId}/students/${student.student_id}/proctor`,
          ),
        );
      } catch (caught) {
        setError(
          caught instanceof Error
            ? caught.message
            : "Gagal memuat jejak integritas.",
        );
      } finally {
        setProctorLoading(false);
      }
    },
    [examPackage, setId],
  );

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
      {data && (
        <PageHeader
          className="mb-4"
          title={data.title}
          description={
            data.description ||
            "Pantau jawaban dan hasil analisis mahasiswa pada paket ini."
          }
          icon={ClipboardList}
          eyebrow={
            <span className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-primary">
              <GraduationCap size={14} /> Progres Mahasiswa
            </span>
          }
          action={
            <div className="inline-flex flex-wrap items-center justify-end gap-x-2 gap-y-1 rounded-lg border border-outline-variant/40 bg-surface-container-low px-3 py-2 text-xs text-on-surface-variant">
              <span className="font-mono-ui font-bold text-primary">
                {data.code}
              </span>
              <span aria-hidden="true">•</span>
              <span>{data.subject_name}</span>
              <span>{data.published_question_count} soal terbit</span>
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
          <div className="mt-4 space-y-4">
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
                  <table className="w-full min-w-[920px] text-left text-sm">
                    <thead className="bg-surface-container-low text-xs font-semibold uppercase text-on-surface-variant">
                      <tr>
                        <th className="px-5 py-3">Mahasiswa</th>
                        <th className="px-5 py-3">Jawaban</th>
                        <th className="px-5 py-3">Status</th>
                        <th className="px-5 py-3">Integritas</th>
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
                              {student.proctor ? (
                                <div className="space-y-1">
                                  <span
                                    className={`badge ${
                                      student.proctor.serious_count > 0
                                        ? "badge-revoked"
                                        : student.proctor.multi_monitor ||
                                            student.proctor.vm_signal ||
                                            student.proctor.second_session
                                          ? "badge-review"
                                          : "badge-active"
                                    }`}
                                  >
                                    <ShieldAlert size={12} className="mr-1 inline" />
                                    {student.proctor.serious_count > 0
                                      ? `${student.proctor.serious_count} sinyal`
                                      : "Tercatat"}
                                  </span>
                                  <p className="text-[11px] text-on-surface-variant">
                                    {student.proctor.tab_switches} tab ·{" "}
                                    {student.proctor.fullscreen_exits} layar ·{" "}
                                    {student.proctor.copy_paste_attempts} salin/tempel
                                  </p>
                                  {student.proctor.submitted_via === "NO_DRAFT" && (
                                    <p className="text-[11px] font-semibold text-amber-600 dark:text-amber-400">
                                      Tanpa draf tersinkron
                                    </p>
                                  )}
                                  {student.proctor.mobile && (
                                    <p className="text-[11px] text-on-surface-variant">
                                      Ponsel
                                      {student.proctor.reduced_assurance
                                        ? " · assurance terbatas"
                                        : ""}
                                    </p>
                                  )}
                                  {examPackage && (
                                    <button
                                      type="button"
                                      onClick={() => void openProctor(student)}
                                      className="text-[11px] font-semibold text-primary hover:underline"
                                    >
                                      Lihat jejak
                                    </button>
                                  )}
                                </div>
                              ) : (
                                <span className="badge badge-role">—</span>
                              )}
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
      {proctorStudent && (
        <div
          className="fixed inset-0 z-[400] flex items-center justify-center bg-black/60 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="proctor-timeline-title"
        >
          <div className="flex max-h-[85vh] w-full max-w-2xl flex-col rounded-2xl border border-outline-variant/50 bg-surface-container-lowest p-5 shadow-2xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3
                  id="proctor-timeline-title"
                  className="font-display text-base font-bold text-on-surface"
                >
                  Jejak Integritas · {proctorStudent.student_name}
                </h3>
                <p className="mt-1 text-xs text-on-surface-variant">
                  Sinyal browser dicatat sebagai bukti untuk ditinjau, bukan
                  keputusan otomatis.
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setProctorStudent(null);
                  setProctorTimeline(null);
                }}
                className="text-on-surface-variant hover:text-on-surface"
                aria-label="Tutup jejak integritas"
              >
                <X size={18} />
              </button>
            </div>

            {proctorLoading ? (
              <p className="py-10 text-center text-sm text-on-surface-variant">
                Memuat jejak integritas...
              </p>
            ) : proctorTimeline ? (
              <div className="mt-4 min-h-0 space-y-3 overflow-y-auto pr-1">
                <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                  <div className="rounded-lg border border-outline-variant/40 p-2">
                    <p className="text-on-surface-variant">Percobaan</p>
                    <p className="font-mono-ui font-bold">
                      {proctorTimeline.attempt_number}
                    </p>
                  </div>
                  <div className="rounded-lg border border-outline-variant/40 p-2">
                    <p className="text-on-surface-variant">Event</p>
                    <p className="font-mono-ui font-bold">
                      {proctorTimeline.events.length}
                    </p>
                  </div>
                  <div className="rounded-lg border border-outline-variant/40 p-2">
                    <p className="text-on-surface-variant">Ditutup via</p>
                    <p className="font-mono-ui font-bold">
                      {proctorTimeline.submitted_via ?? "—"}
                    </p>
                  </div>
                  <div className="rounded-lg border border-outline-variant/40 p-2">
                    <p className="text-on-surface-variant">Terakhir aktif</p>
                    <p className="font-mono-ui font-bold">
                      {proctorTimeline.last_seen_at
                        ? new Date(proctorTimeline.last_seen_at).toLocaleString(
                            "id-ID",
                          )
                        : "—"}
                    </p>
                  </div>
                </div>

                {proctorTimeline.events.length === 0 ? (
                  <p className="rounded-lg border border-outline-variant/40 p-4 text-center text-sm text-on-surface-variant">
                    Belum ada sinyal proctoring untuk percobaan ini.
                  </p>
                ) : (
                  <ol className="space-y-2">
                    {proctorTimeline.events.map((event) => (
                      <li
                        key={event.id}
                        className={`rounded-lg border p-3 text-xs ${
                          event.severity >= 3
                            ? "border-error/40 bg-error-container/30"
                            : event.severity === 2
                              ? "border-amber-500/30 bg-amber-500/10"
                              : "border-outline-variant/40"
                        }`}
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="font-mono-ui font-bold text-on-surface">
                            {event.type.replaceAll("_", " ")}
                          </span>
                          <span className="text-on-surface-variant">
                            {new Date(event.recorded_at).toLocaleString("id-ID")}
                          </span>
                        </div>
                        {Object.keys(event.metadata).length > 0 && (
                          <p className="mt-1 break-words font-mono-ui text-[11px] text-on-surface-variant">
                            {JSON.stringify(event.metadata).slice(0, 240)}
                          </p>
                        )}
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            ) : (
              <p className="py-10 text-center text-sm text-on-surface-variant">
                Jejak integritas tidak tersedia.
              </p>
            )}
          </div>
        </div>
      )}

      <FeedbackModal
        open={!!error}
        message={error}
        onClose={() => setError("")}
      />
    </PageContainer>
  );
}
