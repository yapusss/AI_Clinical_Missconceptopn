"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { BarChart3, RefreshCw } from "lucide-react";

import { useAuth } from "../components/AuthProvider";
import AppSelect from "../components/AppSelect";
import FeedbackModal from "../components/FeedbackModal";
import PageContainer from "../components/PageContainer";
import PageHeader from "../components/PageHeader";
import { apiFetch } from "../lib/api";
import type {
  AnswerSimilarityBucket,
  AnswerSimilarityMetrics,
  ReadingMaterialCounts,
} from "../lib/studentSubmissions";

type SubjectOption = { id: string; slug: string; name: string; image_url?: string };

type ByModelRow = {
  model_identifier: string;
  total_validations: number | null;
  scored_validations: number | null;
  rejection_rate: number | null;
  tier_agreement_accuracy: number | null;
  macro_f1: number | null;
  percentage_mae: number | null;
  expected_calibration_error: number | null;
  answer_similarity_t1_mean?: number | null;
  answer_similarity_t3_mean?: number | null;
  answer_similarity_coverage?: number | null;
  verdict_agreement_rate?: number | null;
  verdict_comparable_count?: number | null;
};

type Metrics = {
  total_validations: number;
  message?: string;
  scored_validations?: number | null;
  rejection_rate?: number | null;
  tier_agreement_accuracy?: number | null;
  macro_f1?: number | null;
  percentage_mae?: number | null;
  percentage_rmse?: number | null;
  expected_calibration_error?: number | null;
  by_model?: ByModelRow[];
  note?: string;
} & AnswerSimilarityMetrics;

const ALL_SUBJECTS = "";
const ALL_MODELS = "";

const fmt = (value: number | null | undefined, digits = 4) =>
  value === null || value === undefined || Number.isNaN(value)
    ? "—"
    : Number(value).toFixed(digits);

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-outline-variant/30 bg-surface-container-lowest p-3">
      <p className="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant">
        {label}
      </p>
      <p className="mt-1 font-mono-ui text-lg font-extrabold text-on-surface">{value}</p>
    </div>
  );
}

