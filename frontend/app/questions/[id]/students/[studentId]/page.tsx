"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  AlertTriangle,
  ArrowRight,
  BrainCircuit,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronUp,
  ClipboardCheck,
  Lock,
  RotateCcw,
  ShieldCheck,
  Unlock,
  X,
  XCircle,
} from "lucide-react";

import { useAuth } from "../../../../components/AuthProvider";
import AppSelect from "../../../../components/AppSelect";
import PageHeader from "../../../../components/PageHeader";
import PageContainer from "../../../../components/PageContainer";
import ReadingMaterial from "../../../../components/ReadingMaterial";
import RichTextContent from "../../../../components/RichTextContent";
import MathContent from "../../../../components/MathContent";
import { apiFetch } from "../../../../lib/api";
import type {
  CatalogMatch,
  EvidenceSpan,
  GroundingReference,
  LearnedTopic,
  MissingConcept,
  StudentReadingMaterial,
} from "../../../../lib/studentSubmissions";
import FeedbackModal from "../../../../components/FeedbackModal";

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
    references?: GroundingReference[];
    what_should_be_learned?: LearnedTopic[];
    suggested_materials?: LearnedTopic[];
    // C7: the material the LLM wrote for this question, or `null`.
    reading_material?: StudentReadingMaterial | null;
    // v3.2: the sentence-level anchor to the misconception, or `null`.
    evidence_span?: EvidenceSpan | null;
    // Phase 6: the catalogue mapping (lecturer-only) and the missing-concept list.
    catalog_match?: CatalogMatch | null;
    missing_concepts?: MissingConcept[];
    validation: {
      status: string;
      final_percentage: string | null;
      final_tier_level: number | null;
      // Migration 0031: the diagnosis itself. The level above cannot distinguish FP from
      // MSC (both are level 2), so this is the field the lecturer's choice lives in.
      final_category: string | null;
      final_feedback: string | null;
      lecturer_name: string;
      validated_at: string | null;
    } | null;
  } | null;
};

