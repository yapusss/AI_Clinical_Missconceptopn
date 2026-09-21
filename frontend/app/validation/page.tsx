"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  ClipboardCheck,
  ShieldCheck,
  TriangleAlert,
} from "lucide-react";

import { useAuth } from "../components/AuthProvider";
import { apiFetch } from "../lib/api";

type QueueItem = {
  analysis_id: string;
  submission_id: string;
  run_number: number;
  student_name: string;
  set_title: string | null;
  set_code: string | null;
  question_prompt_preview: string;
  subject_name: string;
  percentage_correct: string;
  tier_level: number;
  tier_label: string;
  confidence: string;
  model_identifier: string;
  submitted_at: string;
  answer_preview: string;
};

const errMsg = (err: unknown) => (err instanceof Error ? err.message : String(err));

const fmtDate = (value: string) => {
  try {
    return new Date(value).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" });
  } catch {
    return value;
  }
};

const TIER_BADGE: Record<number, string> = {
  1: "badge-revoked",
  2: "badge-draft",
  3: "badge-review",
  4: "badge-active",
};

const fmtPct = (v: string) => {
  const n = Number.parseFloat(v);
  return Number.isNaN(n) ? v : `${n.toFixed(1)}%`;
};

export default function ValidationQueuePage() {
  const { user, loading } = useAuth();
  const router = useRouter();

  const [items, setItems] = useState<QueueItem[]>([]);
  const [fetching, setFetching] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setFetching(true);
    setError("");
    try {
      const data = await apiFetch<QueueItem[]>("/validations/queue");
      setItems(data);
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setFetching(false);
    }
  }, []);

  useEffect(() => {
    if (loading) return;
    if (!user) {
      router.replace("/login");
      return;
    }
    void load();
  }, [user, loading, router, load]);

  if (loading || !user) return null;

  const isLecturer =
    user.is_superuser || (user.roles ?? []).some((r) => r.role === "LECTURER");

  return (
    <div style={{ maxWidth: "1080px", margin: "0 auto" }}>
      <div className="mt-3 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-primary-fixed-dim bg-primary-fixed/60 px-3 py-1 text-xs font-bold uppercase tracking-wider text-primary">
            <ShieldCheck size={14} color="var(--primary)" />
            Validasi Analisis AI
          </div>
          <h1 className="mt-2 font-display text-2xl font-bold tracking-tight text-on-surface">
            Antrian Validasi
          </h1>
          <p className="text-sm text-on-surface-variant">
            Tinjau hasil analisis AI, konfirmasi miskonsepsi, lalu terima, koreksi, atau tolak.
            AI memberi saran — Anda yang memutuskan.
          </p>
        </div>
        <div className="glass-panel rounded-lg border border-outline-variant/40 px-4 py-3 text-xs font-semibold text-on-surface-variant">
          Menunggu <span className="font-mono-ui text-primary">{items.length}</span> analisis
        </div>
      </div>

      {!isLecturer && (
        <div
          role="status"
          className="mt-6 flex items-center gap-3 rounded-lg border border-primary-fixed-dim bg-primary-fixed/60 p-4 text-sm text-primary"
        >
          <ClipboardCheck size={20} />
          <span>Halaman ini ditujukan untuk dosen pengampu mata kuliah terkait.</span>
        </div>
      )}

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
        <p className="mt-8 text-sm text-on-surface-variant">Memuat antrian validasi...</p>
      ) : items.length === 0 ? (
        <div className="glass-panel mt-8 rounded-xl border border-outline-variant/40 p-8 text-center text-sm text-on-surface-variant">
          Tidak ada analisis yang menunggu validasi saat ini.
        </div>
      ) : (
        <div className="mt-8 space-y-4">
          {items.map((item) => (
            <Link
              key={item.analysis_id}
              href={`/validation/${item.analysis_id}`}
              className="glass-card block rounded-xl p-5 no-underline"
            >
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`badge ${TIER_BADGE[item.tier_level] ?? "badge-role"}`}>
                      Tier {item.tier_level} · {item.tier_label}
                    </span>
                    <span className="badge badge-role">{fmtPct(item.percentage_correct)}</span>
                    {item.run_number > 1 && (
                      <span className="badge badge-draft">Analisis ulang ke-{item.run_number}</span>
                    )}
                  </div>
                  <p className="mt-2 truncate text-sm font-semibold text-on-surface">
                    {item.question_prompt_preview}
                  </p>
                  <p className="mt-1 text-xs text-on-surface-variant">
                    {item.student_name} • {item.set_title ?? "-"}{" "}
                    {item.set_code && (
                      <span className="font-mono-ui text-primary">({item.set_code})</span>
                    )}{" "}
                    • {item.subject_name}
                  </p>
                  <p className="mt-2 line-clamp-2 text-xs text-on-surface-variant">
                    {item.answer_preview}
                  </p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-2">
                  <span className="text-[11px] text-on-surface-variant">
                    {fmtDate(item.submitted_at)}
                  </span>
                  <span className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-white">
                    Tinjau
                    <ArrowRight size={14} color="#ffffff" />
                  </span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
