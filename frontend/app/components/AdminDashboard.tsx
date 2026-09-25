"use client";

import Link from "next/link";
import { Activity, AlertTriangle, Bot, BookOpen, CheckCircle2, ClipboardList, Clock3, FileWarning, GraduationCap, Users } from "lucide-react";

type StatusCounts = Record<string, number>;
type Dashboard = {
  system: { active_students: number; active_lecturers: number; active_subjects: number; active_question_sets: number };
  package_status: StatusCounts;
  validation_status: StatusCounts;
  attention_packages: { id: string; code: string; title: string; subject_name: string; reason: string; state: string }[];
  recent_activity: { label: string; timestamp: string; type: string }[];
  ai_health: { queue: number; success_rate: number | null; failures: number; average_execution_ms: number | null };
  alerts: { level: "warning" | "info" | "error"; message: string }[];
};

const colors = ["#6366f1", "#06b6d4", "#f59e0b", "#ef4444"];
const label: Record<string, string> = { DRAFT: "Draft", ACTIVE: "Aktif", INACTIVE: "Nonaktif", PENDING: "Menunggu", VALIDATED: "Tervalidasi", FAILED: "Gagal" };

function Doughnut({ title, data }: { title: string; data: StatusCounts }) {
  const entries = Object.entries(data);
  const total = entries.reduce((sum, [, value]) => sum + value, 0);
  let angle = 0;
  const segments = entries.map(([, value], index) => {
    const next = total ? angle + (value / total) * 360 : angle;
    const segment = `${colors[index]} ${angle}deg ${next}deg`;
    angle = next;
    return segment;
  });
  return <section className="glass-card p-5"><div className="flex items-start justify-between gap-3"><div><h2 className="font-display text-base font-bold text-on-surface">{title}</h2><p className="mt-1 text-xs text-on-surface-variant">Ringkasan status saat ini</p></div><span className="rounded-full bg-primary/10 px-2.5 py-1 text-xs font-bold text-primary">{total} total</span></div><div className="mt-5 flex items-center gap-7"><div className="relative grid h-36 w-36 shrink-0 place-items-center rounded-full" style={{ background: total ? `conic-gradient(${segments.join(", ")})` : "var(--bg-card-hover)" }}><div className="grid h-24 w-24 place-items-center rounded-full bg-surface-container-lowest text-center"><strong className="text-2xl text-on-surface">{total}</strong><span className="text-[10px] text-on-surface-variant">data</span></div></div><ul className="space-y-2">{entries.map(([key, value], index) => <li key={key} className="flex items-center gap-4 text-sm"><span className="flex items-center gap-2 text-on-surface-variant"><i className="h-2.5 w-2.5 rounded-full" style={{ background: colors[index] }} />{label[key] ?? key}</span><strong className="text-on-surface">{value}</strong></li>)}</ul></div></section>;
}

