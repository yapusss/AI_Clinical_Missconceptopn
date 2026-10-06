"use client";

import Link from "next/link";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  BookOpenCheck,
  CheckCircle2,
  Clock3,
  Lightbulb,
  Play,
  Target,
  TrendingUp,
} from "lucide-react";

export type StudentActiveExam = {
  package_id: string;
  package_code: string;
  package_title: string;
  subject_name: string;
  started_at: string;
  duration_minutes: number | null;
};

export type StudentRemediation = {
  submission_id: string;
  package_id: string | null;
  package_title: string;
  question_prompt_preview: string;
  category: string;
  feedback_preview: string;
};

export type StudentValidated = {
  submission_id: string;
  package_id: string | null;
  package_title: string;
  score: number | null;
  validated_at: string | null;
  lecturer_name: string;
};

export type StudentDashboardData = {
  active_exams: StudentActiveExam[];
  diagnostic_distribution: Record<string, number>;
  needs_remediation: StudentRemediation[];
  recent_validated: StudentValidated[];
  stats?: {
    avg_score: number | null;
    validated: number;
    in_progress: number;
    misconceptions: number;
  };
};

const TIER_ORDER = ["SC", "LK", "FP", "FN", "MSC"] as const;

const TIER_META: Record<string, { label: string; color: string }> = {
  SC: { label: "SC · Paham Utuh", color: "#10b981" },
  LK: { label: "LK · Kurang Paham", color: "#f59e0b" },
  FP: { label: "FP · Benar, Alasan Keliru", color: "#f97316" },
  FN: { label: "FN · Alasan Benar, Kesimpulan Keliru", color: "#6366f1" },
  MSC: { label: "MSC · Miskonsepsi", color: "#ef4444" },
};

const CATEGORY_LABEL: Record<string, string> = {
  SC: "Paham Utuh",
  LK: "Kurang Paham",
  FP: "Benar, Alasan Keliru",
  FN: "Alasan Benar, Kesimpulan Keliru",
  MSC: "Miskonsepsi",
};

