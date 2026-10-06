"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  BookOpenCheck,
  CheckCircle2,
  Clock3,
  Lightbulb,
  LineChart,
  Play,
  Target,
  TrendingUp,
} from "lucide-react";

import AppSelect from "./AppSelect";

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

export type StudentExamTrendPoint = {
  package_id: string;
  package_code: string;
  package_title: string;
  date: string | null;
  score: number | null;
};

export type StudentSubjectExamTrend = {
  subject_id: string;
  subject_name: string;
  exams: StudentExamTrendPoint[];
};

export type StudentDashboardData = {
  active_exams: StudentActiveExam[];
  diagnostic_distribution: Record<string, number>;
  needs_remediation: StudentRemediation[];
  recent_validated: StudentValidated[];
  subject_exam_trends?: StudentSubjectExamTrend[];
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

const fmtDate = (value: string | null) => {
  if (!value) return "-";
  try {
    return new Date(value).toLocaleDateString("id-ID", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  } catch {
    return value;
  }
};

const CHART_HEIGHT = 240;
const CHART_PAD_TOP = 22;
const CHART_PAD_BOTTOM = 34;
const CHART_PAD_LEFT = 46;
const CHART_PAD_RIGHT = 18;
const Y_TICKS = [0, 25, 50, 75, 100] as const;

function useContainerWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const update = () => setWidth(node.clientWidth);
    update();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", update);
      return () => window.removeEventListener("resize", update);
    }
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return [ref, width] as const;
}

type ChartPoint = StudentExamTrendPoint & { value: number; x: number; y: number };

function buildSmoothPath(points: { x: number; y: number }[]) {
  if (points.length === 0) return "";
  if (points.length === 1) return `M ${points[0].x} ${points[0].y}`;
  let path = `M ${points[0].x} ${points[0].y}`;
  for (let index = 0; index < points.length - 1; index += 1) {
    const previous = points[index - 1] ?? points[index];
    const current = points[index];
    const next = points[index + 1];
    const after = points[index + 2] ?? next;
    const tension = 0.18;
    const control1x = current.x + (next.x - previous.x) * tension;
    const control1y = current.y + (next.y - previous.y) * tension;
    const control2x = next.x - (after.x - current.x) * tension;
    const control2y = next.y - (after.y - current.y) * tension;
    path += ` C ${control1x} ${control1y}, ${control2x} ${control2y}, ${next.x} ${next.y}`;
  }
  return path;
}

