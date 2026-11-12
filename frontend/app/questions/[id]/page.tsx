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

// Plain-language supervision notes for lecturers. These describe what the
// browser observed in everyday Indonesian; they are never an automatic
// verdict, so the wording stays factual instead of accusatory.
type IntegrityNote = { text: string; tone: "danger" | "warn" | "info" | "ok" };

const integrityNotes = (
  proctor: NonNullable<StudentProgress["proctor"]>,
): IntegrityNote[] => {
  const notes: IntegrityNote[] = [];
  if (proctor.fullscreen_exits > 0)
    notes.push({
      text: `Keluar dari layar penuh ${proctor.fullscreen_exits} kali`,
      tone: "danger",
    });
  if (proctor.second_session)
    notes.push({
      text: "Ujian dibuka di lebih dari satu sesi",
      tone: "danger",
    });
  if (proctor.submitted_via === "NO_DRAFT")
    notes.push({
      text: "Waktu habis tanpa jawaban tersimpan",
      tone: "warn",
    });
  if (proctor.tab_switches > 0)
    notes.push({ text: `Pindah tab ${proctor.tab_switches} kali`, tone: "warn" });
  if (proctor.focus_losses > 0)
    notes.push({
      text: `Berpindah aplikasi ${proctor.focus_losses} kali`,
      tone: "warn",
    });
  if (proctor.copy_paste_attempts > 0)
    notes.push({
      text: `Mencoba menyalin/menempel ${proctor.copy_paste_attempts} kali`,
      tone: "warn",
    });
  if (proctor.multi_monitor)
    notes.push({ text: "Terdeteksi lebih dari satu layar", tone: "warn" });
  if (proctor.vm_signal)
    notes.push({ text: "Terdeteksi mesin virtual", tone: "warn" });
  if (proctor.mobile)
    notes.push({
      text: proctor.reduced_assurance
        ? "Dikerjakan dari ponsel (pengawasan terbatas)"
        : "Dikerjakan dari ponsel",
      tone: "info",
    });
  if (proctor.submitted_via === "AUTO_SERVER")
    notes.push({
      text: "Dikumpulkan otomatis karena waktu habis",
      tone: "info",
    });
  if (notes.length === 0)
    notes.push({ text: "Tidak ada kejadian mencurigakan", tone: "ok" });
  return notes;
};

const integrityBadge = (
  proctor: NonNullable<StudentProgress["proctor"]>,
): { label: string; className: string } => {
  if (proctor.serious_count > 0)
    return { label: "Perlu ditinjau", className: "badge-revoked" };
  if (
    proctor.tab_switches > 0 ||
    proctor.focus_losses > 0 ||
    proctor.copy_paste_attempts > 0 ||
    proctor.multi_monitor ||
    proctor.vm_signal
  )
    return { label: "Ada catatan", className: "badge-review" };
  if (proctor.mobile || proctor.submitted_via === "AUTO_SERVER")
    return { label: "Tercatat", className: "badge-review" };
  return { label: "Aman", className: "badge-active" };
};

const PROCTOR_EVENT_LABEL: Record<string, string> = {
  EXAM_STARTED: "Mulai mengerjakan",
  HEARTBEAT: "Ujian masih terbuka",
  WINDOW_BLUR: "Berpindah ke aplikasi lain",
  WINDOW_FOCUS: "Kembali ke halaman ujian",
  FULLSCREEN_ENTER: "Masuk layar penuh",
  FULLSCREEN_EXIT: "Keluar dari layar penuh",
  TAB_HIDDEN: "Pindah ke tab lain",
  TAB_VISIBLE: "Kembali ke tab ujian",
  COPY_ATTEMPT: "Mencoba menyalin teks",
  PASTE_ATTEMPT: "Mencoba menempel teks",
  CONTEXT_MENU: "Membuka menu klik kanan",
  DEVTOOLS_SHORTCUT: "Membuka alat pengembang browser",
  MULTI_MONITOR: "Terdeteksi lebih dari satu layar",
  VM_SIGNAL: "Terdeteksi mesin virtual",
  AUTOMATION_SIGNAL: "Terdeteksi otomatisasi browser",
  SECOND_SESSION: "Ujian dibuka di sesi lain",
  SESSION_CHANGED: "Sesi berganti (perangkat/tab lain)",
  MOBILE_DEVICE: "Mengerjakan dari ponsel",
  REDUCED_ASSURANCE: "Pengawasan terbatas",
  NETWORK_OFFLINE: "Koneksi terputus",
  NETWORK_ONLINE: "Koneksi kembali",
  PAGE_HIDE: "Halaman ditinggalkan",
  SUBMIT: "Mengumpulkan jawaban",
  AUTO_SUBMITTED_SERVER: "Dikumpulkan otomatis karena waktu habis",
  NO_DRAFT_AT_EXPIRY: "Waktu habis tanpa jawaban tersimpan",
};

