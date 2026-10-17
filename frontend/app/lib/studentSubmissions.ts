export type EvidenceSpan = {
  field: "tier1" | "tier3";
  sentence_id: number;
  quote: string;
  reason: string;
  status: "exact" | "normalized";
  // The resolved sentence; absent on rows written before it was stored, in
  // which case surfaces fall back to `quote`.
  sentence?: string | null;
};

export type StudentEvaluation = {
  percentage_correct: number;
  is_score_modified: boolean;
  original_ai_score?: number;
  tier_level: number;
  tier_label: string;
  clinical_feedback: string;
  misconception_info?: {
    code: string;
    category?: string;
  } | null;
  suggested_materials?: string[];
  // C7: the reading material the LLM wrote for this question, or `null`. The
  // student sees the text and the reference the LLM used — never the lecturer's
  // citation/review/staleness diagnostics.
  reading_material?: StudentReadingMaterial | null;
  // v3.2: the sentence-level anchor, present only while the material is READY.
  evidence_span?: EvidenceSpan | null;
  validator_name?: string;
  validated_at?: string;
};

export type FourTierDiagnosis = {
  module_a_score?: string | null;
  module_b_score?: string | null;
  module_c_code?: string | null;
  category?: string | null;
  risk_level?: string | null;
};

export type StudentAttempt = {
  submission_id: string;
  attempt_no: number;
  status: string;
  answer_text: string;
  tier1_answer?: string | null;
  tier2_confidence?: number | null;
  tier3_reason?: string | null;
  tier4_confidence?: number | null;
  heuristic_flags?: string[];
  four_tier_diagnosis?: FourTierDiagnosis | null;
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

export type StudentPackageGroup = {
  package_id: string;
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
  overall_score?: number | null;
  correct_count?: number;
  validated_count?: number;
  is_fully_validated?: boolean;
  score_policy?: "HIGHEST" | "AVERAGE" | "LAST_ATTEMPT";
  questions: StudentQuestionGroup[];
};

export type StatusMeta = { label: string; cls: string; hint: string };

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

export const statusMeta = (status: string): StatusMeta =>
  STATUS_META[status] ?? { label: status, cls: "badge-role", hint: "" };

// --- Grounding / citation shapes (R6; the student surface in R7 inherits these) ---

export type GroundingReference = {
  chunk_id: string;
  document_id: string | null;
  document_title: string | null;
  page: number | null;
  quote: string;
  similarity: number | null;
  valid: boolean;
  reason_if_invalid: string | null;
};

export type LearnedTopic = {
  topik: string;
  sumber_chunk_ids: string[];
};

// --- Reading material / answer-similarity shapes (C6, consumed by the lecturer
// surfaces). Additive to the R1–R6 grounding shapes; nothing above is removed.
// C8 removed `GroundingSummary` / `GroundingPayload` with the superseded
// grounding keys. `references` (provenance of the reading material) stays.

export type ReadingMaterialSource = {
  chunk_id: string;
  document_id?: string | null;
  document_title?: string | null;
  page?: number | null;
};

export type VerdictShadow = {
  rule_t1?: string | null;
  rule_t3?: string | null;
  sim_t1?: number | null;
  sim_t3?: number | null;
  threshold_t1?: number | null;
  threshold_t3?: number | null;
  source?: string | null;
};

export type ReadingMaterial = {
  id: string;
  status: string;
  content_md: string | null;
  sources: ReadingMaterialSource[];
  grounded: boolean;
  ungrounded_source_count: number;
  stale: boolean;
  stale_reason: string | null;
  review_status: string;
  flag_note: string | null;
  prompt_version: string | null;
  model_identifier: string | null;
  attempts: number;
};

// The student-facing slice of a reading material (C7): the text and the
// reference the LLM used. Lecturer-only diagnostics (status, review_status,
// flag_note, staleness, cosine) are deliberately not part of this shape — the
// student payload never carries them.
export type StudentReadingMaterial = {
  // 'READY' | 'PENDING' | 'STALE'. A non-READY row arrives with no content and exists
  // only so the student can be told the material is still being written.
  status?: string | null;
  content_md: string | null;
  sources: ReadingMaterialSource[];
};

// Flat keys the analysis detail adds alongside the grounding block (C5/C6).
export type AnalysisSimilarityDetail = {
  answer_similarity_t1?: number | null;
  answer_similarity_t3?: number | null;
  llm_t1_score?: string | null;
  llm_t3_score?: string | null;
  verdict_shadow?: VerdictShadow;
  reading_material?: ReadingMaterial | null;
};

export type AnswerSimilarityBucket = {
  count: number;
  t1_mean: number | null;
  t3_mean: number | null;
};

export type ReadingMaterialCounts = {
  READY: number;
  PENDING: number;
  STALE: number;
  FAILED: number;
  total: number;
};

// The C5 aggregate keys (D9/D19). Every aggregate is shown with its denominator.
export type AnswerSimilarityMetrics = {
  answer_similarity_t1_mean?: number | null;
  answer_similarity_t1_median?: number | null;
  answer_similarity_t3_mean?: number | null;
  answer_similarity_t3_median?: number | null;
  answer_similarity_coverage?: number | null;
  no_similarity_count?: number | null;
  answer_similarity_by_category?: Record<string, AnswerSimilarityBucket>;
  answer_similarity_by_prompt_version?: Record<string, AnswerSimilarityBucket>;
  verdict_agreement_rate?: number | null;
  verdict_disagreement_count?: number | null;
  verdict_comparable_count?: number | null;
  reading_material_counts?: ReadingMaterialCounts;
};

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
        description: "Model AI sedang mengevaluasi pola penalaran.",
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
