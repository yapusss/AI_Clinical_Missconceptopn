"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, BarChart3, TriangleAlert } from "lucide-react";

import { useAuth } from "../components/AuthProvider";
import { apiFetch } from "../lib/api";

type PerTier = {
  tier_level: number;
  support: number;
  precision: number;
  recall: number;
  f1: number;
};

type CalibrationBin = {
  bin: string;
  count: number;
  agreement_rate: number;
  avg_confidence: number;
};

type ByModelRow = {
  model_identifier: string;
  total_validations: number;
  scored_validations: number;
  rejection_rate: number | null;
  tier_agreement_accuracy: number | null;
  macro_f1: number | null;
  percentage_mae: number | null;
  expected_calibration_error: number | null;
};

type Metrics = {
  total_validations: number;
  by_model?: ByModelRow[];
  rejection_rate?: number;
  scored_validations?: number;
  tier_agreement_accuracy?: number | null;
  macro_f1?: number | null;
  per_tier?: PerTier[];
  confusion_matrix?: Record<string, Record<string, number>>;
  percentage_mae?: number | null;
  percentage_rmse?: number | null;
  calibration?: CalibrationBin[];
  expected_calibration_error?: number | null;
  note?: string;
  message?: string;
};

const errMsg = (err: unknown) => (err instanceof Error ? err.message : String(err));

const fmtNum = (v: number | null | undefined, digits = 2) =>
  v === null || v === undefined ? "-" : v.toFixed(digits);

const fmtRate = (v: number | null | undefined) =>
  v === null || v === undefined ? "-" : `${(v * 100).toFixed(1)}%`;

function MetricCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="glass-card p-4">
      <p className="text-xs font-semibold uppercase tracking-wider text-on-surface-variant">
        {label}
      </p>
      <p className="mt-1 font-mono-ui text-2xl font-bold text-on-surface">{value}</p>
      {hint && <p className="mt-1 text-[11px] text-on-surface-variant">{hint}</p>}
    </div>
  );
}

