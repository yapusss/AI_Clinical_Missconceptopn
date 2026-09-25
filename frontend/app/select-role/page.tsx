"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, BookOpen, GraduationCap, LayoutDashboard, ShieldCheck } from "lucide-react";

import { useAuth } from "../components/AuthProvider";

const META: Record<string, { label: string; icon: typeof ShieldCheck; desc: string }> = {
  ADMIN: { label: "Administrator", icon: ShieldCheck, desc: "Kelola seluruh sistem." },
  LECTURER: { label: "Dosen", icon: BookOpen, desc: "Kelola bank soal dan validasi jawaban." },
  STUDENT: { label: "Mahasiswa", icon: GraduationCap, desc: "Lembar evaluasi dan latihan." },
  GENERAL: { label: "Akun Umum", icon: LayoutDashboard, desc: "Tampilan umum tanpa peran khusus." },
};

type Option = { key: string; subjects: string[] };

export default function SelectRolePage() {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [user, loading, router]);

  function computeOptions(): Option[] {
    if (!user) return [];
    const seen = new Map<string, string[]>();
    if (user.is_superuser) seen.set("ADMIN", []);
    (user.roles ?? []).forEach((r) => {
      const list = seen.get(r.role) ?? [];
      seen.set(r.role, r.subject_name ? [...list, r.subject_name] : list);
    });
    if (seen.size === 0) seen.set("GENERAL", []);
    return [...seen.entries()].map(([key, subjects]) => ({ key, subjects }));
  }

  function enter(key: string) {
    localStorage.setItem("selected_role", key);
    router.push(`/dashboard?role=${key}`);
  }

  return (
    <div
      className="app-shell"
      style={{ minHeight: "100vh", background: "var(--bg-main)", flexDirection: "column" }}
    >
      <div style={{ width: "100%", maxWidth: "840px", padding: "3rem 1.25rem", margin: "0 auto" }}>
      <header style={{ marginBottom: "1.5rem" }}>
        <h1 style={{ fontSize: "1.6rem", fontWeight: 800, margin: 0 }}>Pilih peran Anda</h1>
        <p style={{ fontSize: "0.9rem", color: "var(--text-muted)", marginTop: "0.4rem" }}>
          Masuk sebagai <strong style={{ color: "var(--text-main)" }}>{user?.email}</strong> — {user?.full_name}. Pilih peran untuk membuka dashboard.
        </p>
      </header>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: "16px" }}>
        {computeOptions().map((opt) => {
          const meta = META[opt.key] ?? META.GENERAL;
          const Icon = meta.icon;
          return (
            <button
              key={opt.key}
              type="button"
              onClick={() => enter(opt.key)}
              className="glass-card animate-fade-in"
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "flex-start",
                textAlign: "left",
                padding: "1.25rem",
                borderRadius: "var(--radius-lg)",
                cursor: "pointer",
              }}
            >
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
                <Icon size={26} />
              </div>
              <h2 style={{ fontSize: "1.05rem", fontWeight: 700, margin: "0.75rem 0 0.2rem" }}>{meta.label}</h2>
              <p style={{ fontSize: "0.82rem", color: "var(--text-muted)", margin: 0 }}>{meta.desc}</p>
              {opt.subjects.length > 0 && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", marginTop: "0.6rem" }}>
                  {opt.subjects.map((s) => (
                    <span key={s} className="badge badge-role">{s}</span>
                  ))}
                </div>
              )}
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "6px",
                  fontSize: "0.85rem",
                  fontWeight: 600,
                  color: "var(--primary)",
                  marginTop: "0.9rem",
                }}
              >
                Masuk
                <ArrowRight size={16} />
              </span>
            </button>
          );
        })}
        </div>
      </div>
    </div>
  );
}