type TimelineRow = {
  key: string;
  label: string;
  note: string | null;
  at: string;
  severity: number;
};

// One row per event, in the order it happened — the lecturer sees the student's
// actual session, not counts. Heartbeats are dropped (they are just keep-alives)
// and the raw event code/metadata are translated into everyday Indonesian.
const eventNote = (event: ProctorEventItem): string | null => {
  const meta = event.metadata ?? {};
  if (event.type === "EXAM_STARTED") {
    const device = meta.mobile ? "dari ponsel" : "dari komputer";
    const fullscreen =
      meta.fullscreen === true ? "layar penuh aktif" : "tanpa layar penuh";
    return `${device}, ${fullscreen}`;
  }
  if (event.type === "AUTO_SUBMITTED_SERVER") {
    const count = Number(meta.submitted_count ?? 0);
    return `${count} jawaban terkumpul otomatis`;
  }
  if (event.type === "NO_DRAFT_AT_EXPIRY") {
    return "tidak ada jawaban yang tersimpan sebelum waktu habis";
  }
  if (event.type === "SESSION_CHANGED") {
    const previous = Number(meta.previous_session_count ?? 0);
    return previous > 0 ? `sebelumnya ${previous} sesi aktif` : null;
  }
  return null;
};

const timelineRows = (events: ProctorEventItem[]): TimelineRow[] =>
  events
    .filter((event) => event.type !== "HEARTBEAT")
    .map((event) => ({
      key: event.id,
      label:
        PROCTOR_EVENT_LABEL[event.type] ??
        event.type.replaceAll("_", " ").toLowerCase(),
      note: eventNote(event),
      at: event.occurred_at ?? event.recorded_at,
      severity: event.severity,
    }))
    .sort((a, b) => a.at.localeCompare(b.at));

