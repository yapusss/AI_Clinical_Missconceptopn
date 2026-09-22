"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  BarChart3,
  BookOpen,
  CircleCheck,
  ClipboardList,
  FilePlus,
  FileSearch,
  GraduationCap,
  KeyRound,
  LayoutDashboard,
  ShieldCheck,
  TrendingUp,
  TriangleAlert,
  Users,
} from "lucide-react";

import { useAuth } from "../components/AuthProvider";
import { apiFetch } from "../lib/api";

type Role = { role: string; subject_slug: string; subject_name: string };
type SubjectSummary = { slug: string; name: string };
type Summary = Record<string, string | number | null | SubjectSummary[]>;
type DashboardData = { roles: Role[]; is_superuser: boolean; summary: Summary };

const ROLE_META: Record<string, { label: string; icon: typeof ShieldCheck; desc: string }> = {
  ADMIN: { label: "Administrator", icon: ShieldCheck, desc: "Ikhtisar seluruh sistem." },
  LECTURER: { label: "Dosen", icon: BookOpen, desc: "Kelola soal dan validasi jawaban mahasiswa." },
  STUDENT: { label: "Mahasiswa", icon: GraduationCap, desc: "Lembar evaluasi dan pemantauan penguasaan." },
  GENERAL: { label: "Akun Umum", icon: LayoutDashboard, desc: "Ringkasan umum akun Anda." },
};

const fmtPercent = (v: unknown) =>
  typeof v === "number" ? `${v.toFixed(2).replace(/\.?0+$/, "")}%` : "-";

type Card = { icon: typeof ShieldCheck; label: string; value: unknown; format?: (v: unknown) => string };

function StatCard({ icon, label, value }: Card) {
  const Icon = icon;
  return (
    <div className="glass-card" style={{ padding: "1rem", borderRadius: "var(--radius-md)" }}>
      <div
        style={{
          width: "40px",
          height: "40px",
          borderRadius: "var(--radius-sm)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "rgba(99, 102, 241, 0.15)",
          color: "var(--primary)",
        }}
      >
        <Icon size={20} />
      </div>
      <p style={{ fontSize: "1.9rem", fontWeight: 800, margin: "0.75rem 0 0.2rem", color: "var(--text-main)" }}>
        {((value ?? 0) as React.ReactNode)}
      </p>
      <p style={{ fontSize: "0.75rem", color: "var(--text-muted)", margin: 0 }}>{label}</p>
    </div>
  );
}

