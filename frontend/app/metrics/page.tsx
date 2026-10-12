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

type SubjectOption = { id: string; slug: string; name: string; image_url?: string };

type Bucket = { count: number; similarity_mean: number };

type ByModelRow = {
  model_identifier: string;
  total_validations: number | null;
  scored_validations: number | null;
  rejection_rate: number | null;
  tier_agreement_accuracy: number | null;
  macro_f1: number | null;
  percentage_mae: number | null;
  expected_calibration_error: number | null;
  grounding_similarity_mean: number | null;
  citation_coverage: number | null;
  citation_validity_rate: number | null;
  hallucinated_citation_rate: number | null;
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
  grounding_similarity_mean?: number | null;
  grounding_similarity_median?: number | null;
  citation_coverage?: number | null;
  citation_validity_rate?: number | null;
  hallucinated_citation_rate?: number | null;
  grounding_by_category?: Record<string, Bucket>;
  grounding_by_prompt_version?: Record<string, Bucket>;
  no_grounding_count?: number | null;
  by_model?: ByModelRow[];
  note?: string;
};

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

function BucketList({
  title,
  buckets,
}: {
  title: string;
  buckets: Record<string, Bucket>;
}) {
  const entries = Object.entries(buckets ?? {});
  return (
    <div>
      <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-on-surface-variant">
        {title}
      </p>
      {entries.length === 0 ? (
        <p className="text-xs italic text-on-surface-variant">Belum ada analisis ter-grounding.</p>
      ) : (
        <ul className="space-y-1">
          {entries.map(([key, bucket]) => (
            <li
              key={key}
              className="flex items-center justify-between rounded border border-outline-variant/30 bg-surface-container-lowest px-3 py-1.5 text-xs"
            >
              <span className="font-mono-ui text-on-surface">{key}</span>
              <span className="font-mono-ui text-on-surface-variant">
                n={bucket.count} • keselarasan {fmt(bucket.similarity_mean)}
              </span>
            </li>
          ))}
        </ul>
      )}
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
        description="Kesesuaian diagnosis AI dengan validasi dosen, serta keselarasan keluaran AI dengan sumber referensi yang dikutipnya."
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
                <table className="w-full min-w-[720px] border-collapse text-xs">
                  <thead>
                    <tr className="text-left text-[10px] uppercase tracking-wider text-on-surface-variant">
                      <th className="border-b border-outline-variant/40 pb-2 pr-3">Model</th>
                      <th className="border-b border-outline-variant/40 pb-2 pr-3">Validasi</th>
                      <th className="border-b border-outline-variant/40 pb-2 pr-3">Tier</th>
                      <th className="border-b border-outline-variant/40 pb-2 pr-3">Macro-F1</th>
                      <th className="border-b border-outline-variant/40 pb-2 pr-3">MAE</th>
                      <th className="border-b border-outline-variant/40 pb-2 pr-3">Keselarasan</th>
                      <th className="border-b border-outline-variant/40 pb-2 pr-3">Cakupan</th>
                      <th className="border-b border-outline-variant/40 pb-2">Validitas</th>
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
                          {fmt(row.grounding_similarity_mean)}
                        </td>
                        <td className="border-b border-outline-variant/20 py-2 pr-3 font-mono-ui">
                          {fmt(row.citation_coverage)}
                        </td>
                        <td className="border-b border-outline-variant/20 py-2 font-mono-ui">
                          {fmt(row.citation_validity_rate)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </section>

          {/* Grounding panel */}
          <section className="glass-panel overflow-hidden rounded-xl border border-outline-variant/40">
            <header className="border-b border-outline-variant/40 bg-surface-container-low px-5 py-3 flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-on-surface-variant font-mono-ui">
                Grounding — Keselarasan dengan Sumber
              </span>
              <span className="text-[11px] text-on-surface-variant">bukan akurasi</span>
            </header>
            <div className="space-y-5 p-5">
              <p className="text-[11px] leading-relaxed text-on-surface-variant">
                Grounding mengukur keselarasan keluaran AI dengan kutipan sumber yang dipilihnya
                sendiri. Tidak memerlukan validasi dosen dan bukan akurasi.
              </p>

              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
                <Stat label="Rata-rata" value={fmt(metrics.grounding_similarity_mean)} />
                <Stat label="Median" value={fmt(metrics.grounding_similarity_median)} />
                <Stat label="Cakupan Sitasi" value={fmt(metrics.citation_coverage)} />
                <Stat label="Rasio Valid" value={fmt(metrics.citation_validity_rate)} />
                <Stat label="Rasio Halusinasi" value={fmt(metrics.hallucinated_citation_rate)} />
                <Stat label="Tanpa Grounding" value={fmt(metrics.no_grounding_count, 0)} />
              </div>

              <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                <BucketList
                  title="Per Kategori Four-Tier"
                  buckets={metrics.grounding_by_category ?? {}}
                />
                <BucketList
                  title="Per Versi Prompt"
                  buckets={metrics.grounding_by_prompt_version ?? {}}
                />
              </div>
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
