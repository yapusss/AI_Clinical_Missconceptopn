"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  AlertTriangle,
  ArrowLeft,
  BrainCircuit,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  Lightbulb,
  RotateCcw,
  ShieldCheck,
  TriangleAlert,
  XCircle,
} from "lucide-react";

import { useAuth } from "../../../../components/AuthProvider";
import AppSelect from "../../../../components/AppSelect";
import PageHeader from "../../../../components/PageHeader";
import PageContainer from "../../../../components/PageContainer";
import { apiFetch } from "../../../../lib/api";

type IndicatorScore = {
  order_index: number;
  label: string;
  weight: string;
  score: "PRESENT" | "PARTIAL" | "MISSING";
  evidence: string;
};

type MisconceptionMatch = {
  misconception_id: string;
  label: string;
  matched: boolean;
  confidence: string;
  reasoning: string;
  lecturer_confirmed?: boolean;
};

type AttemptItem = {
  submission_id: string;
  attempt_no: number;
  status: string;
  answer_text: string;
  tier1_answer?: string;
  tier2_confidence?: number;
  tier3_reason?: string;
  tier4_confidence?: number;
  heuristic_flags?: string[];
  submitted_at: string;
  analysis: {
    id: string;
    run_number: number;
    percentage_correct: string;
    tier_level: number;
    tier_label: string;
    confidence: string;
    explanation: string;
    execution_time_ms: number | null;
    module_a_score?: string;
    module_b_score?: string;
    module_c_code?: string;
    four_tier_category?: string;
    risk_level?: string;
    concept_breakdown_json: {
      indicators?: IndicatorScore[];
      misconception_matches?: MisconceptionMatch[];
      proposed_new_misconception?: string | null;
    };
    validation: {
      status: string;
      final_percentage: string | null;
      final_tier_level: number | null;
      final_feedback: string | null;
      lecturer_name: string;
      validated_at: string | null;
    } | null;
  } | null;
};

type QuestionReviewItem = {
  question_id: string;
  order_index: number;
  prompt: string;
  model_answer: string;
  status: string;
  indicators: {
    id: string;
    label: string;
    description: string;
    weight: string;
    order_index: number;
  }[];
  attempts: AttemptItem[];
};

type PackageReview = {
  package: {
    id: string;
    code: string;
    title: string;
    description: string;
    subject_id: string;
    subject_name: string;
  };
  student: { id: string; name: string; email: string };
  published_question_count: number;
  answered_count: number;
  total_attempts_count: number;
  questions: QuestionReviewItem[];
};

const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  PENDING_VALIDATION: { label: "Perlu Validasi", cls: "badge-draft" },
  VALIDATED: { label: "Tervalidasi", cls: "badge-active" },
  REJECTED: { label: "Ditolak", cls: "badge-revoked" },
  ANALYZING: { label: "Dianalisis AI", cls: "badge-review" },
  ANALYSIS_FAILED: { label: "Analisis Gagal", cls: "badge-revoked" },
  SUBMITTED: { label: "Tersimpan", cls: "badge-review" },
  UNANSWERED: { label: "Belum Dijawab", cls: "badge-draft" },
};

const SCORE_BADGE: Record<string, { label: string; cls: string }> = {
  PRESENT: { label: "Terpenuhi", cls: "badge-active" },
  PARTIAL: { label: "Sebagian", cls: "badge-draft" },
  MISSING: { label: "Tidak terpenuhi", cls: "badge-revoked" },
};

const CATEGORY_TO_LEVEL: Record<string, number> = {
  SC: 4,
  FN: 3,
  FP: 2,
  MSC: 2,
  LK: 1,
};

const CATEGORY_META: Record<
  string,
  { label: string; desc: string; cardCls: string }
> = {
  FP: {
    label: "False Positive",
    desc: "Jawaban benar menutupi miskonsepsi.",
    cardCls: "diag-card-fp",
  },
  MSC: {
    label: "Miskonsepsi",
    desc: "Miskonsepsi penuh dan diyakini secara konsisten.",
    cardCls: "diag-card-msc",
  },
  FN: {
    label: "False Negative",
    desc: "Penalaran benar tetapi kesimpulan keliru.",
    cardCls: "diag-card-fn",
  },
  LK: {
    label: "Lack of Knowledge",
    desc: "Kurang pengetahuan, ragu-ragu, atau menebak.",
    cardCls: "diag-card-lk",
  },
  SC: {
    label: "Sound Understanding",
    desc: "Paham konsep secara utuh dan konsisten.",
    cardCls: "diag-card-sc",
  },
};

