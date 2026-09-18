"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

import { useAuth } from "../components/AuthProvider";
import { Icon } from "../components/Icon";
import type { IconName } from "../components/Icon";

const META: Record<string, { label: string; icon: IconName; desc: string }> = {
  ADMIN: { label: "Administrator", icon: "verified", desc: "Kelola seluruh sistem." },
  LECTURER: { label: "Dosen", icon: "menu_book", desc: "Kelola bank soal dan validasi jawaban." },
  RESEARCHER: { label: "Peneliti", icon: "bar_chart", desc: "Analisis miskonsepsi dan data asesmen." },
  STUDENT: { label: "Mahasiswa", icon: "school", desc: "Lembar evaluasi dan latihan." },
  GENERAL: { label: "Akun Umum", icon: "dashboard", desc: "Tampilan umum tanpa peran khusus." },
};

type Option = { key: string; subjects: string[] };

export default function SelectRolePage() {
  const { user, loading, logout } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    if (!user) {
      router.replace("/login");
    }
  }, [user, loading, router]);

  function computeOptions(): Option[] {
    if (!user) return [];
    const seen = new Map<string, string[]>();
    if (user.is_superuser) seen.set("ADMIN", []);
    (user.roles ?? []).forEach((r) => {
      const list = seen.get(r.role) ?? [];
      seen.set(r.role, [...list, r.subject_name]);
    });
    if (seen.size === 0) seen.set("GENERAL", []);
    return [...seen.entries()].map(([key, subjects]) => ({ key, subjects }));
  }

  const options = computeOptions();

  function enter(key: string) {
    localStorage.setItem("selected_role", key);
    router.push(`/dashboard?role=${key}`);
  }

  const handleLogout = async () => {
    await logout();
    router.replace("/login");
  };

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-gradient-to-b from-white via-[#F0F7FF] to-[#E6F0FA] font-body">
        <p className="text-sm text-on-surface-variant">Memuat data pengguna...</p>
      </main>
    );
  }

  if (!user) return null;

  return (
    <main className="min-h-screen bg-gradient-to-b from-white via-[#F0F7FF] to-[#E6F0FA] font-body text-on-surface">
      <div className="mx-auto w-full max-w-3xl px-6">
        <header className="flex items-center justify-between py-5">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-outline-variant/40 bg-surface-container-lowest text-primary shadow-sm">
              <Icon name="school" className="h-6 w-6" />
            </div>
            <div>
              <p className="font-display text-lg font-bold tracking-tight text-primary">
                EvalAI Academic
              </p>
              <p className="text-xs text-on-surface-variant">Pemilihan peran</p>
            </div>
          </div>
          <button
            onClick={handleLogout}
            className="inline-flex items-center gap-1.5 rounded-lg border border-outline-variant/30 bg-surface-container-lowest px-3 py-2 text-xs font-semibold text-on-surface-variant transition-colors hover:bg-error-container hover:text-on-error-container"
          >
            <Icon name="logout" className="h-4 w-4" />
            Keluar
          </button>
        </header>

        <div className="mb-8 mt-6 text-center">
          <h1 className="font-display text-2xl font-bold tracking-tight text-on-surface">
            Pilih peran Anda
          </h1>
          <p className="mt-1.5 text-sm text-on-surface-variant">
            Masuk sebagai <span className="font-medium text-on-surface">{user?.email}</span> —{" "}
            {user?.full_name}. Pilih peran untuk membuka dashboard.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {options.map((opt) => {
            const meta = META[opt.key] ?? META.GENERAL;
            return (
              <button
                key={opt.key}
                onClick={() => enter(opt.key)}
                className="glass-tier-2 group flex flex-col rounded-xl p-6 text-left transition-all duration-200 hover:-translate-y-0.5 hover:border-primary-fixed-dim"
              >
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary-fixed/60 text-primary transition-colors group-hover:bg-primary text-on-primary">
                  <Icon name={meta.icon} className="h-6 w-6" />
                </div>
                <h2 className="mt-4 font-display text-lg font-bold text-on-surface">
                  {meta.label}
                </h2>
                <p className="mt-1 text-xs text-on-surface-variant">{meta.desc}</p>
                {opt.subjects.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {opt.subjects.map((s) => (
                      <span
                        key={s}
                        className="rounded bg-surface-container-high px-2 py-0.5 text-[11px] font-medium text-secondary"
                      >
                        {s}
                      </span>
                    ))}
                  </div>
                )}
                <span className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-primary">
                  Masuk
                  <Icon
                    name="arrow_forward"
                    className="h-4 w-4 transition-transform group-hover:translate-x-0.5"
                  />
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </main>
  );
}