const fmtDateTime = (value: string | null) => {
  if (!value) return "-";
  try {
    return new Date(value).toLocaleString("id-ID", {
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return value;
  }
};

const fmtPercent = (value: number | null) =>
  typeof value === "number" ? `${value.toFixed(1).replace(/\.?0+$/, "")}%` : "-";

function ActiveExamBanner({ exam }: { exam: StudentActiveExam }) {
  const deadline = exam.duration_minutes
    ? new Date(new Date(exam.started_at).getTime() + exam.duration_minutes * 60000)
    : null;
  return (
    <section className="glass-card border border-primary/40 bg-primary/5 p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-primary/15 text-primary">
            <Clock3 size={22} />
          </span>
          <div className="min-w-0">
            <span className="badge badge-active">Sedang Berjalan</span>
            <h2 className="mt-2 font-display text-base font-bold text-on-surface">
              {exam.package_title}
            </h2>
            <p className="mt-1 text-xs text-on-surface-variant">
              {exam.subject_name} · Mulai {fmtDateTime(exam.started_at)}
              {deadline ? ` · Berakhir ${fmtDateTime(deadline.toISOString())}` : ""}
            </p>
          </div>
        </div>
        <Link
          href={`/sets/${exam.package_id}?code=${encodeURIComponent(exam.package_code)}`}
          className="btn-primary inline-flex shrink-0 items-center gap-2"
        >
          <Play size={16} />
          Lanjutkan Ujian
        </Link>
      </div>
    </section>
  );
}

function Doughnut({ data }: { data: Record<string, number> }) {
  const entries = TIER_ORDER.map((key) => [key, data[key] ?? 0] as const);
  const total = entries.reduce((sum, [, value]) => sum + value, 0);
  let angle = 0;
  const segments = entries.map(([key, value]) => {
    const next = total ? angle + (value / total) * 360 : angle;
    const segment = `${TIER_META[key].color} ${angle}deg ${next}deg`;
    angle = next;
    return segment;
  });

  return (
    <section className="glass-card p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-base font-bold text-on-surface">
            Profil Pemahaman Konsep
          </h2>
          <p className="mt-1 text-xs text-on-surface-variant">
            Distribusi diagnosis four-tier dari evaluasi Anda.
          </p>
        </div>
        <span className="rounded-full bg-primary/10 px-2.5 py-1 text-xs font-bold text-primary">
          {total} evaluasi
        </span>
      </div>
      <div className="mt-5 flex flex-col items-center gap-7 sm:flex-row">
        <div
          className="relative grid h-36 w-36 shrink-0 place-items-center rounded-full"
          style={{
            background: total
              ? `conic-gradient(${segments.join(", ")})`
              : "var(--bg-card-hover)",
          }}
        >
          <div className="grid h-24 w-24 place-items-center rounded-full bg-surface-container-lowest text-center">
            <div>
              <strong className="block text-2xl text-on-surface">{total}</strong>
              <span className="text-[10px] text-on-surface-variant">evaluasi</span>
            </div>
          </div>
        </div>
        <ul className="w-full space-y-2">
          {entries.map(([key, value]) => (
            <li key={key} className="flex items-center justify-between gap-4 text-sm">
              <span className="flex items-center gap-2 text-on-surface-variant">
                <i
                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ background: TIER_META[key].color }}
                />
                {TIER_META[key].label}
              </span>
              <strong className="text-on-surface">{value}</strong>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

export default function StudentDashboard({ dashboard }: { dashboard: StudentDashboardData }) {
  const stats = dashboard.stats;
  const distribution = dashboard.diagnostic_distribution ?? {};
  const activeExams = dashboard.active_exams ?? [];
  const remediation = dashboard.needs_remediation ?? [];
  const recent = dashboard.recent_validated ?? [];

  const metrics = [
    {
      label: "Rata-rata skor pemahaman",
      value: fmtPercent(stats?.avg_score ?? null),
      icon: TrendingUp,
    },
    {
      label: "Evaluasi selesai / tervalidasi",
      value: stats?.validated ?? 0,
      icon: CheckCircle2,
    },
    {
      label: "Sedang diproses",
      value: stats?.in_progress ?? 0,
      icon: Activity,
    },
    {
      label: "Miskonsepsi aktif",
      value: stats?.misconceptions ?? (distribution.MSC ?? 0) + (distribution.FP ?? 0),
      icon: AlertTriangle,
    },
  ];

  return (
    <div className="space-y-5">
      {activeExams.map((exam) => (
        <ActiveExamBanner key={exam.package_id} exam={exam} />
      ))}

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {metrics.map((metric) => {
          const Icon = metric.icon;
          return (
            <article key={metric.label} className="glass-card p-4">
              <div className="flex items-center justify-between">
                <span className="grid h-10 w-10 place-items-center rounded-xl bg-primary/15 text-primary">
                  <Icon size={20} />
                </span>
                <span className="text-2xl font-bold text-on-surface">{metric.value}</span>
              </div>
              <p className="mt-4 text-sm font-medium text-on-surface-variant">{metric.label}</p>
            </article>
          );
        })}
      </section>

      <Doughnut data={distribution} />

      <div className="grid gap-5 lg:grid-cols-2">
        <section className="glass-card overflow-hidden">
          <div className="flex items-center gap-2 border-b border-outline-variant/40 px-5 py-4">
            <Target size={19} className="text-error" />
            <div>
              <h2 className="font-display text-base font-bold text-on-surface">
                Fokus Remediasi Konsep
              </h2>
              <p className="mt-1 text-xs text-on-surface-variant">
                Konsep dengan miskonsepsi yang perlu dipelajari kembali.
              </p>
            </div>
          </div>
          {remediation.length ? (
            <div className="divide-y divide-outline-variant/30">
              {remediation.map((item) => (
                <Link
                  key={item.submission_id}
                  href={item.package_id ? `/pengumpulan/${item.package_id}` : "/code"}
                  className="block px-5 py-4 hover:bg-surface-container"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-on-surface">
                        {item.package_title || "Paket ujian"}
                      </p>
                      <p className="mt-1 line-clamp-2 text-xs text-on-surface-variant">
                        {item.question_prompt_preview || "Soal evaluasi"}
                      </p>
                      <p className="mt-2 line-clamp-2 text-xs text-on-surface-variant">
                        {item.feedback_preview}
                      </p>
                    </div>
                    <span className="badge badge-revoked shrink-0">
                      {CATEGORY_LABEL[item.category] ?? item.category}
                    </span>
                  </div>
                  <span className="mt-2 inline-flex items-center gap-1 text-xs font-bold text-primary">
                    Pelajari kembali <ArrowRight size={13} />
                  </span>
                </Link>
              ))}
            </div>
          ) : (
            <div className="flex items-center gap-3 p-5 text-sm text-on-surface-variant">
              <Lightbulb size={18} className="text-tertiary-container" />
              Tidak ada miskonsepsi aktif. Pertahankan!
            </div>
          )}
        </section>

        <section className="glass-card overflow-hidden">
          <div className="flex items-center gap-2 border-b border-outline-variant/40 px-5 py-4">
            <BookOpenCheck size={19} className="text-primary" />
            <div>
              <h2 className="font-display text-base font-bold text-on-surface">
                Aktivitas Validasi Terbaru
              </h2>
              <p className="mt-1 text-xs text-on-surface-variant">
                Jawaban yang baru selesai ditinjau dosen pengampu.
              </p>
            </div>
          </div>
          {recent.length ? (
            <div className="divide-y divide-outline-variant/30">
              {recent.map((item) => (
                <div key={item.submission_id} className="flex items-start justify-between gap-3 px-5 py-4">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-on-surface">
                      {item.package_title || "Paket ujian"}
                    </p>
                    <p className="mt-1 text-xs text-on-surface-variant">
                      {item.lecturer_name || "Dosen pengampu"} · {fmtDateTime(item.validated_at)}
                    </p>
                  </div>
                  <span className="badge badge-active shrink-0">{fmtPercent(item.score)}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="p-5 text-sm text-on-surface-variant">
              Belum ada jawaban yang tervalidasi.
            </p>
          )}
        </section>
      </div>
    </div>
  );
}