export default function DashboardPage() {
  const { user, token, loading } = useAuth();
  const router = useRouter();
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState("");
  const [pageLoading, setPageLoading] = useState(true);
  // Read from the URL/storage after mount only: a render-time read diverges from
  // the server render and breaks hydration.
  const [view, setView] = useState<string | null>(null);
  const [selectedRole, setSelectedRole] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setView(params.get("view"));
    setSelectedRole(params.get("role") ?? localStorage.getItem("selected_role"));
  }, []);

  useEffect(() => {
    if (!loading && (!user || !token)) {
      router.replace("/login");
      return;
    }
    if (!user || !token) return;
    let cancelled = false;
    apiFetch<DashboardData>("/dashboard/summary")
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch(() => {
        if (!cancelled) setError("Gagal memuat ringkasan dashboard.");
      })
      .finally(() => {
        if (!cancelled) setPageLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [user, token, loading, router]);

  if (!user) return null;

  const isAdmin = user.is_superuser;
  const roles = data?.roles ?? [];
  const fallbackRole = isAdmin ? "ADMIN" : (roles[0]?.role ?? "GENERAL");
  const primaryRole = selectedRole ?? fallbackRole;
  const meta = ROLE_META[primaryRole] ?? ROLE_META.GENERAL;
  const summary = data?.summary ?? {};
  const mySubjects = (summary.my_subjects as SubjectSummary[]) ?? [];

  const cards: Card[] = (() => {
    switch (primaryRole) {
      case "ADMIN":
        return [
          { icon: Users, label: "Pengguna terdaftar", value: summary.total_users },
          { icon: BookOpen, label: "Mata kuliah", value: summary.total_subjects },
          { icon: FileSearch, label: "Bank soal", value: summary.total_question_sets },
          { icon: ClipboardList, label: "Pengumpulan", value: summary.total_submissions },
          { icon: TriangleAlert, label: "Miskonsepsi", value: summary.total_misconceptions },
          { icon: BarChart3, label: "Analisis LLM", value: summary.total_analyses },
          { icon: ShieldCheck, label: "Validasi", value: summary.total_validations },
        ];
      case "STUDENT":
        return [
          { icon: ClipboardList, label: "Pengumpulan saya", value: summary.my_submissions },
          { icon: BarChart3, label: "Sedang dianalisis", value: summary.my_analyzed },
          { icon: CircleCheck, label: "Tervalidasi", value: summary.my_validated },
          { icon: TrendingUp, label: "Rata-rata skor", value: summary.my_avg_score, format: fmtPercent },
        ];
      case "LECTURER":
        return [
          { icon: FileSearch, label: "Bank soal saya", value: summary.my_question_sets },
          { icon: BookOpen, label: "Soal di mata kuliah saya", value: summary.subject_question_sets },
          { icon: ClipboardList, label: "Pengumpulan mahasiswa", value: summary.subject_submissions },
          { icon: ShieldCheck, label: "Menunggu validasi", value: summary.pending_validations },
        ];
      default:
        return [
          { icon: BookOpen, label: "Mata kuliah", value: Array.isArray(summary.my_subjects) ? summary.my_subjects.length : 0 },
          { icon: LayoutDashboard, label: "Peran", value: roles.length || "Umum" },
        ];
    }
  })();

  const quickActions: { icon: typeof ShieldCheck; label: string; href?: string }[] =
    primaryRole === "STUDENT"
      ? [
          { icon: ClipboardList, label: "Kerjakan evaluasi baru", href: "/code" },
          { icon: FileSearch, label: "Lihat pengumpulan saya", href: "/code#pengumpulan" },
        ]
      : primaryRole === "LECTURER"
        ? [
            { icon: FilePlus, label: "Buat bank soal baru", href: "/questions" },
            { icon: ShieldCheck, label: "Tinjau validasi", href: "/validation" },
          ]
        : primaryRole === "ADMIN"
          ? [
              { icon: Users, label: "Kelola pengguna" },
              { icon: BookOpen, label: "Kelola mata kuliah" },
            ]
          : [];

  const MetaIcon = meta.icon;

  return (
    <div style={{ maxWidth: "1080px", margin: "0 auto" }}>
      <header style={{ display: "flex", alignItems: "center", gap: "14px", marginBottom: "1.5rem" }}>
        <div
          style={{
            width: "48px",
            height: "48px",
            borderRadius: "var(--radius-md)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "rgba(99, 102, 241, 0.15)",
            color: "var(--primary)",
          }}
        >
          <MetaIcon size={26} />
        </div>
        <div>
          <h1 style={{ fontSize: "1.6rem", fontWeight: 800, margin: 0 }}>{meta.label}</h1>
          <p style={{ fontSize: "0.9rem", color: "var(--text-muted)", margin: "0.2rem 0 0" }}>{meta.desc}</p>
        </div>
      </header>

      {view && (
        <div role="status" style={{ borderRadius: "var(--radius-sm)", border: "1px solid rgba(99, 102, 241, 0.25)", background: "rgba(99, 102, 241, 0.1)", color: "var(--text-muted)", fontSize: "0.85rem", padding: "0.7rem 1rem", marginBottom: "1.25rem" }}>
          Modul {view === "soal" ? "Soal" : "Settings"} akan segera tersedia.
        </div>
      )}

      {error && (
        <div role="alert" style={{ borderRadius: "var(--radius-sm)", border: "1px solid rgba(239, 68, 68, 0.3)", background: "rgba(239, 68, 68, 0.12)", color: "#f87171", fontSize: "0.85rem", padding: "0.7rem 1rem", marginBottom: "1.25rem" }}>
          {error}
        </div>
      )}

      {pageLoading ? (
        <p style={{ color: "var(--text-dim)", fontSize: "0.85rem" }}>Memproses...</p>
      ) : (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "16px" }}>
            {cards.map((card) => (
              <StatCard
                key={card.label}
                icon={card.icon}
                label={card.label}
                value={card.format ? card.format(card.value) : card.value}
              />
            ))}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))", gap: "20px", marginTop: "1.75rem" }}>
            <section className="glass-card" style={{ padding: "1.25rem", borderRadius: "var(--radius-lg)" }}>
              <h2 style={{ fontSize: "1.05rem", fontWeight: 700, margin: 0 }}>Aksi cepat</h2>
              <ul style={{ marginTop: "0.9rem", padding: 0, display: "flex", flexDirection: "column", gap: "8px", listStyle: "none" }}>
                {quickActions.map((action) => {
                  const ActionIcon = action.icon;
                  const inner = (
                    <>
                      <ActionIcon size={16} color="var(--primary)" />
                      {action.label}
                    </>
                  );
                  return (
                    <li key={action.label}>
                      {action.href ? (
                        <Link
                          href={action.href}
                          className="btn-secondary"
                          style={{ width: "100%", justifyContent: "flex-start", padding: "0.6rem 0.9rem" }}
                        >
                          {inner}
                        </Link>
                      ) : (
                        <button
                          type="button"
                          className="btn-secondary"
                          style={{ width: "100%", justifyContent: "flex-start", padding: "0.6rem 0.9rem" }}
                        >
                          {inner}
                        </button>
                      )}
                    </li>
                  );
                })}
                {quickActions.length === 0 && (
                  <li style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>
                    Tidak ada aksi khusus untuk peran ini.
                  </li>
                )}
              </ul>
            </section>

            <section className="glass-card" style={{ padding: "1.25rem", borderRadius: "var(--radius-lg)" }}>
              <h2 style={{ fontSize: "1.05rem", fontWeight: 700, margin: 0 }}>Mata kuliah saya</h2>
              {mySubjects.length > 0 ? (
                <ul style={{ marginTop: "0.9rem", padding: 0, display: "flex", flexDirection: "column", gap: "8px", listStyle: "none" }}>
                  {mySubjects.map((s) => (
                    <li
                      key={s.slug}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        padding: "0.6rem 0.9rem",
                        borderRadius: "var(--radius-sm)",
                        background: "var(--input-bg)",
                        border: "1px solid var(--border-color)",
                      }}
                    >
                      <span style={{ fontSize: "0.85rem", fontWeight: 600, color: "var(--text-main)" }}>
                        <KeyRound size={14} color="var(--primary)" style={{ marginRight: "8px" }} />
                        {s.name}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p style={{ marginTop: "0.9rem", fontSize: "0.85rem", color: "var(--text-muted)" }}>
                  Belum ada mata kuliah yang ditautkan ke akun ini.
                </p>
              )}
            </section>
          </div>
        </>
      )}
    </div>
  );
}
