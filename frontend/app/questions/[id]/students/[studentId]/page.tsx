"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  BrainCircuit,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronUp,
  ClipboardCheck,
  Info,
  Lock,
  RotateCcw,
  ShieldCheck,
  TriangleAlert,
  Unlock,
  XCircle,
} from "lucide-react";

import { useAuth } from "../../../../components/AuthProvider";
import AppSelect from "../../../../components/AppSelect";
import PageHeader from "../../../../components/PageHeader";
import PageContainer from "../../../../components/PageContainer";
import { apiFetch } from "../../../../lib/api";

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
  short_answer?: string;
  model_answer: string;
  reference?: { short_answer: string; reason: string };
  status: string;
  attempts: AttemptItem[];
};

type PackageReviewSummary = {
  total_questions: number;
  validated_count: number;
  correct_count: number;
  overall_score: number;
  is_all_validated: boolean;
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
  summary?: PackageReviewSummary;
  questions: QuestionReviewItem[];
};

const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  PENDING_VALIDATION: { label: "Menunggu Validasi", cls: "badge-draft" },
  VALIDATED: { label: "Tervalidasi", cls: "badge-active" },
  REJECTED: { label: "Ditolak", cls: "badge-revoked" },
  ANALYZING: { label: "Dianalisis AI", cls: "badge-review" },
  ANALYSIS_FAILED: { label: "Analisis Gagal", cls: "badge-revoked" },
  SUBMITTED: { label: "Tersimpan", cls: "badge-review" },
  UNANSWERED: { label: "Belum Dijawab", cls: "badge-draft" },
};

const VALIDATION_STATUS_LABEL: Record<string, string> = {
  ACCEPTED: "Diterima",
  EDITED: "Disesuaikan Dosen",
  REJECTED: "Ditolak (Re-analisis)",
};

const CATEGORY_TO_LEVEL: Record<string, number> = {
  SC: 4,
  FN: 3,
  FP: 2,
  MSC: 2,
  LK: 1,
};

const CATEGORY_STYLES: Record<
  string,
  { badgeCls: string; label: string; desc: string; detailExpl: string }
