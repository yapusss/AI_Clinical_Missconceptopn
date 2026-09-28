"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Building2, Eye, EyeOff, Lock, UserRound } from "lucide-react";

import { useAuth } from "../components/AuthProvider";
import ThemeToggle from "../components/ThemeToggle";

export default function LoginPage() {
  const { user, loading, login, register } = useAuth();
  const router = useRouter();
  const [isRegister, setIsRegister] = useState(false);
  const [namaLengkap, setNamaLengkap] = useState("");
  const [identitas, setIdentitas] = useState("");
  const [kataSandi, setKataSandi] = useState("");
  const [konfirmasiSandi, setKonfirmasiSandi] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!loading && user) router.replace("/select-role");
  }, [user, loading, router]);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      if (isRegister) {
        if (kataSandi !== konfirmasiSandi) throw new Error("Konfirmasi kata sandi tidak sama.");
        await register(namaLengkap, identitas, kataSandi);
      } else {
        await login(identitas, kataSandi);
      }
      router.push("/select-role");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login gagal.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="app-shell"
      style={{
        minHeight: "100vh",
        background: "var(--bg-main)",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div style={{ position: "absolute", top: "16px", right: "16px" }}>
        <ThemeToggle />
      </div>

      <div
        className="glass-panel animate-fade-in"
        style={{
          width: "100%",
          maxWidth: "420px",
          padding: "2rem",
          borderRadius: "var(--radius-lg)",
          boxSizing: "border-box",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", marginBottom: "1.25rem" }}>
          <div
            style={{
              width: "52px",
              height: "52px",
              borderRadius: "var(--radius-md)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: "var(--gradient-primary)",
              color: "#ffffff",
            }}
          >
            <Building2 size={28} />
          </div>
        </div>
        <h1 style={{ fontSize: "1.5rem", fontWeight: 800, textAlign: "center", margin: 0 }}>
          {isRegister ? "Daftar Akun" : "Masuk ke Portal"}
        </h1>
        <p style={{ fontSize: "0.85rem", color: "var(--text-muted)", textAlign: "center", marginTop: "0.4rem" }}>
          {isRegister ? "Pendaftaran ini khusus untuk akun mahasiswa." : "EvalAI Academic — AI Clinical Misconception"}
        </p>

        <form
          onSubmit={onSubmit}
          style={{ display: "flex", flexDirection: "column", gap: "1rem", marginTop: "1.5rem" }}
        >
          {isRegister && <label style={{ display: "flex", flexDirection: "column", gap: "0.35rem", fontSize: "0.8rem", fontWeight: 600, color: "var(--text-muted)" }}>
            Nama Lengkap
            <div style={{ position: "relative" }}>
              <UserRound size={18} style={{ position: "absolute", left: "12px", top: "50%", transform: "translateY(-50%)", color: "var(--text-dim)" }} />
              <input type="text" autoComplete="name" required value={namaLengkap} onChange={(e) => setNamaLengkap(e.target.value)} placeholder="Nama lengkap" className="form-input" style={{ paddingLeft: "2.4rem" }} />
            </div>
          </label>}
          <label style={{ display: "flex", flexDirection: "column", gap: "0.35rem", fontSize: "0.8rem", fontWeight: 600, color: "var(--text-muted)" }}>
            Email
            <div style={{ position: "relative" }}>
              <UserRound size={18} style={{ position: "absolute", left: "12px", top: "50%", transform: "translateY(-50%)", color: "var(--text-dim)" }} />
              <input
                type="email"
                autoComplete="email"
                required
                value={identitas}
                onChange={(e) => setIdentitas(e.target.value)}
                placeholder="nama@email.com"
                className="form-input"
                style={{ paddingLeft: "2.4rem" }}
              />
            </div>
          </label>

          <label style={{ display: "flex", flexDirection: "column", gap: "0.35rem", fontSize: "0.8rem", fontWeight: 600, color: "var(--text-muted)" }}>
            Kata Sandi
            <div style={{ position: "relative" }}>
              <Lock size={18} style={{ position: "absolute", left: "12px", top: "50%", transform: "translateY(-50%)", color: "var(--text-dim)" }} />
              <input
                type={showPassword ? "text" : "password"}
                autoComplete={isRegister ? "new-password" : "current-password"}
                required
                value={kataSandi}
                onChange={(e) => setKataSandi(e.target.value)}
                placeholder="••••••••"
                className="form-input"
                style={{ paddingLeft: "2.4rem", paddingRight: "2.4rem" }}
              />
              <button
                type="button"
                aria-label="Tampilkan atau sembunyikan kata sandi"
                onClick={() => setShowPassword(!showPassword)}
                style={{
                  position: "absolute",
                  right: "6px",
                  top: "50%",
                  transform: "translateY(-50%)",
                  background: "transparent",
                  border: "none",
                  color: "var(--text-dim)",
                  cursor: "pointer",
                  padding: "6px",
                  display: "inline-flex",
                }}
              >
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </label>

          {isRegister && <label style={{ display: "flex", flexDirection: "column", gap: "0.35rem", fontSize: "0.8rem", fontWeight: 600, color: "var(--text-muted)" }}>
            Konfirmasi Kata Sandi
            <div style={{ position: "relative" }}>
              <Lock size={18} style={{ position: "absolute", left: "12px", top: "50%", transform: "translateY(-50%)", color: "var(--text-dim)" }} />
              <input type={showPassword ? "text" : "password"} autoComplete="new-password" required value={konfirmasiSandi} onChange={(e) => setKonfirmasiSandi(e.target.value)} placeholder="Ulangi kata sandi" className="form-input" style={{ paddingLeft: "2.4rem" }} />
            </div>
          </label>}

          {error && (
            <div role="alert" style={{ borderRadius: "var(--radius-sm)", border: "1px solid rgba(239, 68, 68, 0.3)", background: "rgba(239, 68, 68, 0.12)", color: "#f87171", fontSize: "0.85rem", padding: "0.6rem 0.9rem" }}>
              {error}
            </div>
          )}

          <button type="submit" className="btn-primary" disabled={submitting} style={{ padding: "0.75rem 1.25rem", fontSize: "0.9rem", opacity: submitting ? 0.6 : 1 }}>
            {submitting ? "Memproses..." : isRegister ? "Daftar Akun" : "Masuk ke Akun"}
            <ArrowRight size={16} />
          </button>
        </form>
        <p style={{ margin: "1.25rem 0 0", textAlign: "center", fontSize: "0.85rem", color: "var(--text-muted)" }}>
          {isRegister ? "Sudah memiliki akun?" : "Belum memiliki akun?"}{" "}
          <button type="button" onClick={() => { setIsRegister(!isRegister); setError(""); }} style={{ border: 0, background: "transparent", color: "var(--primary)", fontWeight: 700, cursor: "pointer", padding: 0 }}>
            {isRegister ? "Masuk" : "Daftar"}
          </button>
        </p>
      </div>
    </div>
  );
}