export default function MetricsPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [data, setData] = useState<Metrics | null>(null);
  const [fetching, setFetching] = useState(true);
  const [error, setError] = useState("");

  const [modelFilter, setModelFilter] = useState<string>("");

  const load = useCallback(async (model?: string) => {
    setFetching(true);
    setError("");
    try {
      const active = model !== undefined ? model : modelFilter;
      const qs = active ? `?model=${encodeURIComponent(active)}` : "";
      setData(await apiFetch<Metrics>(`/metrics/model${qs}`));
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setFetching(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelFilter]);

  const pickModel = (model: string) => {
    const next = modelFilter === model ? "" : model;
    setModelFilter(next);
    void load(next);
  };

  useEffect(() => {
    if (loading) return;
    if (!user) {
      router.replace("/login");
      return;
    }
    void load();
  }, [user, loading, router, load]);

  if (loading || !user) return null;

  const tiers = data?.per_tier ?? [];
  const confusion = data?.confusion_matrix ?? {};
  const tierKeys = Object.keys(confusion);

  return (
    <div style={{ maxWidth: "1080px", margin: "0 auto" }}>
      <Link
        href="/dashboard"
        className="inline-flex items-center gap-1.5 text-xs font-semibold text-on-surface-variant hover:text-primary"
      >
        <ArrowLeft size={14} />
        Kembali ke dashboard
      </Link>

      <div className="mt-3">
        <div className="inline-flex items-center gap-2 rounded-full border border-primary-fixed-dim bg-primary-fixed/60 px-3 py-1 text-xs font-bold uppercase tracking-wider text-primary">
          <BarChart3 size={14} color="var(--primary)" />
          Kinerja Model AI
        </div>
        <h1 className="mt-2 font-display text-2xl font-bold tracking-tight text-on-surface">
          Metrik Kesesuaian dengan Validasi Dosen
        </h1>
        <p className="max-w-2xl text-sm text-on-surface-variant">
          {data?.note ??
            "Metrik dihitung dari perbandingan keluaran AI (original) dengan keputusan dosen (final) pada analisis yang sudah divalidasi."}
        </p>
        {modelFilter && (
          <div className="mt-2 inline-flex items-center gap-2 rounded-full border border-primary-fixed-dim bg-primary-fixed/60 px-3 py-1 text-xs font-bold text-primary">
            Filter model: <span className="font-mono-ui">{modelFilter}</span>
            <button type="button" onClick={() => pickModel(modelFilter)} className="underline">
              hapus
            </button>
          </div>
        )}
      </div>

      {error && (
        <div
          role="alert"
          className="mt-6 flex items-center gap-3 rounded-lg border border-error/40 bg-error-container p-4 text-sm text-on-error-container"
        >
          <TriangleAlert size={20} />
          <span>{error}</span>
        </div>
      )}

      {fetching ? (
        <p className="mt-8 text-sm text-on-surface-variant">Memuat metrik...</p>
      ) : !data || data.total_validations === 0 ? (
        <div className="glass-panel mt-8 rounded-xl border border-outline-variant/40 p-8 text-center text-sm text-on-surface-variant">
          {data?.message ?? "Belum ada data validasi."}
        </div>
      ) : (
        <>
          <div className="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
            <MetricCard
              label="Validasi total"
              value={String(data.total_validations)}
              hint={`${data.scored_validations ?? 0} dinilai (diterima/dikoreksi)`}
            />
            <MetricCard
              label="Akurasi tier"
              value={fmtRate(data.tier_agreement_accuracy)}
              hint="AI = keputusan dosen"
            />
            <MetricCard label="Macro-F1 tier" value={fmtNum(data.macro_f1)} hint="rata-rata 4 tier" />
            <MetricCard
              label="MAE skor"
              value={fmtNum(data.percentage_mae)}
              hint={`RMSE ${fmtNum(data.percentage_rmse)}`}
            />
            <MetricCard
              label="Tingkat penolakan"
              value={fmtRate(data.rejection_rate)}
              hint="analisis ditolak dosen"
            />
            <MetricCard
              label="ECE (kalibrasi)"
              value={fmtNum(data.expected_calibration_error, 3)}
              hint="selisih keyakinan vs akurasi"
            />
          </div>

          {(data.by_model?.length ?? 0) > 1 && (
            <section className="glass-panel mt-6 overflow-hidden rounded-xl border border-outline-variant/40">
              <header className="border-b border-outline-variant/40 bg-surface-container-low px-5 py-3">
                <p className="text-xs font-semibold uppercase tracking-wider text-on-surface-variant">
                  Perbandingan model — klik baris untuk memfilter
                </p>
              </header>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-[11px] uppercase tracking-wider text-on-surface-variant">
                      <th className="px-5 py-2">Model</th>
                      <th className="px-3 py-2">N validasi</th>
                      <th className="px-3 py-2">Akurasi tier</th>
                      <th className="px-3 py-2">Macro-F1</th>
                      <th className="px-3 py-2">MAE</th>
                      <th className="px-3 py-2">Tolak</th>
                      <th className="px-5 py-2">ECE</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-outline-variant/30">
                    {data.by_model!.map((row) => (
                      <tr
                        key={row.model_identifier}
                        onClick={() => pickModel(row.model_identifier)}
                        className={`cursor-pointer hover:bg-surface-container ${
                          modelFilter === row.model_identifier ? "bg-primary-fixed/40" : ""
                        }`}
                      >
                        <td className="px-5 py-2 font-mono-ui text-xs font-bold text-on-surface">
                          {row.model_identifier}
                        </td>
                        <td className="px-3 py-2 text-on-surface-variant">{row.total_validations}</td>
                        <td className="px-3 py-2 font-mono-ui">{fmtRate(row.tier_agreement_accuracy)}</td>
                        <td className="px-3 py-2 font-mono-ui font-semibold text-primary">
                          {fmtNum(row.macro_f1)}
                        </td>
                        <td className="px-3 py-2 font-mono-ui">{fmtNum(row.percentage_mae)}</td>
                        <td className="px-3 py-2 font-mono-ui">{fmtRate(row.rejection_rate)}</td>
                        <td className="px-5 py-2 font-mono-ui">
                          {fmtNum(row.expected_calibration_error, 3)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          <div className="mt-6 grid grid-cols-1 gap-5 lg:grid-cols-2">
            <section className="glass-panel overflow-hidden rounded-xl border border-outline-variant/40">
              <header className="border-b border-outline-variant/40 bg-surface-container-low px-5 py-3">
                <p className="text-xs font-semibold uppercase tracking-wider text-on-surface-variant">
                  Per-tier
                </p>
              </header>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-wider text-on-surface-variant">
                    <th className="px-5 py-2">Tier</th>
                    <th className="px-3 py-2">N</th>
                    <th className="px-3 py-2">Presisi</th>
                    <th className="px-3 py-2">Recall</th>
                    <th className="px-5 py-2">F1</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-outline-variant/30">
                  {tiers.map((t) => (
                    <tr key={t.tier_level}>
                      <td className="px-5 py-2 font-mono-ui font-bold text-on-surface">
                        {t.tier_level}
                      </td>
                      <td className="px-3 py-2 text-on-surface-variant">{t.support}</td>
                      <td className="px-3 py-2 font-mono-ui">{fmtNum(t.precision)}</td>
                      <td className="px-3 py-2 font-mono-ui">{fmtNum(t.recall)}</td>
                      <td className="px-5 py-2 font-mono-ui font-semibold text-primary">
                        {fmtNum(t.f1)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>

            <section className="glass-panel overflow-hidden rounded-xl border border-outline-variant/40">
              <header className="border-b border-outline-variant/40 bg-surface-container-low px-5 py-3">
                <p className="text-xs font-semibold uppercase tracking-wider text-on-surface-variant">
                  Kalibrasi keyakinan
                </p>
              </header>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-wider text-on-surface-variant">
                    <th className="px-5 py-2">Bin</th>
                    <th className="px-3 py-2">N</th>
                    <th className="px-3 py-2">Keyakinan</th>
                    <th className="px-5 py-2">Kesesuaian</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-outline-variant/30">
                  {(data.calibration ?? []).map((b) => (
                    <tr key={b.bin}>
                      <td className="px-5 py-2 font-mono-ui text-on-surface">{b.bin}</td>
                      <td className="px-3 py-2 text-on-surface-variant">{b.count}</td>
                      <td className="px-3 py-2 font-mono-ui">{fmtRate(b.avg_confidence)}</td>
                      <td className="px-5 py-2 font-mono-ui font-semibold text-primary">
                        {fmtRate(b.agreement_rate)}
                      </td>
                    </tr>
                  ))}
                  {(data.calibration ?? []).length === 0 && (
                    <tr>
                      <td colSpan={4} className="px-5 py-4 text-xs text-on-surface-variant">
                        Belum ada data kalibrasi.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </section>
          </div>

          {tierKeys.length > 0 && (
            <section className="glass-panel mt-5 overflow-hidden rounded-xl border border-outline-variant/40">
              <header className="border-b border-outline-variant/40 bg-surface-container-low px-5 py-3">
                <p className="text-xs font-semibold uppercase tracking-wider text-on-surface-variant">
                  Confusion matrix — baris: prediksi AI, kolom: keputusan dosen
                </p>
              </header>
              <div className="overflow-x-auto px-5 py-4">
                <table className="text-sm">
                  <thead>
                    <tr>
                      <th className="px-3 py-2" />
                      {tierKeys.map((k) => (
                        <th
                          key={k}
                          className="px-3 py-2 text-center font-mono-ui text-[11px] text-on-surface-variant"
                        >
                          {k}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {tierKeys.map((row) => (
                      <tr key={row}>
                        <td className="px-3 py-2 font-mono-ui text-[11px] font-bold text-on-surface-variant">
                          {row}
                        </td>
                        {tierKeys.map((col) => {
                          const v = confusion[row]?.[col] ?? 0;
                          const isDiag = row === col;
                          return (
                            <td
                              key={col}
                              className={`px-3 py-2 text-center font-mono-ui ${
                                isDiag ? "font-bold text-primary" : v > 0 ? "text-on-surface" : "text-on-surface-variant"
                              }`}
                            >
                              {v}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
