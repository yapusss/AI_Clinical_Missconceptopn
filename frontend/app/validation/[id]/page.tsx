"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  AlertTriangle,
  ArrowLeft,
  BookMarked,
  BrainCircuit,
  CheckCircle2,
  ClipboardCheck,
  GraduationCap,
  Lightbulb,
  RotateCcw,
  ShieldCheck,
  XCircle,
} from "lucide-react";

import { useAuth } from "../../components/AuthProvider";
import AppSelect from "../../components/AppSelect";
import PageContainer from "../../components/PageContainer";
import PageHeader from "../../components/PageHeader";
import RichTextContent from "../../components/RichTextContent";
import MathContent from "../../components/MathContent";
import { apiFetch } from "../../lib/api";
import FeedbackModal from "../../components/FeedbackModal";
import type {
  GroundingReference,
  LearnedTopic,
  ReadingMaterial,
  VerdictShadow,
} from "../../lib/studentSubmissions";

type MisconceptionMatch = {
  misconception_id: string;
  label: string;
  matched: boolean;
  confidence: string;
  reasoning: string;
  lecturer_confirmed?: boolean;
};

type Detail = {
  analysis_id: string;
  submission_id: string;
  run_number: number;
  submission_status: string;
  student: { id: string; name: string };
  subject: { id: string; name: string };
  set: { id: string; code: string; title: string };
  question: {
    version_id: string;
    version_number: number;
    prompt: string;
    short_answer?: string;
    model_answer: string;
    reference?: { short_answer: string; reason: string };
  };
  answer: {
    text: string;
    tier1_answer?: string;
    tier2_confidence?: number;
    tier3_reason?: string;
    tier4_confidence?: number;
    heuristic_flags?: string[];
    attempt_no: number;
    submitted_at: string;
  };
  llm: {
    model_identifier: string;
    prompt_version: string;
    percentage_correct: string;
    tier_level: number;
    tier_label: string;
    confidence: string;
    explanation: string;
    module_a_score?: string;
    module_b_score?: string;
    module_c_code?: string;
    four_tier_category?: string;
    risk_level?: string;
    concept_breakdown_json: {
      misconception_matches?: MisconceptionMatch[];
      module_c?: {
        code: string;
        role: "CONFIRMED_MISCONCEPTION" | "CLASS_MAPPING_INDICATION";
        role_label: string;
      } | null;
      heuristic_flags?: string[];
    };
    execution_time_ms: number | null;
    created_at: string;
    references?: GroundingReference[];
    what_should_be_learned?: LearnedTopic[];
    suggested_materials?: LearnedTopic[];
    answer_similarity_t1?: number | null;
    answer_similarity_t3?: number | null;
    llm_t1_score?: string | null;
    llm_t3_score?: string | null;
    verdict_shadow?: VerdictShadow;
    reading_material?: ReadingMaterial | null;
  };
  validatable: boolean;
  existing_validation: {
    status: string;
    final_percentage: string | null;
    final_tier_level: number | null;
    final_category: string | null;
    final_feedback: string | null;
    lecturer_name: string;
    validated_at: string;
  } | null;
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

// The tier level is a derived projection of the category, not a separate judgement:
// FP and MSC both map to level 2, so the level can never be the lecturer's answer.
// It is still sent because the procedure stores it (and NOT NULL legacy columns need it),
// but it is always computed from the chosen category.
const CATEGORY_TO_LEVEL: Record<string, number> = {
  SC: 4,
  FN: 3,
  FP: 2,
  MSC: 2,
  LK: 1,
};

// Display order for the diagnosis selector: sound understanding first, then the three
// ways a student can be wrong, then "does not know".
const CATEGORY_ORDER = ["SC", "FP", "FN", "MSC", "LK"];

const shortId = (value?: string | null) => (value ? value.slice(0, 8) : "—");

const MATERIAL_STATUS_META: Record<string, { label: string; cls: string }> = {
  READY: { label: "Siap", cls: "badge-active" },
  PENDING: { label: "Menunggu", cls: "badge-draft" },
  STALE: { label: "Kedaluwarsa", cls: "badge-review" },
  FAILED: { label: "Gagal", cls: "badge-revoked" },
};

export default function ValidationDetailPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const analysisId = params?.id;

  const [data, setData] = useState<Detail | null>(null);
  const [fetching, setFetching] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  // Validation Form State
  const [finalPct, setFinalPct] = useState("");
  const [finalCategory, setFinalCategory] = useState<string>("");
  const [feedback, setFeedback] = useState("");
  const [notes, setNotes] = useState("");
  const [confirms, setConfirms] = useState<Record<string, boolean>>({});
  const [showRejectBox, setShowRejectBox] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Reading-material flag (review, not edit) state.
  const [flagOpen, setFlagOpen] = useState(false);
  const [flagNote, setFlagNote] = useState("");
  const [flagSubmitting, setFlagSubmitting] = useState(false);

  const load = useCallback(async () => {
    if (!analysisId) return;
    setFetching(true);
    setError("");
    try {
      const det = await apiFetch<Detail>(`/validations/${analysisId}`);
      setData(det);

      const existing = det.existing_validation;
      setFinalPct(existing?.final_percentage ?? det.llm.percentage_correct);
      setFinalCategory(
        existing?.final_category ?? det.llm.four_tier_category ?? "",
      );
      setFeedback(existing?.final_feedback ?? det.llm.explanation);

      const initialConfirms: Record<string, boolean> = {};
      const matches =
        det.llm.concept_breakdown_json?.misconception_matches ?? [];
      matches.forEach((m) => {
        initialConfirms[m.misconception_id] =
          m.lecturer_confirmed !== undefined ? m.lecturer_confirmed : m.matched;
      });
      setConfirms(initialConfirms);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Gagal memuat detail analisis.",
      );
    } finally {
      setFetching(false);
    }
  }, [analysisId]);

  useEffect(() => {
    if (loading) return;
    if (!user) {
      router.replace("/login");
      return;
    }
    void load();
  }, [user, loading, router, load]);

  const handleValidationSubmit = async (forcedStatus?: "REJECTED") => {
    if (!analysisId || !data) return;
    setError("");
    setNotice("");

    if (forcedStatus !== "REJECTED") {
      if (!finalCategory) {
        setError(
          "Peringatan: Silakan pilih Diagnosis Akhir sebelum menyimpan validasi.",
        );
        return;
      }
      if (finalPct === "" || Number.isNaN(Number(finalPct))) {
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
    } else if (!notes.trim()) {
      setError(
        "Peringatan: Harap isi catatan alasan penolakan agar analisis ulang AI dapat diperbaiki.",
      );
      return;
    }

    setSubmitting(true);
    try {
      let decisionStatus: "ACCEPTED" | "EDITED" | "REJECTED" = "ACCEPTED";
      if (forcedStatus === "REJECTED") {
        decisionStatus = "REJECTED";
      } else {
        const isScoreChanged =
          Number(finalPct) !== Number(data.llm.percentage_correct);
        const isCategoryChanged =
          finalCategory !== (data.llm.four_tier_category ?? "");
        const isFeedbackChanged =
          feedback.trim() !== data.llm.explanation.trim();
        if (isScoreChanged || isCategoryChanged || isFeedbackChanged) {
          decisionStatus = "EDITED";
        }
      }

      const body: Record<string, unknown> = { status: decisionStatus };
      if (decisionStatus !== "REJECTED") {
        body.final_percentage = Number(finalPct);
        body.final_category = finalCategory;
        // Derived, never chosen: the legacy NOT NULL columns need a level and the
        // procedure stores it, but the category above is the lecturer's actual answer.
        body.final_tier_level =
          CATEGORY_TO_LEVEL[finalCategory] ?? data.llm.tier_level ?? 1;
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
      }>(`/validations/${analysisId}/submit`, {
        method: "POST",
        body: JSON.stringify(body),
      });

      setNotice(res.message);
      await load();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Gagal menyimpan validasi.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleFlagMaterial = async () => {
    const material = data?.llm.reading_material;
    if (!material) return;
    setError("");
    setNotice("");
    setFlagSubmitting(true);
    try {
      const res = await apiFetch<{
        status: string;
        review_status: string;
        flag_note: string | null;
      }>(`/materials/reading/${material.id}/flag`, {
        method: "POST",
        body: JSON.stringify({ note: flagNote.trim() || undefined }),
      });
      setNotice(
        "Materi ditandai perlu diperbaiki dan masuk antrean regenerate.",
      );
      setData((prev) =>
        prev
          ? {
              ...prev,
              llm: {
                ...prev.llm,
                reading_material: {
                  ...material,
                  status: res.status,
                  review_status: res.review_status,
                  flag_note: res.flag_note,
                },
              },
            }
          : prev,
      );
      setFlagOpen(false);
      setFlagNote("");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Gagal menandai materi bacaan.",
      );
    } finally {
      setFlagSubmitting(false);
    }
  };

  const resetToAiValues = () => {
    if (!data) return;
    setFinalPct(data.llm.percentage_correct);
    setFinalCategory(data.llm.four_tier_category ?? "");
    setFeedback(data.llm.explanation);
  };

  const categoryMeta = data?.llm.four_tier_category
    ? CATEGORY_META[data.llm.four_tier_category]
    : null;

  const heuristicFlags =
    data?.answer.heuristic_flags ??
    data?.llm.concept_breakdown_json?.heuristic_flags ??
    [];

  const learnedTopics =
    data?.llm.what_should_be_learned ?? data?.llm.suggested_materials ?? [];
  const readingMaterial = data?.llm.reading_material ?? null;
  const shadowVerdict = data?.llm.verdict_shadow ?? {};
  const materialStatusMeta = readingMaterial
    ? MATERIAL_STATUS_META[readingMaterial.status] ?? {
        label: readingMaterial.status,
        cls: "badge-role",
      }
    : null;

  if (loading || !user) return null;

  return (
    <PageContainer>
      <Link
        href="/validation"
        className="inline-flex items-center gap-1.5 text-xs font-semibold text-on-surface-variant hover:text-primary no-underline"
      >
        <ArrowLeft size={14} /> Kembali ke antrian validasi
      </Link>

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
          Memuat data analisis...
        </p>
      ) : data ? (
        <div className="mt-3 space-y-5">
          <PageHeader
            title={data.student.name}
            description={`${data.set.title} • ${data.subject.name}`}
            icon={ClipboardCheck}
            eyebrow={
              <span className="font-mono-ui text-xs font-bold uppercase tracking-wider text-primary">
                {data.set.code} • Tinjauan Diagnostik Four-Tier
              </span>
            }
            action={
              <div className="flex items-center gap-2">
                <span
                  className={`badge ${
                    data.submission_status === "PENDING_VALIDATION"
                      ? "badge-draft"
                      : data.submission_status === "VALIDATED"
                        ? "badge-active"
                        : "badge-revoked"
                  }`}
                >
                  {data.submission_status === "PENDING_VALIDATION"
                    ? "Menunggu Validasi"
                    : data.submission_status === "VALIDATED"
                      ? "Tervalidasi"
                      : data.submission_status}
                </span>
                <span className="text-[11px] text-on-surface-variant font-mono-ui">
                  Run #{data.run_number}
                </span>
              </div>
            }
          />

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
            {/* LEFT COLUMN: Reading Flow */}
            <div className="lg:col-span-7 space-y-4">
              <section className="glass-panel overflow-hidden rounded-xl border border-outline-variant/40">
                <header className="border-b border-outline-variant/40 bg-surface-container-low px-5 py-3">
                  <span className="text-xs font-bold uppercase tracking-wider text-on-surface-variant font-mono-ui">
                    Pertanyaan &amp; Jawaban Model
                  </span>
                </header>

                <div className="p-5 space-y-4">
                  <div>
                    <h3 className="text-xs font-bold uppercase tracking-wider text-on-surface-variant">
                      Pertanyaan Konseptual
                    </h3>
                    <RichTextContent
                      html={data.question.prompt}
                      className="mt-1.5 !text-2xl font-semibold leading-relaxed text-on-surface"
                    />
                  </div>

                  <div className="border-t border-outline-variant/20 pt-3">
                    <h3 className="text-xs font-bold uppercase tracking-wider text-on-surface-variant">
                      Jawaban Singkat (Referensi)
                    </h3>
                    <RichTextContent
                      html={
                        data.question.reference?.short_answer ??
                        data.question.short_answer ??
                        ""
                      }
                      className="mt-1.5 text-sm text-on-surface-variant leading-relaxed"
                    />
                  </div>

                  <div className="border-t border-outline-variant/20 pt-3">
                    <h3 className="text-xs font-bold uppercase tracking-wider text-on-surface-variant">
                      Alasan Referensi
                    </h3>
                    <RichTextContent
                      html={
                        data.question.reference?.reason ??
                        data.question.model_answer ??
                        ""
                      }
                      className="mt-1.5 text-sm text-on-surface-variant leading-relaxed"
                    />
                  </div>

                  {/* Heuristic Warnings */}
                  {heuristicFlags.length > 0 && (
                    <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-300 space-y-1">
                      <div className="flex items-center gap-1.5 font-bold">
                        <AlertTriangle size={14} /> Penanda Otomatis Terdeteksi:
                      </div>
                      <div className="flex flex-wrap gap-1.5 pt-1">
                        {heuristicFlags.map((flag) => (
                          <span
                            key={flag}
                            className="font-mono-ui font-semibold bg-amber-500/20 px-2 py-0.5 rounded border border-amber-500/40"
                          >
                            {flag === "t1_berisi_alasan" &&
                              "Tier 1 Memuat Alasan"}
                            {flag === "t3_kosong" && "Tier 3 Kosong / < 5 Kata"}
                            {flag === "t3_redundan" &&
                              "Tier 3 Redundan dengan Tier 1"}
                            {flag === "t3_hafalan" &&
                              "Tier 3 Kutipan Hafalan Rumus"}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Four-Tier Student Response */}
                  <div className="border-t border-outline-variant/20 pt-3 space-y-3">
                    <h3 className="text-xs font-bold uppercase tracking-wider text-on-surface-variant">
                      Jawaban Mahasiswa (Four-Tier)
                    </h3>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="rounded-lg border border-outline-variant/30 bg-surface-container-lowest p-3">
                        <span className="text-[10px] font-bold uppercase text-on-surface-variant">
                          Tier 1 — Kesimpulan
                        </span>
                        <MathContent
                          value={data.answer.tier1_answer || data.answer.text}
                          className="mt-1 text-sm font-semibold text-on-surface font-mono-ui"
                        />
                      </div>
                      <div className="rounded-lg border border-outline-variant/30 bg-surface-container-lowest p-3">
                        <span className="text-[10px] font-bold uppercase text-on-surface-variant">
                          Tier 2 — Keyakinan Jawaban
                        </span>
                        <p className="mt-1 text-sm font-bold text-primary font-mono-ui">
                          Skala {data.answer.tier2_confidence ?? 1} / 6 (
                          {(data.answer.tier2_confidence ?? 1) >= 4
                            ? "Yakin"
                            : "Tidak Yakin"}
                          )
                        </p>
                      </div>
                      <div className="rounded-lg border border-outline-variant/30 bg-surface-container-lowest p-3 sm:col-span-2">
                        <span className="text-[10px] font-bold uppercase text-on-surface-variant">
                          Tier 3 — Alasan Ilmiah
                        </span>
                        <MathContent
                          value={data.answer.tier3_reason || data.answer.text}
                          className="mt-1 text-sm text-on-surface font-mono-ui leading-relaxed"
                        />
                      </div>
                      <div className="rounded-lg border border-outline-variant/30 bg-surface-container-lowest p-3 sm:col-span-2">
                        <span className="text-[10px] font-bold uppercase text-on-surface-variant">
                          Tier 4 — Keyakinan Alasan
                        </span>
                        <p className="mt-1 text-sm font-bold text-primary font-mono-ui">
                          Skala {data.answer.tier4_confidence ?? 1} / 6 (
                          {(data.answer.tier4_confidence ?? 1) >= 4
                            ? "Yakin"
                            : "Tidak Yakin"}
                          )
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              </section>

              {/* Modular AI Diagnostics */}
              <section className="glass-panel overflow-hidden rounded-xl border border-outline-variant/40">
                <header className="border-b border-outline-variant/40 bg-surface-container-low px-5 py-3 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <BrainCircuit size={17} className="text-primary" />
                    <span className="text-xs font-bold uppercase tracking-wider text-on-surface">
                      Evaluasi Modular AI (Run #{data.run_number})
                    </span>
                  </div>
                  <span className="text-[11px] text-on-surface-variant font-mono-ui">
                    {data.llm.execution_time_ms ?? "-"} ms
                  </span>
                </header>

                <div className="p-5 space-y-4 text-xs">
                  <div>
                    <h4 className="font-bold uppercase tracking-wider text-on-surface-variant">
                      Penjelasan Klinis AI:
                    </h4>
                    <p className="mt-1 whitespace-pre-wrap leading-relaxed text-on-surface text-xs">
                      {data.llm.explanation}
                    </p>
                  </div>

                  {/* Misconception Catalog Matches */}
                  <div className="border-t border-outline-variant/20 pt-3">
                    <div className="flex items-center gap-1.5 mb-2">
                      <Lightbulb size={14} className="text-primary" />
                      <h4 className="font-bold tracking-wider text-on-surface-variant">
                        Miskonsepsi Terdeteksi (Katalog &amp; Indikasi)
                      </h4>
                    </div>

                    {!data.llm.concept_breakdown_json?.misconception_matches
                      ?.length ? (
                      <p className="text-on-surface-variant italic">
                        Tidak ada pola miskonsepsi yang terdeteksi.
                      </p>
                    ) : (
                      <div className="space-y-2">
                        {data.llm.concept_breakdown_json.misconception_matches.map(
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

              {/* Materi Bacaan — generated reading material (C6). Review only:
                  there is deliberately no edit control, textarea or save button
                  (D7) — a lecturer flags bad material and the drain regenerates. */}
              <section className="glass-panel overflow-hidden rounded-xl border border-outline-variant/40">
                <header className="flex items-center justify-between border-b border-outline-variant/40 bg-surface-container-low px-5 py-3">
                  <div className="flex items-center gap-2">
                    <BookMarked size={17} className="text-primary" />
                    <span className="text-xs font-bold tracking-wider text-on-surface">
                      Materi Bacaan
                    </span>
                  </div>
                  {readingMaterial && materialStatusMeta && (
                    <div className="flex items-center gap-2">
                      <span className={`badge ${materialStatusMeta.cls} shrink-0`}>
                        {materialStatusMeta.label}
                      </span>
                      {readingMaterial.stale && (
                        <span className="badge badge-revoked shrink-0">
                          Perlu regenerate
                        </span>
                      )}
                    </div>
                  )}
                </header>

                <div className="space-y-3 p-5">
                  {!readingMaterial ? (
                    <p className="text-xs italic text-on-surface-variant">
                      Belum ada materi bacaan untuk kategori ini. Materi dibuat untuk
                      setiap kategori selain Sound Understanding dan baru muncul setelah
                      antrean drain berjalan.
                    </p>
                  ) : (
                    <>
                      {/* Staleness badge (D18) — recomputed server-side at read time */}
                      {readingMaterial.stale && (
                        <div className="space-y-1 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-300">
                          <div className="flex items-center gap-1.5 font-bold">
                            <AlertTriangle size={14} /> referensi berubah sejak materi ini dibuat
                          </div>
                          {readingMaterial.stale_reason && (
                            <p className="leading-relaxed">{readingMaterial.stale_reason}</p>
                          )}
                        </div>
                      )}

                      {/* Flagged review state */}
                      {readingMaterial.review_status === "FLAGGED" && (
                        <div className="space-y-1 rounded-lg border border-error/40 bg-error-container/20 p-3 text-xs text-error">
                          <div className="flex items-center gap-1.5 font-bold">
                            <XCircle size={14} /> Ditandai perlu diperbaiki
                          </div>
                          {readingMaterial.flag_note && (
                            <p className="leading-relaxed">{readingMaterial.flag_note}</p>
                          )}
                        </div>
                      )}

                      {/* Ungrounded warning (D8/D10) */}
                      {readingMaterial.grounded === false && (
                        <div className="flex items-start gap-1.5 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-300">
                          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                          <span className="leading-relaxed">
                            Materi ini dibuat TANPA materi referensi (grounded = false).
                          </span>
                        </div>
                      )}
                      {readingMaterial.ungrounded_source_count > 0 && (
                        <p className="text-[11px] leading-relaxed text-error">
                          {readingMaterial.ungrounded_source_count} sumber yang dikutip tidak
                          dapat diselesaikan ke materi referensi.
                        </p>
                      )}

                      {/* The material itself — read-only */}
                      {readingMaterial.status === "READY" && readingMaterial.content_md ? (
                        <div className="whitespace-pre-wrap text-sm leading-relaxed text-on-surface">
                          {readingMaterial.content_md}
                        </div>
                      ) : (
                        <p className="text-xs italic text-on-surface-variant">
                          {readingMaterial.status === "PENDING"
                            ? "Materi sedang dalam antrean generate."
                            : readingMaterial.status === "STALE"
                              ? "Materi menunggu regenerate karena referensi berubah."
                              : readingMaterial.status === "FAILED"
                                ? `Generate materi gagal setelah ${readingMaterial.attempts} percobaan.`
                                : "Materi belum tersedia."}
                        </p>
                      )}

                      {/* Sources (provenance of the material) */}
                      {readingMaterial.sources.length > 0 && (
                        <div className="border-t border-outline-variant/20 pt-3">
                          <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-on-surface-variant">
                            Sumber Materi ({readingMaterial.sources.length})
                          </p>
                          <ul className="space-y-1">
                            {readingMaterial.sources.map((src, index) => (
                              <li
                                key={`${src.chunk_id}-${index}`}
                                className="flex items-center justify-between gap-2 rounded border border-outline-variant/30 bg-surface-container-lowest px-3 py-1.5 text-xs"
                              >
                                <span className="min-w-0 truncate font-semibold text-on-surface">
                                  {src.document_title || "Sumber tidak dikenal"}
                                </span>
                                <span className="shrink-0 font-mono-ui text-[10px] text-on-surface-variant">
                                  {typeof src.page === "number" ? `hal. ${src.page}` : "—"}
                                </span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {/* Cosine values — labelled as alignment, never accuracy */}
                      <div className="border-t border-outline-variant/20 pt-3">
                        <p className="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant">
                          Keselarasan dengan jawaban referensi dosen
                        </p>
                        <div className="mt-1.5 grid grid-cols-2 gap-3">
                          <div className="rounded-lg border border-outline-variant/30 bg-surface-container-lowest p-3">
                            <span className="text-[10px] font-bold uppercase text-on-surface-variant">
                              Tier 1
                            </span>
                            <p className="mt-0.5 font-mono-ui text-base font-extrabold text-primary">
                              {typeof data.llm.answer_similarity_t1 === "number"
                                ? data.llm.answer_similarity_t1.toFixed(4)
                                : "—"}
                            </p>
                          </div>
                          <div className="rounded-lg border border-outline-variant/30 bg-surface-container-lowest p-3">
                            <span className="text-[10px] font-bold uppercase text-on-surface-variant">
                              Tier 3
                            </span>
                            <p className="mt-0.5 font-mono-ui text-base font-extrabold text-primary">
                              {typeof data.llm.answer_similarity_t3 === "number"
                                ? data.llm.answer_similarity_t3.toFixed(4)
                                : "—"}
                            </p>
                          </div>
                        </div>
                        <p className="mt-1.5 text-[11px] leading-relaxed text-on-surface-variant">
                          Bukan akurasi; mengukur keselarasan jawaban mahasiswa dengan jawaban
                          referensi dosen. Tanda — berarti similarity belum tersedia untuk analisis ini.
                        </p>
                      </div>

                      {/* Driving verdict + shadow verdict */}
                      <div className="grid grid-cols-1 gap-3 border-t border-outline-variant/20 pt-3 sm:grid-cols-2">
                        <div className="rounded-lg border border-outline-variant/30 bg-surface-container-lowest p-3 text-xs">
                          <p className="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant">
                            Verdict penggerak
                          </p>
                          <p className="mt-1 font-mono-ui text-on-surface">
                            T1: {data.llm.module_a_score ?? "—"} · T3: {data.llm.module_b_score ?? "—"}
                          </p>
                          <p className="mt-1 text-[11px] text-on-surface-variant">
                            Sumber: {readingMaterial.prompt_version ?? data.llm.prompt_version ?? "—"}
                          </p>
                        </div>
                        <div className="rounded-lg border border-dashed border-outline-variant/40 bg-surface-container-low p-3 text-xs">
                          <p className="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant">
                            Shadow (aturan θ) — tidak menggerakkan
                          </p>
                          <p className="mt-1 font-mono-ui text-on-surface">
                            T1: {shadowVerdict.rule_t1 ?? data.llm.llm_t1_score ?? "—"} · T3:{" "}
                            {shadowVerdict.rule_t3 ?? data.llm.llm_t3_score ?? "—"}
                          </p>
                          <p className="mt-1 text-[11px] text-on-surface-variant">
                            Diagnostik kalibrasi; verdict penggerak tetap yang menentukan kategori.
                          </p>
                        </div>
                      </div>

                      {/* Flag control — review, not editing */}
                      <div className="border-t border-outline-variant/20 pt-3">
                        {!flagOpen ? (
                          <button
                            type="button"
                            onClick={() => setFlagOpen(true)}
                            className="btn-secondary inline-flex items-center gap-1.5 !px-3 !py-1.5 text-xs font-semibold cursor-pointer"
                            title="Tandai materi ini perlu diperbaiki (bukan mengedit teksnya)"
                          >
                            <AlertTriangle size={14} /> Tandai perlu diperbaiki
                          </button>
                        ) : (
                          <div className="space-y-2 rounded-lg border border-dashed border-error/40 bg-error-container/20 p-3">
                            <div className="flex items-center justify-between text-xs font-bold text-error">
                              <span className="inline-flex items-center gap-1.5">
                                <AlertTriangle size={14} /> Tandai perlu diperbaiki
                              </span>
                              <button
                                type="button"
                                onClick={() => setFlagOpen(false)}
                                className="text-[11px] text-on-surface-variant hover:text-on-surface cursor-pointer"
                              >
                                Batal
                              </button>
                            </div>
                            <p className="text-[11px] leading-relaxed text-on-surface-variant">
                              Catatan opsional akan dibawa ke generate ulang. Materi tidak dapat
                              diedit manual.
                            </p>
                            <textarea
                              rows={2}
                              value={flagNote}
                              onChange={(e) => setFlagNote(e.target.value)}
                              placeholder="Jelaskan kenapa materi ini perlu diperbaiki..."
                              className="form-input w-full text-xs"
                            />
                            <div className="flex justify-end">
                              <button
                                type="button"
                                onClick={handleFlagMaterial}
                                disabled={flagSubmitting}
                                className="btn-danger !px-3 !py-1.5 text-xs font-semibold"
                              >
                                {flagSubmitting ? "Menandai..." : "Kirim tanda"}
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    </>
                  )}
                </div>
              </section>

              {/* Yang Perlu Dipelajari (C8: the grounding score is gone) */}
              <section className="glass-panel overflow-hidden rounded-xl border border-outline-variant/40">
                <header className="border-b border-outline-variant/40 bg-surface-container-low px-5 py-3">
                  <div className="flex items-center gap-2">
                    <GraduationCap size={17} className="text-primary" />
                    <span className="text-xs font-bold tracking-wider text-on-surface">
                      Yang Perlu Dipelajari
                    </span>
                  </div>
                </header>

                <div className="space-y-3 p-5">
                  <p className="text-[11px] leading-relaxed text-on-surface-variant">
                    Bukan akurasi; mengukur keselarasan keluaran AI dengan sumber yang dikutip.
                  </p>

                  {learnedTopics.length === 0 ? (
                    <p className="text-xs italic text-on-surface-variant">
                      Tidak ada sumber referensi terverifikasi untuk analisis ini.
                    </p>
                  ) : (
                    <ol className="space-y-2">
                      {learnedTopics.map((topic, index) => (
                        <li
                          key={index}
                          className="rounded-lg border border-outline-variant/30 bg-surface-container-lowest p-3"
                        >
                          <div className="flex items-start gap-2">
                            <span className="mt-0.5 font-mono-ui text-[10px] font-bold text-primary">
                              {index + 1}.
                            </span>
                            <span className="text-xs font-medium text-on-surface">{topic.topik}</span>
                          </div>
                          {topic.sumber_chunk_ids?.length > 0 && (
                            <div className="mt-1.5 flex flex-wrap gap-1 pl-5">
                              {topic.sumber_chunk_ids.map((chunkId) => (
                                <span
                                  key={chunkId}
                                  title={chunkId}
                                  className="rounded border border-outline-variant/30 bg-surface-container px-1.5 py-0.5 font-mono-ui text-[10px] text-on-surface-variant"
                                >
                                  {shortId(chunkId)}
                                </span>
                              ))}
                            </div>
                          )}
                        </li>
                      ))}
                    </ol>
                  )}
                </div>
              </section>
            </div>

            {/* RIGHT COLUMN: Sticky Validation Desk */}
            <div className="lg:col-span-5 lg:sticky lg:top-6 space-y-4">
              <section className="glass-panel overflow-hidden rounded-xl border border-outline-variant/40 shadow-sm">
                <header className="border-b border-outline-variant/40 bg-surface-container-low px-5 py-3 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <ShieldCheck size={18} className="text-primary" />
                    <h4 className="text-xs font-bold uppercase tracking-wider text-on-surface">
                      Keputusan Validasi Dosen
                    </h4>
                  </div>
                  {data.existing_validation && (
                    <span className="text-[11px] text-on-surface-variant">
                      Status:{" "}
                      <strong className="text-on-surface font-semibold">
                        {data.existing_validation.status}
                      </strong>
                    </span>
                  )}
                </header>

                <div className="p-5 space-y-4">
                  {/* Matrix Category Banner */}
                  {categoryMeta && (
                    <div className={`diag-card ${categoryMeta.cardCls}`}>
                      <div className="flex items-center justify-between">
                        <span className="diag-title">
                          [{data.llm.four_tier_category}] {categoryMeta.label}
                        </span>
                      </div>
                      <p className="diag-desc">{categoryMeta.desc}</p>
                      <div className="diag-meta">
                        <span>Modul A: {data.llm.module_a_score}</span>
                        <span>Modul B: {data.llm.module_b_score}</span>
                        {data.llm.module_c_code && (
                          <span>Miskonsepsi: {data.llm.module_c_code}</span>
                        )}
                      </div>
                    </div>
                  )}

                  {/* AI Recommendation Summary */}
                  <div className="rounded-lg border border-outline-variant/30 bg-surface-container-lowest p-3 flex items-center justify-between">
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant">
                        Hasil Prediksi AI
                      </p>
                      <div className="mt-1 flex items-baseline gap-2">
                        <span className="font-mono-ui text-xl font-extrabold text-primary">
                          {Number(data.llm.percentage_correct).toFixed(1)}%
                        </span>
                        <span className="text-xs font-semibold text-on-surface-variant">
                          {data.llm.four_tier_category
                            ? `[${data.llm.four_tier_category}] ${
                                CATEGORY_META[data.llm.four_tier_category]?.label ??
                                data.llm.four_tier_category
                              }`
                            : data.llm.tier_label}
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

                  {/* Direct Controls for Score, Tier, and Feedback */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                    <div>
                      <label
                        htmlFor="final-pct-v"
                        className="block text-[11px] font-bold uppercase text-on-surface-variant"
                      >
                        Skor Akhir (%)
                      </label>
                      <input
                        id="final-pct-v"
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
                        options={CATEGORY_ORDER.map((code) => ({
                          value: code,
                          label: `[${code}] ${CATEGORY_META[code].label}`,
                        }))}
                      />
                    </div>

                    <div className="sm:col-span-2">
                      <label
                        htmlFor="feedback-v"
                        className="block text-[11px] font-bold uppercase text-on-surface-variant"
                      >
                        Feedback untuk Mahasiswa
                      </label>
                      <textarea
                        id="feedback-v"
                        rows={4}
                        value={feedback}
                        onChange={(e) => setFeedback(e.target.value)}
                        className="form-input mt-1 w-full text-xs leading-relaxed"
                        placeholder="Tuliskan umpan balik atau klarifikasi konseptual..."
                      />
                    </div>
                  </div>

                  {/* Rejection Mode */}
                  {showRejectBox && (
                    <div className="rounded-lg border border-dashed border-error/40 bg-error-container/20 p-3 space-y-2">
                      <div className="flex items-center justify-between text-xs font-bold text-error">
                        <span className="inline-flex items-center gap-1.5">
                          <XCircle size={14} /> Tolak &amp; Minta Analisis Ulang
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
                        Sertakan catatan penolakan. Catatan ini akan dikirimkan
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
                          disabled={submitting}
                          className="btn-danger !py-1.5 !px-3 text-xs font-semibold"
                        >
                          Konfirmasi Tolak &amp; Re-analisis
                        </button>
                      </div>
                    </div>
                  )}

                  {!showRejectBox && (
                    <div>
                      <label
                        htmlFor="notes-v"
                        className="block text-[11px] font-bold uppercase text-on-surface-variant"
                      >
                        Catatan Internal Dosen (Opsional)
                      </label>
                      <input
                        id="notes-v"
                        type="text"
                        value={notes}
                        onChange={(e) => setNotes(e.target.value)}
                        placeholder="Catatan untuk arsip atau penelitian..."
                        className="form-input mt-1 w-full text-xs"
                      />
                    </div>
                  )}

                  {/* Action Buttons */}
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
                      disabled={submitting}
                      className="btn-primary !py-2 !px-4 text-xs font-semibold inline-flex items-center gap-1.5 shadow-sm cursor-pointer"
                    >
                      <ShieldCheck size={16} />
                      {submitting ? "Menyimpan..." : "Simpan Validasi"}
                    </button>
                  </div>
                </div>
              </section>
            </div>
          </div>
        </div>
      ) : null}
      <FeedbackModal
        open={!!error}
        message={error}
        onClose={() => setError("")}
      />
    </PageContainer>
  );
}