> = {
  SC: {
    badgeCls: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border border-emerald-500/40",
    label: "Sound Understanding",
    desc: "Paham konsep secara utuh dan konsisten.",
    detailExpl: "Sound Understanding: Mahasiswa memahami konsep ilmiah secara utuh dan konsisten.",
  },
  LK: {
    badgeCls: "bg-sky-500/15 text-sky-700 dark:text-sky-400 border border-sky-500/40",
    label: "Lack of Knowledge",
    desc: "Kurang pengetahuan, ragu-ragu, atau menebak.",
    detailExpl: "Lack of Knowledge: Mahasiswa mengalami kesulitan konsep dasar atau tidak memiliki keyakinan yang cukup.",
  },
  FN: {
    badgeCls: "bg-purple-500/15 text-purple-700 dark:text-purple-400 border border-purple-500/40",
    label: "False Negative",
    desc: "Penalaran benar tetapi kesimpulan keliru.",
    detailExpl: "False Negative: Penalaran ilmiah mahasiswa sudah tepat, namun kurang teliti saat menarik kesimpulan akhir.",
  },
  FP: {
    badgeCls: "bg-rose-500/15 text-rose-700 dark:text-rose-400 border border-rose-500/40",
    label: "False Positive",
    desc: "Jawaban benar menutupi miskonsepsi.",
    detailExpl: "False Positive: Kesimpulan mahasiswa benar, namun alasan/penalaran menunjukkan pemahaman yang keliru.",
  },
  MSC: {
    badgeCls: "bg-amber-500/15 text-amber-700 dark:text-amber-400 border border-amber-500/40",
    label: "Miskonsepsi",
    desc: "Miskonsepsi penuh dan diyakini secara konsisten.",
    detailExpl: "Misconception: Kesimpulan dan alasan salah, serta diyakini secara konsisten oleh mahasiswa.",
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

const fmtPct = (num: number) => {
  return num % 1 === 0 ? `${num.toFixed(0)}%` : `${num.toFixed(1)}%`;
};

export default function StudentPackageReviewPage({ examPackage = false }: { examPackage?: boolean }) {
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

  // Form State
  const [isCorrect, setIsCorrect] = useState<boolean>(false);
  const [finalCategory, setFinalCategory] = useState<string>("LK");
  const [feedback, setFeedback] = useState("");
  const [notes, setNotes] = useState("");
  const [showRejectBox, setShowRejectBox] = useState(false);
  const [showAiDetails, setShowAiDetails] = useState(false);
  const [isUnlocked, setIsUnlocked] = useState(false);
  const [submittingValidation, setSubmittingValidation] = useState(false);

  const load = useCallback(async () => {
    if (!setId || !studentId) return;
    setFetching(true);
    setError("");
    try {
      const res = await apiFetch<PackageReview>(
        `/${examPackage ? "exam-packages" : "questions"}/${setId}/students/${studentId}/review`
      );
      setData(res);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Gagal memuat review paket."
      );
    } finally {
      setFetching(false);
    }
  }, [setId, studentId, examPackage]);

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
      (a, b) => b.attempt_no - a.attempt_no
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

  useEffect(() => {
    if (!currentAttempt || !currentAttempt.analysis) return;
    const a = currentAttempt.analysis;
    const v = a.validation;

    const initialScoreVal =
      v?.final_percentage !== null && v?.final_percentage !== undefined
        ? Number(v.final_percentage)
        : Number(a.percentage_correct);

    setIsCorrect(initialScoreVal >= 99.9);
    setFinalCategory(a.four_tier_category ?? "LK");
    setFeedback(v?.final_feedback ?? a.explanation);
    setNotes("");
    setShowRejectBox(false);
    setShowAiDetails(false);
    setIsUnlocked(false);
  }, [currentAttempt]);

  const isAlreadyValidated = Boolean(currentAttempt?.analysis?.validation);
  const isLocked = isAlreadyValidated && !isUnlocked;

  const isFormModified = useMemo(() => {
    if (!currentAttempt?.analysis) return false;
    const a = currentAttempt.analysis;
    const v = a.validation;
    const initialScoreVal =
      v?.final_percentage !== null && v?.final_percentage !== undefined
        ? Number(v.final_percentage)
        : Number(a.percentage_correct);
    const initialIsCorrect = initialScoreVal >= 99.9;
    const initialCat = a.four_tier_category ?? "LK";
    const initialFeedback = v?.final_feedback ?? a.explanation;

    return (
      isCorrect !== initialIsCorrect ||
      finalCategory !== initialCat ||
      feedback.trim() !== initialFeedback.trim() ||
      notes.trim().length > 0
    );
  }, [currentAttempt, isCorrect, finalCategory, feedback, notes]);

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
        setError("Peringatan: Silakan pilih Diagnosis Akhir Dosen terlebih dahulu.");
        return;
      }
      if (!feedback.trim()) {
        setError("Peringatan: Feedback untuk mahasiswa tidak boleh kosong.");
        return;
      }
    } else if (!notes.trim()) {
      setError("Peringatan: Harap isi catatan alasan penolakan untuk AI.");
      return;
    }

    setSubmittingValidation(true);

    try {
      const a = currentAttempt.analysis;
      let decisionStatus: "ACCEPTED" | "EDITED" | "REJECTED" = "ACCEPTED";
      const targetScorePct = isCorrect ? 100.0 : 0.0;

      if (forcedStatus === "REJECTED") {
        decisionStatus = "REJECTED";
      } else {
        const isScoreChanged =
          Math.abs(targetScorePct - Number(a.percentage_correct)) > 0.01;
        const isCategoryChanged =
          finalCategory !== (a.four_tier_category ?? "LK");
        const isFeedbackChanged = feedback.trim() !== a.explanation.trim();
        if (isScoreChanged || isCategoryChanged || isFeedbackChanged) {
          decisionStatus = "EDITED";
        }
      }

      const body: Record<string, unknown> = { status: decisionStatus };
      if (decisionStatus !== "REJECTED") {
        body.final_percentage = targetScorePct;
        body.final_tier_level =
          CATEGORY_TO_LEVEL[finalCategory] ?? a.tier_level ?? 1;
        body.final_feedback = feedback.trim();
      }
      if (notes.trim()) {
        body.notes = notes.trim();
      }

      const res = await apiFetch<{
        message: string;
        submission_status: string;
      }>(`/validations/${currentAttempt.analysis.id}/submit`, {
        method: "POST",
        body: JSON.stringify(body),
      });

      setIsUnlocked(false);
      await load();

      if (data) {
        const nextPending = data.questions.findIndex(
          (q, i) =>
            i > activeQuestionIdx &&
            q.attempts.some((att) => att.status === "PENDING_VALIDATION")
        );
        if (nextPending !== -1) {
          setNotice(
            `Soal ${activeQuestion?.order_index} berhasil divalidasi. Mengalihkan ke Soal ${data.questions[nextPending].order_index}...`
          );
          setActiveQuestionIdx(nextPending);
          window.scrollTo({ top: 0, behavior: "smooth" });
        } else {
          setNotice(res.message || "Validasi berhasil disimpan.");
        }
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Gagal menyimpan validasi."
      );
    } finally {
      setSubmittingValidation(false);
    }
  };

  const resetToAiValues = () => {
    if (!currentAttempt?.analysis) return;
    setIsCorrect(Number(currentAttempt.analysis.percentage_correct) >= 99.9);
    setFinalCategory(currentAttempt.analysis.four_tier_category ?? "LK");
    setFeedback(currentAttempt.analysis.explanation);
  };

  const handleCancelUnlock = () => {
    if (!currentAttempt?.analysis) return;
    const a = currentAttempt.analysis;
    const v = a.validation;
    const initialScoreVal =
      v?.final_percentage !== null && v?.final_percentage !== undefined
        ? Number(v.final_percentage)
        : Number(a.percentage_correct);
    setIsCorrect(initialScoreVal >= 99.9);
    setFinalCategory(a.four_tier_category ?? "LK");
    setFeedback(v?.final_feedback ?? a.explanation);
    setIsUnlocked(false);
  };

  const categoryMeta = currentAttempt?.analysis?.four_tier_category
    ? CATEGORY_STYLES[currentAttempt.analysis.four_tier_category] ?? CATEGORY_STYLES.LK
    : null;

  const summary = data?.summary;
  const isAiPredictedCorrect =
    Number(currentAttempt?.analysis?.percentage_correct || 0) >= 99.9;

  if (loading || !user) return null;

  return (
    <PageContainer>
      <Link
        href={`/${examPackage ? "exam-packages" : "questions"}/${setId}`}
        className="inline-flex items-center gap-1.5 text-xs font-semibold text-on-surface-variant hover:text-primary no-underline transition-colors"
      >
        <ArrowLeft size={14} /> Kembali ke daftar mahasiswa
      </Link>

      {data && (
        <PageHeader
          className="mt-2 mb-2"
          title={data.student.name}
          description={`${data.package.title} • ${data.package.subject_name}`}
          icon={ClipboardCheck}
          eyebrow={
            <span className="font-mono-ui text-xs font-bold uppercase tracking-wider text-primary">
              {data.package.code} • Meja Evaluasi Diagnostik
            </span>
          }
          action={
            <div className="flex items-center gap-2">
              <span className="badge badge-active text-xs">
                Terjawab {data.answered_count} / {data.published_question_count} Soal
              </span>
            </div>
          }
        />
      )}

      {error && (
        <div
          role="alert"
          className="mt-3 flex items-center gap-2.5 rounded-lg border border-error/40 bg-error-container p-3 text-xs text-on-error-container"
        >
          <TriangleAlert size={15} className="shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {notice && (
        <div
          role="status"
          className="mt-3 flex items-center gap-2.5 rounded-lg border border-primary-fixed-dim bg-primary-fixed/60 p-3 text-xs text-primary"
        >
          <CheckCircle2 size={15} className="shrink-0" />
          <span>{notice}</span>
        </div>
      )}

      {fetching ? (
        <p className="mt-8 text-sm text-on-surface-variant">
          Memuat data pengerjaan mahasiswa...
        </p>
      ) : data && activeQuestion ? (
        <div className="mt-3.5 flex flex-col lg:flex-row gap-5 items-start">
          {/* KOLOM KIRI: WORKBENCH EVALUASI & VALIDASI */}
          <main className="flex-1 min-w-0 space-y-4">
            <section className="glass-panel rounded-2xl border border-outline-variant/40 shadow-sm p-4 sm:p-5 space-y-4">
              <div className="flex items-center justify-between border-b border-outline-variant/30 pb-2.5">
                <div className="flex items-center gap-2">
                  <span className="font-mono-ui text-base font-bold text-primary">
                    Soal Nomor {activeQuestion.order_index}
                  </span>
                  <span className="text-xs text-on-surface-variant font-mono-ui">
                    dari {data.questions.length} Soal
                  </span>
                </div>

                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-1.5 text-xs">
                    <span className="text-on-surface-variant text-xs font-semibold uppercase tracking-wide">
                      Percobaan:
                    </span>
                    <AppSelect
                      value={currentAttempt ? String(currentAttempt.attempt_no) : ""}
                      onValueChange={(val) => {
                        if (val)
                          handleSelectAttempt(
                            activeQuestion.question_id,
                            Number.parseInt(val, 10)
                          );
                      }}
                      ariaLabel="Pilih Percobaan"
                      disabled={attemptsDesc.length === 0}
                      placeholder={
                        attemptsDesc.length === 0
                          ? "Belum ada"
                          : `Ke-${currentAttempt?.attempt_no ?? 1}`
                      }
                      className="min-w-[95px] text-xs"
                      options={attemptsDesc.map((att) => ({
                        value: String(att.attempt_no),
                        label: `Ke-${att.attempt_no}`,
                      }))}
                    />
                  </div>

                  {currentAttempt ? (
                    <span className={`badge ${STATUS_BADGE[currentAttempt.status]?.cls} text-xs`}>
                      {STATUS_BADGE[currentAttempt.status]?.label}
                    </span>
                  ) : (
                    <span className="badge badge-draft text-xs">Belum Dijawab</span>
                  )}
                </div>
              </div>

              {/* SOAL vs JAWABAN MAHASISWA */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5 items-stretch">
                <div className="rounded-xl border border-outline-variant/30 bg-surface-container-low p-3.5 flex flex-col justify-between space-y-3">
                  <div>
                    <span className="text-xs font-semibold uppercase tracking-wider text-on-surface-variant block mb-1">
                      Pertanyaan Konseptual
                    </span>
                    <p className="whitespace-pre-wrap text-[15px] font-medium text-on-surface leading-relaxed">
                      {activeQuestion.prompt}
                    </p>
                  </div>

                  <div className="border-t border-outline-variant/20 pt-2.5">
                    <span className="text-xs font-semibold uppercase tracking-wider text-primary block mb-1">
                      Jawaban Singkat (Referensi)
                    </span>
                    <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-on-surface bg-surface-container-lowest p-2.5 rounded-lg border border-outline-variant/20">
                      {activeQuestion.reference?.short_answer ?? activeQuestion.short_answer ?? ''}
                    </p>
                  </div>

                  <div className="border-t border-outline-variant/20 pt-2.5">
                    <span className="text-xs font-semibold uppercase tracking-wider text-primary block mb-1">
                      Alasan Referensi
                    </span>
                    <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-on-surface bg-surface-container-lowest p-2.5 rounded-lg border border-outline-variant/20">
                      {activeQuestion.reference?.reason ?? activeQuestion.model_answer ?? ''}
                    </p>
                  </div>
                </div>

                <div className="rounded-xl border border-outline-variant/30 bg-surface-container-low p-3.5 space-y-2.5 flex flex-col justify-between">
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-xs font-semibold uppercase tracking-wider text-on-surface-variant">
                        Jawaban Mahasiswa
                      </span>
                      {currentAttempt && (
                        <span className="text-[11px] text-on-surface-variant font-mono-ui">
                          {fmtDate(currentAttempt.submitted_at)}
                        </span>
                      )}
                    </div>

                    {currentAttempt?.heuristic_flags && currentAttempt.heuristic_flags.length > 0 && (
                      <div className="mb-2 flex items-center gap-1.5 rounded-lg border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[11px] text-amber-300">
                        <AlertTriangle size={12} className="shrink-0" />
                        <span className="font-semibold">Catatan:</span>
                        {currentAttempt.heuristic_flags.map((flag) => (
                          <span key={flag} className="font-mono-ui">
                            {flag === "t1_berisi_alasan" && "[T1 Memuat Alasan]"}
                            {flag === "t3_kosong" && "[T3 Kurang Kata]"}
                            {flag === "t3_redundan" && "[T3 Redundan]"}
                            {flag === "t3_hafalan" && "[T3 Hafalan Rumus]"}
                          </span>
                        ))}
                      </div>
                    )}

                    <div className="rounded-lg border border-outline-variant/30 bg-surface-container-lowest p-2.5 space-y-0.5">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium uppercase tracking-wide text-on-surface-variant">
                          1. Kesimpulan (Tier 1)
                        </span>
                        <span className="font-mono-ui text-[11px] text-on-surface-variant/80">
                          {currentAttempt?.tier2_confidence ?? 1}/6 · {(currentAttempt?.tier2_confidence ?? 1) >= 4 ? "Yakin" : "Ragu"}
                        </span>
                      </div>
                      <p className="text-[15px] font-medium text-on-surface leading-normal mt-0.5">
                        {currentAttempt?.tier1_answer || currentAttempt?.answer_text || "Belum ada jawaban"}
                      </p>
                    </div>
                  </div>

                  <div className="rounded-lg border border-outline-variant/30 bg-surface-container-lowest p-2.5 space-y-0.5">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium uppercase tracking-wide text-on-surface-variant">
                        2. Alasan Ilmiah (Tier 3)
                      </span>
                      <span className="font-mono-ui text-[11px] text-on-surface-variant/80">
                        {currentAttempt?.tier4_confidence ?? 1}/6 · {(currentAttempt?.tier4_confidence ?? 1) >= 4 ? "Yakin" : "Ragu"}
                      </span>
                    </div>
                    <p className="text-sm leading-relaxed text-on-surface whitespace-pre-wrap mt-0.5 max-h-32 overflow-y-auto">
                      {currentAttempt?.tier3_reason || currentAttempt?.answer_text || "Belum ada alasan"}
                    </p>
                  </div>
                </div>
              </div>

              {/* REKOMENDASI AI: MURNI STATUS BENAR/SALAH */}
              {currentAttempt?.analysis && (
                <div className="rounded-xl border border-outline-variant/40 bg-surface-container-low/70 px-3.5 py-2.5 space-y-1.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs font-bold uppercase tracking-wider text-on-surface-variant flex items-center gap-1.5">
                        <BrainCircuit size={14} className="text-primary" /> REKOMENDASI AI:
                      </span>

                      <span
                        className={`font-mono-ui text-xs font-bold inline-flex items-center gap-1.5 py-0.5 px-2.5 rounded-full ${
                          CATEGORY_STYLES[currentAttempt.analysis.four_tier_category ?? "LK"]?.badgeCls
                        }`}
                        title={categoryMeta?.detailExpl}
                      >
                        [{currentAttempt.analysis.four_tier_category}] {categoryMeta?.label}
                        <Info size={11} className="opacity-70" />
                      </span>

                      <span
                        className={`font-mono-ui font-bold text-xs px-2.5 py-0.5 rounded border inline-flex items-center gap-1 ${
                          isAiPredictedCorrect
                            ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30"
                            : "bg-rose-500/15 text-rose-400 border-rose-500/30"
                        }`}
                      >
                        {isAiPredictedCorrect ? "Prediksi: Benar" : "Prediksi: Salah"}
                      </span>

                      <span className="text-xs text-on-surface-variant">
                        T1: <strong className="text-on-surface">{currentAttempt.analysis.module_a_score}</strong> · T3: <strong className="text-on-surface">{currentAttempt.analysis.module_b_score}</strong>
                      </span>
                    </div>

                    <button
                      type="button"
                      onClick={() => setShowAiDetails((prev) => !prev)}
                      className="text-xs text-primary hover:underline font-semibold cursor-pointer inline-flex items-center gap-1"
                    >
                      {showAiDetails ? (
                        <>Sembunyikan Detail AI <ChevronUp size={12} /></>
                      ) : (
                        <>Lihat Detail AI <ChevronDown size={12} /></>
                      )}
                    </button>
                  </div>

                  <p className="text-xs text-on-surface-variant leading-relaxed">
                    <strong className="text-on-surface">Temuan AI: </strong>
                    {currentAttempt.analysis.four_tier_category === "FP"
                      ? "Kesimpulan benar, namun alasan ilmiah menunjukkan miskonsepsi (False Positive)."
                      : currentAttempt.analysis.four_tier_category === "SC"
                      ? "Kesimpulan dan penalaran fisis konsisten dengan kunci ilmiah (Sound Understanding)."
                      : currentAttempt.analysis.explanation.split("\n")[0] || currentAttempt.analysis.explanation}
                  </p>

                  {showAiDetails && (
                    <div className="pt-2 mt-1.5 border-t border-outline-variant/20 text-xs space-y-1.5 text-on-surface-variant animate-fade-in">
                      <div className="bg-surface-container-lowest p-2.5 rounded-lg border border-outline-variant/25 whitespace-pre-wrap leading-relaxed">
                        {currentAttempt.analysis.explanation}
                      </div>
                      <div className="flex items-center justify-between text-[11px] font-mono-ui text-on-surface-variant/80">
                        <span>Tingkat Keyakinan Model AI: {Number(currentAttempt.analysis.confidence).toFixed(2)}</span>
                        <span>Waktu Analisis: {currentAttempt.analysis.execution_time_ms ?? "-"} ms</span>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* KEPUTUSAN VALIDASI DOSEN */}
              {currentAttempt?.analysis ? (
                <section
                  className={`rounded-xl border-2 transition-all p-4 sm:p-5 space-y-3.5 shadow-sm ${
                    isLocked
                      ? "border-emerald-500/30 bg-surface-container-low/50"
                      : isAlreadyValidated
                      ? "border-amber-500/50 bg-surface-container-low"
                      : "border-primary/40 bg-surface-container-low"
                  }`}
                >
                  <div className="flex items-center justify-between border-b border-outline-variant/20 pb-2.5">
                    <div className="flex items-center gap-2">
                      {isLocked ? (
                        <Lock size={16} className="text-emerald-600 dark:text-emerald-400" />
                      ) : (
                        <ShieldCheck size={18} className="text-primary" />
                      )}
                      <h3 className="text-xs font-bold uppercase tracking-wider text-on-surface">
                        KEPUTUSAN VALIDASI DOSEN
                      </h3>
                    </div>

                    <div>
                      {isLocked ? (
                        <span className="text-xs font-semibold text-emerald-700 dark:text-emerald-400 bg-emerald-500/10 px-2.5 py-0.5 rounded-full border border-emerald-500/30 inline-flex items-center gap-1.5">
                          ✓ Sudah Divalidasi ({VALIDATION_STATUS_LABEL[currentAttempt.analysis.validation?.status ?? "ACCEPTED"]})
                        </span>
                      ) : isFormModified ? (
                        <span className="text-xs font-semibold text-amber-500 dark:text-amber-400 bg-amber-500/10 px-2.5 py-0.5 rounded-full border border-amber-500/30 inline-flex items-center gap-1">
                          ● Ada perubahan belum disimpan
                        </span>
                      ) : (
                        <span className="text-xs font-semibold text-on-surface-variant bg-surface-container px-2.5 py-0.5 rounded-full border border-outline-variant/30">
                          Menunggu Validasi
                        </span>
                      )}
                    </div>
                  </div>

                  {isLocked ? (
                    <div className="space-y-3 pt-1">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                        <div className="bg-surface-container-lowest p-3 rounded-lg border border-outline-variant/25">
                          <span className="text-[11px] font-bold uppercase tracking-wider text-on-surface-variant block mb-1">
                            STATUS BUTIR INI
                          </span>
                          <span
                            className={`font-mono-ui text-lg font-extrabold inline-flex items-center gap-1.5 ${
                              isCorrect ? "text-emerald-500" : "text-rose-500"
                            }`}
                          >
                            {isCorrect ? <CheckCircle2 size={18} /> : <XCircle size={18} />}
                            {isCorrect ? "Benar" : "Salah"}
                          </span>
                        </div>

                        <div className="bg-surface-container-lowest p-3 rounded-lg border border-outline-variant/25">
                          <span className="text-[11px] font-bold uppercase tracking-wider text-on-surface-variant block mb-1">
                            DIAGNOSIS AKHIR DOSEN
                          </span>
                          <span
                            className={`font-mono-ui text-xs font-bold inline-flex items-center gap-1.5 py-0.5 px-2.5 rounded-full ${
                              CATEGORY_STYLES[finalCategory]?.badgeCls
                            }`}
                          >
                            [{finalCategory}] {CATEGORY_STYLES[finalCategory]?.label ?? finalCategory}
                          </span>
                        </div>
                      </div>

                      <div className="bg-surface-container-lowest p-3 rounded-lg border border-outline-variant/25">
                        <span className="text-[11px] font-bold uppercase tracking-wider text-on-surface-variant block mb-1">
                          FEEDBACK UNTUK MAHASISWA
                        </span>
                        <p className="text-xs text-on-surface leading-relaxed whitespace-pre-wrap">
                          {feedback || "Tidak ada umpan balik tertulis."}
                        </p>
                      </div>

                      <div className="pt-2 flex items-center justify-between border-t border-outline-variant/20">
                        <span className="text-[11px] text-on-surface-variant">
                          Divalidasi oleh: <strong className="text-on-surface">{currentAttempt.analysis.validation?.lecturer_name}</strong>
                          {currentAttempt.analysis.validation?.validated_at && (
                            <> ({fmtDate(currentAttempt.analysis.validation.validated_at)})</>
                          )}
                        </span>

                        <button
                          type="button"
                          onClick={() => setIsUnlocked(true)}
                          className="btn-secondary !py-1.5 !px-3 text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
                        >
                          <Unlock size={13} /> Buka Kunci untuk Koreksi
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-3.5">
                      {isAlreadyValidated && (
                        <div className="flex items-center justify-between bg-amber-500/10 border border-amber-500/30 rounded-lg px-3 py-1.5 text-xs text-amber-300">
                          <span className="inline-flex items-center gap-1.5 font-semibold">
                            <Unlock size={13} /> Mode Koreksi Aktif: Anda sedang mengedit validasi yang sudah tersimpan.
                          </span>
                          <button
                            type="button"
                            onClick={handleCancelUnlock}
                            className="text-amber-400 hover:underline font-semibold cursor-pointer text-[11px]"
                          >
                            Batal Koreksi
                          </button>
                        </div>
                      )}

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-start">
                        {/* Status Biner: Benar / Salah (Softer, Refined Color Intensity) */}
                        <div>
                          <label className="block text-xs font-bold uppercase tracking-wider text-on-surface mb-1">
                            PENILAIAN BUTIR SOAL INI
                          </label>
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => setIsCorrect(true)}
                              className={`flex-1 py-2 px-3 rounded-lg border text-xs font-mono-ui cursor-pointer transition-all ${
                                isCorrect
                                  ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/50 font-bold ring-1 ring-emerald-500/25 shadow-sm"
                                  : "bg-surface-container text-on-surface-variant border-outline-variant/40 hover:bg-surface-container-high hover:text-on-surface"
                              }`}
                            >
                              🟢 Benar
                            </button>
                            <button
                              type="button"
                              onClick={() => setIsCorrect(false)}
                              className={`flex-1 py-2 px-3 rounded-lg border text-xs font-mono-ui cursor-pointer transition-all ${
                                !isCorrect
                                  ? "bg-rose-500/15 text-rose-700 dark:text-rose-400 border-rose-500/50 font-bold ring-1 ring-rose-500/25 shadow-sm"
                                  : "bg-surface-container text-on-surface-variant border-outline-variant/40 hover:bg-surface-container-high hover:text-on-surface"
                              }`}
                            >
                              🔴 Salah
                            </button>
                          </div>
                          <div className="mt-1.5 text-xs text-on-surface-variant flex items-center gap-1.5">
                            <span>
                              Rekomendasi AI:{" "}
                              <strong className="text-on-surface font-mono-ui">
                                {isAiPredictedCorrect ? "Benar" : "Salah"}
                              </strong>
                            </span>
                            <span className="text-outline-variant">·</span>
                            <button
                              type="button"
                              onClick={resetToAiValues}
                              className="text-primary hover:underline font-semibold cursor-pointer inline-flex items-center gap-0.5"
                              title="Gunakan nilai rekomendasi AI"
                            >
                              <RotateCcw size={10} /> Reset ke AI
                            </button>
                          </div>
                        </div>

                        {/* Diagnosis Akhir Dosen */}
                        <div>
                          <span className="block text-xs font-bold uppercase tracking-wider text-on-surface mb-1">
                            DIAGNOSIS AKHIR DOSEN
                          </span>
                          <AppSelect
                            value={finalCategory}
                            onValueChange={(val) => setFinalCategory(val)}
                            className="w-full text-xs font-medium"
                            ariaLabel="Pilih Diagnosis Akhir Dosen"
                            options={[
                              { value: "SC", label: "[SC] Sound Understanding" },
                              { value: "LK", label: "[LK] Lack of Knowledge" },
                              { value: "FP", label: "[FP] False Positive" },
                              { value: "MSC", label: "[MSC] Misconception" },
                              { value: "FN", label: "[FN] False Negative" },
                            ]}
                          />
                          <span className="text-xs text-on-surface-variant mt-1.5 flex items-center gap-1.5">
                            AI merekomendasikan:{" "}
                            <strong
                              className={`font-mono-ui text-[11px] font-bold px-2 py-0.5 rounded-md ${
                                CATEGORY_STYLES[currentAttempt.analysis.four_tier_category ?? "LK"]?.badgeCls
                              }`}
                            >
                              [{currentAttempt.analysis.four_tier_category}] {categoryMeta?.label}
                            </strong>
                          </span>
                        </div>

                        {/* Feedback Textarea */}
                        <div className="sm:col-span-2">
                          <label
                            htmlFor="feedback"
                            className="block text-xs font-bold uppercase tracking-wider text-on-surface mb-1"
                          >
                            FEEDBACK UNTUK MAHASISWA
                          </label>
                          <textarea
                            id="feedback"
                            rows={3}
                            value={feedback}
                            onChange={(e) => setFeedback(e.target.value)}
                            className="form-input w-full text-xs leading-relaxed resize-y"
                            placeholder="Tuliskan umpan balik atau bimbingan konsep yang akan dibaca oleh mahasiswa pada lembar evaluasinya..."
                          />
                        </div>
                      </div>

                      {showRejectBox && (
                        <div className="rounded-lg border border-dashed border-error/40 bg-error-container/20 p-3 space-y-2">
                          <div className="flex items-center justify-between text-xs font-bold text-error">
                            <span className="inline-flex items-center gap-1.5">
                              <XCircle size={14} /> Tolak &amp; Minta Analisis Ulang AI
                            </span>
                            <button
                              type="button"
                              onClick={() => setShowRejectBox(false)}
                              className="text-xs text-on-surface-variant hover:text-on-surface cursor-pointer"
                            >
                              Batal
                            </button>
                          </div>
                          <textarea
                            rows={2}
                            value={notes}
                            onChange={(e) => setNotes(e.target.value)}
                            placeholder="Jelaskan alasan penolakan agar model AI dapat memperbaiki analisis ulangnya..."
                            className="form-input w-full text-xs"
                          />
                          <div className="flex justify-end pt-1">
                            <button
                              type="button"
                              onClick={() => handleValidationSubmit("REJECTED")}
                              disabled={submittingValidation}
                              className="btn-danger !py-1.5 !px-3.5 text-xs font-semibold cursor-pointer"
                            >
                              Konfirmasi Tolak &amp; Re-analisis
                            </button>
                          </div>
                        </div>
                      )}

                      <div className="pt-2 border-t border-outline-variant/20 flex items-center justify-between gap-3">
                        {!showRejectBox ? (
                          <button
                            type="button"
                            onClick={() => setShowRejectBox(true)}
                            className="btn-danger !py-2 !px-3.5 text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
                          >
                            <XCircle size={14} /> Tolak &amp; Re-analisis
                          </button>
                        ) : (
                          <div />
                        )}

                        <div className="flex items-center gap-2">
                          {isAlreadyValidated && (
                            <button
                              type="button"
                              onClick={handleCancelUnlock}
                              className="btn-secondary !py-2 !px-3.5 text-xs font-semibold cursor-pointer"
                            >
                              Batal
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => handleValidationSubmit()}
                            disabled={submittingValidation}
                            className="btn-primary !py-2 !px-5 text-xs font-bold inline-flex items-center gap-1.5 shadow-sm cursor-pointer"
                          >
                            <ShieldCheck size={16} />
                            {submittingValidation ? "Menyimpan..." : isAlreadyValidated ? "Simpan Perubahan" : "Simpan Validasi"}
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </section>
              ) : (
                <div className="rounded-xl border border-outline-variant/40 bg-surface-container-lowest p-4 text-center text-xs text-on-surface-variant">
                  {currentAttempt?.status === "ANALYZING"
                    ? "Model AI sedang menganalisis tanggapan ini."
                    : currentAttempt?.status === "ANALYSIS_FAILED"
                      ? "Analisis AI mengalami kendala dan dijadwalkan ulang oleh sistem."
                      : "Belum ada analisis AI yang tersedia untuk divalidasi pada butir soal ini."}
                </div>
              )}

              {/* NAVIGASI INLINE */}
              <div className="flex items-center justify-between pt-2.5 border-t border-outline-variant/20">
                <button
                  type="button"
                  onClick={() => {
                    setActiveQuestionIdx((prev) => Math.max(0, prev - 1));
                    window.scrollTo({ top: 0, behavior: "smooth" });
                  }}
                  disabled={activeQuestionIdx === 0}
                  className="btn-secondary !py-1.5 !px-3.5 text-xs font-semibold disabled:opacity-30 cursor-pointer inline-flex items-center gap-1.5"
                >
                  <ChevronLeft size={14} /> Soal Sebelumnya
                </button>

                <span className="text-xs font-mono-ui font-semibold text-on-surface-variant">
                  Soal {activeQuestionIdx + 1} dari {data.questions.length}
                </span>

                <button
                  type="button"
                  onClick={() => {
                    setActiveQuestionIdx((prev) =>
                      Math.min(data.questions.length - 1, prev + 1)
                    );
                    window.scrollTo({ top: 0, behavior: "smooth" });
                  }}
                  disabled={activeQuestionIdx === data.questions.length - 1}
                  className="btn-secondary !py-1.5 !px-3.5 text-xs font-semibold disabled:opacity-30 cursor-pointer inline-flex items-center gap-1.5"
                >
                  Soal Berikutnya <ArrowRight size={14} />
                </button>
              </div>
            </section>
          </main>

          {/* KOLOM KANAN: DAFTAR SOAL + KARTU NILAI AKHIR (100%, 75%, 50%, ETC) */}
          <aside className="w-full lg:w-52 shrink-0 lg:sticky lg:top-6 space-y-3">
            {/* 1. KOTAK DAFTAR SOAL */}
            <div className="rounded-xl border border-outline-variant/40 bg-surface-container-lowest p-3.5 shadow-sm">
              <div className="flex items-center justify-between border-b border-outline-variant/30 pb-2.5">
                <h3 className="font-bold text-xs text-on-surface uppercase tracking-wide">Daftar Soal</h3>
                <span className="text-xs text-on-surface-variant font-mono-ui">
                  {data.questions.length} Soal
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-2 py-3">
                {data.questions.map((q, idx) => {
                  const isCurrent = idx === activeQuestionIdx;
                  const isAnswered = q.attempts.length > 0;
                  const hasPendingValidation = q.attempts.some(
                    (a) => a.status === "PENDING_VALIDATION"
                  );
                  const isValidated =
                    q.attempts.length > 0 &&
                    q.attempts[0].status === "VALIDATED";
                  const isCorrectItem =
                    isValidated &&
                    Number(q.attempts[0]?.analysis?.validation?.final_percentage ?? q.attempts[0]?.analysis?.percentage_correct ?? 0) >= 99.9;

                  let boxBorderCls = "border-outline-variant/50 bg-surface-container text-on-surface-variant";
                  let dotColor = "bg-slate-400";
                  let statusTitle = "Belum Dijawab";

                  if (isValidated) {
                    if (isCorrectItem) {
                      boxBorderCls = "border-emerald-500/60 bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 font-bold";
                      dotColor = "bg-emerald-400";
                      statusTitle = "Jawaban Benar";
                    } else {
                      boxBorderCls = "border-rose-500/60 bg-rose-500/15 text-rose-600 dark:text-rose-400 font-bold";
                      dotColor = "bg-rose-400";
                      statusTitle = "Jawaban Salah";
                    }
                  } else if (hasPendingValidation) {
                    boxBorderCls = "border-amber-500/60 bg-amber-500/15 text-amber-600 dark:text-amber-400 font-bold";
                    dotColor = "bg-amber-400";
                    statusTitle = "Menunggu Validasi";
                  } else if (isAnswered) {
                    boxBorderCls = "border-blue-500/60 bg-blue-500/15 text-blue-600 dark:text-blue-400 font-bold";
                    dotColor = "bg-blue-400";
                    statusTitle = "Tersimpan";
                  }

                  return (
                    <button
                      key={q.question_id}
                      type="button"
                      onClick={() => {
                        setActiveQuestionIdx(idx);
                        window.scrollTo({ top: 0, behavior: "smooth" });
                      }}
                      className={`relative flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border font-mono-ui text-xs transition-all cursor-pointer shadow-sm ${boxBorderCls} ${
                        isCurrent
                          ? "ring-2 ring-primary ring-offset-2 ring-offset-surface-container-lowest font-extrabold !text-white !bg-primary !border-primary"
                          : "hover:border-primary/60"
                      }`}
                      title={`Soal ${idx + 1}: ${statusTitle}`}
                    >
                      {idx + 1}
                      <span
                        className={`absolute -top-1 -right-1 h-2 w-2 rounded-full border border-surface-container-lowest ${dotColor}`}
                      />
                    </button>
                  );
                })}
              </div>

              <div className="pt-2 border-t border-outline-variant/30 space-y-1 text-[11px] text-on-surface-variant font-medium">
                <div className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-emerald-400 shrink-0" />
                  <span>Jawaban Benar</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-rose-400 shrink-0" />
                  <span>Jawaban Salah</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-amber-400 shrink-0" />
                  <span>Menunggu Validasi</span>
                </div>
              </div>
            </div>

            {/* 2. KARTU NILAI AKHIR (SEPERTI 100%, 75%, 50%, ETC) TEPAT DI BAWAH KOTAK DAFTAR SOAL */}
            <div className="rounded-xl border border-outline-variant/40 bg-surface-container-lowest p-4 shadow-sm">
              <span className="text-xs font-bold uppercase tracking-wider text-on-surface-variant block">
                Nilai Akhir:
              </span>
              <span className="font-mono-ui text-3xl font-black text-on-surface mt-1.5 block">
                {fmtPct(summary?.overall_score ?? 0)}
              </span>
            </div>
          </aside>
        </div>
      ) : null}
    </PageContainer>
  );
}