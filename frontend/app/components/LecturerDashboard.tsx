"use client";

import { useState } from "react";
import Link from "next/link";
import {
  Activity,
  BarChart3,
  BookOpen,
  CalendarClock,
  ClipboardCheck,
  TriangleAlert,
} from "lucide-react";
import AppSelect from "./AppSelect";

type Dashboard = {
  pending_validation_count: number;
  validation_queue: {
    analysis_id: string;
    student_name: string;
    subject_name: string;
    score: number;
    submitted_at: string;
  }[];
  active_packages: {
    id: string;
    code: string;
    title: string;
    subject_name: string;
    opens_at: string | null;
    closes_at: string | null;
    question_count: number;
    participant_count: number;
  }[];
  subjects: {
    id: string;
    name: string;
    slug: string;
    question_sets: number;
    active_packages: number;
    submissions: number;
    pending_validations: number;
    average_score: number | null;
  }[];
  risk_levels: { risk_level: string; count: number }[];
  subject_mastery_distributions: {
    subject_id: string;
    remedial: number;
    reinforcement: number;
    mastery: number;
  }[];
  packages_pending_validation: {
    id: string;
    code: string;
    title: string;
    subject_name: string;
    pending_validation_count: number;
  }[];
  package_recommendations: {
    id: string;
    title: string;
    subject_name: string;
    average_score: number;
    student_count: number;
    recommendation: string;
  }[];
  recent_activity: {
    label: string;
    subject_name: string;
    timestamp: string;
    type: "SUBMISSION" | "VALIDATION";
  }[];
};

const dateTime = (value: string | null) =>
  value
    ? new Date(value).toLocaleString("id-ID", {
        dateStyle: "medium",
        timeStyle: "short",
      })
    : "Tanpa batas waktu";
const score = (value: number | null) =>
  value === null ? "-" : `${value.toFixed(1)}%`;