type QuestionReviewItem = {
  question_id: string;
  order_index: number;
  version_id: string;
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

// Skor butir bersifat biner: 100 hanya bila Modul A dan B sama-sama BENAR,
// yang setara dengan level 4 (SC). Karena itu hanya [SC] yang konsisten dengan
// keputusan "Benar"; kombinasi lain menulis final_percentage yang bertentangan
// dengan final_tier_level (0% + level 4, atau 100% + level < 4).
//
// Tetap diperingatkan di KEDUA arah, tetapi ringkas: cukup chip
// "Kontradiktif: Salah + [SC] → 0% · level 4" — penjelasan panjangnya yang
// mengganggu, bukan peringatannya. Tidak pernah memblokir; koreksi dosen boleh
// parsial dan kombinasi ini kadang disengaja.
const isDraftContradictory = (draft: {
  isCorrect: boolean;
  finalCategory: string;
}) => draft.isCorrect !== (draft.finalCategory === "SC");

// Nilai awal satu percobaan: validasi yang sudah tersimpan bila ada, selain itu
// rekomendasi AI. Satu sumber kebenaran untuk pra-isi formulir dan untuk patch.
const draftBaseValues = (analysis: NonNullable<AttemptItem["analysis"]>) => {
  const v = analysis.validation;
  const score =
    v?.final_percentage !== null && v?.final_percentage !== undefined
      ? Number(v.final_percentage)
      : Number(analysis.percentage_correct);
  return {
    isCorrect: score >= 99.9,
    finalCategory: analysis.four_tier_category ?? "LK",
  };
};

// Status yang berarti "sedang/akan dianalisis (ulang) oleh AI" — validasi
// belum bisa diselesaikan selama ada soal pada status ini.
const IN_FLIGHT_STATUSES = ["SUBMITTED", "ANALYZING", "ANALYSIS_FAILED"];

// Mirror backend LLM_MAX_RUNS default (worker caps re-analysis runs per submission).
const MAX_ANALYSIS_RUNS = 3;

// Pagination for the Ringkasan table.
const SUMMARY_PAGE_SIZE = 10;

const CATEGORY_STYLES: Record<
  string,
  { badgeCls: string; label: string; desc: string; detailExpl: string }
> = {
  SC: {
    badgeCls:
      "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border border-emerald-500/40",
    label: "Sound Understanding",
    desc: "Paham konsep secara utuh dan konsisten.",
    detailExpl:
      "Sound Understanding: Mahasiswa memahami konsep ilmiah secara utuh dan konsisten.",
  },
  LK: {
    badgeCls:
      "bg-sky-500/15 text-sky-700 dark:text-sky-400 border border-sky-500/40",
    label: "Lack of Knowledge",
    desc: "Kurang pengetahuan, ragu-ragu, atau menebak.",
    detailExpl:
      "Lack of Knowledge: Mahasiswa mengalami kesulitan konsep dasar atau tidak memiliki keyakinan yang cukup.",
  },
  FN: {
    badgeCls:
      "bg-purple-500/15 text-purple-700 dark:text-purple-400 border border-purple-500/40",
    label: "False Negative",
    desc: "Penalaran benar tetapi kesimpulan keliru.",
    detailExpl:
      "False Negative: Penalaran ilmiah mahasiswa sudah tepat, namun kurang teliti saat menarik kesimpulan akhir.",
  },
  FP: {
    badgeCls:
      "bg-rose-500/15 text-rose-700 dark:text-rose-400 border border-rose-500/40",
    label: "False Positive",
    desc: "Jawaban benar menutupi miskonsepsi.",
    detailExpl:
      "False Positive: Kesimpulan mahasiswa benar, namun alasan/penalaran menunjukkan pemahaman yang keliru.",
  },
  MSC: {
    badgeCls:
      "bg-amber-500/15 text-amber-700 dark:text-amber-400 border border-amber-500/40",
    label: "Miskonsepsi",
    desc: "Miskonsepsi penuh dan diyakini secara konsisten.",
    detailExpl:
      "Misconception: Kesimpulan dan alasan salah, serta diyakini secara konsisten oleh mahasiswa.",
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
  return num % 1 === 0 ? num.toFixed(0) : num.toFixed(1);
};

// Jam pengumpulan — dipakai hanya untuk memisahkan dua baris yang nomor soal +
// nomor percobaannya sama (mahasiswa bisa punya percobaan di paket berbeda).
const fmtClock = (val: string) => {
  try {
    return new Date(val).toLocaleTimeString("id-ID", {
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return val;
  }
};

type ValidationDraft = {
  questionId: string;
  orderIndex: number;
  isCorrect: boolean;
  finalCategory: string;
  mode: "new" | "correction";
  touched: boolean;
  decisionTouched?: boolean;
  updatedAt: string;
};

const draftStorageKey = (setId: string, studentId: string) =>
  `acm_val_drafts:${setId}:${studentId}`;

const readDrafts = (
  setId: string | undefined,
  studentId: string | undefined,
): Record<string, ValidationDraft> => {
  if (!setId || !studentId || typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(draftStorageKey(setId, studentId));
    return raw ? (JSON.parse(raw) as Record<string, ValidationDraft>) : {};
  } catch {
    return {};
  }
};

const persistDrafts = (
  setId: string | undefined,
  studentId: string | undefined,
  next: Record<string, ValidationDraft>,
) => {
  if (!setId || !studentId || typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      draftStorageKey(setId, studentId),
      JSON.stringify(next),
    );
  } catch {
    /* abaikan error quota/privacy mode */
  }
};

export default function StudentPackageReviewPage({
  examPackage = false,
}: {
  examPackage?: boolean;
}) {
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
  // Kunci pilihan percobaan = submission_id, bukan attempt_no: nomor percobaan
  // bisa berulang untuk satu soal (percobaan pada paket berbeda), dan dengan
  // attempt_no sebagai kunci percobaan kedua tidak akan pernah terbuka.
  const [selectedAttemptByQuestion, setSelectedAttemptByQuestion] = useState<
    Record<string, string>
  >({});

  // Form State
  const [isCorrect, setIsCorrect] = useState<boolean>(false);
  const [finalCategory, setFinalCategory] = useState<string>("LK");
  const [notes, setNotes] = useState("");
  const [showRejectBox, setShowRejectBox] = useState(false);
  const [showAiDetails, setShowAiDetails] = useState(false);
  const [showShortAnswerReference, setShowShortAnswerReference] = useState(false);
  const [showReasonReference, setShowReasonReference] = useState(false);
  const [isUnlocked, setIsUnlocked] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, ValidationDraft>>({});
  const [showFinalizeModal, setShowFinalizeModal] = useState(false);
  const [finalizing, setFinalizing] = useState(false);
  const [finalizeProgress, setFinalizeProgress] = useState<{
    done: number;
    total: number;
  } | null>(null);
  const [showFinalizeDetail, setShowFinalizeDetail] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [rejectError, setRejectError] = useState("");
  const [reanalyzing, setReanalyzing] = useState(false);
  // 'alive' | 'stale' | 'missing' from the reanalyze response: a re-armed submission
  // only progresses if the analysis worker is actually running.
  const [analysisWorker, setAnalysisWorker] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"SUMMARY" | "DETAIL">("SUMMARY");
  const [summaryPage, setSummaryPage] = useState(1);

  const load = useCallback(async () => {
    if (!setId || !studentId) return;
    setFetching(true);
    setError("");
    try {
      const res = await apiFetch<PackageReview>(
        `/${examPackage ? "exam-packages" : "questions"}/${setId}/students/${studentId}/review`,
      );
      setData(res);
      setDrafts(readDrafts(setId, studentId));
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Gagal memuat review paket.",
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
      (a, b) => b.attempt_no - a.attempt_no,
    );
  }, [activeQuestion]);

  const currentAttempt: AttemptItem | undefined = useMemo(() => {
    if (!activeQuestion || !attemptsDesc.length) return undefined;
    const chosenSubmissionId =
      selectedAttemptByQuestion[activeQuestion.question_id];
    if (chosenSubmissionId) {
      const found = attemptsDesc.find(
        (a) => a.submission_id === chosenSubmissionId,
      );
      if (found) return found;
    }
    return attemptsDesc[0];
  }, [activeQuestion, attemptsDesc, selectedAttemptByQuestion]);

  // v3.2: the sentence-level anchor, surfaced to the lecturer unconditionally.
  const evidenceSpan = currentAttempt?.analysis?.evidence_span ?? null;
  const tier1Highlight = evidenceSpan?.field === "tier1" ? evidenceSpan : null;
  const tier3Highlight = evidenceSpan?.field === "tier3" ? evidenceSpan : null;

  // Label opsi percobaan — beri jam pengumpulan bila nomor percobaannya kembar,
  // supaya tiap opsi tetap dapat dibedakan.
  const attemptOptionLabels = useMemo(() => {
    const counts = new Map<number, number>();
    for (const att of attemptsDesc)
      counts.set(att.attempt_no, (counts.get(att.attempt_no) ?? 0) + 1);
    return new Map(
      attemptsDesc.map((att) => [
        att.submission_id,
        (counts.get(att.attempt_no) ?? 0) > 1
          ? `Ke-${att.attempt_no} · ${fmtClock(att.submitted_at)}`
          : `Ke-${att.attempt_no}`,
      ]),
    );
  }, [attemptsDesc]);

  // The draft for the attempt currently on screen. The "streamline review layouts"
  // refactor on origin/main removed this const once nothing in its version used it, but
  // the contradiction warning below does — so it is reinstated here rather than inlined
  // into the JSX. (This was the one hidden conflict: git merged the deletion and the new
  // uses textually, leaving a reference to a variable that no longer existed.)
  const currentDraft: ValidationDraft | undefined = currentAttempt?.analysis
    ? drafts[currentAttempt.analysis.id]
    : undefined;

  useEffect(() => {
    setShowShortAnswerReference(false);
    setShowReasonReference(false);
  }, [activeQuestion?.question_id, currentAttempt?.attempt_no]);

  useEffect(() => {
    if (!currentAttempt || !currentAttempt.analysis) return;
    const a = currentAttempt.analysis;
    const savedDraft = drafts[a.id];

    let nextIsCorrect: boolean;
    let nextCategory: string;
    if (savedDraft) {
      nextIsCorrect = savedDraft.isCorrect;
      nextCategory = savedDraft.finalCategory;
    } else {
      // Nilai awal percobaan INI (validasi tersimpan / rekomendasi AI).
      const base = draftBaseValues(a);
      nextIsCorrect = base.isCorrect;
      nextCategory = base.finalCategory;
    }
    setIsCorrect(nextIsCorrect);
    setFinalCategory(nextCategory);
    setNotes("");
    setShowRejectBox(false);
    setShowAiDetails(false);
    setIsUnlocked(false);

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentAttempt]);

  const isAlreadyValidated = Boolean(currentAttempt?.analysis?.validation);
  const isLocked = isAlreadyValidated && !isUnlocked;
  const activeDraft = currentAttempt?.analysis
    ? drafts[currentAttempt.analysis.id]
    : undefined;
  const hasActiveLecturerDecision =
    !isAlreadyValidated && Boolean(activeDraft?.decisionTouched);

  const updateDraft = (
    patch: Partial<{
      isCorrect: boolean;
      finalCategory: string;
    }>,
  ) => {
    if (!currentAttempt?.analysis || !activeQuestion) return;
    const analysisId = currentAttempt.analysis.id;
    // Basis patch adalah draft milik percobaan INI — bukan state bersama
    // `isCorrect`/`finalCategory`, yang bisa masih menyimpan nilai percobaan
    // lain dan menulis kombinasi bertentangan seperti "Salah [SC]".
    const base = drafts[analysisId] ?? {
      ...draftBaseValues(currentAttempt.analysis),
      questionId: activeQuestion.question_id,
      orderIndex: activeQuestion.order_index,
      mode: (isAlreadyValidated ? "correction" : "new") as ValidationDraft["mode"],
      touched: false,
      updatedAt: new Date().toISOString(),
    };
    const nextIsCorrect = patch.isCorrect ?? base.isCorrect;
    const nextCategory = patch.finalCategory ?? base.finalCategory;

    setIsCorrect(nextIsCorrect);
    setFinalCategory(nextCategory);

    setDrafts((prev) => {
      const next: Record<string, ValidationDraft> = {
        ...prev,
        [analysisId]: {
          questionId: activeQuestion.question_id,
          orderIndex: activeQuestion.order_index,
          isCorrect: nextIsCorrect,
          finalCategory: nextCategory,
          mode: isAlreadyValidated ? "correction" : "new",
          touched: true,
          // Hanya tiga kontrol eksplisit (Benar, Salah, kategori) dan tombol
          // "Gunakan Rekomendasi AI" yang menulis draft; decisionTouched
          // menyala saat klik Benar/Salah.
          decisionTouched:
            prev[analysisId]?.decisionTouched || patch.isCorrect !== undefined,
          updatedAt: new Date().toISOString(),
        },
      };
      persistDrafts(setId, studentId, next);
      return next;
    });
  };

  const handleSelectAttempt = (questionId: string, submissionId: string) => {
    setSelectedAttemptByQuestion((prev) => ({
      ...prev,
      [questionId]: submissionId,
    }));
  };

  const latestAttemptOf = (q: QuestionReviewItem): AttemptItem | undefined =>
    [...q.attempts].sort((a, b) => b.attempt_no - a.attempt_no)[0];

  const awaitingDecisionQuestions = useMemo(
    () =>
      (data?.questions ?? []).filter((q) => {
        const st = latestAttemptOf(q)?.status;
        return st === "PENDING_VALIDATION" || st === "REJECTED";
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data],
  );

  const inFlightQuestions = useMemo(
    () =>
      (data?.questions ?? []).filter((q) =>
        IN_FLIGHT_STATUSES.includes(latestAttemptOf(q)?.status ?? ""),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data],
  );

  const finalizeItems = useMemo(() => {
    if (!data) return [];
    const items: {
      analysisId: string;
      orderIndex: number;
      attempt: AttemptItem;
      draft: ValidationDraft;
    }[] = [];
    for (const q of data.questions) {
      for (const att of q.attempts) {
        const aid = att.analysis?.id;
        if (aid && drafts[aid]) {
          items.push({
            analysisId: aid,
            orderIndex: q.order_index,
            attempt: att,
            draft: drafts[aid],
          });
        }
      }
    }
    items.sort((a, b) => a.orderIndex - b.orderIndex);
    return items;
  }, [data, drafts]);

  const decidedPendingCount = awaitingDecisionQuestions.filter((q) => {
    const aid = latestAttemptOf(q)?.analysis?.id;
    return aid ? Boolean(drafts[aid]?.decisionTouched) : false;
  }).length;

  const rejectedUndecidedCount = awaitingDecisionQuestions.filter((q) => {
    if (latestAttemptOf(q)?.status !== "REJECTED") return false;
    const aid = latestAttemptOf(q)?.analysis?.id;
    return !(aid && drafts[aid]);
  }).length;

  const allPendingDecided =
    inFlightQuestions.length === 0 &&
    (awaitingDecisionQuestions.length === 0 ||
      decidedPendingCount === awaitingDecisionQuestions.length);

  const trustableAiItems = useMemo(() => {
    const items: typeof finalizeItems = [];
    for (const question of data?.questions ?? []) {
      const attempt = latestAttemptOf(question);
      const analysis = attempt?.analysis;
      if (
        attempt?.status !== "PENDING_VALIDATION" ||
        !analysis ||
        analysis.validation ||
        drafts[analysis.id]?.decisionTouched
      ) {
        continue;
      }
      items.push({
        analysisId: analysis.id,
        orderIndex: question.order_index,
        attempt,
        draft: {
          questionId: question.question_id,
          orderIndex: question.order_index,
          isCorrect: Number(analysis.percentage_correct) >= 99.9,
          finalCategory: analysis.four_tier_category ?? "LK",
          mode: "new",
          touched: false,
          decisionTouched: true,
          updatedAt: new Date().toISOString(),
        },
      });
    }
    return items.sort((left, right) => left.orderIndex - right.orderIndex);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, drafts]);

  const finalizeSummary = useMemo(() => {
    const s = { benar: 0, salah: 0, correction: 0 };
    for (const it of finalizeItems) {
      if (it.draft.isCorrect) s.benar += 1;
      else s.salah += 1;
      if (it.draft.mode === "correction") s.correction += 1;
    }
    return s;
  }, [finalizeItems]);

  // Baris finalisasi siap-render: label yang tidak pernah kembar (nomor soal +
  // nomor percobaan, ditambah jam pengumpulan bila pasangan itu muncul dua kali)
  // dan penanda keputusan bertentangan.
  const finalizeRows = useMemo(() => {
    const perQuestion = new Map<number, number>();
    for (const it of finalizeItems)
      perQuestion.set(it.orderIndex, (perQuestion.get(it.orderIndex) ?? 0) + 1);
    const rows = finalizeItems.map((it) => ({
      ...it,
      label: `Soal ${it.orderIndex} · Ke-${it.attempt.attempt_no}`,
      chipLabel:
        (perQuestion.get(it.orderIndex) ?? 0) > 1
          ? `${it.orderIndex}.${it.attempt.attempt_no}`
          : String(it.orderIndex),
      contradictory: isDraftContradictory(it.draft),
    }));
    const labelCounts = new Map<string, number>();
    for (const r of rows)
      labelCounts.set(r.label, (labelCounts.get(r.label) ?? 0) + 1);
    return rows.map((r) =>
      (labelCounts.get(r.label) ?? 0) > 1
        ? { ...r, label: `${r.label} (${fmtClock(r.attempt.submitted_at)})` }
        : r,
    );
  }, [finalizeItems]);

  const contradictoryRows = useMemo(
    () => finalizeRows.filter((r) => r.contradictory),
    [finalizeRows],
  );

  type SummaryRow = {
    idx: number;
    questionId: string;
    statusLabel: string;
    statusCls: string;
    decision: "Benar" | "Salah" | null;
    diagnosis: string;
    source: "Dosen" | "AI" | "-";
  };

  const summaryRows: SummaryRow[] = useMemo(() => {
    if (!data) return [];
    return data.questions.map((q, idx) => {
      const att = latestAttemptOf(q);
      const an = att?.analysis ?? null;
      const aid = an?.id;
      const draft = aid ? drafts[aid] : undefined;
      const validation = an?.validation ?? null;
      const status = att?.status ?? "UNANSWERED";

      let statusLabel = "Belum Dijawab";
      let statusCls = "text-on-surface-variant";
      if (status === "VALIDATED") {
        statusLabel = "Tervalidasi";
        statusCls = "text-emerald-600 dark:text-emerald-400 font-semibold";
      } else if (status === "REJECTED") {
        statusLabel = "Ditolak — menunggu analisis ulang";
        statusCls = "text-rose-500 font-semibold";
      } else if (status === "ANALYZING" || status === "SUBMITTED") {
        statusLabel = "Menunggu analisis AI";
        statusCls = "text-amber-600 dark:text-amber-400 font-semibold";
      } else if (status === "ANALYSIS_FAILED") {
        statusLabel = "Analisis gagal";
        statusCls = "text-rose-500 font-semibold";
      } else if (status === "PENDING_VALIDATION") {
        if (draft) {
          if (draft.touched) {
            statusLabel = "Draft dosen";
            statusCls = "text-primary font-semibold";
          } else {
            statusLabel = "AI belum disentuh";
            statusCls = "text-on-surface-variant font-semibold";
          }
        } else {
          statusLabel = "Menunggu validasi";
          statusCls = "text-amber-600 dark:text-amber-400 font-semibold";
        }
      }

      let decision: SummaryRow["decision"] = null;
      let source: SummaryRow["source"] = "-";
      const levelToCode: Record<number, string> = {
        4: "SC",
        3: "FN",
        2: "MSC",
        1: "LK",
      };
      const labelFor = (code?: string | null) =>
        code ? (CATEGORY_STYLES[code]?.label ?? code) : "-";
      let diagnosis = "-";
      if (validation) {
        decision =
          Number(validation.final_percentage ?? an?.percentage_correct ?? 0) >=
          99.9
            ? "Benar"
            : "Salah";
        source = "Dosen";
        const code =
          draft?.finalCategory ??
          // Migration 0031 rows carry the lecturer's diagnosis verbatim. The level
          // fallback below survives for validations written before it, and for the
          // /validation/[id] surface, which still edits a bare tier level.
          validation.final_category ??
          (validation.final_tier_level === (an?.tier_level ?? null)
            ? (an?.four_tier_category ?? null)
            : (levelToCode[validation.final_tier_level ?? 0] ?? null));
        diagnosis = labelFor(code);
      } else if (draft) {
        decision = draft.isCorrect ? "Benar" : "Salah";
        source = draft.touched ? "Dosen" : "AI";
        diagnosis = labelFor(draft.finalCategory);
      } else if (an) {
        decision = Number(an.percentage_correct) >= 99.9 ? "Benar" : "Salah";
        source = "AI";
        diagnosis = labelFor(an.four_tier_category);
      }

      return {
        idx,
        questionId: q.question_id,
        statusLabel,
        statusCls,
        decision,
        diagnosis,
        source,
      };
    });
  }, [data, drafts]);

  const totalPages = Math.max(
    1,
    Math.ceil(summaryRows.length / SUMMARY_PAGE_SIZE),
  );
  const safePage = Math.min(summaryPage, totalPages);
  const pageRows = summaryRows.slice(
    (safePage - 1) * SUMMARY_PAGE_SIZE,
    safePage * SUMMARY_PAGE_SIZE,
  );

  const openQuestionFromSummary = (idx: number) => {
    setActiveQuestionIdx(idx);
    setActiveTab("DETAIL");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const buildSubmitBody = (draft: ValidationDraft, attempt: AttemptItem) => {
    const a = attempt.analysis;
    const targetScore = draft.isCorrect ? 100.0 : 0.0;
    const isScoreChanged = a
      ? Math.abs(targetScore - Number(a.percentage_correct)) > 0.01
      : true;
    const isCategoryChanged = a
      ? draft.finalCategory !== (a.four_tier_category ?? "LK")
      : true;
    const decisionStatus =
      isScoreChanged || isCategoryChanged ? "EDITED" : "ACCEPTED";
    const body: Record<string, unknown> = {
      status: decisionStatus,
      final_percentage: targetScore,
      final_tier_level:
        CATEGORY_TO_LEVEL[draft.finalCategory] ?? a?.tier_level ?? 1,
      // Sent separately from the level: FP and MSC both map to level 2, so without this
      // the server stores the lecturer's FP correction as an unchanged tier.
      final_category: draft.finalCategory ?? a?.four_tier_category ?? null,
    };
    return body;
  };

  const handleFinalize = async () => {
    const items = finalizeItems;
    if (!items.length || finalizing) return;
    setFinalizing(true);
    setError("");
    setNotice("");
    const failed: string[] = [];
    const succeededIds: string[] = [];
    const total = items.length;
    let done = 0;
    setFinalizeProgress({ done: 0, total });

    for (const item of items) {
      if (!item.draft.finalCategory) {
        failed.push(`Soal ${item.orderIndex}: diagnosis akhir wajib dipilih.`);
        continue;
      }
      try {
        await apiFetch(`/validations/${item.analysisId}/submit`, {
          method: "POST",
          body: JSON.stringify(buildSubmitBody(item.draft, item.attempt)),
        });
        succeededIds.push(item.analysisId);
      } catch (err) {
        failed.push(
          `Soal ${item.orderIndex}: ${err instanceof Error ? err.message : "gagal menyimpan."}`,
        );
      } finally {
        done += 1;
        setFinalizeProgress({ done, total });
      }
    }

    setFinalizeProgress(null);

    setDrafts((prev) => {
      const next = { ...prev };
      for (const id of succeededIds) delete next[id];
      persistDrafts(setId, studentId, next);
      return next;
    });
    setShowFinalizeModal(false);
    await load();
    if (failed.length) {
      setError(`Evaluasi selesai sebagian. ${failed.join(" ")}`);
    } else {
      setNotice(`Evaluasi selesai: ${succeededIds.length} validasi disimpan.`);
    }
    setFinalizing(false);
  };

  const handleTrustAi = () => {
    if (!trustableAiItems.length) return;
    setDrafts((prev) => {
      const next = { ...prev };
      for (const item of trustableAiItems) {
        next[item.analysisId] = item.draft;
      }
      persistDrafts(setId, studentId, next);
      return next;
    });
    setNotice(
      `${trustableAiItems.length} rekomendasi AI diterapkan ke draf. Simpan seluruh keputusan melalui Selesai Evaluasi.`,
    );
  };

  // Tolak & Re-analisis: LANGSUNG kirim REJECTED untuk soal aktif (tidak di-draft),
  // sehingga analisis ulang AI segera terjadwal untuk butir ini.
  const handleRejectNow = async () => {
    if (!currentAttempt?.analysis || rejecting) return;
    if (!notes.trim()) {
      setRejectError("Harap isi catatan alasan penolakan untuk AI.");
      return;
    }
    setRejecting(true);
    setRejectError("");
    setError("");
    setNotice("");
    try {
      await apiFetch(`/validations/${currentAttempt.analysis.id}/submit`, {
        method: "POST",
        body: JSON.stringify({ status: "REJECTED", notes: notes.trim() }),
      });
      const aid = currentAttempt.analysis.id;
      setDrafts((prev) => {
        const next = { ...prev };
        delete next[aid];
        persistDrafts(setId, studentId, next);
        return next;
      });
      setShowRejectBox(false);
      setNotes("");
      setIsUnlocked(false);
      await load();
      setNotice("Ditolak — analisis ulang AI dijadwalkan untuk soal ini.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal menolak analisis.");
    } finally {
      setRejecting(false);
    }
  };

  const handleReanalyze = async () => {
    if (!currentAttempt?.submission_id || reanalyzing) return;
    setReanalyzing(true);
    setError("");
    setNotice("");
    try {
      const result = await apiFetch<{
        analysis_worker?: string;
        reading_materials_requeued?: number;
      }>(`/submissions/${currentAttempt.submission_id}/reanalyze`, {
        method: "POST",
      });
      setAnalysisWorker(result.analysis_worker ?? null);
      await load();
      setNotice(
        "Analisis ulang dijadwalkan. Status butir ini akan berubah setelah worker selesai.",
      );
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Gagal menjadwalkan analisis ulang.",
      );
    } finally {
      setReanalyzing(false);
    }
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
    setNotes("");
    setShowRejectBox(false);
    setDrafts((prev) => {
      const next = { ...prev };
      delete next[a.id];
      persistDrafts(setId, studentId, next);
      return next;
    });
    setIsUnlocked(false);
  };

  const summary = data?.summary;

  if (loading || !user) return null;

  return (
    <PageContainer>
      {data && (
        <PageHeader
          className="mb-4 border-b border-outline-variant/30 pb-4"
          title={data.student.name}
          description={`Review evaluasi diagnostik • ${data.package.title} • ${data.package.subject_name}`}
          icon={ClipboardCheck}
          action={
            <div className="inline-flex items-center gap-2 rounded-lg border border-primary-fixed-dim bg-primary-fixed/50 px-3 py-2 text-xs">
              <span className="font-semibold text-on-surface-variant">Paket ujian</span>
              <span className="font-mono-ui font-bold uppercase tracking-wider text-primary">
                {data.package.code}
              </span>
            </div>
          }
        />
      )}

      {fetching ? (
        <p className="mt-8 text-sm text-on-surface-variant">
          Memuat data pengerjaan mahasiswa...
        </p>
      ) : data && activeQuestion ? (
        <div className="mt-3.5 flex flex-col lg:flex-row gap-5 items-start">
          {/* KOLOM KIRI: WORKBENCH EVALUASI & VALIDASI */}
          <main className="flex-1 min-w-0 space-y-4">
            {/* TAB NAVIGASI (di atas card, pola sama dgn navigasi subjek Bank Soal/Ujian) */}
            <div className="flex border-b border-outline-variant/40">
              <button
                type="button"
                onClick={() => setActiveTab("SUMMARY")}
                className={`border-b-2 px-5 py-3 text-sm font-semibold ${
                  activeTab === "SUMMARY"
                    ? "border-primary text-primary"
                    : "border-transparent text-on-surface-variant"
                }`}
              >
                Ringkasan
              </button>
              <button
                type="button"
                onClick={() => setActiveTab("DETAIL")}
                className={`border-b-2 px-5 py-3 text-sm font-semibold ${
                  activeTab === "DETAIL"
                    ? "border-primary text-primary"
                    : "border-transparent text-on-surface-variant"
                }`}
              >
                Detail Evaluasi
              </button>
            </div>

            {activeTab === "SUMMARY" ? (
              <section className="glass-panel rounded-2xl border border-outline-variant/40 shadow-sm p-4 sm:p-5">
                <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h3 className="text-sm font-bold uppercase tracking-wider text-on-surface">
                      Ringkasan Evaluasi Mahasiswa
                    </h3>
                    <p className="mt-1 text-xs text-on-surface-variant">
                      {trustableAiItems.length > 0
                        ? `${trustableAiItems.length} rekomendasi AI belum divalidasi.`
                        : "Tidak ada rekomendasi AI yang menunggu validasi."}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={handleTrustAi}
                    disabled={trustableAiItems.length === 0}
                    className="btn-secondary shrink-0 !py-2 !px-3 text-xs font-bold inline-flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <BrainCircuit size={15} />
                    {`Gunakan Rekomendasi AI (${trustableAiItems.length})`}
                  </button>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-sm">
                    <thead>
                      <tr className="border-b border-outline-variant/40 text-left text-xs uppercase tracking-wider text-on-surface-variant">
                        <th className="py-2 pr-3 font-bold">No</th>
                        <th className="py-2 pr-3 font-bold">Status Butir</th>
                        <th className="py-2 pr-3 font-bold">Keputusan</th>
                        <th className="py-2 pr-3 font-bold">Diagnosis</th>
                        <th className="py-2 pr-3 font-bold">Sumber</th>
                        <th className="py-2 text-right font-bold">Aksi</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pageRows.map((row) => (
                        <tr
                          key={row.questionId}
                          onClick={() => openQuestionFromSummary(row.idx)}
                          className="border-b border-outline-variant/20 cursor-pointer transition-colors hover:bg-surface-container-high/40"
                        >
                          <td className="py-2 pr-3 font-mono-ui font-bold text-on-surface">
                            {row.idx + 1}
                          </td>
                          <td className={`py-2 pr-3 text-xs ${row.statusCls}`}>
                            {row.statusLabel}
                          </td>
                          <td
                            className={`py-2 pr-3 font-semibold ${
                              row.decision === "Benar"
                                ? "text-emerald-600 dark:text-emerald-400"
                                : row.decision === "Salah"
                                  ? "text-rose-500"
                                  : "text-on-surface-variant"
                            }`}
                          >
                            {row.decision ?? "—"}
                          </td>
                          <td className="py-2 pr-3 font-mono-ui text-xs text-on-surface">
                            {row.diagnosis}
                          </td>
                          <td className="py-2 pr-3 text-xs text-on-surface-variant">
                            {row.source}
                          </td>
                          <td className="py-2 text-right">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                openQuestionFromSummary(row.idx);
                              }}
                              className="text-xs font-semibold text-primary hover:underline cursor-pointer"
                            >
                              Buka
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs text-on-surface-variant">
                    Halaman {safePage}/{totalPages} · menampilkan{" "}
                    {pageRows.length} dari {summaryRows.length} soal
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      disabled={safePage <= 1}
                      onClick={() => setSummaryPage(safePage - 1)}
                      className="btn-secondary text-xs !py-1.5 !px-3 disabled:opacity-30 cursor-pointer"
                    >
                      ← Sebelumnya
                    </button>
                    <button
                      type="button"
                      disabled={safePage >= totalPages}
                      onClick={() => setSummaryPage(safePage + 1)}
                      className="btn-secondary text-xs !py-1.5 !px-3 disabled:opacity-30 cursor-pointer"
                    >
                      Berikutnya →
                    </button>
                  </div>
                </div>
                <p className="mt-2 text-xs text-on-surface-variant">
                  Klik baris atau “Buka” untuk meninjau &amp; menyesuaikan
                  keputusan pada tab Detail Evaluasi.
                </p>
              </section>
            ) : (
              <section className="glass-panel rounded-2xl border border-outline-variant/40 shadow-sm p-4 sm:p-5 space-y-4">
                <div className="flex items-center justify-between border-b border-outline-variant/30 pb-2.5">
                  <div>
                    <span className="font-mono-ui text-base font-bold text-primary">
                      Soal Nomor {activeQuestion.order_index}
                    </span>
                  </div>

                  <div className="flex items-center gap-3">
                    <div className="flex items-center gap-1.5 text-xs">
                      <span className="text-on-surface-variant text-xs font-semibold uppercase tracking-wide">
                        Percobaan:
                      </span>
                      {attemptsDesc.length <= 1 ? (
                        <span className="inline-flex min-w-[95px] items-center justify-center rounded-lg border border-outline-variant/30 bg-surface-container-low px-3 py-1.5 text-xs font-semibold text-on-surface-variant">
                          {attemptsDesc.length === 0
                            ? "Belum ada"
                            : `Ke-${currentAttempt?.attempt_no ?? 1}`}
                        </span>
                      ) : (
                        <AppSelect
                          value={currentAttempt?.submission_id ?? ""}
                          onValueChange={(val) => {
                            if (val)
                              handleSelectAttempt(
                                activeQuestion.question_id,
                                val,
                              );
                          }}
                          ariaLabel="Pilih Percobaan"
                          placeholder={`Ke-${currentAttempt?.attempt_no ?? 1}`}
                          className="min-w-[95px] text-xs"
                          options={attemptsDesc.map((att) => ({
                            value: att.submission_id,
                            label:
                              attemptOptionLabels.get(att.submission_id) ??
                              `Ke-${att.attempt_no}`,
                          }))}
                        />
                      )}
                    </div>

                    {!currentAttempt ? (
                      <span className="badge badge-draft text-xs">
                        Belum Dijawab
                      </span>
                    ) : hasActiveLecturerDecision ? (
                      <span
                        className={`text-xs font-semibold px-2.5 py-0.5 rounded-full border ${
                          activeDraft?.isCorrect
                            ? "text-emerald-700 dark:text-emerald-400 bg-emerald-500/10 border-emerald-500/30"
                            : "text-rose-700 dark:text-rose-400 bg-rose-500/10 border-rose-500/30"
                        }`}
                      >
                        Keputusan Dosen: {activeDraft?.isCorrect ? "Benar" : "Salah"}
                      </span>
                    ) : (
                      <span
                        className={`badge ${STATUS_BADGE[currentAttempt.status]?.cls} text-xs`}
                      >
                        {STATUS_BADGE[currentAttempt.status]?.label}
                      </span>
                    )}
                  </div>
                </div>

                {/* PERTANYAAN KONSEPTUAL — callout penuh, sama seperti view lain */}
                <div className="rounded-xl border border-primary/30 border-l-4 border-l-primary bg-primary-fixed p-4 shadow-sm sm:p-5 space-y-2">
                  <span className="block text-sm font-semibold uppercase tracking-wider text-primary">
                    Pertanyaan Konseptual
                  </span>
                  <RichTextContent
                    html={activeQuestion.prompt}
                    className="!text-lg font-semibold leading-relaxed text-on-surface sm:!text-xl"
                  />
                </div>

                <div className="space-y-3.5">
                  <section className="space-y-2 rounded-xl border border-outline-variant/50 border-l-4 border-l-primary/70 bg-surface-container-low/40 p-3">
                    <div>
                      <span className="mb-1 block text-xs font-bold uppercase tracking-wider text-primary">Jawaban Singkat Mahasiswa</span>
                      <div className="space-y-0.5 text-sm leading-relaxed text-on-surface">
                        <MathContent
                          value={currentAttempt?.tier1_answer || currentAttempt?.answer_text}
                          fallback="Belum ada jawaban"
                          className="text-sm leading-relaxed text-on-surface mt-0.5"
                          highlightQuote={tier1Highlight?.quote}
                        />
                        {currentAttempt?.heuristic_flags?.includes("t1_berisi_alasan") && (
                          <div className="mt-1.5 flex items-center gap-1.5 rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-xs text-amber-600 dark:text-amber-400">
                            <AlertTriangle size={12} className="shrink-0" />
                            <span>Jawaban singkat memuat alasan — uraikan alasan ilmiah pada kolom Alasan.</span>
                          </div>
                        )}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setShowShortAnswerReference((visible) => !visible)}
                      aria-expanded={showShortAnswerReference}
                      className="flex w-full items-center justify-between border-t border-outline-variant/30 pt-2 text-left text-xs font-semibold text-primary transition-colors hover:text-primary/75"
                    >
                      <span>{showShortAnswerReference ? "Sembunyikan referensi jawaban" : "Lihat referensi jawaban"}</span>
                      {showShortAnswerReference ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
                    </button>
                    {showShortAnswerReference && (
                      <div className="border-t border-outline-variant/30 pt-2">
                        <span className="block text-xs font-semibold uppercase tracking-wider text-primary">Jawaban Singkat Referensi</span>
                        <RichTextContent
                          html={activeQuestion.reference?.short_answer ?? activeQuestion.short_answer ?? ""}
                          className="mt-1 text-sm leading-relaxed text-on-surface"
                        />
                      </div>
                    )}
                  </section>

                  <section className="space-y-2 rounded-xl border border-outline-variant/50 border-l-4 border-l-primary/70 bg-surface-container-low/40 p-3">
                    <div>
                      <span className="mb-1 block text-xs font-bold uppercase tracking-wider text-primary">Alasan Mahasiswa</span>
                      <div className="space-y-0.5 text-sm leading-relaxed text-on-surface">
                        <MathContent
                          value={currentAttempt?.tier3_reason || currentAttempt?.answer_text}
                          fallback="Belum ada alasan"
                          className="text-sm leading-relaxed text-on-surface mt-0.5 max-h-32 overflow-y-auto"
                          highlightQuote={tier3Highlight?.quote}
                        />
                        {(currentAttempt?.heuristic_flags ?? []).some((flag) => flag === "t3_kosong" || flag === "t3_redundan" || flag === "t3_hafalan") && (
                          <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-xs text-amber-600 dark:text-amber-400">
                            <AlertTriangle size={12} className="shrink-0" />
                            {currentAttempt?.heuristic_flags?.includes("t3_kosong") && <span>Alasan terlalu singkat.</span>}
                            {currentAttempt?.heuristic_flags?.includes("t3_redundan") && <span>Alasan mengulang jawaban.</span>}
                            {currentAttempt?.heuristic_flags?.includes("t3_hafalan") && <span>Alasan hafalan rumus tanpa penerapan.</span>}
                          </div>
                        )}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setShowReasonReference((visible) => !visible)}
                      aria-expanded={showReasonReference}
                      className="flex w-full items-center justify-between border-t border-outline-variant/30 pt-2 text-left text-xs font-semibold text-primary transition-colors hover:text-primary/75"
                    >
                      <span>{showReasonReference ? "Sembunyikan referensi alasan" : "Lihat referensi alasan"}</span>
                      {showReasonReference ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
                    </button>
                    {showReasonReference && (
                      <div className="border-t border-outline-variant/30 pt-2">
                        <span className="block text-xs font-semibold uppercase tracking-wider text-primary">Alasan Referensi</span>
                        <RichTextContent
                          html={activeQuestion.reference?.reason ?? activeQuestion.model_answer ?? ""}
                          className="mt-1 text-sm leading-relaxed text-on-surface"
                        />
                      </div>
                    )}
                  </section>
                </div>

                {/* REKOMENDASI AI: MURNI STATUS BENAR/SALAH */}
                {currentAttempt?.analysis && (
                  <div className="rounded-xl border border-outline-variant/40 bg-surface-container-low/70 px-3.5 py-2.5 space-y-1.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-bold uppercase tracking-wider text-on-surface-variant flex items-center gap-1.5">
                          <BrainCircuit size={15} className="text-primary" />{" "}
                          REKOMENDASI AI:
                        </span>

                        {currentAttempt.analysis.run_number > 1 && (
                          <span
                            className="font-mono-ui text-xs font-bold inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full border border-amber-500/40 bg-amber-500/15 text-amber-600 dark:text-amber-400"
                            title="Analisis ulang oleh AI setelah penolakan dosen"
                          >
                            <RotateCcw size={12} /> Analisis{" "}
                            {currentAttempt.analysis.run_number}/
                            {MAX_ANALYSIS_RUNS}
                          </span>
                        )}

                      </div>

                      <button
                        type="button"
                        onClick={() => setShowAiDetails((prev) => !prev)}
                        className="text-xs text-primary hover:underline font-semibold cursor-pointer inline-flex items-center gap-1"
                      >
                        {showAiDetails ? (
                          <>
                            Sembunyikan Detail AI <ChevronUp size={12} />
                          </>
                        ) : (
                          <>
                            Lihat Detail AI <ChevronDown size={12} />
                          </>
                        )}
                      </button>
                    </div>

                    <p className="text-xs text-on-surface-variant leading-relaxed">
                      <strong className="text-on-surface">Temuan AI: </strong>
                      {currentAttempt.analysis.four_tier_category === "FP"
                        ? "Kesimpulan benar, namun alasan ilmiah menunjukkan miskonsepsi (False Positive)."
                        : currentAttempt.analysis.four_tier_category === "SC"
                          ? "Kesimpulan dan penalaran fisis konsisten dengan kunci ilmiah (Sound Understanding)."
                          : currentAttempt.analysis.explanation.split(
                              "\n",
                            )[0] || currentAttempt.analysis.explanation}
                    </p>

                    {showAiDetails && (
                      <div className="pt-2 mt-1.5 border-t border-outline-variant/20 text-xs space-y-1.5 text-on-surface-variant animate-fade-in">
                        <div className="bg-surface-container-lowest p-2.5 rounded-lg border border-outline-variant/25 whitespace-pre-wrap leading-relaxed">
                          {currentAttempt.analysis.explanation}
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
                          <Lock
                            size={16}
                            className="text-emerald-600 dark:text-emerald-400"
                          />
                        ) : (
                          <ShieldCheck size={18} className="text-primary" />
                        )}
                        <h3 className="text-sm font-bold uppercase tracking-wider text-on-surface">
                          KEPUTUSAN VALIDASI DOSEN
                        </h3>
                      </div>

                      {isLocked && (
                        <div>
                          <span className="text-xs font-semibold text-emerald-700 dark:text-emerald-400 bg-emerald-500/10 px-2.5 py-0.5 rounded-full border border-emerald-500/30 inline-flex items-center gap-1.5">
                            ✓ Sudah Divalidasi (
                            {
                              VALIDATION_STATUS_LABEL[
                                currentAttempt.analysis.validation?.status ??
                                  "ACCEPTED"
                              ]
                            }
                            )
                          </span>
                        </div>
                      )}
                    </div>

                    {isLocked ? (
                      <div className="space-y-3 pt-1">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-start">
                          <div>
                            <span className="block text-xs font-bold uppercase tracking-wider text-on-surface mb-1">
                              PENILAIAN BUTIR SOAL INI
                            </span>
                            <div
                              className={`w-full rounded-lg border px-3 py-2 text-xs font-mono-ui font-bold inline-flex items-center gap-1.5 ${
                                isCorrect
                                  ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/50"
                                  : "bg-rose-500/15 text-rose-700 dark:text-rose-400 border-rose-500/50"
                              }`}
                            >
                              {isCorrect ? (
                                <CheckCircle2 size={15} />
                              ) : (
                                <XCircle size={15} />
                              )}
                              {isCorrect ? "Benar" : "Salah"}
                            </div>
                          </div>

                          <div>
                            <span className="block text-xs font-bold uppercase tracking-wider text-on-surface mb-1">
                              DIAGNOSIS AKHIR DOSEN
                            </span>
                            <div
                              className={`w-full rounded-lg border px-3 py-2 text-xs font-medium font-mono-ui ${
                                CATEGORY_STYLES[finalCategory]?.badgeCls
                              }`}
                            >
                              [{finalCategory}]{" "}
                              {CATEGORY_STYLES[finalCategory]?.label ??
                                finalCategory}
                            </div>
                          </div>
                        </div>

                        <ReadingMaterial
                          material={currentAttempt.analysis?.reading_material}
                          evidence={currentAttempt.analysis?.evidence_span ?? null}
                          missingConcepts={
                            currentAttempt.analysis?.missing_concepts ?? []
                          }
                        />

                        <div className="pt-2 flex items-center justify-between border-t border-outline-variant/20">
                          <span className="text-xs text-on-surface-variant">
                            Divalidasi oleh:{" "}
                            <strong className="text-on-surface">
                              {
                                currentAttempt.analysis.validation
                                  ?.lecturer_name
                              }
                            </strong>
                            {currentAttempt.analysis.validation
                              ?.validated_at && (
                              <>
                                {" "}
                                (
                                {fmtDate(
                                  currentAttempt.analysis.validation
                                    .validated_at,
                                )}
                                )
                              </>
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
                              <Unlock size={13} /> Mode Koreksi Aktif: Anda
                              sedang mengedit validasi yang sudah tersimpan.
                            </span>
                            <button
                              type="button"
                              onClick={handleCancelUnlock}
                              className="text-amber-400 hover:underline font-semibold cursor-pointer text-xs"
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
                                onClick={() => updateDraft({ isCorrect: true })}
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
                                onClick={() =>
                                  updateDraft({ isCorrect: false })
                                }
                                className={`flex-1 py-2 px-3 rounded-lg border text-xs font-mono-ui cursor-pointer transition-all ${
                                  !isCorrect
                                    ? "bg-rose-500/15 text-rose-700 dark:text-rose-400 border-rose-500/50 font-bold ring-1 ring-rose-500/25 shadow-sm"
                                    : "bg-surface-container text-on-surface-variant border-outline-variant/40 hover:bg-surface-container-high hover:text-on-surface"
                                }`}
                              >
                                🔴 Salah
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
                              onValueChange={(val) =>
                                updateDraft({ finalCategory: val })
                              }
                              className="w-full text-xs font-medium"
                              ariaLabel="Pilih Diagnosis Akhir Dosen"
                              options={[
                                {
                                  value: "SC",
                                  label: "[SC] Sound Understanding",
                                },
                                {
                                  value: "LK",
                                  label: "[LK] Lack of Knowledge",
                                },
                                { value: "FP", label: "[FP] False Positive" },
                                { value: "MSC", label: "[MSC] Misconception" },
                                { value: "FN", label: "[FN] False Negative" },
                              ]}
                            />
                          </div>

                          {/* Materi Bacaan — the material the LLM wrote for this
                              question (C7). Renders nothing when null. */}
                          <ReadingMaterial
                          material={currentAttempt.analysis?.reading_material}
                          evidence={currentAttempt.analysis?.evidence_span ?? null}
                          missingConcepts={
                            currentAttempt.analysis?.missing_concepts ?? []
                          }
                        />
                        </div>

                        {/* Peringatan keputusan bertentangan — satu frasa, tidak memblokir */}
                        {currentDraft && isDraftContradictory(currentDraft) && (
                          <div className="inline-flex items-center gap-1.5 rounded-md border border-amber-500/40 bg-amber-500/10 px-2.5 py-1 text-xs font-semibold text-amber-600 dark:text-amber-400">
                            <AlertTriangle size={12} className="shrink-0" />
                            <span>Keputusan bertentangan</span>
                          </div>
                        )}

                        {showRejectBox && (
                          <div className="rounded-lg border border-dashed border-error/40 bg-error-container/20 p-3 space-y-2">
                            <div className="flex items-center justify-between text-xs font-bold text-error">
                              <span className="inline-flex items-center gap-1.5">
                                <XCircle size={14} /> Tolak &amp; Minta Analisis
                                Ulang AI
                              </span>
                              <button
                                type="button"
                                onClick={() => {
                                  setShowRejectBox(false);
                                  setRejectError("");
                                }}
                                className="text-xs text-on-surface-variant hover:text-on-surface cursor-pointer"
                              >
                                Batal
                              </button>
                            </div>
                            <textarea
                              rows={2}
                              value={notes}
                              onChange={(e) => {
                                setNotes(e.target.value);
                                if (rejectError) setRejectError("");
                              }}
                              placeholder="Jelaskan alasan penolakan agar model AI dapat memperbaiki analisis ulangnya..."
                              className={`form-input w-full text-xs ${
                                rejectError
                                  ? "border-error ring-1 ring-error/40"
                                  : ""
                              }`}
                            />
                            {rejectError && (
                              <p className="flex items-center gap-1.5 text-xs font-semibold text-error">
                                <AlertTriangle size={13} className="shrink-0" />
                                {rejectError}
                              </p>
                            )}
                            <div className="flex justify-end pt-1">
                              <button
                                type="button"
                                onClick={handleRejectNow}
                                disabled={rejecting}
                                className="btn-danger !py-1.5 !px-3.5 text-xs font-semibold cursor-pointer"
                              >
                                {rejecting
                                  ? "Menolak..."
                                  : "Konfirmasi Tolak & Re-analisis"}
                              </button>
                            </div>
                          </div>
                        )}

                        <div className="pt-2 border-t border-outline-variant/20 flex items-center justify-between gap-3">
                          {!showRejectBox ? (
                            <button
                              type="button"
                              onClick={() => {
                                setShowRejectBox(true);
                                setRejectError("");
                              }}
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
                                Batal Koreksi
                              </button>
                            )}
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
                        ? "Analisis AI gagal dan tidak dicoba lagi otomatis setelah batas percobaan tercapai."
                        : "Belum ada analisis AI yang tersedia untuk divalidasi pada butir soal ini."}

                    {currentAttempt?.status === "ANALYSIS_FAILED" && (
                      <div className="mt-3 flex flex-col items-center gap-2">
                        <button
                          type="button"
                          onClick={() => void handleReanalyze()}
                          disabled={reanalyzing}
                          className="btn-secondary inline-flex items-center gap-1.5 !py-2 !px-3.5 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          <RotateCcw
                            size={13}
                            className={reanalyzing ? "animate-spin" : ""}
                          />
                          {reanalyzing ? "Menjadwalkan..." : "Proses ulang analisis"}
                        </button>
                        {analysisWorker && analysisWorker !== "alive" && (
                          <p className="text-[11px] leading-relaxed text-error">
                            Worker analisis tidak berjalan (
                            {analysisWorker === "missing" ? "tidak ditemukan" : "tidak aktif"}
                            ) — submission akan tetap tertahan sampai worker hidup.
                          </p>
                        )}
                      </div>
                    )}
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
                        Math.min(data.questions.length - 1, prev + 1),
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
            )}
          </main>

          {/* KOLOM KANAN: DAFTAR SOAL + KARTU NILAI AKHIR (100%, 75%, 50%, ETC) */}
          <aside className="w-full lg:mt-16 lg:w-52 shrink-0 lg:sticky lg:top-6 space-y-3">
            {/* 1. KOTAK DAFTAR SOAL */}
            <div className="rounded-xl border border-outline-variant/40 bg-surface-container-lowest p-3.5 shadow-sm">
              <div className="flex items-center justify-between border-b border-outline-variant/30 pb-2.5">
                <h3 className="font-bold text-xs text-on-surface uppercase tracking-wide">
                  Daftar Soal
                </h3>
                <span className="text-xs text-on-surface-variant font-mono-ui">
                  {data.questions.length} Soal
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-2 py-3">
                {data.questions.map((q, idx) => {
                  const isCurrent = idx === activeQuestionIdx;
                  const latestAttempt = latestAttemptOf(q);
                  const isAnswered = Boolean(latestAttempt);
                  const isValidated = latestAttempt?.status === "VALIDATED";
                  const draft = latestAttempt?.analysis
                    ? drafts[latestAttempt.analysis.id]
                    : undefined;
                  const hasLecturerDecision = Boolean(draft?.decisionTouched);
                  const isCorrectItem =
                    isValidated &&
                    Number(
                      latestAttempt?.analysis?.validation?.final_percentage ??
                        latestAttempt?.analysis?.percentage_correct ??
                        0,
                    ) >= 99.9;

                  let boxBorderCls =
                    "border-outline-variant/50 bg-surface-container text-on-surface-variant";
                  let dotColor: string | null = null;
                  let statusTitle = "Belum Dijawab";

                  if (isValidated) {
                    if (isCorrectItem) {
                      boxBorderCls =
                        "border-emerald-500/60 bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 font-bold";
                      statusTitle = "Jawaban Benar";
                    } else {
                      boxBorderCls =
                        "border-rose-500/60 bg-rose-500/15 text-rose-600 dark:text-rose-400 font-bold";
                      statusTitle = "Jawaban Salah";
                    }
                  } else if (hasLecturerDecision) {
                    if (draft?.isCorrect) {
                      boxBorderCls =
                        "border-emerald-500/60 bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 font-bold";
                      statusTitle = "Keputusan dosen: Benar";
                    } else {
                      boxBorderCls =
                        "border-rose-500/60 bg-rose-500/15 text-rose-600 dark:text-rose-400 font-bold";
                      statusTitle = "Keputusan dosen: Salah";
                    }
                  } else if (latestAttempt?.status === "PENDING_VALIDATION") {
                    dotColor = "bg-amber-400";
                    statusTitle = "Belum diputuskan";
                  } else if (isAnswered) {
                    boxBorderCls =
                      "border-blue-500/60 bg-blue-500/15 text-blue-600 dark:text-blue-400 font-bold";
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
                          ? "ring-2 ring-primary ring-offset-2 ring-offset-surface-container-lowest font-extrabold"
                          : "hover:border-primary/60"
                      }`}
                      title={`Soal ${idx + 1}: ${statusTitle}`}
                    >
                      {idx + 1}
                      {dotColor && (
                        <span
                          className={`absolute -top-1 -right-1 h-2 w-2 rounded-full border border-surface-container-lowest ${dotColor}`}
                        />
                      )}
                    </button>
                  );
                })}
              </div>

              <div className="pt-2 border-t border-outline-variant/30 space-y-1 text-xs text-on-surface-variant font-medium">
                <div className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-amber-400 shrink-0" />
                  <span>Belum divalidasi</span>
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

            {/* FINALISASI: kirim semua draft validasi sekaligus */}
            <button
              type="button"
              onClick={() => setShowFinalizeModal(true)}
              disabled={
                !allPendingDecided || finalizeItems.length === 0 || finalizing
              }
              className="btn-primary w-full !py-2.5 text-sm font-bold inline-flex items-center justify-center gap-2 shadow-sm cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <ShieldCheck size={16} />
              {finalizing ? "Menyimpan..." : "Selesai Evaluasi"}
            </button>
            {(inFlightQuestions.length > 0 || rejectedUndecidedCount > 0) && (
              <p className="text-xs text-amber-600 dark:text-amber-400 text-center leading-relaxed">
                {inFlightQuestions.length > 0
                  ? `${inFlightQuestions.length} soal sedang dianalisis AI. `
                  : ""}
                {rejectedUndecidedCount > 0
                  ? `${rejectedUndecidedCount} soal menunggu analisis ulang selesai — validasi ulang setelah siap.`
                  : ""}
              </p>
            )}
            <p className="text-xs text-on-surface-variant text-center">
              Draf: {decidedPendingCount} / {awaitingDecisionQuestions.length}{" "}
              soal menunggu validasi diputuskan
            </p>
          </aside>
        </div>
      ) : null}

      {/* MODAL RINGKASAN FINALISASI */}
      {showFinalizeModal && (
        <div
          className="fixed inset-0 z-[300] flex items-center justify-center bg-black/60 p-4"
          role="dialog"
        >
          <div className="w-full max-w-lg rounded-2xl border border-outline-variant/50 bg-surface-container-lowest p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-display text-base font-bold text-on-surface flex items-center gap-2">
                <ShieldCheck size={18} className="text-primary" /> Selesai
                Evaluasi?
              </h3>
              <button
                type="button"
                onClick={() => setShowFinalizeModal(false)}
                className="text-on-surface-variant hover:text-on-surface cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>
            <p className="text-sm text-on-surface-variant">
              {finalizeItems.length} keputusan draft akan dikirim sebagai
              validasi final:
            </p>

            {/* Ringkasan agregat — tetap mudah dipindai walau puluhan soal */}
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/15 px-2.5 py-1 text-xs font-bold text-emerald-600 dark:text-emerald-400">
                <CheckCircle2 size={14} /> {finalizeSummary.benar} Benar
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-lg border border-rose-500/30 bg-rose-500/15 px-2.5 py-1 text-xs font-bold text-rose-600 dark:text-rose-400">
                <XCircle size={14} /> {finalizeSummary.salah} Salah
              </span>
              {finalizeSummary.correction > 0 && (
                <span className="inline-flex items-center gap-1.5 rounded-lg border border-primary/30 bg-primary-fixed px-2.5 py-1 text-xs font-bold text-primary">
                  <ShieldCheck size={14} /> {finalizeSummary.correction} Koreksi
                </span>
              )}
            </div>

            {/* Kontradiksi Benar/Salah vs diagnosis — diperingatkan, bukan diblokir */}
            {contradictoryRows.length > 0 && (
              <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-600 dark:text-amber-400">
                <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                <span>
                  <strong>
                    {contradictoryRows.length} keputusan bertentangan
                  </strong>
                  {": "}
                  {contradictoryRows.map((r) => r.label).join(", ")}
                </span>
              </div>
            )}

            {/* Grid nomor soal berwarna sesuai keputusan — compact untuk N besar */}
            <div className="flex flex-wrap gap-1.5">
              {finalizeRows.map((item) => (
                <span
                  key={item.analysisId}
                  title={`${item.label}: ${
                    item.draft.isCorrect ? "Benar" : "Salah"
                  } [${item.draft.finalCategory}]${
                    item.contradictory ? " · BERTENTANGAN" : ""
                  }${item.draft.mode === "correction" ? " · Koreksi" : ""}`}
                  className={`flex h-7 min-w-7 items-center justify-center rounded-md border px-1 font-mono-ui text-xs font-bold ${
                    item.draft.isCorrect
                      ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                      : "border-rose-500/40 bg-rose-500/15 text-rose-600 dark:text-rose-400"
                  }${item.contradictory ? " ring-2 ring-amber-500/70" : ""}`}
                >
                  {item.chipLabel}
                </span>
              ))}
            </div>

            <button
              type="button"
              onClick={() => setShowFinalizeDetail((s) => !s)}
              className="text-xs font-semibold text-primary hover:underline cursor-pointer"
            >
              {showFinalizeDetail
                ? "Sembunyikan rincian"
                : `Lihat rincian (${finalizeItems.length})`}
            </button>
            {showFinalizeDetail && (
              <div className="max-h-56 overflow-y-auto space-y-1.5">
                {finalizeRows.map((item) => (
                  <div
                    key={item.analysisId}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-outline-variant/30 bg-surface-container-low px-3 py-1.5 text-xs"
                  >
                    <span className="font-mono-ui font-bold text-on-surface">
                      {item.label}
                    </span>
                    <span
                      className={`font-semibold ${
                        item.draft.isCorrect
                          ? "text-emerald-600 dark:text-emerald-400"
                          : "text-rose-500"
                      }`}
                    >
                      {item.draft.isCorrect ? "Benar" : "Salah"}
                    </span>
                    <span className="font-mono-ui text-on-surface-variant">
                      [{item.draft.finalCategory}]
                    </span>
                    {item.contradictory && (
                      <span className="inline-flex items-center gap-1 rounded-md border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 font-semibold text-amber-600 dark:text-amber-400">
                        <AlertTriangle size={11} /> Bertentangan
                      </span>
                    )}
                    <span className="text-on-surface-variant">
                      {item.draft.mode === "correction"
                        ? "Koreksi"
                        : "Validasi baru"}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {finalizeProgress && (
              <p className="text-xs font-mono-ui font-bold text-primary">
                Menyimpan {finalizeProgress.done} / {finalizeProgress.total} ...
              </p>
            )}
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowFinalizeModal(false)}
                className="btn-secondary text-xs cursor-pointer"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={() => void handleFinalize()}
                disabled={finalizing}
                className="btn-primary text-xs font-bold cursor-pointer"
              >
                {finalizing ? "Menyimpan..." : "Ya, Selesai Evaluasi"}
              </button>
            </div>
          </div>
        </div>
      )}
      <FeedbackModal
        open={!!error}
        message={error}
        onClose={() => setError("")}
      />
      <FeedbackModal
        open={!!notice}
        message={notice}
        variant="success"
        onClose={() => setNotice("")}
      />
    </PageContainer>
  );
}
