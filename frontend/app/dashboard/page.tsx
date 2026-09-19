"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { useAuth } from "../components/AuthProvider";
import { AppSidebar } from "../components/AppSidebar";
import { Icon } from "../components/Icon";
import type { IconName } from "../components/Icon";

type Role = {
  role: string;
  subject_slug: string;
  subject_name: string;
};

type SubjectSummary = {
  id: string;
  slug: string;
  name: string;
};

type Summary = Record<string, string | number | null | SubjectSummary[]>;

type DashboardData = {
  roles: Role[];
  is_superuser: boolean;
  summary: Summary;
};

type Card = {
  icon: IconName;
  label: string;
  value: unknown;
  format?: (v: unknown) => string;
};

type QuickAction = {
  icon: IconName;
  label: string;
  onClick?: () => void;
};

const ROLE_META: Record<string, { label: string; icon: IconName; desc: string }> = {
  ADMIN: { label: "Administrator", icon: "verified", desc: "Ikhtisar seluruh sistem." },
  LECTURER: { label: "Dosen", icon: "menu_book", desc: "Kelola soal dan validasi jawaban mahasiswa." },
  STUDENT: { label: "Mahasiswa", icon: "school", desc: "Lembar evaluasi dan pemantauan penguasaan." },
  GENERAL: { label: "Akun Umum", icon: "dashboard", desc: "Ringkasan umum akun Anda." },
};

const fmtPercent = (v: unknown) =>
  typeof v === "number" ? `${v.toFixed(2).replace(/\.?0+$/, "")}%` : "-";

function StatCard({ icon, label, value }: Card) {
  return (
    <div className="glass-tier-1 rounded-xl border border-outline-variant/40 p-5">
      <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary-fixed/60 text-primary">
        <Icon name={icon} className="h-5 w-5" />
      </div>
      <p className="mt-4 text-3xl font-bold tracking-tight text-on-surface">
        {(value ?? 0) as React.ReactNode}
      </p>
      <p className="mt-1 text-xs text-on-surface-variant">{label}</p>
    </div>
  );
}