function SubjectAverageBarChart({
  subjects,
}: {
  subjects: Dashboard["subjects"];
}) {
  const data = subjects
    .filter((subject) => subject.average_score !== null)
    .sort((a, b) => (b.average_score ?? 0) - (a.average_score ?? 0));
  return (
    <section className="glass-card overflow-hidden">
      <div className="flex items-start justify-between gap-3 border-b border-outline-variant/40 px-5 py-4">
        <div>
          <h2 className="font-display text-base font-bold text-on-surface">
            Perbandingan Nilai Mata Kuliah
          </h2>
          <p className="mt-1 text-xs text-on-surface-variant">
            Nilai akhir setelah validasi dosen.
          </p>
        </div>
        <span className="grid h-9 w-9 place-items-center rounded-xl bg-primary/10 text-primary">
          <BarChart3 size={19} />
        </span>
      </div>
      {data.length ? (
        <div className="space-y-4 p-5">
          {data.slice(0, 4).map((subject) => (
            <div key={subject.id}>
              <div className="mb-1.5 flex items-center justify-between gap-3 text-xs">
                <span className="truncate font-medium text-on-surface">
                  {subject.name}
                </span>
                <strong className="shrink-0 text-on-surface">
                  {score(subject.average_score)}
                </strong>
              </div>
              <div className="h-3 overflow-hidden rounded-full bg-surface-container">
                <div
                  className="h-full rounded-full bg-primary"
                  style={{
                    width: `${Math.max(subject.average_score ?? 0, 2)}%`,
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="m-5 rounded-xl bg-surface-container p-4 text-sm text-on-surface-variant">
          Rata-rata nilai tersedia setelah ada hasil analisis AI.
        </p>
      )}
    </section>
  );
}

function SubjectMasteryDonut({ dashboard }: { dashboard: Dashboard }) {
  const [subjectId, setSubjectId] = useState(dashboard.subjects[0]?.id ?? "");
  const subject = dashboard.subjects.find((item) => item.id === subjectId);
  const distribution = dashboard.subject_mastery_distributions.find(
    (item) => item.subject_id === subjectId,
  );
  const data = [
    {
      label: "Perlu remedial",
      value: distribution?.remedial ?? 0,
      color: "#ef4444",
    },
    {
      label: "Perlu penguatan",
      value: distribution?.reinforcement ?? 0,
      color: "#f59e0b",
    },
    {
      label: "Sudah menguasai",
      value: distribution?.mastery ?? 0,
      color: "#10b981",
    },
  ];
  const total = data.reduce((sum, item) => sum + item.value, 0);
  let start = 0;
  const segments = data.map((item) => {
    const end = total ? start + (item.value / total) * 360 : start;
    const segment = `${item.color} ${start}deg ${end}deg`;
    start = end;
    return segment;
  });

  return (
    <section className="glass-card overflow-hidden">
      <div className="border-b border-outline-variant/40 px-5 py-4">
        <div>
          <h2 className="font-display text-lg font-bold text-on-surface">
            Distribusi Capaian Mahasiswa
          </h2>
          <p className="mt-1 text-sm text-on-surface-variant">
            Rata-rata nilai final dari seluruh paket ujian mata kuliah.
          </p>
        </div>
        <AppSelect
          value={subjectId}
          onValueChange={setSubjectId}
          ariaLabel="Pilih mata kuliah untuk distribusi capaian"
          className="mt-3 w-full"
          options={dashboard.subjects.map((item) => ({
            value: item.id,
            label: item.name,
          }))}
        />
      </div>
      {subject ? (
        <div className="grid items-center gap-5 p-5 sm:grid-cols-[132px_1fr]">
          <div
            aria-label={`Distribusi capaian ${subject.name}: ${total} mahasiswa`}
            className="relative mx-auto grid h-32 w-32 shrink-0 place-items-center rounded-full"
            style={{
              background: total
                ? `conic-gradient(${segments.join(", ")})`
                : "var(--bg-card-hover)",
            }}
          >
            <div className="grid h-[90px] w-[90px] place-items-center rounded-full bg-surface-container-lowest text-center">
              <strong className="font-mono-ui text-2xl text-on-surface">
                {total}
              </strong>
              <span className="text-[10px] text-on-surface-variant">
                mahasiswa
              </span>
            </div>
          </div>
          <ul className="space-y-2">
            {data.map((item) => (
              <li
                key={item.label}
                className="flex items-center justify-between gap-3 rounded-lg bg-surface-container px-3 py-2"
              >
                <span className="flex items-center gap-2 text-xs text-on-surface-variant">
                  <i
                    className="h-2.5 w-2.5 rounded-full"
                    style={{ background: item.color }}
                  />
                  {item.label}
                </span>
                <strong className="shrink-0 text-sm text-on-surface">
                  {item.value}{" "}
                  <span className="font-normal text-on-surface-variant">
                    ({total ? Math.round((item.value / total) * 100) : 0}%)
                  </span>
                </strong>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="m-5 rounded-xl bg-surface-container p-4 text-sm text-on-surface-variant">
          Belum ada mata kuliah yang dapat dipilih.
        </p>
      )}
    </section>
  );
}

function PackagesPendingValidation({
  packages,
}: {
  packages: Dashboard["packages_pending_validation"];
}) {
  const visiblePackages = packages.slice(0, 3);
  return (
    <section className="glass-card overflow-hidden">
      <div className="flex items-start justify-between gap-3 border-b border-outline-variant/40 px-5 py-4">
        <div>
          <h2 className="font-display text-base font-bold text-on-surface">
            Paket perlu divalidasi
          </h2>
          <p className="mt-1 text-xs text-on-surface-variant">
            Paket dengan minimal satu jawaban yang masih menunggu validasi.
          </p>
        </div>
        <span className="grid h-9 w-9 place-items-center rounded-xl bg-status-draft/10 text-status-draft">
          <ClipboardCheck size={19} />
        </span>
      </div>
      {packages.length ? (
        <div className="divide-y divide-outline-variant/30">
          {visiblePackages.map((item) => (
            <Link
              key={item.id}
              href={`/exam-packages/${item.id}`}
              className="flex items-center justify-between gap-3 px-5 py-3.5 no-underline transition-colors hover:bg-surface-container"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-on-surface">
                  {item.title}
                </p>
                <p className="mt-1 text-xs text-on-surface-variant">
                  {item.subject_name}
                </p>
              </div>
              <span className="shrink-0 rounded-full bg-status-draft/10 px-2.5 py-1 text-xs font-bold text-status-draft">
                {item.pending_validation_count} mahasiswa menunggu
              </span>
            </Link>
          ))}
        </div>
      ) : (
        <p className="p-5 text-sm text-on-surface-variant">
          Tidak ada paket ujian yang menunggu validasi.
        </p>
      )}
    </section>
  );
}

export default function LecturerDashboard({
  dashboard,
}: {
  dashboard: Dashboard;
}) {
  const pending = dashboard.pending_validation_count;
  return (
    <div className="space-y-5">
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[
          {
            label: "Menunggu validasi",
            value: pending,
            icon: ClipboardCheck,
            tone: "text-status-draft bg-status-draft/10",
          },
          {
            label: "Paket ujian aktif",
            value: dashboard.active_packages.length,
            icon: CalendarClock,
            tone: "text-primary bg-primary/10",
          },
          {
            label: "Paket perlu validasi",
            value: dashboard.packages_pending_validation.length,
            icon: Activity,
            tone: "text-secondary bg-secondary/10",
          },
          {
            label: "Mata kuliah diampu",
            value: dashboard.subjects.length,
            icon: BookOpen,
            tone: "text-tertiary-container bg-tertiary-container/10",
          },
        ].map((metric) => {
          const Icon = metric.icon;
          return (
            <article key={metric.label} className="glass-card p-4">
              <div className="flex items-center justify-between">
                <span
                  className={`grid h-10 w-10 place-items-center rounded-xl ${metric.tone}`}
                >
                  <Icon size={20} />
                </span>
                <strong className="font-mono-ui text-2xl text-on-surface">
                  {metric.value}
                </strong>
              </div>
              <p className="mt-4 text-sm font-medium text-on-surface-variant">
                {metric.label}
              </p>
            </article>
          );
        })}
      </section>

      <section>
        <div className="mb-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.14em] text-primary">
              Ringkasan Evaluasi
            </p>
          </div>
        </div>
        <div className="grid gap-5 xl:grid-cols-2">
          <SubjectMasteryDonut dashboard={dashboard} />
          <div className="grid content-start gap-5">
            <SubjectAverageBarChart subjects={dashboard.subjects} />
            <PackagesPendingValidation
              packages={dashboard.packages_pending_validation}
            />
          </div>
        </div>
      </section>

      <section className="grid gap-5 xl:grid-cols-2">
        <section className="glass-card overflow-hidden">
          <div className="flex items-center justify-between border-b border-outline-variant/40 px-5 py-4">
            <div>
              <h2 className="font-display text-lg font-bold text-on-surface">
                Paket ujian aktif
              </h2>
              <p className="mt-1 text-sm text-on-surface-variant">
                Pantau paket yang sedang tersedia bagi mahasiswa.
              </p>
            </div>
            <CalendarClock size={20} className="text-primary" />
          </div>
          {dashboard.active_packages.length ? (
            <div>
              <table className="w-full table-fixed text-left text-sm">
                <thead className="bg-surface-container-low text-xs uppercase text-on-surface-variant">
                  <tr>
                    <th className="w-[31%] px-3 py-3">Paket</th>
                    <th className="w-[19%] px-3 py-3">Mata kuliah</th>
                    <th className="w-[25%] px-3 py-3">Jadwal berakhir</th>
                    <th className="w-[12.5%] px-3 py-3 text-center">Soal</th>
                    <th className="w-[12.5%] px-3 py-3 text-center">Peserta</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-outline-variant/30">
                  {dashboard.active_packages.map((item) => (
                    <tr key={item.id}>
                      <td className="break-words px-3 py-3.5">
                        <p className="font-semibold text-on-surface">
                          {item.title}
                        </p>
                      </td>
                      <td className="break-words px-3 py-3.5 text-on-surface-variant">
                        {item.subject_name}
                      </td>
                      <td className="break-words px-3 py-3.5 text-xs text-on-surface-variant">
                        {dateTime(item.closes_at)}
                      </td>
                      <td className="px-3 py-3.5 text-center font-semibold text-on-surface">
                        {item.question_count}
                      </td>
                      <td className="px-3 py-3.5 text-center font-semibold text-on-surface">
                        {item.participant_count}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="p-5 text-sm text-on-surface-variant">
              Belum ada paket ujian aktif pada mata kuliah yang Anda ampu.
            </p>
          )}
        </section>

        <section className="glass-card overflow-hidden">
          <div className="flex items-center justify-between border-b border-outline-variant/40 px-5 py-4">
            <div>
              <h2 className="font-display text-lg font-bold text-on-surface">
                Ringkasan mata kuliah
              </h2>
              <p className="mt-1 text-sm text-on-surface-variant">
                Kondisi konten dan evaluasi pada setiap mata kuliah Anda.
              </p>
            </div>
            <BookOpen size={20} className="text-primary" />
          </div>
          {dashboard.subjects.length ? (
            <div>
              <table className="w-full table-fixed text-left text-sm">
                <thead className="bg-surface-container-low text-xs uppercase text-on-surface-variant">
                  <tr>
                    <th className="w-[32%] px-3 py-3">Mata kuliah</th>
                    <th className="w-[17%] px-3 py-3 text-center">Bank soal</th>
                    <th className="w-[17%] px-3 py-3 text-center">
                      Paket aktif
                    </th>
                    <th className="w-[17%] px-3 py-3 text-center">Jawaban</th>
                    <th className="w-[17%] px-3 py-3 text-center">
                      Perlu validasi
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-outline-variant/30">
                  {dashboard.subjects.map((item) => (
                    <tr
                      key={item.id}
                      className="hover:bg-surface-container-low"
                    >
                      <td className="break-words px-3 py-3.5">
                        <Link
                          href={`/admin/subjects/${item.id}`}
                          className="font-semibold text-on-surface no-underline hover:text-primary"
                        >
                          {item.name}
                        </Link>
                        <p className="mt-1 font-mono-ui text-xs text-on-surface-variant">
                          {item.slug}
                        </p>
                      </td>
                      <td className="px-3 py-3.5 text-center">
                        {item.question_sets}
                      </td>
                      <td className="px-3 py-3.5 text-center">
                        {item.active_packages}
                      </td>
                      <td className="px-3 py-3.5 text-center">
                        {item.submissions}
                      </td>
                      <td className="px-3 py-3.5 text-center">
                        <span
                          className={
                            item.pending_validations
                              ? "font-bold text-status-draft"
                              : "text-on-surface-variant"
                          }
                        >
                          {item.pending_validations}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="p-5 text-sm text-on-surface-variant">
              Belum ada mata kuliah yang ditautkan ke akun ini.
            </p>
          )}
        </section>
      </section>

      <section className="glass-card p-5">
        <div className="flex items-start gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-error/10 text-error">
            <TriangleAlert size={20} />
          </span>
          <div>
            <h2 className="font-display text-lg font-bold text-on-surface">
              Saran pembelajaran per paket
            </h2>
            <p className="mt-1 text-sm text-on-surface-variant">
              Saran dibuat dari rata-rata nilai final tiap mahasiswa yang sudah
              divalidasi dosen.
            </p>
          </div>
        </div>
        {dashboard.package_recommendations.length ? (
          <div className="mt-5 grid gap-3 lg:grid-cols-2">
            {dashboard.package_recommendations.map((item) => (
              <Link
                key={item.id}
                href={`/exam-packages/${item.id}`}
                className="rounded-xl border border-outline-variant/30 bg-surface-container p-4 no-underline transition-colors hover:bg-surface-container-high"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-on-surface">
                      {item.title}
                    </p>
                    <p className="mt-1 text-xs text-on-surface-variant">
                      {item.subject_name} · {item.student_count} mahasiswa
                      tervalidasi
                    </p>
                  </div>
                  <strong
                    className={`shrink-0 font-mono-ui text-lg ${item.average_score < 60 ? "text-error" : item.average_score < 80 ? "text-status-draft" : "text-tertiary-container"}`}
                  >
                    {score(item.average_score)}
                  </strong>
                </div>
                <p className="mt-3 text-sm leading-6 text-on-surface-variant">
                  {item.recommendation}
                </p>
              </Link>
            ))}
          </div>
        ) : (
          <p className="mt-5 rounded-xl bg-surface-container p-4 text-sm text-on-surface-variant">
            Saran tersedia setelah dosen menyelesaikan validasi nilai paket
            ujian.
          </p>
        )}
      </section>
    </div>
  );
}