const fmtDate = (val: string) => {
  try {
    return new Date(val).toLocaleString("id-ID", {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return val;
  }
};

export default function StudentPackageReviewPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const params = useParams<{ id: string; studentId: string }>();
  const setId = params?.id;
  const studentId = params?.studentId;

  const [data, setData] = useState<PackageReview | null>(null);
  const [fetching, setFetching] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const [activeQuestionIdx, setActiveQuestionIdx] = useState(0);
  const [selectedAttemptByQuestion, setSelectedAttemptByQuestion] = useState<
    Record<string, number>
  >({});

  // Validation Form State
  const [finalPct, setFinalPct] = useState("");
  const [finalCategory, setFinalCategory] = useState<string>("LK");
  const [feedback, setFeedback] = useState("");
  const [notes, setNotes] = useState("");
  const [confirms, setConfirms] = useState<Record<string, boolean>>({});
  const [showRejectBox, setShowRejectBox] = useState(false);
  const [submittingValidation, setSubmittingValidation] = useState(false);

  const load = useCallback(async () => {
    if (!setId || !studentId) return;
    setFetching(true);
    setError("");
    try {
      const res = await apiFetch<PackageReview>(
        `/questions/${setId}/students/${studentId}/review`,
      );
      setData(res);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Gagal memuat review paket.",
      );
    } finally {
      setFetching(false);
    }
  }, [setId, studentId]);

  useEffect(() => {
    if (loading) return;
    if (!user) {
      router.replace("/login");
      return;
    }
    void load();
  }, [loading, user, router, load]);

  const activeQuestion: QuestionReviewItem | undefined = useMemo(() => {
    if (!data || !data.questions.length) return undefined;
    return data.questions[activeQuestionIdx] ?? data.questions[0];
  }, [data, activeQuestionIdx]);

  const attemptsDesc: AttemptItem[] = useMemo(() => {
    if (!activeQuestion) return [];
    return [...activeQuestion.attempts].sort(
      (a, b) => b.attempt_no - a.attempt_no,
    );
  }, [activeQuestion]);

  const currentAttempt: AttemptItem | undefined = useMemo(() => {
    if (!activeQuestion || !attemptsDesc.length) return undefined;
    const chosenAttemptNo =
      selectedAttemptByQuestion[activeQuestion.question_id];
    if (chosenAttemptNo !== undefined) {
      const found = attemptsDesc.find((a) => a.attempt_no === chosenAttemptNo);
      if (found) return found;
    }
    return attemptsDesc[0];
  }, [activeQuestion, attemptsDesc, selectedAttemptByQuestion]);

  // Sync validation controls when currentAttempt changes
  useEffect(() => {
    if (!currentAttempt || !currentAttempt.analysis) return;
    const a = currentAttempt.analysis;
    const v = a.validation;

    setFinalPct(v?.final_percentage ?? a.percentage_correct);
    setFinalCategory(a.four_tier_category ?? "LK");
    setFeedback(v?.final_feedback ?? a.explanation);
    setNotes("");
    setShowRejectBox(false);

    const initialConfirms: Record<string, boolean> = {};
    const matches = a.concept_breakdown_json?.misconception_matches ?? [];
    matches.forEach((m) => {
      initialConfirms[m.misconception_id] =
        m.lecturer_confirmed !== undefined ? m.lecturer_confirmed : m.matched;
    });
    setConfirms(initialConfirms);
  }, [currentAttempt]);

  const handleSelectAttempt = (questionId: string, attemptNo: number) => {
    setSelectedAttemptByQuestion((prev) => ({
      ...prev,
      [questionId]: attemptNo,
    }));
  };

  const handleValidationSubmit = async (forcedStatus?: "REJECTED") => {
    if (!currentAttempt || !currentAttempt.analysis) return;
    setError("");
    setNotice("");

    if (forcedStatus !== "REJECTED") {
      if (!finalCategory) {
        setError(
          "Peringatan: Anda belum memilih Diagnosis Akhir. Silakan pilih Diagnosis sebelum menyimpan validasi.",
        );
        return;
      }
      if (finalPct === "" || isNaN(Number(finalPct))) {
        setError("Peringatan: Masukkan Skor Akhir (%) berupa angka valid.");
        return;
      }
      const numPct = Number(finalPct);
      if (numPct < 0 || numPct > 100) {
        setError(
          "Peringatan: Skor Akhir harus berada di rentang 0 sampai 100.",
        );
        return;
      }
      if (!feedback.trim()) {
        setError("Peringatan: Feedback untuk mahasiswa tidak boleh kosong.");
        return;
      }
    } else {
      if (!notes.trim()) {
        setError(
          "Peringatan: Harap isi catatan alasan penolakan agar analisis ulang AI dapat diperbaiki.",
        );
        return;
      }
    }

    setSubmittingValidation(true);

    try {
      const a = currentAttempt.analysis;
      let decisionStatus: "ACCEPTED" | "EDITED" | "REJECTED" = "ACCEPTED";
      if (forcedStatus === "REJECTED") {
        decisionStatus = "REJECTED";
      } else {
        const isScoreChanged =
          Math.abs(Number(finalPct) - Number(a.percentage_correct)) > 0.01;
        const isCategoryChanged =
          finalCategory !== (a.four_tier_category ?? "LK");
        const isFeedbackChanged = feedback.trim() !== a.explanation.trim();
        if (isScoreChanged || isCategoryChanged || isFeedbackChanged) {
          decisionStatus = "EDITED";
        }
      }

      const body: Record<string, unknown> = { status: decisionStatus };
      if (decisionStatus !== "REJECTED") {
        body.final_percentage = Number(finalPct);
        body.final_tier_level =
          CATEGORY_TO_LEVEL[finalCategory] ?? a.tier_level ?? 1;
        body.final_feedback = feedback.trim();
      }
      if (notes.trim()) {
        body.notes = notes.trim();
      }

      const confList = Object.entries(confirms).map(
        ([misconception_id, confirmed]) => ({
          misconception_id,
          confirmed,
        }),
      );
      if (confList.length) {
        body.misconception_confirmations = confList;
      }

      const res = await apiFetch<{
        message: string;
        submission_status: string;
      }>(`/validations/${currentAttempt.analysis.id}/submit`, {
        method: "POST",
        body: JSON.stringify(body),
      });

      setNotice(res.message);
      await load();

      if (data) {
        const nextPending = data.questions.findIndex(
          (q, i) =>
            i > activeQuestionIdx &&
            q.attempts.some((att) => att.status === "PENDING_VALIDATION"),
        );
        if (nextPending !== -1) {
          setActiveQuestionIdx(nextPending);
        }
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Gagal menyimpan validasi.",
      );
    } finally {
      setSubmittingValidation(false);
    }
  };

  const resetToAiValues = () => {
    if (!currentAttempt?.analysis) return;
    setFinalPct(currentAttempt.analysis.percentage_correct);
    setFinalCategory(currentAttempt.analysis.four_tier_category ?? "LK");
    setFeedback(currentAttempt.analysis.explanation);
  };

  const categoryMeta = currentAttempt?.analysis?.four_tier_category
    ? CATEGORY_META[currentAttempt.analysis.four_tier_category]
    : null;

  if (loading || !user) return null;

  return (
    <PageContainer>
      <Link
        href={`/questions/${setId}`}
        className="inline-flex items-center gap-2 text-xs font-semibold text-on-surface-variant hover:text-primary no-underline"
      >
        <ArrowLeft size={14} /> Kembali ke daftar mahasiswa
      </Link>

      {data && (
        <PageHeader
          className="mt-3"
          title={data.student.name}
          description={`${data.package.title} • ${data.package.subject_name}`}
          icon={ClipboardCheck}
          eyebrow={
            <span className="font-mono-ui text-xs font-bold uppercase tracking-wider text-primary">
              {data.package.code} • Evaluasi Paket Four-Tier
            </span>
          }
          action={
            <div className="flex items-center gap-2">
              <span className="badge badge-active">
                Terjawab {data.answered_count} / {data.published_question_count}{" "}
                Soal
              </span>
              <span className="badge badge-role font-mono-ui">
                {data.total_attempts_count} Percobaan Total
              </span>
            </div>
          }
        />
      )}

      {error && (
        <div
          role="alert"
          className="mt-4 flex items-center gap-3 rounded-lg border border-error/40 bg-error-container p-4 text-sm text-on-error-container"
        >
          <TriangleAlert size={18} />
          <span>{error}</span>
        </div>
      )}

      {notice && (
        <div
          role="status"
          className="mt-4 flex items-center gap-3 rounded-lg border border-primary-fixed-dim bg-primary-fixed/60 p-4 text-sm text-primary"
        >
          <CheckCircle2 size={18} />
          <span>{notice}</span>
        </div>
      )}

      {fetching ? (
        <p className="mt-8 text-sm text-on-surface-variant">
          Memuat data pengerjaan mahasiswa...
        </p>
      ) : data && activeQuestion ? (
        <div className="mt-6 space-y-5">
          {/* Navigator Bar */}
          <div className="border-b border-outline-variant/30 bg-surface-container-low/70 px-4 py-3 sm:px-6 rounded-2xl border border-outline-variant/40 shadow-sm">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-xs font-bold uppercase tracking-wider text-on-surface-variant mr-1">
                  Navigasi soal:
                </span>
                <div className="flex flex-wrap items-center gap-1.5">
                  {data.questions.map((q, idx) => {
                    const isCurrent = idx === activeQuestionIdx;
                    const isAnswered = q.attempts.length > 0;
                    const hasPendingValidation = q.attempts.some(
                      (a) => a.status === "PENDING_VALIDATION",
                    );
                    const isValidated =
                      q.attempts.length > 0 &&
                      q.attempts[0].status === "VALIDATED";

                    let pillClass = "";
                    if (isCurrent) {
                      pillClass =
                        "bg-purple-200 text-slate-950 border-purple-400 font-bold dark:bg-purple-300 dark:text-slate-950 ring-2 ring-purple-400/40 shadow-sm";
                    } else if (hasPendingValidation) {
                      pillClass =
                        "bg-amber-500/20 text-amber-300 border-amber-500/50 hover:bg-amber-500/30 font-medium";
                    } else if (isValidated) {
                      pillClass =
                        "bg-emerald-500/20 text-emerald-300 border-emerald-500/40 hover:bg-emerald-500/30 font-medium";
                    } else if (isAnswered) {
                      pillClass =
                        "bg-blue-500/20 text-blue-300 border-blue-500/40 hover:bg-blue-500/30 font-medium";
                    } else {
                      pillClass =
                        "bg-white text-slate-900 border-slate-300 hover:bg-slate-100 font-semibold";
                    }

                    return (
                      <button
                        key={q.question_id}
                        type="button"
                        onClick={() => setActiveQuestionIdx(idx)}
                        className={`rounded-lg border px-3 py-1.5 text-xs font-mono-ui transition-all cursor-pointer ${pillClass}`}
                        aria-current={isCurrent ? "page" : undefined}
                      >
                        Soal {q.order_index}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Attempt Selector Dropdown */}
              <div className="flex items-center gap-2 shrink-0">
                <span className="text-xs font-bold uppercase tracking-wider text-on-surface-variant whitespace-nowrap">
                  Pilih percobaan:
                </span>
                <AppSelect
                  value={
                    currentAttempt ? String(currentAttempt.attempt_no) : ""
                  }
                  onValueChange={(val) => {
                    if (val)
                      handleSelectAttempt(
                        activeQuestion.question_id,
                        Number.parseInt(val, 10),
                      );
                  }}
                  ariaLabel="Pilih Percobaan"
                  disabled={attemptsDesc.length === 0}
                  placeholder={
                    attemptsDesc.length === 0
                      ? "Belum ada percobaan"
                      : `Percobaan ${currentAttempt?.attempt_no ?? 1}`
                  }
                  className="min-w-[140px] sm:min-w-[160px]"
                  options={attemptsDesc.map((att) => ({
                    value: String(att.attempt_no),
                    label: `Percobaan ${att.attempt_no}`,
                  }))}
                />
              </div>
            </div>
          </div>

          {/* DUAL COLUMN: Reading Flow (Left) vs. Sticky Action Desk (Right) */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
            {/* LEFT COLUMN: Question, Answer, and AI Analysis Reading Flow (lg:col-span-7) */}
            <div className="lg:col-span-7 space-y-4">
              {/* 1. Question & Student Response */}
              <section className="glass-panel overflow-hidden rounded-xl border border-outline-variant/40">
                <header className="border-b border-outline-variant/40 bg-surface-container-low px-5 py-3 flex items-center justify-between">
                  <span className="text-xs font-bold uppercase tracking-wider text-on-surface-variant font-mono-ui">
                    Soal Nomor {activeQuestion.order_index}
                  </span>
                  {currentAttempt ? (
                    <span
                      className={`badge ${STATUS_BADGE[currentAttempt.status]?.cls}`}
                    >
                      {STATUS_BADGE[currentAttempt.status]?.label}
                    </span>
                  ) : (
                    <span className="badge badge-draft">Belum Dijawab</span>
                  )}
                </header>

                <div className="p-5 space-y-4">
                  <div>
                    <h3 className="text-xs font-bold uppercase tracking-wider text-on-surface-variant">
                      Pertanyaan Konseptual
                    </h3>
                    <p className="mt-1.5 whitespace-pre-wrap text-sm text-on-surface font-medium leading-relaxed">
                      {activeQuestion.prompt}
                    </p>
                  </div>

                  <div className="border-t border-outline-variant/20 pt-3">
                    <h3 className="text-xs font-bold uppercase tracking-wider text-on-surface-variant">
                      Jawaban Referensi (Kebenaran Ilmiah)
                    </h3>
                    <p className="mt-1.5 whitespace-pre-wrap text-sm text-on-surface-variant leading-relaxed">
                      {activeQuestion.model_answer}
                    </p>
                  </div>

                  {/* HEURISTIC FLAGS WARNING BANNER */}
                  {currentAttempt?.heuristic_flags &&
                    currentAttempt.heuristic_flags.length > 0 && (
                      <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-300 space-y-1">
                        <div className="flex items-center gap-1.5 font-bold">
                          <AlertTriangle size={14} /> Terdeteksi Penanda
                          Otomatis Antar-Tier:
                        </div>
                        <div className="flex flex-wrap gap-1.5 pt-1">
                          {currentAttempt.heuristic_flags.map((flag) => (
                            <span
                              key={flag}
                              className="font-mono-ui font-semibold bg-amber-500/20 px-2 py-0.5 rounded border border-amber-500/40"
                            >
                              {flag === "t1_berisi_alasan" &&
                                "Tier 1 Memuat Kata Sebab"}
                              {flag === "t3_kosong" &&
                                "Tier 3 < 5 Kata / Kosong"}
                              {flag === "t3_redundan" &&
                                "Tier 3 Redundan dengan Tier 1"}
                              {flag === "t3_hafalan" &&
                                "Tier 3 Kutipan Hafalan Rumus"}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                  {/* FOUR-TIER RESPONSES BREAKDOWN */}
                  <div className="border-t border-outline-variant/20 pt-3 space-y-3">
                    <div className="flex items-center justify-between">
                      <h3 className="text-xs font-bold uppercase tracking-wider text-on-surface-variant">
                        Jawaban Mahasiswa (Four-Tier)
                      </h3>
                      {currentAttempt && (
                        <span className="text-[11px] text-on-surface-variant">
                          Percobaan {currentAttempt.attempt_no} •{" "}
                          {fmtDate(currentAttempt.submitted_at)}
                        </span>
                      )}
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="rounded-lg border border-outline-variant/30 bg-surface-container-lowest p-3">
                        <span className="text-[10px] font-bold uppercase text-on-surface-variant">
                          Tier 1 — Kesimpulan
                        </span>
                        <p className="mt-1 text-sm font-semibold text-on-surface font-mono-ui">
                          {currentAttempt?.tier1_answer ||
                            currentAttempt?.answer_text ||
                            "Belum ada jawaban"}
                        </p>
                      </div>
                      <div className="rounded-lg border border-outline-variant/30 bg-surface-container-lowest p-3">
                        <span className="text-[10px] font-bold uppercase text-on-surface-variant">
                          Tier 2 — Keyakinan Jawaban
                        </span>
                        <p className="mt-1 text-sm font-bold text-primary font-mono-ui">
                          Skala {currentAttempt?.tier2_confidence ?? 1} / 6 (
                          {(currentAttempt?.tier2_confidence ?? 1) >= 4
                            ? "Yakin"
                            : "Tidak Yakin"}
                          )
                        </p>
                      </div>
                      <div className="rounded-lg border border-outline-variant/30 bg-surface-container-lowest p-3 sm:col-span-2">
                        <span className="text-[10px] font-bold uppercase text-on-surface-variant">
                          Tier 3 — Alasan / Penalaran Ilmiah
                        </span>
                        <p className="mt-1 text-sm text-on-surface whitespace-pre-wrap font-mono-ui leading-relaxed">
                          {currentAttempt?.tier3_reason ||
                            currentAttempt?.answer_text ||
                            "Belum ada alasan"}
                        </p>
                      </div>
                      <div className="rounded-lg border border-outline-variant/30 bg-surface-container-lowest p-3 sm:col-span-2">
                        <span className="text-[10px] font-bold uppercase text-on-surface-variant">
                          Tier 4 — Keyakinan Alasan
                        </span>
                        <p className="mt-1 text-sm font-bold text-primary font-mono-ui">
                          Skala {currentAttempt?.tier4_confidence ?? 1} / 6 (
                          {(currentAttempt?.tier4_confidence ?? 1) >= 4
                            ? "Yakin"
                            : "Tidak Yakin"}
                          )
                        </p>
                      </div>
                    </div>
                  </div>
                </div>

                <footer className="border-t border-outline-variant/20 bg-surface-container-low/50 px-5 py-3 flex items-center justify-between">
                  <button
                    type="button"
                    onClick={() =>
                      setActiveQuestionIdx((prev) => Math.max(0, prev - 1))
                    }
                    disabled={activeQuestionIdx === 0}
                    className="btn-secondary !py-1 !px-2.5 text-xs disabled:opacity-40"
                  >
                    <ChevronLeft size={14} /> Soal Sebelumnya
                  </button>
                  <span className="text-xs font-mono-ui text-on-surface-variant">
                    Soal {activeQuestionIdx + 1} dari {data.questions.length}
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      setActiveQuestionIdx((prev) =>
                        Math.min(data.questions.length - 1, prev + 1),
                      )
                    }
                    disabled={activeQuestionIdx === data.questions.length - 1}
                    className="btn-secondary !py-1 !px-2.5 text-xs disabled:opacity-40"
                  >
                    Soal Berikutnya <ChevronRight size={14} />
                  </button>
                </footer>
              </section>

              {/* 2. AI Clinical Analysis Details */}
              {currentAttempt?.analysis && (
                <section className="glass-panel overflow-hidden rounded-xl border border-outline-variant/40">
                  <header className="border-b border-outline-variant/40 bg-surface-container-low px-5 py-3 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <BrainCircuit size={17} className="text-primary" />
                      <span className="text-xs font-bold uppercase tracking-wider text-on-surface">
                        Evaluasi Modular AI (Run #
                        {currentAttempt.analysis.run_number})
                      </span>
                    </div>
                    <span className="text-[11px] text-on-surface-variant">
                      Waktu Proses:{" "}
                      {currentAttempt.analysis.execution_time_ms ?? "-"} ms
                    </span>
                  </header>

                  <div className="p-5 space-y-4 text-xs">
                    {/* Rubric Breakdown */}
                    <div>
                      <h4 className="font-bold uppercase tracking-wider text-on-surface-variant mb-2">
                        Evaluasi Indikator Rubrik:
                      </h4>
                      <div className="space-y-2">
                        {(
                          currentAttempt.analysis.concept_breakdown_json
                            ?.indicators ?? []
                        ).map((ind) => {
                          const badge =
                            SCORE_BADGE[ind.score] ?? SCORE_BADGE.MISSING;
                          return (
                            <div
                              key={ind.order_index}
                              className="rounded-lg border border-outline-variant/30 bg-surface-container-lowest p-3"
                            >
                              <div className="flex items-center justify-between gap-2">
                                <span className="font-semibold text-on-surface text-xs">
                                  #{ind.order_index} {ind.label} (bobot{" "}
                                  {ind.weight})
                                </span>
                                <span className={`badge ${badge.cls}`}>
                                  {badge.label}
                                </span>
                              </div>
                              {ind.evidence && (
                                <p className="mt-1 text-[11px] italic text-on-surface-variant leading-relaxed">
                                  Bukti: &ldquo;{ind.evidence}&rdquo;
                                </p>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    {/* Explanation */}
                    <div className="border-t border-outline-variant/20 pt-3">
                      <h4 className="font-bold uppercase tracking-wider text-on-surface-variant">
                        Penjelasan Klinis AI:
                      </h4>
                      <p className="mt-1 whitespace-pre-wrap leading-relaxed text-on-surface text-xs">
                        {currentAttempt.analysis.explanation}
                      </p>
                    </div>

                    {/* Advisory Misconceptions */}
                    <div className="border-t border-outline-variant/20 pt-3">
                      <div className="flex items-center gap-1.5 mb-2">
                        <Lightbulb size={14} className="text-primary" />
                        <h4 className="font-bold uppercase tracking-wider text-on-surface-variant">
                          Miskonsepsi Terdeteksi (Advisory)
                        </h4>
                      </div>

                      {!currentAttempt.analysis.concept_breakdown_json
                        ?.misconception_matches?.length ? (
                        <p className="text-on-surface-variant italic">
                          Tidak ada pola miskonsepsi yang terdeteksi.
                        </p>
                      ) : (
                        <div className="space-y-2">
                          {currentAttempt.analysis.concept_breakdown_json.misconception_matches.map(
                            (m) => (
                              <div
                                key={m.misconception_id}
                                className="rounded-lg border border-outline-variant/30 bg-surface-container-lowest p-3"
                              >
                                <div className="flex items-center justify-between gap-2">
                                  <span className="font-semibold text-on-surface text-xs">
                                    {m.label}
                                  </span>
                                  <span
                                    className={`badge ${m.matched ? "badge-draft" : "badge-role"}`}
                                  >
                                    {m.matched ? "Usulan AI" : "Tidak Cocok"}
                                  </span>
                                </div>
                                {m.reasoning && (
                                  <p className="mt-1 text-[11px] text-on-surface-variant leading-relaxed">
                                    {m.reasoning}
                                  </p>
                                )}
                                <label className="mt-2.5 flex items-center gap-2 cursor-pointer font-medium text-on-surface text-xs">
                                  <input
                                    type="checkbox"
                                    checked={
                                      confirms[m.misconception_id] ?? m.matched
                                    }
                                    onChange={(e) =>
                                      setConfirms((prev) => ({
                                        ...prev,
                                        [m.misconception_id]: e.target.checked,
                                      }))
                                    }
                                    className="accent-primary h-3.5 w-3.5"
                                  />
                                  <span>
                                    Konfirmasi keberadaan miskonsepsi ini
                                  </span>
                                </label>
                              </div>
                            ),
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </section>
              )}
            </div>

            {/* RIGHT COLUMN: STICKY VALIDATION DESK (lg:col-span-5) */}
            <div className="lg:col-span-5 lg:sticky lg:top-6 space-y-4">
              {!currentAttempt?.analysis ? (
                <div className="glass-panel rounded-xl border border-outline-variant/40 p-6 text-center text-xs text-on-surface-variant">
                  {currentAttempt?.status === "ANALYZING"
                    ? "Model AI sedang menganalisis percobaan ini."
                    : currentAttempt?.status === "ANALYSIS_FAILED"
                      ? "Analisis AI mengalami kendala dan dijadwalkan ulang oleh sistem."
                      : "Belum ada analisis AI yang tersedia untuk divalidasi."}
                </div>
              ) : (
                <section className="glass-panel overflow-hidden rounded-xl border border-outline-variant/40 shadow-sm">
                  <header className="border-b border-outline-variant/40 bg-surface-container-low px-5 py-3 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <ShieldCheck size={18} className="text-primary" />
                      <h4 className="text-xs font-bold uppercase tracking-wider text-on-surface">
                        Validasi Dosen (Percobaan {currentAttempt.attempt_no})
                      </h4>
                    </div>
                    {currentAttempt.analysis.validation && (
                      <span className="text-[11px] text-on-surface-variant">
                        Status:{" "}
                        <strong className="text-on-surface font-semibold">
                          {currentAttempt.analysis.validation.status}
                        </strong>
                      </span>
                    )}
                  </header>

                  <div className="p-5 space-y-4">
                    {/* 1. Kartu Kategori Diagnostik */}
                    {categoryMeta && (
                      <div className={`diag-card ${categoryMeta.cardCls}`}>
                        <div className="flex items-center justify-between">
                          <span className="diag-title">
                            [{currentAttempt.analysis.four_tier_category}]{" "}
                            {categoryMeta.label}
                          </span>
                        </div>
                        <p className="diag-desc">{categoryMeta.desc}</p>
                        <div className="diag-meta">
                          <span>
                            Modul A (T1):{" "}
                            {currentAttempt.analysis.module_a_score}
                          </span>
                          <span>
                            Modul B (T3):{" "}
                            {currentAttempt.analysis.module_b_score}
                          </span>
                          {currentAttempt.analysis.module_c_code && (
                            <span>
                              Miskonsepsi:{" "}
                              {currentAttempt.analysis.module_c_code}
                            </span>
                          )}
                        </div>
                      </div>
                    )}

                    {/* 2. Box Hasil Prediksi AI (Bersih dari kata 'Tier 2') */}
                    <div className="rounded-lg border border-outline-variant/30 bg-surface-container-lowest p-3 flex items-center justify-between">
                      <div>
                        <p className="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant">
                          Hasil Prediksi AI
                        </p>
                        <div className="mt-1 flex items-baseline gap-2">
                          <span className="font-mono-ui text-xl font-extrabold text-primary">
                            {Number(
                              currentAttempt.analysis.percentage_correct,
                            ).toFixed(1)}
                            %
                          </span>
                          <span className="text-xs font-bold text-on-surface">
                            [{currentAttempt.analysis.four_tier_category}]{" "}
                            {categoryMeta?.label}
                          </span>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={resetToAiValues}
                        className="text-[11px] text-primary hover:underline inline-flex items-center gap-1 cursor-pointer font-medium"
                        title="Kembalikan form ke nilai awal AI"
                      >
                        <RotateCcw size={12} /> Reset ke AI
                      </button>
                    </div>

                    {/* 3. Input Skor Akhir & Dropdown Diagnosis Akhir (Kategori 4-Tier Murni) */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                      <div>
                        <label
                          htmlFor="final-pct"
                          className="block text-[11px] font-bold uppercase text-on-surface-variant"
                        >
                          Skor Akhir (%)
                        </label>
                        <input
                          id="final-pct"
                          type="number"
                          min={0}
                          max={100}
                          step={0.1}
                          value={finalPct}
                          onChange={(e) => setFinalPct(e.target.value)}
                          className="form-input mt-1 w-full text-xs font-mono-ui"
                        />
                      </div>

                      <div>
                        <span className="block text-[11px] font-bold uppercase text-on-surface-variant">
                          Diagnosis Akhir
                        </span>
                        <AppSelect
                          value={finalCategory}
                          onValueChange={(val) => setFinalCategory(val)}
                          className="mt-1 w-full text-xs"
                          ariaLabel="Pilih Diagnosis Akhir"
                          options={[
                            {
                              value: "SC",
                              label: "[SC] Sound Understanding",
                            },
                            {
                              value: "LK",
                              label: "[LK] Lack of Knowledge",
                            },
                            {
                              value: "FP",
                              label: "[FP] False Positive",
                            },
                            {
                              value: "MSC",
                              label: "[MSC] Misconception",
                            },
                            {
                              value: "FN",
                              label: "[FN] False Negative",
                            },
                          ]}
                        />
                      </div>

                      <div className="sm:col-span-2">
                        <label
                          htmlFor="feedback"
                          className="block text-[11px] font-bold uppercase text-on-surface-variant"
                        >
                          Feedback untuk Mahasiswa
                        </label>
                        <textarea
                          id="feedback"
                          rows={4}
                          value={feedback}
                          onChange={(e) => setFeedback(e.target.value)}
                          className="form-input mt-1 w-full text-xs leading-relaxed"
                          placeholder="Tuliskan umpan balik atau klarifikasi konseptual..."
                        />
                      </div>
                    </div>

                    {/* Rejection Notes Area */}
                    {showRejectBox && (
                      <div className="rounded-lg border border-dashed border-error/40 bg-error-container/20 p-3 space-y-2">
                        <div className="flex items-center justify-between text-xs font-bold text-error">
                          <span className="inline-flex items-center gap-1.5">
                            <XCircle size={14} /> Tolak &amp; Minta Analisis
                            Ulang
                          </span>
                          <button
                            type="button"
                            onClick={() => setShowRejectBox(false)}
                            className="text-[11px] text-on-surface-variant hover:text-on-surface cursor-pointer"
                          >
                            Batal
                          </button>
                        </div>
                        <p className="text-[11px] text-on-surface-variant leading-relaxed">
                          Sertakan alasan penolakan. Catatan ini akan diumpankan
                          ke worker AI saat re-analisis dijalankan.
                        </p>
                        <textarea
                          rows={2}
                          value={notes}
                          onChange={(e) => setNotes(e.target.value)}
                          placeholder="Jelaskan alasan kenapa analisis ini ditolak..."
                          className="form-input w-full text-xs"
                        />
                        <div className="flex justify-end pt-1">
                          <button
                            type="button"
                            onClick={() => handleValidationSubmit("REJECTED")}
                            disabled={submittingValidation}
                            className="btn-danger !py-1.5 !px-3 text-xs font-semibold cursor-pointer"
                          >
                            Konfirmasi Tolak &amp; Re-analisis
                          </button>
                        </div>
                      </div>
                    )}

                    {!showRejectBox && (
                      <div>
                        <label
                          htmlFor="internal-notes"
                          className="block text-[11px] font-bold uppercase text-on-surface-variant"
                        >
                          Catatan Internal Dosen (Opsional)
                        </label>
                        <input
                          id="internal-notes"
                          type="text"
                          value={notes}
                          onChange={(e) => setNotes(e.target.value)}
                          placeholder="Catatan untuk arsip atau penelitian..."
                          className="form-input mt-1 w-full text-xs"
                        />
                      </div>
                    )}

                    {/* Action Buttons: Tolak & Reanalisis on Left, Simpan on Right */}
                    <div className="pt-3 border-t border-outline-variant/20 flex items-center justify-between gap-3">
                      {!showRejectBox ? (
                        <button
                          type="button"
                          onClick={() => setShowRejectBox(true)}
                          className="btn-danger !py-2 !px-3 text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
                          title="Tolak analisis AI dan jadwalkan analisis ulang"
                        >
                          <XCircle size={15} /> Tolak &amp; Re-analisis
                        </button>
                      ) : (
                        <div />
                      )}

                      <button
                        type="button"
                        onClick={() => handleValidationSubmit()}
                        disabled={submittingValidation}
                        className="btn-primary !py-2 !px-4 text-xs font-semibold inline-flex items-center gap-1.5 shadow-sm cursor-pointer"
                      >
                        <ShieldCheck size={16} />
                        {submittingValidation
                          ? "Menyimpan..."
                          : "Simpan Validasi"}
                      </button>
                    </div>
                  </div>
                </section>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </PageContainer>
  );
}