function SimilarityBucketList({
  title,
  buckets,
}: {
  title: string;
  buckets: Record<string, AnswerSimilarityBucket>;
}) {
  const entries = Object.entries(buckets ?? {});
  return (
    <div>
      <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-on-surface-variant">
        {title}
      </p>
      {entries.length === 0 ? (
        <p className="text-xs italic text-on-surface-variant">
          Belum ada analisis dengan nilai similarity.
        </p>
      ) : (
        <ul className="space-y-1">
          {entries.map(([key, bucket]) => (
            <li
              key={key}
              className="flex items-center justify-between rounded border border-outline-variant/30 bg-surface-container-lowest px-3 py-1.5 text-xs"
            >
              <span className="font-mono-ui text-on-surface">{key}</span>
              <span className="font-mono-ui text-on-surface-variant">
                n={bucket.count} • T1 {fmt(bucket.t1_mean)} • T3 {fmt(bucket.t3_mean)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function MaterialCountsCard({ counts }: { counts?: ReadingMaterialCounts }) {
  const c = counts ?? { READY: 0, PENDING: 0, STALE: 0, FAILED: 0, total: 0 };
  const rows: { key: keyof ReadingMaterialCounts; label: string }[] = [
    { key: "READY", label: "Siap" },
    { key: "PENDING", label: "Menunggu" },
    { key: "STALE", label: "Kedaluwarsa" },
    { key: "FAILED", label: "Gagal" },
  ];
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
      {rows.map((r) => (
        <Stat key={r.key} label={r.label} value={String(c[r.key])} />
      ))}
      <Stat label="Total" value={String(c.total)} />
    </div>
  );
}

export default function MetricsPage() {
  const { user, token, loading } = useAuth();
  const router = useRouter();

  const [subjects, setSubjects] = useState<SubjectOption[]>([]);
  const [subjectId, setSubjectId] = useState(ALL_SUBJECTS);
  const [model, setModel] = useState(ALL_MODELS);
  const [models, setModels] = useState<string[]>([]);
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [fetching, setFetching] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (loading) return;
    if (!user || !token) {
      router.replace("/login");
      return;
    }
    void apiFetch<{
      my_subjects?: SubjectOption[];
      summary?: { my_subjects?: SubjectOption[] };
    }>("/dashboard/summary")
      .then((summary) =>
        setSubjects(summary.summary?.my_subjects ?? summary.my_subjects ?? []),
      )
      .catch((err) =>
        setError(err instanceof Error ? err.message : "Gagal memuat mata kuliah."),
      );
  }, [user, token, loading, router]);

  const load = useCallback(async () => {
    if (!token) return;
    setFetching(true);
    try {
      const params = new URLSearchParams();
      if (subjectId) params.set("subject_id", subjectId);
      if (model) params.set("model", model);
      const query = params.toString();
      const data = await apiFetch<Metrics>(`/metrics/model${query ? `?${query}` : ""}`);
      setMetrics(data);
      setModels((prev) => {
        const seen = new Set(prev);
        (data.by_model ?? []).forEach((row) => seen.add(row.model_identifier));
        return [...seen].sort();
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal memuat metrik.");
    } finally {
      setFetching(false);
    }
  }, [token, subjectId, model]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading || !user) return null;

  const hasValidations = (metrics?.total_validations ?? 0) > 0;

  return (
    <PageContainer>
      <PageHeader
        title="Metrik Model"
        description="Kesesuaian diagnosis AI dengan validasi dosen, serta keselarasan jawaban mahasiswa dengan jawaban referensi dosen."
        icon={BarChart3}
        action={
          <button
            type="button"
            onClick={() => void load()}
            disabled={fetching}
            className="btn-secondary inline-flex items-center gap-1.5 text-xs"
          >
            <RefreshCw size={14} className={fetching ? "animate-spin" : ""} />
            Muat ulang
          </button>
        }
      />

      <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className="mb-1.5 block text-[11px] font-bold uppercase tracking-wider text-on-surface-variant">
            Mata Kuliah
          </label>
          <AppSelect
            value={subjectId}
            onValueChange={setSubjectId}
            className="w-full"
            ariaLabel="Pilih mata kuliah"
            placeholder="Semua mata kuliah"
            options={[
              { value: ALL_SUBJECTS, label: "Semua mata kuliah" },
              ...subjects.map((s) => ({ value: s.id, label: s.name })),
            ]}
          />
        </div>
        <div>
          <label className="mb-1.5 block text-[11px] font-bold uppercase tracking-wider text-on-surface-variant">
            Model
          </label>
          <AppSelect
            value={model}
            onValueChange={setModel}
            className="w-full"
            ariaLabel="Pilih model"
            placeholder="Semua model"
            options={[
              { value: ALL_MODELS, label: "Semua model" },
              ...models.map((m) => ({ value: m, label: m })),
            ]}
          />
        </div>
      </div>

      {fetching && !metrics ? (
        <p className="mt-8 text-sm text-on-surface-variant">Memuat metrik...</p>
      ) : metrics ? (
        <div className="mt-6 space-y-5">
          {!hasValidations && (
            <div className="rounded-lg border border-outline-variant/40 bg-surface-container-low p-4 text-sm text-on-surface-variant">
              {metrics.message ?? "Belum ada data validasi dosen."}
            </div>
          )}

          {/* Validation-derived panel */}
          <section className="glass-panel overflow-hidden rounded-xl border border-outline-variant/40">
            <header className="border-b border-outline-variant/40 bg-surface-container-low px-5 py-3">
              <span className="text-xs font-bold uppercase tracking-wider text-on-surface-variant font-mono-ui">
                Kesesuaian dengan Validasi Dosen
              </span>
            </header>
            <div className="grid grid-cols-2 gap-3 p-5 sm:grid-cols-4">
              <Stat label="Total Validasi" value={fmt(metrics.total_validations, 0)} />
              <Stat label="Dinilai (Scored)" value={fmt(metrics.scored_validations, 0)} />
              <Stat label="Tier Agreement" value={fmt(metrics.tier_agreement_accuracy)} />
              <Stat label="Macro-F1" value={fmt(metrics.macro_f1)} />
              <Stat label="MAE (%)" value={fmt(metrics.percentage_mae, 2)} />
              <Stat label="RMSE (%)" value={fmt(metrics.percentage_rmse, 2)} />
              <Stat label="ECE" value={fmt(metrics.expected_calibration_error)} />
              <Stat label="Rejection Rate" value={fmt(metrics.rejection_rate)} />
            </div>
          </section>

          {/* by_model comparison */}
          <section className="glass-panel overflow-hidden rounded-xl border border-outline-variant/40">
            <header className="border-b border-outline-variant/40 bg-surface-container-low px-5 py-3">
              <span className="text-xs font-bold uppercase tracking-wider text-on-surface-variant font-mono-ui">
                Perbandingan per Model
              </span>
            </header>
            <div className="overflow-x-auto p-5">
              {(metrics.by_model ?? []).length === 0 ? (
                <p className="text-xs italic text-on-surface-variant">Belum ada model dalam cakupan ini.</p>
              ) : (
                <>
                  <table className="w-full min-w-[760px] border-collapse text-xs">
                    <thead>
                      <tr className="text-left text-[10px] uppercase tracking-wider text-on-surface-variant">
                        <th className="border-b border-outline-variant/40 pb-2 pr-3">Model</th>
                        <th className="border-b border-outline-variant/40 pb-2 pr-3">Validasi</th>
                        <th className="border-b border-outline-variant/40 pb-2 pr-3">Tier</th>
                        <th className="border-b border-outline-variant/40 pb-2 pr-3">Macro-F1</th>
                        <th className="border-b border-outline-variant/40 pb-2 pr-3">MAE</th>
                        <th className="border-b border-outline-variant/40 pb-2 pr-3">Sim T1</th>
                        <th className="border-b border-outline-variant/40 pb-2 pr-3">Sim T3</th>
                        <th className="border-b border-outline-variant/40 pb-2 pr-3">Sim Cov</th>
                        <th className="border-b border-outline-variant/40 pb-2">Agreement (n)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(metrics.by_model ?? []).map((row) => (
                        <tr key={row.model_identifier} className="text-on-surface">
                          <td className="border-b border-outline-variant/20 py-2 pr-3 font-mono-ui">
                            {row.model_identifier}
                          </td>
                          <td className="border-b border-outline-variant/20 py-2 pr-3 font-mono-ui">
                            {fmt(row.total_validations, 0)} / {fmt(row.scored_validations, 0)}
                          </td>
                          <td className="border-b border-outline-variant/20 py-2 pr-3 font-mono-ui">
                            {fmt(row.tier_agreement_accuracy)}
                          </td>
                          <td className="border-b border-outline-variant/20 py-2 pr-3 font-mono-ui">
                            {fmt(row.macro_f1)}
                          </td>
                          <td className="border-b border-outline-variant/20 py-2 pr-3 font-mono-ui">
                            {fmt(row.percentage_mae, 2)}
                          </td>
                          <td className="border-b border-outline-variant/20 py-2 pr-3 font-mono-ui">
                            {fmt(row.answer_similarity_t1_mean)}
                          </td>
                          <td className="border-b border-outline-variant/20 py-2 pr-3 font-mono-ui">
                            {fmt(row.answer_similarity_t3_mean)}
                          </td>
                          <td className="border-b border-outline-variant/20 py-2 pr-3 font-mono-ui">
                            {fmt(row.answer_similarity_coverage)}
                          </td>
                          <td className="border-b border-outline-variant/20 py-2 font-mono-ui">
                            {fmt(row.verdict_agreement_rate)} ({fmt(row.verdict_comparable_count, 0)})
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </>
              )}
            </div>
          </section>

          {/* Answer-similarity panel — the new primary alignment measure */}
          <section className="glass-panel overflow-hidden rounded-xl border border-outline-variant/40">
            <header className="flex items-center justify-between border-b border-outline-variant/40 bg-surface-container-low px-5 py-3">
              <span className="text-xs font-bold uppercase tracking-wider text-on-surface-variant font-mono-ui">
                Answer Similarity — Keselarasan dengan Jawaban Referensi Dosen
              </span>
              <span className="text-[11px] text-on-surface-variant">bukan akurasi</span>
            </header>
            <div className="space-y-5 p-5">
              <p className="text-[11px] leading-relaxed text-on-surface-variant">
                Cosine(jawaban mahasiswa, jawaban referensi dosen). Diukur terhadap jawaban
                referensi dosen, tidak memerlukan validasi dosen, dan bukan akurasi. Setiap
                rata-rata dan median hanya dihitung atas analisis yang memiliki nilai similarity.
              </p>

              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Stat label="T1 Rata-rata" value={fmt(metrics.answer_similarity_t1_mean)} />
                <Stat label="T1 Median" value={fmt(metrics.answer_similarity_t1_median)} />
                <Stat label="T3 Rata-rata" value={fmt(metrics.answer_similarity_t3_mean)} />
                <Stat label="T3 Median" value={fmt(metrics.answer_similarity_t3_median)} />
              </div>

              {/* Denominators shown beside the means/medians (D9/D19) */}
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Stat label="Cakupan Similarity" value={fmt(metrics.answer_similarity_coverage)} />
                <Stat label="Tanpa Similarity" value={fmt(metrics.no_similarity_count, 0)} />
              </div>

              <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                <SimilarityBucketList
                  title="Per Kategori Four-Tier"
                  buckets={metrics.answer_similarity_by_category ?? {}}
                />
                <SimilarityBucketList
                  title="Per Versi Prompt"
                  buckets={metrics.answer_similarity_by_prompt_version ?? {}}
                />
              </div>
            </div>
          </section>

          {/* Shadow vs driving verdict — diagnostic, never an accuracy figure (D16) */}
          <section className="glass-panel overflow-hidden rounded-xl border border-outline-variant/40">
            <header className="flex items-center justify-between border-b border-outline-variant/40 bg-surface-container-low px-5 py-3">
              <span className="text-xs font-bold uppercase tracking-wider text-on-surface-variant font-mono-ui">
                Shadow vs Verdict Penggerak
              </span>
              <span className="text-[11px] text-on-surface-variant">diagnostik — bukan akurasi</span>
            </header>
            <div className="space-y-4 p-5">
              <p className="text-[11px] leading-relaxed text-on-surface-variant">
                Verdict digerakkan oleh LLM; aturan berbasis θ (theta) dicatat sebagai shadow dan
                tidak menggerakkan kategori mana pun. Angka ini menunjukkan seberapa sering kedua
                verdict berbeda — diagnostik kalibrasi, bukan skor kualitas dan bukan akurasi.
              </p>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Stat label="Agreement Rate" value={fmt(metrics.verdict_agreement_rate)} />
                <Stat label="Komparabel (n)" value={fmt(metrics.verdict_comparable_count, 0)} />
                <Stat label="Berbeda" value={fmt(metrics.verdict_disagreement_count, 0)} />
              </div>
              <p className="text-[11px] leading-relaxed text-on-surface-variant">
                Agreement rate dihitung hanya atas {fmt(metrics.verdict_comparable_count, 0)} analisis
                yang memiliki verdict shadow dan LLM; baris tanpa keduanya tidak masuk denominator.
              </p>
            </div>
          </section>

          {/* Reading-material drain backlog — the operator's only queue view (C6) */}
          <section className="glass-panel overflow-hidden rounded-xl border border-outline-variant/40">
            <header className="flex items-center justify-between border-b border-outline-variant/40 bg-surface-container-low px-5 py-3">
              <span className="text-xs font-bold uppercase tracking-wider text-on-surface-variant font-mono-ui">
                Materi Bacaan — Status Antrean
              </span>
              <span className="text-[11px] text-on-surface-variant">antrean drain</span>
            </header>
            <div className="space-y-4 p-5">
              <p className="text-[11px] leading-relaxed text-on-surface-variant">
                Distribusi status materi bacaan dalam cakupan ini. PENDING / STALE / FAILED adalah
                backlog drain — satu-satunya tampilan antrean yang tidak terpantau otomatis.
              </p>
              <MaterialCountsCard counts={metrics.reading_material_counts} />
            </div>
          </section>

          {metrics.note && (
            <p className="rounded-lg border border-outline-variant/40 bg-surface-container-low p-4 text-[11px] leading-relaxed text-on-surface-variant">
              {metrics.note}
            </p>
          )}
        </div>
      ) : null}

      <FeedbackModal open={!!error} message={error} onClose={() => setError("")} />
    </PageContainer>
  );
}