const closingLabel = (submittedVia: string | null) => {
  if (!submittedVia) return "Belum dikumpulkan";
  if (submittedVia === "AUTO_SERVER") return "Otomatis oleh sistem";
  if (submittedVia === "NO_DRAFT") return "Waktu habis, tanpa jawaban";
  return "Dikumpulkan mahasiswa";
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
            : "Gagal memuat catatan pengawasan.",
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
                        <th className="px-5 py-3">Catatan Pengawasan</th>
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
                            <td className="px-5 py-4 align-top">
                              {student.proctor ? (
                                <div className="max-w-[17rem] space-y-1.5">
                                  <span
                                    className={`badge ${integrityBadge(student.proctor).className}`}
                                  >
                                    <ShieldAlert size={12} className="mr-1 inline" />
                                    {integrityBadge(student.proctor).label}
                                  </span>
                                  <ul className="space-y-0.5 text-[11px] leading-snug text-on-surface-variant">
                                    {integrityNotes(student.proctor)
                                      .slice(0, 3)
                                      .map((note) => (
                                        <li
                                          key={note.text}
                                          className={
                                            note.tone === "danger"
                                              ? "font-semibold text-error"
                                              : note.tone === "warn"
                                                ? "text-amber-600 dark:text-amber-400"
                                                : note.tone === "ok"
                                                  ? "text-emerald-600 dark:text-emerald-400"
                                                  : ""
                                          }
                                        >
                                          {note.text}
                                        </li>
                                      ))}
                                  </ul>
                                  {examPackage && (
                                    <button
                                      type="button"
                                      onClick={() => void openProctor(student)}
                                      className="text-[11px] font-semibold text-primary hover:underline"
                                    >
                                      Lihat rincian
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
                  Catatan pengawasan · {proctorStudent.student_name}
                </h3>
                <p className="mt-1 text-xs text-on-surface-variant">
                  Apa yang terjadi selama ujian. Catatan ini hanya untuk
                  ditinjau — tidak otomatis menggagalkan ujian.
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setProctorStudent(null);
                  setProctorTimeline(null);
                }}
                className="text-on-surface-variant hover:text-on-surface"
                aria-label="Tutup catatan pengawasan"
              >
                <X size={18} />
              </button>
            </div>

            {proctorLoading ? (
              <p className="py-10 text-center text-sm text-on-surface-variant">
                Memuat catatan pengawasan...
              </p>
            ) : proctorTimeline ? (
              <div className="mt-4 min-h-0 space-y-3 overflow-y-auto pr-1">
                <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                  <div className="rounded-lg border border-outline-variant/40 p-2">
                    <p className="text-on-surface-variant">Percobaan</p>
                    <p className="font-mono-ui font-bold">
                      ke-{proctorTimeline.attempt_number}
                    </p>
                  </div>
                  <div className="rounded-lg border border-outline-variant/40 p-2">
                    <p className="text-on-surface-variant">Catatan</p>
                    <p className="font-mono-ui font-bold">
                      {timelineRows(proctorTimeline.events).length}
                    </p>
                  </div>
                  <div className="rounded-lg border border-outline-variant/40 p-2">
                    <p className="text-on-surface-variant">Pengumpulan</p>
                    <p className="font-semibold">
                      {closingLabel(proctorTimeline.submitted_via)}
                    </p>
                  </div>
                  <div className="rounded-lg border border-outline-variant/40 p-2">
                    <p className="text-on-surface-variant">Terakhir aktif</p>
                    <p className="font-semibold">
                      {proctorTimeline.last_seen_at
                        ? new Date(proctorTimeline.last_seen_at).toLocaleString(
                            "id-ID",
                            {
                              day: "2-digit",
                              month: "short",
                              hour: "2-digit",
                              minute: "2-digit",
                            },
                          )
                        : "—"}
                    </p>
                  </div>
                </div>

                {timelineRows(proctorTimeline.events).length === 0 ? (
                  <p className="rounded-lg border border-outline-variant/40 p-4 text-center text-sm text-on-surface-variant">
                    Tidak ada catatan mencurigakan selama ujian.
                  </p>
                ) : (
                  <ol className="space-y-2">
                    {timelineRows(proctorTimeline.events).map((row) => (
                      <li
                        key={row.key}
                        className={`flex flex-wrap items-start justify-between gap-2 rounded-lg border p-3 text-xs ${
                          row.severity >= 3
                            ? "border-error/40 bg-error-container/30"
                            : row.severity === 2
                              ? "border-amber-500/30 bg-amber-500/10"
                              : "border-outline-variant/40"
                        }`}
                      >
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-on-surface">
                            {row.label}
                          </p>
                          {row.note && (
                            <p className="mt-0.5 text-[11px] text-on-surface-variant">
                              {row.note}
                            </p>
                          )}
                        </div>
                        <span className="shrink-0 text-[11px] text-on-surface-variant">
                          {new Date(row.at).toLocaleString("id-ID", {
                            day: "2-digit",
                            month: "short",
                            hour: "2-digit",
                            minute: "2-digit",
                            second: "2-digit",
                          })}
                        </span>
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            ) : (
              <p className="py-10 text-center text-sm text-on-surface-variant">
                Catatan pengawasan tidak tersedia.
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