export default function DashboardPage() {
  const { user, token, loading, logout } = useAuth();
  const router = useRouter();
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [selectedRole] = useState<string | null>(() => {
    const q = new URLSearchParams(typeof window === "undefined" ? "" : window.location.search).get("role");
    const stored = typeof window === "undefined" ? null : localStorage.getItem("selected_role");
    return q ?? stored;
  });

  useEffect(() => {
    if (loading) return;
    if (!user || !token) {
      router.replace("/login");
      return;
    }
    let cancelled = false;
    fetch("/api/dashboard/summary", {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((res) => {
        if (!res.ok) throw new Error("Gagal memuat dashboard");
        return res.json();
      })
      .then((d: DashboardData) => {
        if (!cancelled) setData(d);
      })
      .catch(() => {
        if (!cancelled) setError("Gagal memuat ringkasan dashboard.");
      });
    return () => {
      cancelled = true;
    };
  }, [user, token, loading, router]);

  const handleLogout = async () => {
    await logout();
    router.replace("/login");
  };

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-gradient-to-b from-white via-[#F0F7FF] to-[#E6F0FA] font-body">
        <p className="text-sm text-on-surface-variant">Memuat dashboard...</p>
      </main>
    );
  }

  if (!user) return null;

  const isAdmin = user.is_superuser;
  const roles = data?.roles ?? [];
  const fallbackRole = isAdmin ? "ADMIN" : (roles[0]?.role ?? "GENERAL");
  const primaryRole = selectedRole ?? fallbackRole;
  const meta = ROLE_META[primaryRole] ?? ROLE_META.GENERAL;
  const summary = data?.summary ?? {};

  const cards: Card[] = (() => {
    switch (primaryRole) {
      case "ADMIN":
        return [
          { icon: "people", label: "Pengguna terdaftar", value: summary.total_users },
          { icon: "menu_book", label: "Mata kuliah", value: summary.total_subjects },
          { icon: "assignment", label: "Bank soal", value: summary.total_question_sets },
          { icon: "school", label: "Pengumpulan", value: summary.total_submissions },
          { icon: "error_outline", label: "Miskonsepsi", value: summary.total_misconceptions },
          { icon: "bar_chart", label: "Analisis LLM", value: summary.total_analyses },
          { icon: "verified", label: "Validasi", value: summary.total_validations },
        ];
      case "STUDENT":
        return [
          { icon: "assignment", label: "Pengumpulan saya", value: summary.my_submissions },
          { icon: "bar_chart", label: "Sedang dianalisis", value: summary.my_analyzed },
          { icon: "check_circle", label: "Tervalidasi", value: summary.my_validated },
          { icon: "trending_up", label: "Rata-rata skor", value: summary.my_avg_score, format: fmtPercent },
        ];
      case "LECTURER":
        return [
          { icon: "assignment", label: "Bank soal saya", value: summary.my_question_sets },
          { icon: "menu_book", label: "Soal di mata kuliah saya", value: summary.subject_question_sets },
          { icon: "school", label: "Pengumpulan mahasiswa", value: summary.subject_submissions },
          { icon: "verified", label: "Menunggu validasi", value: summary.pending_validations },
        ];
      default:
        return [
          {
            icon: "menu_book",
            label: "Mata kuliah",
            value: Array.isArray(summary.my_subjects) ? summary.my_subjects.length : 0,
          },
          { icon: "dashboard", label: "Peran", value: roles.length || "Umum" },
        ];
    }
  })();

  const quickActions: QuickAction[] =
    primaryRole === "STUDENT"
      ? [
          {
            icon: "assignment",
            label: "Kerjakan evaluasi baru",
            onClick: () => router.push("/questions"),
          },
        ]
      : primaryRole === "LECTURER"
        ? [
            {
              icon: "add",
              label: "Buat bank soal baru",
              onClick: () => router.push("/questions"),
            },
            {
              icon: "verified",
              label: "Tinjau validasi",
              onClick: () => setNotice("Modul Validasi akan aktif pada fase berikutnya."),
            },
          ]
        : primaryRole === "ADMIN"
          ? [
              { icon: "people" as IconName, label: "Kelola pengguna" },
              { icon: "menu_book" as IconName, label: "Kelola mata kuliah" },
            ]
          : [];

  const mySubjects = (summary.my_subjects as SubjectSummary[]) ?? [];

  const handleMenuSelect = (item: "dashboard" | "questions" | "settings" | "profile") => {
    if (item === "dashboard") {
      router.replace(`/dashboard?role=${primaryRole}`);
      return;
    }
    if (item === "questions") {
      router.push("/questions");
      return;
    }
    if (item === "profile") {
      router.push("/profile");
      return;
    }
    setNotice("Settings akan segera tersedia.");
  };

  return (
    <main className="min-h-screen bg-gradient-to-b from-white via-[#F0F7FF] to-[#E6F0FA] font-body text-on-surface">
      <AppSidebar
        role={primaryRole}
        activeItem="dashboard"
        userName={user.full_name}
        onSelect={handleMenuSelect}
        onLogout={handleLogout}
      />
      <div className="min-h-screen lg:pl-72">
        <div className="mx-auto w-full max-w-6xl px-6">
          <header className="flex items-center justify-between py-5">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-outline-variant/40 bg-surface-container-lowest text-primary shadow-sm">
                <Icon name="school" className="h-6 w-6" />
              </div>
              <div>
                <p className="font-display text-lg font-bold tracking-tight text-primary">
                  EvalAI Academic
                </p>
                <p className="text-xs text-on-surface-variant">
                  Dashboard — {meta.label}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <span className="hidden rounded-full border border-outline-variant/30 bg-surface-container-lowest/80 px-3 py-1.5 text-xs font-medium text-on-surface sm:inline">
                {user.full_name}
              </span>
            </div>
          </header>

          <div className="mb-6 flex items-center gap-2">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary-fixed/60 text-primary">
              <Icon name={meta.icon} className="h-6 w-6" />
            </div>
            <div>
              <h1 className="font-display text-2xl font-bold tracking-tight text-on-surface">
                {meta.label}
              </h1>
              <p className="text-sm text-on-surface-variant">{meta.desc}</p>
            </div>
          </div>

          {error && (
            <div
              role="alert"
              className="mb-6 rounded-lg border border-error/40 bg-error-container px-3.5 py-2.5 text-sm text-on-error-container"
            >
              {error}
            </div>
          )}

          {notice && (
            <div
              role="status"
              className="mb-6 rounded-lg border border-primary-fixed-dim bg-primary-fixed/60 px-3.5 py-2.5 text-sm text-primary"
            >
              {notice}
            </div>
          )}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {cards.map((card) => (
              <StatCard
                key={card.label}
                icon={card.icon}
                label={card.label}
                value={card.format ? card.format(card.value) : card.value}
              />
            ))}
          </div>

          <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-2">
            <section className="glass-tier-2 rounded-xl p-6">
              <h2 className="font-display text-lg font-bold text-on-surface">
                Aksi cepat
              </h2>
              <ul className="mt-4 space-y-2">
                {quickActions.map((action) => (
                  <li key={action.label}>
                    <button
                      type="button"
                      onClick={action.onClick}
                      className="flex w-full items-center gap-3 rounded-lg border border-outline-variant/40 bg-surface-container-lowest px-4 py-3 text-sm font-medium text-on-surface transition-colors hover:border-primary-fixed-dim hover:bg-primary-fixed/30"
                    >
                      <Icon name={action.icon} className="h-5 w-5 text-primary" />
                      {action.label}
                    </button>
                  </li>
                ))}
                {quickActions.length === 0 && (
                  <li className="text-sm text-on-surface-variant">
                    Tidak ada aksi khusus untuk peran ini.
                  </li>
                )}
              </ul>
            </section>

            <section className="glass-tier-2 rounded-xl p-6">
              <h2 className="font-display text-lg font-bold text-on-surface">
                Mata kuliah saya
              </h2>
              {mySubjects.length > 0 ? (
                <ul className="mt-4 space-y-2">
                  {mySubjects.map((s) => (
                    <li
                      key={s.slug}
                      className="flex items-center justify-between rounded-lg border border-outline-variant/40 bg-surface-container-lowest px-4 py-3"
                    >
                      <span className="text-sm font-medium text-on-surface">
                        {s.name}
                      </span>
                      <span className="rounded bg-surface-container-high px-2 py-0.5 font-mono-ui text-[11px] uppercase text-secondary">
                        Mata kuliah
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-4 text-sm text-on-surface-variant">
                  Belum ada mata kuliah yang ditautkan ke akun ini.
                </p>
              )}
            </section>
          </div>
        </div>
      </div>
    </main>
  );
}