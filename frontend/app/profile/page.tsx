"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BookOpen, KeyRound, UserRound } from "lucide-react";

import { useAuth } from "../components/AuthProvider";
import PageHeader from "../components/PageHeader";

const ROLE_LABEL: Record<string, string> = {
  ADMIN: "Administrator",
  LECTURER: "Dosen",
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
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [user, loading, router]);

  if (!user) return null;

  const roleList = user.roles ?? [];
  const uniqueRoles = [...new Set(roleList.map((r) => r.role))];

  return (
    <div style={{ maxWidth: "840px", margin: "0 auto" }}>
      <PageHeader className="mb-6" title="Profile" description="Informasi akun dan peran Anda." icon={UserRound} />

      <section className="glass-panel animate-fade-in" style={{ padding: "1.5rem", borderRadius: "var(--radius-lg)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "1.25rem" }}>
          <div
            style={{
              width: "72px",
              height: "72px",
              borderRadius: "var(--radius-lg)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: "var(--gradient-primary)",
              color: "#ffffff",
              fontSize: "1.6rem",
              fontWeight: 800,
              flexShrink: 0,
            }}
          >
            {initials(user.full_name)}
          </div>
          <div style={{ minWidth: 0 }}>
            <h2 style={{ fontSize: "1.35rem", fontWeight: 800, margin: 0 }}>{user.full_name}</h2>
            <p style={{ fontSize: "0.85rem", color: "var(--text-muted)", margin: "0.2rem 0 0.6rem" }}>{user.email}</p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
              {user.is_superuser && <span className="badge badge-role">Administrator</span>}
              {uniqueRoles.map((r) => (
                <span key={r} className="badge badge-active">
                  {ROLE_LABEL[r] ?? r}
                </span>
              ))}
              {uniqueRoles.length === 0 && !user.is_superuser && (
                <span className="badge badge-draft">Akun Umum</span>
              )}
            </div>
          </div>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            gap: "12px",
            marginTop: "1.25rem",
            paddingTop: "1.25rem",
            borderTop: "1px solid var(--border-color)",
          }}
        >
          <div>
            <p style={{ fontSize: "0.75rem", color: "var(--text-muted)", margin: 0 }}>Terdaftar sejak</p>
            <p style={{ fontSize: "0.85rem", fontWeight: 600, color: "var(--text-main)", margin: "0.2rem 0 0" }}>
              {fmtDate(user.created_at)}
            </p>
          </div>
          <div>
            <p style={{ fontSize: "0.75rem", color: "var(--text-muted)", margin: 0 }}>Status akun</p>
            <p style={{ fontSize: "0.85rem", fontWeight: 600, color: "var(--text-main)", margin: "0.2rem 0 0" }}>
              {user.is_active ? "Aktif" : "Nonaktif"}
            </p>
          </div>
          <div>
            <p style={{ fontSize: "0.75rem", color: "var(--text-muted)", margin: 0 }}>ID Pengguna</p>
            <p style={{ fontSize: "0.72rem", color: "var(--text-dim)", fontFamily: "var(--font-mono)", margin: "0.2rem 0 0", overflowWrap: "anywhere" }}>
              {user.id}
            </p>
          </div>
        </div>
      </section>

      <section className="glass-card" style={{ padding: "1.25rem", borderRadius: "var(--radius-lg)", marginTop: "1.25rem" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <h2 style={{ fontSize: "1.05rem", fontWeight: 700, margin: 0 }}>
            <BookOpen size={18} color="var(--primary)" style={{ marginRight: "8px", verticalAlign: "middle" }} />
            Mata kuliah & peran
          </h2>
          <Link
            href="/select-role"
            className="btn-secondary"
            style={{ padding: "0.45rem 0.9rem", fontSize: "0.8rem" }}
          >
            <UserRound size={15} />
            Ganti peran
          </Link>
        </div>

        {roleList.length > 0 ? (
          <ul style={{ marginTop: "1rem", padding: 0, display: "flex", flexDirection: "column", gap: "8px", listStyle: "none" }}>
            {roleList.map((r) => (
              <li
                key={`${r.role}-${r.subject_slug}`}
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
                  {r.subject_name}
                </span>
                <span className="badge badge-role">{r.role}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p style={{ marginTop: "1rem", fontSize: "0.85rem", color: "var(--text-muted)" }}>
            Belum ada mata kuliah yang ditautkan ke akun ini.
          </p>
        )}
      </section>
    </div>
  );
}
