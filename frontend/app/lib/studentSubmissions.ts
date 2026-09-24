export type RubricIndicatorResult = {
  order_index: number;
  label: string;
  description: string;
  max_weight_percent: number;
  earned_points_percent: number;
  status: "PRESENT" | "PARTIAL" | "MISSING";
  evidence?: string;
};

export type ConfirmedMisconception = {
  label: string;
  reasoning: string;
};

export type StudentEvaluation = {
  percentage_correct: number;
  is_score_modified: boolean;
  original_ai_score?: number;
  tier_level: number;
  tier_label: string;
  clinical_feedback: string;
  confirmed_misconceptions: ConfirmedMisconception[];
  rubric_breakdown: RubricIndicatorResult[];
  suggested_materials?: string[];
  validator_name?: string;
  validated_at?: string;
};

export type StudentAttempt = {
  submission_id: string;
  attempt_no: number;
  status: string;
  answer_text: string;
  submitted_at: string;
  evaluation: StudentEvaluation | null;
};

export type StudentQuestionGroup = {
  question_id: string;
  order_index: number;
  version_id: string;
  version_number: number;
  prompt: string;
  model_answer: string;
  answered: boolean;
  attempts: StudentAttempt[];
};

export type StudentSetGroup = {
  set_id: string;
  code: string;
  title: string;
  subject_id: string;
  subject_name: string;
  topic_id?: string | null;
  topic_name?: string | null;
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

/**
 * Goal 3: Consistent, compact status badges for individual submissions
 */
export const STATUS_META: Record<string, StatusMeta> = {
  SUBMITTED: {
    label: "Tersimpan",
    cls: "badge-review",
    hint: "Jawaban tersimpan dan menunggu antrean analisis sistem.",
  },
  ANALYZING: {
    label: "Dianalisis AI",
    cls: "badge-draft",
    hint: "Model AI sedang menganalisis penalaran konseptual jawaban Anda.",
  },
  ANALYSIS_FAILED: {
    label: "Perlu Analisis Ulang",
    cls: "badge-revoked",
    hint: "Analisis otomatis mengalami kendala dan dijadwalkan ulang oleh sistem.",
  },
  PENDING_VALIDATION: {
    label: "Menunggu Dosen",
    cls: "badge-draft",
    hint: "Analisis selesai dan sedang menunggu verifikasi akademik dosen.",
  },
  VALIDATED: {
    label: "Tervalidasi",
    cls: "badge-active",
    hint: "Hasil evaluasi telah ditinjau dan disetujui oleh dosen pengampu.",
  },
  REJECTED: {
    label: "Perlu Analisis Ulang",
    cls: "badge-revoked",
    hint: "Dosen meminta sistem menganalisis ulang jawaban dengan catatan khusus.",
  },
};

export const SHORT_LABEL: Record<string, string> = {
  SUBMITTED: "tersimpan",
  ANALYZING: "dianalisis",
  ANALYSIS_FAILED: "analisis ulang",
  PENDING_VALIDATION: "menunggu dosen",
  VALIDATED: "tervalidasi",
  REJECTED: "analisis ulang",
};

export const PRIORITY = [
  "ANALYSIS_FAILED",
  "REJECTED",
  "PENDING_VALIDATION",
  "SUBMITTED",
  "ANALYZING",
  "VALIDATED",
];

export const statusMeta = (status: string): StatusMeta =>
  STATUS_META[status] ?? { label: status, cls: "badge-role", hint: "" };

export type SemanticStatus = {
  badgeLabel: string;
  badgeClass: string;
  description: string;
};

export function getSemanticStatus(status: string): SemanticStatus {
  switch (status) {
    case "SUBMITTED":
      return {
        badgeLabel: "Submission: Received",
        badgeClass: "border-blue-500/40 bg-blue-500/10 text-blue-400",
        description: "Jawaban telah berhasil diterima sistem dan berada di antrean penilaian.",
      };
    case "ANALYZING":
      return {
        badgeLabel: "AI: Analyzing",
        badgeClass: "border-amber-500/40 bg-amber-500/10 text-amber-400",
        description: "Model AI sedang mengidentifikasi indikator konsep dan pola penalaran.",
      };
    case "ANALYSIS_FAILED":
      return {
        badgeLabel: "AI: Analysis Retrying",
        badgeClass: "border-rose-500/40 bg-rose-500/10 text-rose-400",
        description: "Analisis otomatis mengalami kendala dan telah dijadwalkan ulang oleh sistem.",
      };
    case "PENDING_VALIDATION":
      return {
        badgeLabel: "Review: Pending Lecturer",
        badgeClass: "border-purple-500/40 bg-purple-500/10 text-purple-400",
        description: "Analisis awal selesai dan sedang menunggu verifikasi akademik oleh dosen pengampu.",
      };
    case "VALIDATED":
      return {
        badgeLabel: "Review: Validated by Lecturer",
        badgeClass: "border-emerald-500/40 bg-emerald-500/10 text-emerald-400",
        description: "Penilaian telah ditinjau dan disetujui secara resmi oleh dosen pengampu.",
      };
    case "REJECTED":
      return {
        badgeLabel: "Review: Re-analysis Requested",
        badgeClass: "border-amber-500/40 bg-amber-500/10 text-amber-400",
        description: "Dosen meminta sistem menganalisis ulang jawaban dengan instruksi tambahan.",
      };
    default:
      return {
        badgeLabel: status,
        badgeClass: "border-slate-500/40 bg-slate-500/10 text-slate-400",
        description: "",
      };
  }
}

export const fmtDate = (value: string | null) => {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleString("id-ID", {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return value;
  }
};

/**
 * Goal 3: Consistent table status badge without multi-line wrapping
 */
export function summarizeSetStatus(
  statusSummary: string,
  counts: Record<string, number>,
): { label: string; cls: string; detail: string } {
  const entries = Object.entries(counts ?? {});
  const detail = entries
    .map(([status, count]) => `${count} ${SHORT_LABEL[status] ?? status}`)
    .join(" · ");

  if (statusSummary === "VALIDATED") {
    return {
      label: "Validasi Selesai",
      cls: "badge-active",
      detail: detail || "Semua soal telah divalidasi dosen",
    };
  }

  if (statusSummary === "PENDING_VALIDATION") {
    return {
      label: "Menunggu Validasi",
      cls: "badge-draft",
      detail: detail || "Menunggu verifikasi dosen",
    };
  }

  if (statusSummary !== "MIXED") {
    const meta = statusMeta(statusSummary);
    return { label: meta.label, cls: meta.cls, detail };
  }

  // Mixed states: Keep badge title short (< 20 chars) to prevent line wrapping
  const hasValidated = (counts["VALIDATED"] ?? 0) > 0;
  const hasPending = (counts["PENDING_VALIDATION"] ?? 0) > 0;

  if (hasValidated && hasPending) {
    return {
      label: "Sebagian Ditinjau",
      cls: "badge-draft",
      detail,
    };
  }

  if (hasValidated) {
    return {
      label: "Sebagian Selesai",
      cls: "badge-active",
      detail,
    };
  }

  return {
    label: "Sedang Diproses",
    cls: "badge-review",
    detail,
  };
}