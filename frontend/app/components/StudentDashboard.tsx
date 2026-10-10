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

const CHART_HEIGHT = 200;
const CHART_PAD_TOP = 20;
const CHART_PAD_BOTTOM = 30;
const CHART_PAD_LEFT = 42;
const CHART_PAD_RIGHT = 16;
const Y_TICKS = [0, 25, 50, 75, 100] as const;
const X_HORIZONTAL_GAP = 32;

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
    const usableWidth = Math.max(
      width,
      CHART_PAD_LEFT + CHART_PAD_RIGHT + X_HORIZONTAL_GAP * 2 + 1,
    );
    const innerWidth = usableWidth - CHART_PAD_LEFT - CHART_PAD_RIGHT;
    const plotWidth = Math.max(innerWidth - X_HORIZONTAL_GAP * 2, 0);
    const innerHeight = CHART_HEIGHT - CHART_PAD_TOP - CHART_PAD_BOTTOM;
    const points: ChartPoint[] = exams.map((exam, index) => {
      const value = typeof exam.score === "number" ? Math.max(0, Math.min(100, exam.score)) : 0;
      const ratio = exams.length === 1 ? 0.5 : index / (exams.length - 1);
      return {
        ...exam,
        value,
        x: CHART_PAD_LEFT + X_HORIZONTAL_GAP + ratio * plotWidth,
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
    <section className="glass-card flex h-full flex-col p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex items-start gap-2">
          <TrendingUp size={18} className="mt-0.5 shrink-0 text-primary" />
          <div>
            <h2 className="font-display text-base font-bold text-on-surface">
              Tren Perkembangan Nilai per Ujian
            </h2>
            <p className="mt-0.5 text-xs text-on-surface-variant">
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
            className="w-full sm:w-52"
          />
        )}
      </div>

      <div className="mt-4">
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
    <section className="glass-card border border-primary/40 bg-primary/5 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary/15 text-primary">
            <Clock3 size={20} />
          </span>
          <div className="min-w-0">
            <span className="badge badge-active">Sedang Berjalan</span>
            <h2 className="mt-1.5 font-display text-base font-bold text-on-surface">
              {exam.package_title}
            </h2>
            <p className="mt-0.5 text-xs text-on-surface-variant">
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

type SubjectMastery = {
  subject_id: string;
  subject_name: string;
  validatedCount: number;
  average: number | null;
};

function buildSubjectMastery(trends: StudentSubjectExamTrend[]): SubjectMastery[] {
  return trends.map((item) => {
    const scores = item.exams
      .map((exam) => exam.score)
      .filter((score): score is number => typeof score === "number");
    const average = scores.length
      ? scores.reduce((sum, score) => sum + score, 0) / scores.length
      : null;
    return {
      subject_id: item.subject_id,
      subject_name: item.subject_name,
      validatedCount: scores.length,
      average,
    };
  });
}

function masteryStatus(average: number | null): { label: string; badge: string; bar: string } {
  if (average === null) {
    return {
      label: "Belum Ada Nilai",
      badge: "border-outline-variant/50 bg-surface-container text-on-surface-variant",
      bar: "bg-outline-variant",
    };
  }
  if (average >= 80) {
    return {
      label: "Pemahaman Baik",
      badge: "border-emerald-500/40 bg-emerald-500/15 text-emerald-400",
      bar: "bg-emerald-500",
    };
  }
  if (average >= 60) {
    return {
      label: "Perlu Penguatan",
      badge: "border-amber-500/40 bg-amber-500/15 text-amber-400",
      bar: "bg-amber-500",
    };
  }
  return {
    label: "Perlu Bimbingan",
    badge: "border-rose-500/40 bg-rose-500/15 text-rose-400",
    bar: "bg-rose-500",
  };
}

function SubjectMasteryCard({ trends }: { trends: StudentSubjectExamTrend[] }) {
  const subjects = useMemo(() => buildSubjectMastery(trends), [trends]);

  return (
    <section className="glass-card flex h-full flex-col p-4">
      <div className="flex items-start gap-2">
        <BookOpenCheck size={18} className="mt-0.5 shrink-0 text-primary" />
        <div>
          <h2 className="font-display text-base font-bold text-on-surface">
            Pemahaman Konsep per Mata Kuliah
          </h2>
          <p className="mt-0.5 text-xs text-on-surface-variant">
            Rata-rata skor dari ujian yang telah tervalidasi dosen.
          </p>
        </div>
      </div>

      {subjects.length ? (
        <ul className="mt-4 flex-1 space-y-3">
          {subjects.map((subject) => {
            const status = masteryStatus(subject.average);
            const percent = subject.average === null ? 0 : Math.max(0, Math.min(100, subject.average));
            return (
              <li
                key={subject.subject_id}
                className="rounded-xl border border-outline-variant/40 bg-surface-container-lowest/60 p-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-on-surface">
                      {subject.subject_name}
                    </p>
                    <p className="mt-0.5 text-xs text-on-surface-variant">
                      {subject.validatedCount
                        ? `${subject.validatedCount} ujian tervalidasi`
                        : "Belum ada ujian tervalidasi"}
                    </p>
                  </div>
                  <span className={`badge shrink-0 border ${status.badge}`}>{status.label}</span>
                </div>
                <div className="mt-2.5 flex items-center gap-3">
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-surface-container">
                    <div
                      className={`h-full rounded-full transition-all duration-300 ${status.bar}`}
                      style={{ width: `${percent}%` }}
                    />
                  </div>
                  <span className="w-12 shrink-0 text-right text-sm font-bold text-on-surface">
                    {subject.average === null ? "-" : fmtPercent(subject.average)}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="mt-4 flex flex-1 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-outline-variant/60 px-4 py-12 text-center">
          <LineChart size={22} className="text-on-surface-variant" />
          <p className="max-w-sm text-sm text-on-surface-variant">
            Belum Ada Nilai. Selesaikan ujian Anda untuk melihat pemahaman konsep per mata kuliah.
          </p>
        </div>
      )}
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

      <div className="grid gap-4 lg:grid-cols-2 lg:items-stretch">
        <SubjectExamTrendCard trends={subjectTrends} />

        <SubjectMasteryCard trends={subjectTrends} />
      </div>

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
