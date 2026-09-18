"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { useAuth } from "../components/AuthProvider";
import { AppSidebar } from "../components/AppSidebar";
import type { AppMenuId } from "../components/AppSidebar";
import { Icon } from "../components/Icon";

const ROLE_LABEL: Record<string, string> = {
  ADMIN: "Administrator",
  LECTURER: "Dosen",
  RESEARCHER: "Peneliti",
  STUDENT: "Mahasiswa",
  GENERAL: "Akun Umum",
};

function initials(name: string): string {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("");
}

function fmtDate(value?: string): string {
  if (!value) return "-";
  return new Date(value).toLocaleDateString("id-ID", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export default function ProfilePage() {
  const { user, token, loading, logout } = useAuth();
  const router = useRouter();
  const [notice, setNotice] = useState("");
  const [role] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    return localStorage.getItem("selected_role");
  });

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [user, loading, router]);

  const handleMenuSelect = (item: AppMenuId) => {
    if (item === "dashboard") {
      router.push("/dashboard");
      return;
    }
    if (item === "profile") {
      router.push("/profile");
      return;
    }
    setNotice(`${item === "questions" ? "Modul Soal" : "Settings"} akan segera tersedia.`);
  };

  const handleLogout = async () => {
    await logout();
    router.replace("/login");
  };

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-gradient-to-b from-white via-[#F0F7FF] to-[#E6F0FA] font-body">
        <p className="text-sm text-on-surface-variant">Memuat profil...</p>
      </main>
    );
  }

  if (!user || !token) return null;

  const appRole = role ?? (user.is_superuser ? "ADMIN" : (user.roles?.[0]?.role ?? "GENERAL"));
  const roleList = user.roles ?? [];

  return (
    <main className="min-h-screen bg-gradient-to-b from-white via-[#F0F7FF] to-[#E6F0FA] font-body text-on-surface">
      <AppSidebar
        role={appRole}
        activeItem="profile"
        userName={user.full_name}
        onSelect={handleMenuSelect}
        onLogout={handleLogout}
      />

      <div className="min-h-screen lg:pl-72">
        <div className="mx-auto w-full max-w-4xl px-6 py-8">
          <div className="mb-6 flex items-center gap-2">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary-fixed/60 text-primary">
              <Icon name="person" className="h-6 w-6" />
            </div>
            <div>
              <h1 className="font-display text-2xl font-bold tracking-tight text-on-surface">
                Profile
              </h1>
              <p className="text-sm text-on-surface-variant">
                Informasi akun dan peran Anda.
              </p>
            </div>
          </div>

          {notice && (
            <div
              role="status"
              className="mb-6 rounded-lg border border-primary-fixed-dim bg-primary-fixed/60 px-3.5 py-2.5 text-sm text-primary"
            >
              {notice}
            </div>
          )}

          <section className="glass-tier-2 rounded-xl p-8">
            <div className="flex flex-col items-start gap-6 sm:flex-row sm:items-center">
              <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-2xl bg-primary text-2xl font-bold text-on-primary shadow-sm">
                {initials(user.full_name)}
              </div>
              <div className="min-w-0">
                <h2 className="font-display text-2xl font-bold text-on-surface">
                  {user.full_name}
                </h2>
                <p className="text-sm text-on-surface-variant">{user.email}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {user.is_superuser && (
                    <span className="rounded-full bg-primary-fixed px-3 py-1 text-xs font-semibold text-primary ring-1 ring-primary-fixed-dim">
                      Administrator
                    </span>
                  )}
                  {roleList.length === 0 && !user.is_superuser && (
                    <span className="rounded-full bg-surface-container-high px-3 py-1 text-xs font-semibold text-secondary">
                      Akun Umum
                    </span>
                  )}
                  {[...new Set(roleList.map((r) => r.role))].map((r) => (
                    <span
                      key={r}
                      className="rounded-full bg-surface-container-high px-3 py-1 text-xs font-semibold text-secondary"
                    >
                      {ROLE_LABEL[r] ?? r}
                    </span>
                  ))}
                </div>
              </div>
            </div>

            <dl className="mt-8 grid grid-cols-1 gap-4 border-t border-outline-variant/40 pt-6 sm:grid-cols-2">
              <div>
                <dt className="text-xs text-on-surface-variant">Terdaftar sejak</dt>
                <dd className="mt-0.5 text-sm font-medium text-on-surface">
                  {fmtDate(user.created_at)}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-on-surface-variant">Status akun</dt>
                <dd className="mt-0.5 text-sm font-medium text-on-surface">
                  {user.is_active ? "Aktif" : "Nonaktif"}
                </dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-xs text-on-surface-variant">ID Pengguna</dt>
                <dd className="mt-0.5 font-mono-ui text-xs text-on-surface-variant">
                  {user.id}
                </dd>
              </div>
            </dl>
          </section>

          <section className="glass-tier-2 mt-6 rounded-xl p-8">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-lg font-bold text-on-surface">
                Mata kuliah & peran
              </h2>
              <Link
                href="/select-role"
                className="inline-flex items-center gap-1.5 rounded-lg border border-outline-variant/30 bg-surface-container-lowest px-3 py-2 text-xs font-semibold text-primary transition-colors hover:bg-primary-fixed/40"
              >
                <Icon name="verified_user" className="h-4 w-4" />
                Ganti peran
              </Link>
            </div>

            {roleList.length > 0 ? (
              <ul className="mt-5 space-y-2">
                {roleList.map((r) => (
                  <li
                    key={`${r.role}-${r.subject_slug}`}
                    className="flex items-center justify-between rounded-lg border border-outline-variant/40 bg-surface-container-lowest px-4 py-3"
                  >
                    <span className="text-sm font-medium text-on-surface">
                      {r.subject_name}
                    </span>
                    <span className="rounded bg-surface-container-high px-2 py-0.5 font-mono-ui text-[11px] uppercase text-secondary">
                      {r.role}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-5 text-sm text-on-surface-variant">
                Belum ada mata kuliah yang ditautkan ke akun ini.
              </p>
            )}
          </section>

          <div className="mt-6 flex justify-end">
            <button
              type="button"
              onClick={handleLogout}
              className="inline-flex items-center gap-1.5 rounded-lg border border-outline-variant/30 bg-surface-container-lowest px-4 py-2.5 text-sm font-semibold text-on-surface-variant transition-colors hover:bg-error-container hover:text-on-error-container"
            >
              <Icon name="logout" className="h-4 w-4" />
              Logout
            </button>
          </div>
        </div>
      </div>
    </main>
  );
}