function RecentActivityTable({ activities }: { activities: Dashboard["recent_activity"] }) {
  return <section className="glass-card overflow-hidden"><div className="flex items-center gap-2 border-b border-outline-variant/40 px-5 py-4"><Activity size={19} className="text-primary" /><div><h2 className="font-display text-base font-bold text-on-surface">Aktivitas Terbaru</h2><p className="mt-1 text-xs text-on-surface-variant">Lima perubahan terakhir di sistem.</p></div></div>{activities.length ? <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="bg-surface-container-low text-xs font-semibold uppercase text-on-surface-variant"><tr><th className="px-5 py-3">Aktivitas</th><th className="px-5 py-3">Jenis</th><th className="px-5 py-3">Waktu</th></tr></thead><tbody className="divide-y divide-outline-variant/30">{activities.map((item, index) => <tr key={`${item.timestamp}-${index}`}><td className="px-5 py-3.5 font-medium text-on-surface">{item.label}</td><td className="px-5 py-3.5"><span className="rounded-full bg-primary/10 px-2 py-1 text-xs font-bold text-primary">{item.type === "ACCOUNT" ? "Akun" : item.type === "PACKAGE" ? "Paket" : "Pengumpulan"}</span></td><td className="whitespace-nowrap px-5 py-3.5 text-xs text-on-surface-variant">{new Date(item.timestamp).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" })}</td></tr>)}</tbody></table></div> : <p className="p-5 text-sm text-on-surface-variant">Belum ada aktivitas.</p>}</section>;
}

export default function AdminDashboard({ dashboard }: { dashboard: Dashboard }) {
  const metrics = [
    { label: "Mahasiswa aktif", value: dashboard.system.active_students, icon: GraduationCap },
    { label: "Dosen aktif", value: dashboard.system.active_lecturers, icon: Users },
    { label: "Mata kuliah aktif", value: dashboard.system.active_subjects, icon: BookOpen },
    { label: "Paket ujian aktif", value: dashboard.system.active_question_sets, icon: ClipboardList },
  ];

  return <div className="space-y-5">
    <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{metrics.map((metric) => { const Icon = metric.icon; return <article key={metric.label} className="glass-card p-4"><div className="flex items-center justify-between"><span className="grid h-10 w-10 place-items-center rounded-xl bg-primary/15 text-primary"><Icon size={20} /></span><span className="text-2xl font-bold text-on-surface">{metric.value}</span></div><p className="mt-4 text-sm font-medium text-on-surface-variant">{metric.label}</p></article>; })}</section>

    <section className="grid gap-5 lg:grid-cols-2"><Doughnut title="Status Paket" data={dashboard.package_status} /><Doughnut title="Status Validasi" data={dashboard.validation_status} /></section>


    <section className="glass-card overflow-hidden"><div className="flex items-center justify-between border-b border-outline-variant/40 px-5 py-4"><div><h2 className="font-display text-base font-bold text-on-surface">Paket Perlu Tindakan</h2><p className="mt-1 text-xs text-on-surface-variant">Paket yang belum siap digunakan.</p></div><FileWarning size={19} className="text-error" /></div>{dashboard.attention_packages.length ? <div className="divide-y divide-outline-variant/30">{dashboard.attention_packages.map((item) => <Link href={`/questions/${item.id}/edit`} key={item.id} className="block px-5 py-3 hover:bg-surface-container"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="font-mono-ui text-xs font-bold text-primary">{item.code}</p><p className="mt-1 truncate text-sm font-semibold text-on-surface">{item.title}</p><p className="mt-1 text-xs text-on-surface-variant">{item.subject_name} · {item.reason}</p></div><span className="badge badge-draft">Draft</span></div></Link>)}</div> : <p className="p-5 text-sm text-on-surface-variant">Tidak ada paket yang memerlukan tindakan.</p>}</section>

    <section className="grid gap-5 lg:grid-cols-[1.4fr_1fr]"><RecentActivityTable activities={dashboard.recent_activity} />
      <section className="glass-card p-5"><div className="flex items-center justify-between"><div><h2 className="font-display text-base font-bold text-on-surface">Kesehatan AI</h2><p className="mt-1 text-xs text-on-surface-variant">Kondisi pemrosesan analisis.</p></div><Bot size={20} className="text-secondary" /></div><div className="mt-5 grid grid-cols-2 gap-3"><div className="rounded-xl bg-surface-container p-3"><Clock3 size={16} className="text-primary" /><p className="mt-2 text-lg font-bold text-on-surface">{dashboard.ai_health.queue}</p><p className="text-xs text-on-surface-variant">Dalam antrian</p></div><div className="rounded-xl bg-surface-container p-3"><CheckCircle2 size={16} className="text-tertiary-container" /><p className="mt-2 text-lg font-bold text-on-surface">{dashboard.ai_health.success_rate ?? "-"}{dashboard.ai_health.success_rate !== null ? "%" : ""}</p><p className="text-xs text-on-surface-variant">Berhasil</p></div><div className="rounded-xl bg-surface-container p-3"><AlertTriangle size={16} className="text-error" /><p className="mt-2 text-lg font-bold text-on-surface">{dashboard.ai_health.failures}</p><p className="text-xs text-on-surface-variant">Gagal</p></div><div className="rounded-xl bg-surface-container p-3"><Activity size={16} className="text-secondary" /><p className="mt-2 text-lg font-bold text-on-surface">{dashboard.ai_health.average_execution_ms ?? "-"}{dashboard.ai_health.average_execution_ms !== null ? " ms" : ""}</p><p className="text-xs text-on-surface-variant">Rata-rata proses</p></div></div></section></section>

    <section className="glass-card p-5"><div className="flex items-center gap-2"><AlertTriangle size={19} className="text-error" /><div><h2 className="font-display text-base font-bold text-on-surface">Notifikasi Penting</h2><p className="mt-1 text-xs text-on-surface-variant">Kondisi yang memerlukan perhatian administrator.</p></div></div><div className="mt-4 space-y-2">{dashboard.alerts.length ? dashboard.alerts.map((alert, index) => <div key={`${alert.level}-${index}`} className={`rounded-lg border p-3 text-sm ${alert.level === "error" ? "border-error/40 bg-error-container text-on-error-container" : alert.level === "warning" ? "border-status-draft/40 bg-status-draft/10 text-status-draft" : "border-primary/30 bg-primary/10 text-primary"}`}>{alert.message}</div>) : <p className="rounded-lg border border-tertiary-container/30 bg-tertiary-container/10 p-3 text-sm text-tertiary-container">Tidak ada notifikasi penting saat ini.</p>}</div></section>
  </div>;
}
