"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  AlertTriangle,
  ArrowLeft,
  BrainCircuit,
  CheckCircle2,
  ClipboardCheck,
  Lightbulb,
  RotateCcw,
  ShieldCheck,
  TriangleAlert,
  XCircle,
} from "lucide-react";

import { useAuth } from "../../components/AuthProvider";
import AppSelect from "../../components/AppSelect";
import PageContainer from "../../components/PageContainer";
import PageHeader from "../../components/PageHeader";
import RichTextContent from "../../components/RichTextContent";
import { apiFetch } from "../../lib/api";

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
    model_answer: string;
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
  };
  validatable: boolean;
  existing_validation: {
    status: string;
    final_percentage: string | null;
    final_tier_level: number | null;
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

export default function ValidationDetailPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const analysisId = params?.id;

  const [data, setData] = useState<Detail | null>(null);
  const [fetching, setFetching] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [tiers, setTiers] = useState<{ level: number; label: string }[]>([]);

  // Validation Form State
  const [finalPct, setFinalPct] = useState("");
  const [finalTier, setFinalTier] = useState<number | "">("");
  const [feedback, setFeedback] = useState("");
  const [notes, setNotes] = useState("");
  const [confirms, setConfirms] = useState<Record<string, boolean>>({});
  const [showRejectBox, setShowRejectBox] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    if (!analysisId) return;
    setFetching(true);
    setError("");
    try {
      const det = await apiFetch<Detail>(`/validations/${analysisId}`);
      setData(det);

      const existing = det.existing_validation;
      setFinalPct(existing?.final_percentage ?? det.llm.percentage_correct);
      setFinalTier(existing?.final_tier_level ?? det.llm.tier_level);
      setFeedback(existing?.final_feedback ?? det.llm.explanation);

      const initialConfirms: Record<string, boolean> = {};
      const matches =
        det.llm.concept_breakdown_json?.misconception_matches ?? [];
      matches.forEach((m) => {
        initialConfirms[m.misconception_id] =
          m.lecturer_confirmed !== undefined ? m.lecturer_confirmed : m.matched;
      });
      setConfirms(initialConfirms);

      try {
        const t = await apiFetch<{ level: number; label: string }[]>(
          `/validations/tiers?subject_id=${det.subject.id}`,
        );
        setTiers(t);
      } catch {
        setTiers(
          [1, 2, 3, 4].map((level) => ({ level, label: `Tier ${level}` })),
        );
      }
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
      if (finalTier === "" || finalTier === null) {
        setError(
          "Peringatan: Silakan pilih Tier Akhir sebelum menyimpan validasi.",
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
        const isTierChanged = Number(finalTier) !== Number(data.llm.tier_level);
        const isFeedbackChanged =
          feedback.trim() !== data.llm.explanation.trim();
        if (isScoreChanged || isTierChanged || isFeedbackChanged) {
          decisionStatus = "EDITED";
        }
      }

      const body: Record<string, unknown> = { status: decisionStatus };
      if (decisionStatus !== "REJECTED") {
        body.final_percentage = Number(finalPct);
        body.final_tier_level = Number(finalTier);
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

  const resetToAiValues = () => {
    if (!data) return;
    setFinalPct(data.llm.percentage_correct);
    setFinalTier(data.llm.tier_level);
    setFeedback(data.llm.explanation);
  };

  const categoryMeta = data?.llm.four_tier_category
    ? CATEGORY_META[data.llm.four_tier_category]
    : null;

  const heuristicFlags =
    data?.answer.heuristic_flags ??
    data?.llm.concept_breakdown_json?.heuristic_flags ??
    [];

  if (loading || !user) return null;

  return (
    <PageContainer>
      <Link
        href="/validation"
        className="inline-flex items-center gap-1.5 text-xs font-semibold text-on-surface-variant hover:text-primary no-underline"
      >
        <ArrowLeft size={14} /> Kembali ke antrian validasi
      </Link>

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
                    <RichTextContent html={data.question.prompt} className="mt-1.5 text-sm font-medium leading-relaxed" />
                  </div>

                  <div className="border-t border-outline-variant/20 pt-3">
                    <h3 className="text-xs font-bold uppercase tracking-wider text-on-surface-variant">
                      Jawaban Referensi (Model Answer)
                    </h3>
                    <RichTextContent html={data.question.model_answer} className="mt-1.5 text-sm text-on-surface-variant leading-relaxed" />
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
                        <p className="mt-1 text-sm font-semibold text-on-surface font-mono-ui">
                          {data.answer.tier1_answer || data.answer.text || "-"}
                        </p>
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
                        <p className="mt-1 text-sm text-on-surface whitespace-pre-wrap font-mono-ui leading-relaxed">
                          {data.answer.tier3_reason || data.answer.text || "-"}
                        </p>
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
                      <h4 className="font-bold uppercase tracking-wider text-on-surface-variant">
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
                          Tier {data.llm.tier_level} ({data.llm.tier_label})
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
                        Tier Akhir
                      </span>
                      <AppSelect
                        value={String(finalTier)}
                        onValueChange={(val) => setFinalTier(Number(val))}
                        className="mt-1 w-full text-xs"
                        ariaLabel="Pilih Tier Akhir"
                        options={tiers.map((t) => ({
                          value: String(t.level),
                          label: `Tier ${t.level} - ${t.label}`,
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
    </PageContainer>
  );
}