function SubjectExamTrendChart({ exams }: { exams: StudentExamTrendPoint[] }) {
  const [containerRef, width] = useContainerWidth<HTMLDivElement>();
  const [hovered, setHovered] = useState<number | null>(null);
  const gradientId = useId().replace(/:/g, "");

  const geometry = useMemo(() => {
    const usableWidth = Math.max(width, CHART_PAD_LEFT + CHART_PAD_RIGHT + 1);
    const innerWidth = usableWidth - CHART_PAD_LEFT - CHART_PAD_RIGHT;
    const innerHeight = CHART_HEIGHT - CHART_PAD_TOP - CHART_PAD_BOTTOM;
    const points: ChartPoint[] = exams.map((exam, index) => {
      const value = typeof exam.score === "number" ? Math.max(0, Math.min(100, exam.score)) : 0;
      const ratio = exams.length === 1 ? 0.5 : index / (exams.length - 1);
      return {
        ...exam,
        value,
        x: CHART_PAD_LEFT + ratio * innerWidth,
        y: CHART_PAD_TOP + (1 - value / 100) * innerHeight,
      };
    });
    return {
      points,
      width: usableWidth,
      innerWidth,
      innerHeight,
      baseline: CHART_PAD_TOP + innerHeight,
    };
  }, [exams, width]);

  const { points, width: chartWidth, baseline } = geometry;
  const linePath = useMemo(() => buildSmoothPath(points), [points]);
  const areaPath = useMemo(() => {
    if (points.length < 2) return "";
    const first = points[0];
    const last = points[points.length - 1];
    return `${linePath} L ${last.x} ${baseline} L ${first.x} ${baseline} Z`;
  }, [linePath, points, baseline]);

  const tooltip = hovered !== null ? points[hovered] : null;
  const xStep = points.length > 1 ? points[1].x - points[0].x : geometry.innerWidth;
  const labelEvery = xStep >= 44 ? 1 : Math.max(1, Math.ceil(44 / Math.max(xStep, 1)));
  const useCode = xStep >= 64;

  return (
    <div ref={containerRef} className="relative w-full min-w-0">
      {width > 0 && (
        <svg
          role="img"
          aria-label="Grafik tren nilai per ujian"
          width={chartWidth}
          height={CHART_HEIGHT}
          viewBox={`0 0 ${chartWidth} ${CHART_HEIGHT}`}
          className="block w-full"
        >
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--primary)" stopOpacity="0.32" />
              <stop offset="100%" stopColor="var(--primary)" stopOpacity="0.02" />
            </linearGradient>
          </defs>

          {Y_TICKS.map((tick) => {
            const y = CHART_PAD_TOP + (1 - tick / 100) * geometry.innerHeight;
            return (
              <g key={tick}>
                <line
                  x1={CHART_PAD_LEFT}
                  y1={y}
                  x2={chartWidth - CHART_PAD_RIGHT}
                  y2={y}
                  stroke="var(--border-color)"
                  strokeWidth={1}
                  strokeDasharray="4 6"
                />
                <text
                  x={CHART_PAD_LEFT - 10}
                  y={y + 4}
                  textAnchor="end"
                  fontSize={11}
                  fill="var(--text-dim)"
                >
                  {tick}%
                </text>
              </g>
            );
          })}

          {areaPath && <path d={areaPath} fill={`url(#${gradientId})`} />}
          {points.length > 1 && (
            <path
              d={linePath}
              fill="none"
              stroke="var(--primary)"
              strokeWidth={2.5}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}

          {points.map((point, index) => {
            const showLabel = index % labelEvery === 0 || index === points.length - 1;
            const rawLabel = useCode ? point.package_code || `Ujian ${index + 1}` : `Ujian ${index + 1}`;
            const label = rawLabel.length > 12 ? `${rawLabel.slice(0, 11)}\u2026` : rawLabel;
            return (
              <g key={`${point.package_id}-${index}`}>
                {showLabel && (
                  <text
                    x={point.x}
                    y={CHART_HEIGHT - 12}
                    textAnchor="middle"
                    fontSize={11}
                    fill="var(--text-dim)"
                  >
                    {label}
                  </text>
                )}
                <text
                  x={point.x}
                  y={point.y - 12}
                  textAnchor="middle"
                  fontSize={11}
                  fontWeight={700}
                  fill="var(--primary)"
                >
                  {fmtPercent(point.value)}
                </text>
                <circle
                  cx={point.x}
                  cy={point.y}
                  r={13}
                  fill="transparent"
                  className="cursor-pointer"
                  tabIndex={0}
                  role="button"
                  aria-label={`${point.package_title || point.package_code}: ${fmtPercent(point.value)} pada ${fmtDate(point.date)}`}
                  onMouseEnter={() => setHovered(index)}
                  onMouseLeave={() => setHovered(null)}
                  onFocus={() => setHovered(index)}
                  onBlur={() => setHovered(null)}
                />
                <circle
                  cx={point.x}
                  cy={point.y}
                  r={hovered === index ? 6 : 4.5}
                  fill="var(--primary)"
                  stroke="var(--bg-main)"
                  strokeWidth={2}
                  className="pointer-events-none transition-all duration-150"
                />
              </g>
            );
          })}
        </svg>
      )}

      {tooltip && (
        <div
          className="pointer-events-none absolute z-20 -translate-x-1/2 -translate-y-full rounded-lg border border-outline-variant/60 bg-surface-container-lowest px-3 py-2 text-left shadow-lg"
          style={{
            left: Math.min(Math.max(tooltip.x, 84), Math.max(chartWidth - 84, 84)),
            top: tooltip.y - 12,
          }}
        >
          <p className="max-w-[190px] whitespace-normal text-xs font-semibold text-on-surface">
            {tooltip.package_title || tooltip.package_code}
          </p>
          <p className="mt-0.5 text-[11px] text-on-surface-variant">{fmtDate(tooltip.date)}</p>
          <p className="mt-0.5 text-xs font-bold text-primary">{fmtPercent(tooltip.value)}</p>
        </div>
      )}
    </div>
  );
}

function EmptyTrendState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-outline-variant/60 px-4 py-12 text-center">
      <LineChart size={22} className="text-on-surface-variant" />
      <p className="max-w-sm text-sm text-on-surface-variant">{message}</p>
    </div>
  );
}

function SubjectExamTrendCard({ trends }: { trends: StudentSubjectExamTrend[] }) {
  const [selectedSubject, setSelectedSubject] = useState(
    () => trends.find((item) => item.exams.length > 0)?.subject_id ?? trends[0]?.subject_id ?? "",
  );

  const options = trends.map((item) => ({ value: item.subject_id, label: item.subject_name }));
  const active = trends.find((item) => item.subject_id === selectedSubject) ?? trends[0];
  const exams = active?.exams ?? [];

  return (
    <section className="glass-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-2">
          <TrendingUp size={19} className="mt-0.5 shrink-0 text-primary" />
          <div>
            <h2 className="font-display text-base font-bold text-on-surface">
              Tren Perkembangan Nilai per Ujian
            </h2>
            <p className="mt-1 text-xs text-on-surface-variant">
              Riwayat nilai evaluasi tervalidasi untuk setiap paket ujian.
            </p>
          </div>
        </div>
        {options.length > 0 && (
          <AppSelect
            value={selectedSubject}
            onValueChange={setSelectedSubject}
            options={options}
            ariaLabel="Pilih mata kuliah"
            className="w-full sm:w-64"
          />
        )}
      </div>

      <div className="mt-5">
        {!options.length ? (
          <EmptyTrendState message="Belum ada riwayat ujian yang tervalidasi." />
        ) : exams.length ? (
          <SubjectExamTrendChart exams={exams} />
        ) : (
          <EmptyTrendState message="Belum ada riwayat ujian yang tervalidasi untuk mata kuliah ini." />
        )}
      </div>
    </section>
  );
}

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
  const subjectTrends = dashboard.subject_exam_trends ?? [];

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

      <SubjectExamTrendCard trends={subjectTrends} />

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
