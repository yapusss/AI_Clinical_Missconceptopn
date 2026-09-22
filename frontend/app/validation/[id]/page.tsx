"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft,
  BrainCircuit,
  CheckCircle2,
  ClipboardCheck,
  Lightbulb,
  PenLine,
  ShieldCheck,
  TriangleAlert,
  XCircle,
} from "lucide-react";

import { useAuth } from "../../components/AuthProvider";
import AppSelect from "../../components/AppSelect";
import { apiFetch } from "../../lib/api";

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
    indicators: {
      order_index: number;
      label: string;
      description: string;
      weight: string;
    }[];
  };
  answer: { text: string; attempt_no: number; submitted_at: string };
  llm: {
    model_identifier: string;
    prompt_version: string;
    percentage_correct: string;
    tier_level: number;
    tier_label: string;
    confidence: string;
    explanation: string;
    indicator_scores: IndicatorScore[];
    misconception_matches: MisconceptionMatch[];
    proposed_new_misconception: string | null;
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

const errMsg = (err: unknown) => (err instanceof Error ? err.message : String(err));

const SCORE_META: Record<string, { label: string; cls: string }> = {
  PRESENT: { label: "Terpenuhi", cls: "badge-active" },
  PARTIAL: { label: "Sebagian", cls: "badge-draft" },
  MISSING: { label: "Tidak terpenuhi", cls: "badge-revoked" },
};

const fmtDate = (value: string) => {
  try {
    return new Date(value).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" });
  } catch {
    return value;
  }
};

const fmtPct = (v: string | number | null | undefined) => {
  if (v === null || v === undefined || v === "") return "-";
  const n = typeof v === "number" ? v : Number.parseFloat(v);
  return Number.isNaN(n) ? String(v) : `${n.toFixed(1)}%`;
};

/** Confidence is stored 0–1; display as percentage. */
const fmtConf = (v: string) => {
  const n = Number.parseFloat(v);
  return Number.isNaN(n) ? v : `${(n * 100).toFixed(0)}%`;
};

export default function ValidationDetailPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const analysisId = params?.id as string | undefined;

  const [data, setData] = useState<Detail | null>(null);
  const [fetching, setFetching] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [tiers, setTiers] = useState<{ level: number; label: string }[]>([]);

  // Decision form state
  const [mode, setMode] = useState<"ACCEPTED" | "EDITED" | "REJECTED">("ACCEPTED");
  const [finalPct, setFinalPct] = useState("");
  const [finalTier, setFinalTier] = useState<number | "">("");
  const [feedback, setFeedback] = useState("");
  const [notes, setNotes] = useState("");
  const [confirms, setConfirms] = useState<Record<string, boolean>>({});
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    if (!analysisId) {
      setFetching(false);
      setError("ID analisis tidak valid.");
      return;
    }
    setFetching(true);
    setError("");
    try {
      const det = await apiFetch<Detail>(`/validations/${analysisId}`);
      setData(det);
      setFinalPct(det.llm.percentage_correct);
      setFinalTier(det.llm.tier_level);
      setFeedback(det.llm.explanation);
      const initialConfirms: Record<string, boolean> = {};
      det.llm.misconception_matches.forEach((m) => {
        initialConfirms[m.misconception_id] =
          m.lecturer_confirmed !== undefined ? m.lecturer_confirmed : m.matched;
      });
      setConfirms(initialConfirms);
      // Load available tiers for this subject (for the EDITED tier picker)
      try {
        const t = await apiFetch<{ level: number; label: string }[]>(
          `/validations/tiers?subject_id=${det.subject.id}`,
        );
        setTiers(t);
      } catch {
        setTiers([1, 2, 3, 4].map((level) => ({ level, label: `Tier ${level}` })));
      }
    } catch (err) {
      setError(errMsg(err));
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

  const canEdit = data?.validatable === true;

  const handleSubmit = async () => {
    if (!analysisId || !data) return;
    setError("");
    setNotice("");
    setSubmitting(true);
    try {
      const body: Record<string, unknown> = { status: mode };
      if (mode !== "REJECTED") {
        body.final_percentage = finalPct;
        body.final_tier_level = finalTier;
        body.final_feedback = feedback;
      }
      if (notes) body.notes = notes;
      const confList = Object.entries(confirms).map(([misconception_id, confirmed]) => ({
        misconception_id,
        confirmed,
      }));
      if (confList.length) body.misconception_confirmations = confList;

      const res = await apiFetch<{ message: string; submission_status: string }>(
        `/validations/${analysisId}/submit`,
        { method: "POST", body: JSON.stringify(body) },
      );
      setNotice(res.message);
      setData((prev) =>
        prev ? { ...prev, submission_status: res.submission_status, validatable: false } : prev,
      );
      void load();
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setSubmitting(false);
    }
  };

  const decisionChanged = useMemo(() => {
    if (!data) return false;
    return (
      finalPct !== data.llm.percentage_correct ||
      finalTier !== data.llm.tier_level ||
      feedback !== data.llm.explanation
    );
  }, [data, finalPct, finalTier, feedback]);

  if (loading || !user) return null;

  const indicatorByOrder = new Map(data?.question.indicators.map((i) => [i.order_index, i]));

  return (
    <div style={{ maxWidth: "1080px", margin: "0 auto" }}>
      <Link
        href="/validation"
        className="inline-flex items-center gap-1.5 text-xs font-semibold text-on-surface-variant hover:text-primary"
      >
        <ArrowLeft size={14} />
        Kembali ke antrian validasi
      </Link>

      {error && (
        <div
          role="alert"
          className="mt-4 flex items-center gap-3 rounded-lg border border-error/40 bg-error-container p-4 text-sm text-on-error-container"
        >
          <TriangleAlert size={20} />
          <span>{error}</span>
        </div>
      )}
      {notice && (
        <div
          role="status"
          className="mt-4 flex items-center gap-3 rounded-lg border border-primary-fixed-dim bg-primary-fixed/60 p-4 text-sm text-primary"
        >
          <CheckCircle2 size={20} />
          <span>{notice}</span>
        </div>
      )}

      {fetching ? (
        <p className="mt-8 text-sm text-on-surface-variant">Memuat detail analisis...</p>
      ) : !data ? null : (
        <>
          <div className="mt-3 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-primary-fixed-dim bg-primary-fixed/60 px-3 py-1 text-xs font-bold uppercase tracking-wider text-primary">
                <ClipboardCheck size={14} color="var(--primary)" />
                Tinjau Analisis AI
              </div>
              <h1 className="mt-2 font-display text-2xl font-bold tracking-tight text-on-surface">
                {data.set.title}
              </h1>
              <p className="text-sm text-on-surface-variant">
                {data.student.name} • Kode{" "}
                <span className="font-mono-ui font-bold text-primary">{data.set.code}</span> •{" "}
                {data.subject.name} • Percobaan ke-{data.answer.attempt_no} •{" "}
                {data.run_number > 1 ? `analisis ulang ke-${data.run_number}` : "analisis pertama"}
              </p>
            </div>
            <div className="glass-panel rounded-lg border border-outline-variant/40 px-4 py-3 text-right">
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
                  ? "Menunggu validasi"
                  : data.submission_status === "VALIDATED"
                    ? "Tervalidasi"
                    : data.submission_status}
              </span>
              <p className="mt-1 text-[11px] text-on-surface-variant">
                Model {data.llm.model_identifier} • {data.llm.execution_time_ms ?? "-"}ms
              </p>
            </div>
          </div>

          {/* Side-by-side: student answer vs model answer */}
          <div className="mt-6 grid grid-cols-1 gap-5 lg:grid-cols-2">
            <section className="glass-panel overflow-hidden rounded-xl border border-outline-variant/40">
              <header className="border-b border-outline-variant/40 bg-surface-container-low px-5 py-3">
                <p className="text-xs font-semibold uppercase tracking-wider text-on-surface-variant">
                  Pertanyaan
                </p>
              </header>
              <div className="px-5 py-4">
                <p className="whitespace-pre-line text-sm text-on-surface">{data.question.prompt}</p>
                <p className="mt-4 text-xs font-semibold uppercase tracking-wider text-on-surface-variant">
                  Jawaban mahasiswa
                </p>
                <p className="mt-1 whitespace-pre-line rounded-lg border border-outline-variant/40 bg-surface-container-lowest p-3 text-sm text-on-surface">
                  {data.answer.text}
                </p>
              </div>
            </section>

            <section className="glass-panel overflow-hidden rounded-xl border border-outline-variant/40">
              <header className="border-b border-outline-variant/40 bg-surface-container-low px-5 py-3">
                <p className="text-xs font-semibold uppercase tracking-wider text-on-surface-variant">
                  Jawaban model (acuan)
                </p>
              </header>
              <div className="px-5 py-4">
                <p className="whitespace-pre-line text-sm text-on-surface">
                  {data.question.model_answer}
                </p>
              </div>
            </section>
          </div>

          {/* LLM rubric scoring */}
          <section className="glass-panel mt-5 overflow-hidden rounded-xl border border-outline-variant/40">
            <header className="flex items-center justify-between border-b border-outline-variant/40 bg-surface-container-low px-5 py-3">
              <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-on-surface-variant">
                <BrainCircuit size={15} color="var(--primary)" />
                Penilaian rubrik AI •{" "}
                <span className="font-mono-ui text-primary">
                  {fmtPct(data.llm.percentage_correct)}
                </span>{" "}
                • Tier {data.llm.tier_level} ({data.llm.tier_label}) • keyakinan{" "}
                {fmtConf(data.llm.confidence)}
              </p>
            </header>
            <div className="divide-y divide-outline-variant/30">
              {data.llm.indicator_scores.map((s) => {
                const ind = indicatorByOrder.get(s.order_index);
                const meta = SCORE_META[s.score] ?? { label: s.score, cls: "badge-role" };
                return (
                  <div key={s.order_index} className="px-5 py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono-ui text-xs font-bold text-on-surface">
                        #{s.order_index}
                      </span>
                      <span className="text-sm font-semibold text-on-surface">
                        {ind?.label ?? s.label}
                      </span>
                      <span className="text-[11px] text-on-surface-variant">
                        bobot {ind?.weight ?? s.weight}
                      </span>
                      <span className={`badge ${meta.cls}`}>{meta.label}</span>
                    </div>
                    {s.evidence && (
                      <p className="mt-1 text-xs italic text-on-surface-variant">
                        Bukti: {s.evidence}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
            <div className="border-t border-outline-variant/30 px-5 py-4">
              <p className="text-xs font-semibold uppercase tracking-wider text-on-surface-variant">
                Penjelasan AI
              </p>
              <p className="mt-1 whitespace-pre-line text-sm text-on-surface">
                {data.llm.explanation}
              </p>
            </div>
          </section>

          {/* Advisory misconception matches */}
          <section className="glass-panel mt-5 overflow-hidden rounded-xl border border-outline-variant/40">
            <header className="border-b border-outline-variant/40 bg-surface-container-low px-5 py-3">
              <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-on-surface-variant">
                <Lightbulb size={15} color="var(--primary)" />
                Kecocokan miskonsepsi (advisory)
              </p>
              <p className="mt-1 text-[11px] text-on-surface-variant">
                Usulan AI tidak memaksa tier. Konfirmasi atau tolak setiap kecocokan — keputusan
                Anda yang tercatat.
              </p>
            </header>
            <div className="px-5 py-4">
              {data.llm.misconception_matches.length === 0 ? (
                <p className="text-sm text-on-surface-variant">
                  Tidak ada kecocokan miskonsepsi yang diusulkan AI.
                </p>
              ) : (
                <div className="space-y-3">
                  {data.llm.misconception_matches.map((m) => {
                    const confirmed = confirms[m.misconception_id] ?? m.matched;
                    return (
                      <div
                        key={m.misconception_id}
                        className="rounded-lg border border-outline-variant/40 bg-surface-container-lowest p-3"
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-semibold text-on-surface">{m.label}</span>
                          <span className={`badge ${m.matched ? "badge-draft" : "badge-role"}`}>
                            {m.matched ? "Cocok (usulan AI)" : "Tidak cocok"}
                          </span>
                          <span className="text-[11px] text-on-surface-variant">
                            keyakinan {fmtConf(m.confidence)}
                          </span>
                        </div>
                        {m.reasoning && (
                          <p className="mt-1 text-xs italic text-on-surface-variant">
                            {m.reasoning}
                          </p>
                        )}
                        <div className="mt-2 flex items-center gap-4">
                          <label className="flex cursor-pointer items-center gap-1.5 text-xs font-semibold text-on-surface">
                            <input
                              type="checkbox"
                              disabled={!canEdit}
                              checked={confirmed}
                              onChange={(e) =>
                                setConfirms((prev) => ({
                                  ...prev,
                                  [m.misconception_id]: e.target.checked,
                                }))
                              }
                            />
                            Konfirmasi miskonsepsi ini
                          </label>
                          {m.lecturer_confirmed !== undefined && (
                            <span className="badge badge-active">Sudah ditinjau</span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
              {data.llm.proposed_new_misconception && (
                <div className="mt-3 rounded-lg border border-dashed border-primary-fixed-dim bg-primary-fixed/40 p-3">
                  <p className="text-xs font-semibold text-primary">
                    Pola miskonsepsi baru yang diusulkan AI (belum ada di katalog):
                  </p>
                  <p className="mt-1 text-sm text-on-surface">
                    {data.llm.proposed_new_misconception}
                  </p>
                </div>
              )}
            </div>
          </section>

          {/* Decision panel */}
          {canEdit ? (
            <section className="glass-panel mt-5 overflow-hidden rounded-xl border border-outline-variant/40">
              <header className="border-b border-outline-variant/40 bg-surface-container-low px-5 py-3">
                <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-on-surface-variant">
                  <ShieldCheck size={15} color="var(--primary)" />
                  Keputusan validasi
                </p>
              </header>
              <div className="px-5 py-4">
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setMode("ACCEPTED")}
                    className={`btn-secondary text-xs ${mode === "ACCEPTED" ? "!border-primary !text-primary" : ""}`}
                  >
                    <CheckCircle2 size={15} />
                    Terima apa adanya
                  </button>
                  <button
                    type="button"
                    onClick={() => setMode("EDITED")}
                    className={`btn-secondary text-xs ${mode === "EDITED" ? "!border-primary !text-primary" : ""}`}
                  >
                    <PenLine size={15} />
                    Koreksi
                  </button>
                  <button
                    type="button"
                    onClick={() => setMode("REJECTED")}
                    className={`btn-danger text-xs ${mode === "REJECTED" ? "!border-error" : ""}`}
                  >
                    <XCircle size={15} />
                    Tolak & analisis ulang
                  </button>
                </div>

                {mode !== "REJECTED" && (
                  <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div>
                      <label className="block text-xs font-semibold uppercase text-on-surface-variant">
                        Skor akhir (%)
                      </label>
                      <input
                        type="number"
                        min={0}
                        max={100}
                        step={0.01}
                        value={finalPct}
                        onChange={(e) => setFinalPct(e.target.value)}
                        className="form-input mt-1"
                      />
                      {decisionChanged && mode === "ACCEPTED" && (
                        <p className="mt-1 text-[11px] text-on-surface-variant">
                          Nilai diubah dari usulan AI — pertimbangkan mode Koreksi.
                        </p>
                      )}
                    </div>
                    <div>
                      <label className="block text-xs font-semibold uppercase text-on-surface-variant">
                        Tier akhir
                      </label>
                      <AppSelect value={String(finalTier)} onValueChange={(value) => setFinalTier(Number(value))} className="mt-1" ariaLabel="Tier akhir" options={tiers.map((tier) => ({ value: String(tier.level), label: `Tier ${tier.level} - ${tier.label}` }))} />
                    </div>
                    <div className="sm:col-span-2">
                      <label className="block text-xs font-semibold uppercase text-on-surface-variant">
                        Umpan balik final untuk mahasiswa
                      </label>
                      <textarea
                        rows={3}
                        value={feedback}
                        onChange={(e) => setFeedback(e.target.value)}
                        className="form-input mt-1"
                      />
                    </div>
                  </div>
                )}

                {mode === "REJECTED" && (
                  <div className="mt-4 rounded-lg border border-dashed border-error/40 bg-error-container/40 p-3 text-xs text-on-surface-variant">
                    Menolak akan menandai submission REJECTED dan memasukkannya ke antrian analisis
                    ulang worker. Catatan Anda dikirim ke LLM sebagai konteks perbaikan.
                  </div>
                )}

                <div className="mt-4">
                  <label className="block text-xs font-semibold uppercase text-on-surface-variant">
                    Catatan internal (opsional{mode === "REJECTED" ? ", dikirim ke analisis ulang" : ""})
                  </label>
                  <textarea
                    rows={2}
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    className="form-input mt-1"
                    placeholder={
                      mode === "REJECTED"
                        ? "Jelaskan mengapa analisis ditolak agar analisis ulang lebih baik..."
                        : "Catatan untuk audit..."
                    }
                  />
                </div>

                <div className="mt-4 flex justify-end">
                  <button
                    type="button"
                    onClick={handleSubmit}
                    disabled={submitting}
                    style={{ color: "#ffffff" }}
                    className="inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-2 text-sm font-semibold shadow-sm transition-colors hover:bg-primary-container disabled:opacity-50"
                  >
                    <ShieldCheck size={16} color="#ffffff" />
                    {submitting ? "Menyimpan..." : "Simpan keputusan"}
                  </button>
                </div>
              </div>
            </section>
          ) : data.existing_validation ? (
            <section className="glass-panel mt-5 overflow-hidden rounded-xl border border-outline-variant/40">
              <header className="border-b border-outline-variant/40 bg-surface-container-low px-5 py-3">
                <p className="text-xs font-semibold uppercase tracking-wider text-on-surface-variant">
                  Sudah divalidasi
                </p>
              </header>
              <div className="px-5 py-4 text-sm text-on-surface">
                <p>
                  <span className="badge badge-active">{data.existing_validation.status}</span>{" "}
                  oleh {data.existing_validation.lecturer_name} •{" "}
                  {fmtDate(data.existing_validation.validated_at)}
                </p>
                <p className="mt-2 text-xs text-on-surface-variant">
                  Skor final {fmtPct(data.existing_validation.final_percentage)} • Tier{" "}
                  {data.existing_validation.final_tier_level ?? "-"}
                </p>
                {data.existing_validation.final_feedback && (
                  <p className="mt-2 whitespace-pre-line text-sm">
                    {data.existing_validation.final_feedback}
                  </p>
                )}
              </div>
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}
