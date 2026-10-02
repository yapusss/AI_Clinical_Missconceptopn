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
  HelpCircle,
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
  model_answer: string;
  status: string;
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

// STANDAR WARNA & DESKRIPSI UNTUK 5 KATEGORI FOUR-TIER
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

  // Form State
  const [finalPct, setFinalPct] = useState("");
  const [finalCategory, setFinalCategory] = useState<string>("LK");
  const [feedback, setFeedback] = useState("");
  const [notes, setNotes] = useState("");
  const [showRejectBox, setShowRejectBox] = useState(false);
  const [showAiDetails, setShowAiDetails] = useState(false);
  const [showScoreBasis, setShowScoreBasis] = useState(false);
  const [isUnlocked, setIsUnlocked] = useState(false);
  const [submittingValidation, setSubmittingValidation] = useState(false);

  const load = useCallback(async () => {
    if (!setId || !studentId) return;
    setFetching(true);
    setError("");
    try {
      const res = await apiFetch<PackageReview>(
        `/questions/${setId}/students/${studentId}/review`
      );
      setData(res);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Gagal memuat review paket."
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

  const allQuestionsValidated = useMemo(() => {
    if (!data?.questions?.length) return false;
    return data.questions.every(
      (q) => q.attempts.length > 0 && q.attempts[0].status === "VALIDATED"
    );
  }, [data]);

  // Sinkronisasi data saat berpindah soal atau percobaan
  useEffect(() => {
    if (!currentAttempt || !currentAttempt.analysis) return;
    const a = currentAttempt.analysis;
    const v = a.validation;

    setFinalPct(v?.final_percentage ?? a.percentage_correct);
    setFinalCategory(a.four_tier_category ?? "LK");
    setFeedback(v?.final_feedback ?? a.explanation);
    setNotes("");
    setShowRejectBox(false);
    setShowAiDetails(false);
    setShowScoreBasis(false);
    setIsUnlocked(false);
  }, [currentAttempt]);

  const isAlreadyValidated = Boolean(currentAttempt?.analysis?.validation);
  const isLocked = isAlreadyValidated && !isUnlocked;

  // Deteksi perubahan yang belum disimpan
  const isFormModified = useMemo(() => {
    if (!currentAttempt?.analysis) return false;
    const a = currentAttempt.analysis;
    const v = a.validation;
    const initialPct = v?.final_percentage ?? a.percentage_correct;
    const initialCat = a.four_tier_category ?? "LK";
    const initialFeedback = v?.final_feedback ?? a.explanation;

    return (
      Math.abs(Number(finalPct) - Number(initialPct)) > 0.01 ||
      finalCategory !== initialCat ||
      feedback.trim() !== initialFeedback.trim() ||
      notes.trim().length > 0
    );
  }, [currentAttempt, finalPct, finalCategory, feedback, notes]);

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
      if (finalPct === "" || isNaN(Number(finalPct))) {
        setError("Peringatan: Masukkan Skor Akhir Dosen (%) berupa angka valid.");
        return;
      }
      const numPct = Number(finalPct);
      if (numPct < 0 || numPct > 100) {
        setError("Peringatan: Skor Akhir harus berada di rentang 0 sampai 100.");
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
    setFinalPct(currentAttempt.analysis.percentage_correct);
    setFinalCategory(currentAttempt.analysis.four_tier_category ?? "LK");
    setFeedback(currentAttempt.analysis.explanation);
  };

  const handleCancelUnlock = () => {
    if (!currentAttempt?.analysis) return;
    const a = currentAttempt.analysis;
    const v = a.validation;
    setFinalPct(v?.final_percentage ?? a.percentage_correct);
    setFinalCategory(a.four_tier_category ?? "LK");
    setFeedback(v?.final_feedback ?? a.explanation);
    setIsUnlocked(false);
  };

  const categoryMeta = currentAttempt?.analysis?.four_tier_category
    ? CATEGORY_STYLES[currentAttempt.analysis.four_tier_category] ?? CATEGORY_STYLES.LK
    : null;

  if (loading || !user) return null;

  return (
    <PageContainer>
      {/* Tombol Navigasi Kembali */}
      <Link
        href={`/questions/${setId}`}
        className="inline-flex items-center gap-1.5 text-xs font-semibold text-on-surface-variant hover:text-primary no-underline transition-colors"
      >
        <ArrowLeft size={14} /> Kembali ke daftar mahasiswa
      </Link>

      {/* Header Evaluasi */}
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
              <span className="badge badge-role font-mono-ui text-xs">
                {data.total_attempts_count} Percobaan Total
              </span>
            </div>
          }
        />
      )}

      {/* Banner Penyelesaian Paket */}
      {allQuestionsValidated && (
        <div className="mt-3 rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-3.5 text-emerald-600 dark:text-emerald-400 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 animate-fade-in shadow-sm">
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 bg-emerald-500/20 rounded-lg shrink-0">
              <CheckCircle2 size={18} className="text-emerald-600 dark:text-emerald-400" />
            </div>
            <div>
              <h4 className="text-xs font-bold text-on-surface">
                Seluruh Soal Mahasiswa Ini Telah Tervalidasi
              </h4>
              <p className="text-[11px] text-on-surface-variant mt-0.5">
                Semua butir soal telah diberi skor dan umpan balik final.
              </p>
            </div>
          </div>
          <Link
            href={`/questions/${setId}`}
            className="btn-primary !py-1.5 !px-3.5 text-xs font-semibold inline-flex items-center gap-1.5 shrink-0 self-start sm:self-auto"
          >
            Kembali ke Rekap Kelas <ArrowRight size={13} />
          </Link>
        </div>
      )}

      {/* Alert Error / Sukses */}
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
          {/* KOLOM KIRI (FLEX-1): WORKBENCH EVALUASI & VALIDASI */}
          <main className="flex-1 min-w-0 space-y-4">
            <section className="glass-panel rounded-2xl border border-outline-variant/40 shadow-sm p-4 sm:p-5 space-y-4">
              {/* Header Kartu: Nomor Soal & Status */}
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
                  {/* Selector Percobaan */}
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

                  {/* Badge Status Soal */}
                  {currentAttempt ? (
                    <span className={`badge ${STATUS_BADGE[currentAttempt.status]?.cls} text-xs`}>
                      {STATUS_BADGE[currentAttempt.status]?.label}
                    </span>
                  ) : (
                    <span className="badge badge-draft text-xs">Belum Dijawab</span>
                  )}
                </div>
              </div>

              {/* 1. KOMPARASI KONSEPTUAL: SOAL vs JAWABAN MAHASISWA */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5 items-stretch">
                {/* Kolom Kiri: Soal & Kunci Model */}
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
                      Jawaban Referensi (Kebenaran Ilmiah)
                    </span>
                    <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-on-surface bg-surface-container-lowest p-2.5 rounded-lg border border-outline-variant/20">
                      {activeQuestion.model_answer}
                    </p>
                  </div>
                </div>

                {/* Kolom Kanan: Jawaban Mahasiswa (Font UI Standar, Proporsional) */}
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

                    {/* Penanda Heuristik Antar-Tier */}
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

                    {/* Tier 1 (Kesimpulan) */}
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

                  {/* Tier 3 (Alasan Ilmiah) */}
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

              {/* 2. STRIP REKOMENDASI AI (KOMPAK, 1 BARIS SUMMARY DENGAN KONSISTENSI WARNA) */}
              {currentAttempt?.analysis && (
                <div className="rounded-xl border border-outline-variant/40 bg-surface-container-low/70 px-3.5 py-2.5 space-y-1.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs font-bold uppercase tracking-wider text-on-surface-variant flex items-center gap-1.5">
                        <BrainCircuit size={14} className="text-primary" /> REKOMENDASI AI:
                      </span>

                      {/* Badge Kategori dengan Warna Terpadu */}
                      <span
                        className={`font-mono-ui text-xs font-bold cursor-help inline-flex items-center gap-1.5 py-0.5 px-2.5 rounded-full ${
                          CATEGORY_STYLES[currentAttempt.analysis.four_tier_category ?? "LK"]?.badgeCls
                        }`}
                        title={categoryMeta?.detailExpl}
                      >
                        [{currentAttempt.analysis.four_tier_category}] {categoryMeta?.label}
                        <Info size={11} className="opacity-70" />
                      </span>

                      {/* Skor Rekomendasi AI dengan Popover Perhitungan */}
                      <div className="relative inline-block">
                        <button
                          type="button"
                          onClick={() => setShowScoreBasis((prev) => !prev)}
                          className="font-mono-ui font-bold text-xs text-primary bg-primary/10 hover:bg-primary/20 px-2.5 py-0.5 rounded border border-primary/20 inline-flex items-center gap-1 cursor-pointer transition-colors"
                          title="Klik untuk melihat dasar perhitungan rekomendasi skor AI"
                        >
                          Skor: {Number(currentAttempt.analysis.percentage_correct).toFixed(1)}%
                          <HelpCircle size={11} className="opacity-75" />
                        </button>

                        {/* Popover Dasar Penilaian Skor */}
                        {showScoreBasis && (
                          <div className="absolute left-0 top-full mt-1.5 z-30 w-72 p-3.5 rounded-xl border border-outline-variant/60 bg-surface-container-lowest shadow-2xl text-xs space-y-2 animate-fade-in">
                            <div className="font-bold text-on-surface border-b border-outline-variant/30 pb-1.5 flex items-center justify-between">
                              <span>Dasar Rekomendasi Skor</span>
                              <button
                                type="button"
                                onClick={() => setShowScoreBasis(false)}
                                className="text-on-surface-variant hover:text-on-surface text-sm"
                              >
                                ×
                              </button>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-on-surface-variant">Kesimpulan (Tier 1):</span>
                              <strong className="text-on-surface font-mono-ui">
                                {currentAttempt.analysis.module_a_score}{" "}
                                ({currentAttempt.analysis.module_a_score === "BENAR" ? "+30%" : currentAttempt.analysis.module_a_score === "BENAR_SEBAGIAN" ? "+15%" : "+0%"})
                              </strong>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-on-surface-variant">Alasan Ilmiah (Tier 3):</span>
                              <strong className="text-on-surface font-mono-ui">
                                {currentAttempt.analysis.module_b_score}{" "}
                                (+{(Number(currentAttempt.analysis.percentage_correct) - (currentAttempt.analysis.module_a_score === "BENAR" ? 30 : currentAttempt.analysis.module_a_score === "BENAR_SEBAGIAN" ? 15 : 0)).toFixed(1)}%)
                              </strong>
                            </div>
                            <div className="flex justify-between border-t border-outline-variant/20 pt-1.5 font-bold text-primary font-mono-ui">
                              <span>Total Skor AI:</span>
                              <span>{Number(currentAttempt.analysis.percentage_correct).toFixed(1)}%</span>
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Status Modul T1 & T3 */}
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

                  {/* Summary 1 Kalimat Temuan AI */}
                  <p className="text-xs text-on-surface-variant leading-relaxed">
                    <strong className="text-on-surface">Temuan: </strong>
                    {currentAttempt.analysis.four_tier_category === "FP"
                      ? "Jawaban benar, tetapi alasan/penalaran menunjukkan miskonsepsi."
                      : currentAttempt.analysis.four_tier_category === "SC"
                      ? "Jawaban dan penalaran konsisten dengan konsep acuan ilmiah."
                      : currentAttempt.analysis.explanation.split("\n")[0] || currentAttempt.analysis.explanation}
                  </p>

                  {/* Detail Tambahan AI (Expandable) */}
                  {showAiDetails && (
                    <div className="pt-2 mt-1.5 border-t border-outline-variant/20 text-xs space-y-1.5 text-on-surface-variant animate-fade-in">
                      <div className="bg-surface-container-lowest p-2.5 rounded-lg border border-outline-variant/25 whitespace-pre-wrap leading-relaxed">
                        {currentAttempt.analysis.explanation}
                      </div>
                      <div className="flex items-center justify-between text-[11px] font-mono-ui text-on-surface-variant/80">
                        <span>Kepercayaan AI: {Number(currentAttempt.analysis.confidence).toFixed(2)}</span>
                        <span>Waktu Analisis: {currentAttempt.analysis.execution_time_ms ?? "-"} ms</span>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* 3. KEPUTUSAN VALIDASI DOSEN (DENGAN LOCK STATE PASCA-VALIDASI) */}
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

                    {/* Indikator Status Validasi */}
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

                  {/* KONDISI TERKUNCI (READ-ONLY VIEW) */}
                  {isLocked ? (
                    <div className="space-y-3 pt-1">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                        <div className="bg-surface-container-lowest p-3 rounded-lg border border-outline-variant/25">
                          <span className="text-[11px] font-bold uppercase tracking-wider text-on-surface-variant block mb-1">
                            SKOR AKHIR DOSEN
                          </span>
                          <span className="font-mono-ui text-2xl font-extrabold text-primary">
                            {Number(finalPct).toFixed(1)}%
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
                    /* KONDISI FORM EDITABLE */
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

                      {/* Input Skor Akhir & Diagnosis Akhir */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-start">
                        {/* Skor Akhir Dosen */}
                        <div>
                          <label
                            htmlFor="final-pct"
                            className="block text-xs font-bold uppercase tracking-wider text-on-surface mb-1"
                          >
                            SKOR AKHIR DOSEN (%)
                          </label>
                          <input
                            id="final-pct"
                            type="number"
                            min={0}
                            max={100}
                            step={0.1}
                            value={finalPct}
                            onChange={(e) => setFinalPct(e.target.value)}
                            className="form-input w-32 text-sm font-mono-ui font-bold"
                          />
                          <div className="mt-1 text-xs text-on-surface-variant flex items-center gap-1.5">
                            <span>
                              Rekomendasi AI: <strong className="text-on-surface font-mono-ui">{Number(currentAttempt.analysis.percentage_correct).toFixed(1)}%</strong>
                            </span>
                            <span className="text-outline-variant">·</span>
                            <button
                              type="button"
                              onClick={resetToAiValues}
                              className="text-primary hover:underline font-semibold cursor-pointer inline-flex items-center gap-0.5"
                              title="Gunakan nilai rekomendasi AI"
                            >
                              <RotateCcw size={10} /> Gunakan
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
                          <p className="text-[11px] text-on-surface-variant mt-1">
                            Feedback ini akan diterima mahasiswa setelah validasi disimpan.
                          </p>
                        </div>
                      </div>

                      {/* Mode Tolak & Re-analisis */}
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

                      {/* Bar Tombol Simpan / Tolak */}
                      <div className="pt-2 border-t border-outline-variant/20 flex items-center justify-between gap-3">
                        {!showRejectBox ? (
                          <button
                            type="button"
                            onClick={() => setShowRejectBox(true)}
                            className="btn-danger !py-2 !px-3.5 text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
                            title="Tolak analisis AI dan jadwalkan analisis ulang"
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

              {/* NAVIGASI INLINE DI BAWAH KARTU */}
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

          {/* KOLOM KANAN (LG:W-52 RAMPING): DAFTAR NOMOR SOAL STICKY */}
          <aside className="w-full lg:w-52 shrink-0 lg:sticky lg:top-6 space-y-3">
            <div className="rounded-xl border border-outline-variant/40 bg-surface-container-lowest p-3.5 shadow-sm">
              <div className="flex items-center justify-between border-b border-outline-variant/30 pb-2.5">
                <h3 className="font-bold text-xs text-on-surface uppercase tracking-wide">Daftar Soal</h3>
                <span className="text-xs text-on-surface-variant font-mono-ui">
                  {data.questions.length} Soal
                </span>
              </div>

              {/* Grid Kotak Nomor Soal */}
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

                  let boxBorderCls = "border-outline-variant/50 bg-surface-container text-on-surface-variant";
                  let dotColor = "bg-slate-400";
                  let statusTitle = "Belum Dijawab";

                  if (isValidated) {
                    boxBorderCls = "border-emerald-500/60 bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 font-bold";
                    dotColor = "bg-emerald-400";
                    statusTitle = "Tervalidasi Dosen";
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

                      {/* Dot Indikator Status */}
                      <span
                        className={`absolute -top-1 -right-1 h-2 w-2 rounded-full border border-surface-container-lowest ${dotColor}`}
                      />
                    </button>
                  );
                })}
              </div>

              {/* Legenda Status Kotak */}
              <div className="pt-2 border-t border-outline-variant/30 space-y-1 text-[11px] text-on-surface-variant font-medium">
                <div className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-emerald-400 shrink-0" />
                  <span>Tervalidasi</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-amber-400 shrink-0" />
                  <span>Menunggu Validasi</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-blue-400 shrink-0" />
                  <span>Tersimpan</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-slate-400 shrink-0" />
                  <span>Belum Dijawab</span>
                </div>
              </div>
            </div>
          </aside>
        </div>
      ) : null}
    </PageContainer>
  );
}