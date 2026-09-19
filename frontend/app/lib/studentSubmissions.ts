/** Populated once the AI analysis + lecturer validation pipeline exists (P4/P5/P6). */
export type StudentEvaluation = {
  percentage_correct?: number;
  tier_label?: string;
  explanation?: string;
  suggested_materials?: string[];
};

export type StudentAttempt = {
  submission_id: string;
  attempt_no: number;
  status: string;
  answer_text: string;
  submitted_at: string;
  /** Reserved for P5/P6: score, tier, explanation, suggested materials. */
  evaluation: StudentEvaluation | null;
};

export type StudentQuestionGroup = {
  question_id: string;
  order_index: number;
  version_id: string;
  version_number: number;
  prompt: string;
  answered: boolean;
  attempts: StudentAttempt[];
};

export type StudentSetGroup = {
  set_id: string;
  code: string;
  title: string;
  subject_id: string;
  subject_name: string;
  question_count: number;
  answered_count: number;
  total_attempts: number;
  max_attempt_no: number;
  status_summary: string;
  status_counts: Record<string, number>;
  last_submitted_at: string;
  questions: StudentQuestionGroup[];
};

export type StatusMeta = { label: string; cls: string; hint: string };

export const STATUS_META: Record<string, StatusMeta> = {
  SUBMITTED: {
    label: "Jawaban diterima",
    cls: "badge-review",
    hint: "Jawaban tersimpan dan menunggu analisis dosen pengampu.",
  },
  ANALYZING: {
    label: "Sedang dianalisis",
    cls: "badge-draft",
    hint: "Sistem sedang menganalisis jawaban Anda.",
  },
  ANALYSIS_FAILED: {
    label: "Analisis gagal",
    cls: "badge-revoked",
    hint: "Analisis gagal diproses; jawaban Anda tetap tersimpan.",
  },
  PENDING_VALIDATION: {
    label: "Menunggu validasi dosen",
    cls: "badge-draft",
    hint: "Analisis menunggu peninjauan dan validasi dosen.",
  },
  VALIDATED: {
    label: "Tervalidasi",
    cls: "badge-active",
    hint: "Hasil analisis sudah divalidasi dosen.",
  },
  REJECTED: {
    label: "Perlu analisis ulang",
    cls: "badge-revoked",
    hint: "Dosen menolak hasil analisis; jawaban akan dianalisis ulang.",
  },
};

const SHORT_LABEL: Record<string, string> = {
  SUBMITTED: "menunggu analisis",
  ANALYZING: "sedang dianalisis",
  ANALYSIS_FAILED: "analisis gagal",
  PENDING_VALIDATION: "menunggu validasi",
  VALIDATED: "tervalidasi",
  REJECTED: "perlu analisis ulang",
};

/** Order used to pick the headline state when a set holds several states. */
const PRIORITY = [
  "ANALYSIS_FAILED",
  "REJECTED",
  "PENDING_VALIDATION",
  "SUBMITTED",
  "ANALYZING",
  "VALIDATED",
];

export const statusMeta = (status: string): StatusMeta =>
  STATUS_META[status] ?? { label: status, cls: "badge-role", hint: "" };

export const fmtDate = (value: string) => {
  try {
    return new Date(value).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" });
  } catch {
    return value;
  }
};

/** Aggregate badge for a whole question set: uniform state, or "Sebagian …". */
export function summarizeSetStatus(
  statusSummary: string,
  counts: Record<string, number>,
): { label: string; cls: string; detail: string } {
  const entries = Object.entries(counts ?? {});
  const detail = entries
    .map(([status, count]) => `${count} ${SHORT_LABEL[status] ?? status}`)
    .join(" · ");

  if (statusSummary !== "MIXED") {
    const meta = statusMeta(statusSummary);
    return { label: meta.label, cls: meta.cls, detail };
  }

  const present = PRIORITY.filter((status) => (counts ?? {})[status] > 0);
  const headline = present[0] ?? entries[0]?.[0] ?? "SUBMITTED";
  const meta = statusMeta(headline);
  const noun = meta.label.toLowerCase().replace(/^perlu /, "");
  return { label: `Sebagian ${noun}`, cls: meta.cls, detail };
}