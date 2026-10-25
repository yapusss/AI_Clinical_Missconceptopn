"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  Eye,
  EyeOff,
  Lock,
  UserRound,
} from "lucide-react";
import unsLogo from "../../assets/UNS-LOGO.png";
import ubdLogo from "../../assets/Universiti_Brunei_Darussalam_logo.jpeg";

import { useAuth } from "../components/AuthProvider";
import ThemeToggle from "../components/ThemeToggle";
import FeedbackModal from "../components/FeedbackModal";

export default function LoginPage() {
  const { user, loading, login, register } = useAuth();
  const router = useRouter();
  const [isRegister, setIsRegister] = useState(false);
  const [namaLengkap, setNamaLengkap] = useState("");
  const [nim, setNim] = useState("");
  const [identitas, setIdentitas] = useState("");
  const [kataSandi, setKataSandi] = useState("");
  const [konfirmasiSandi, setKonfirmasiSandi] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    // Skip while a submit is in flight: the submit handler performs the
    // redirect itself, and two competing navigations can cancel each other.
    if (!loading && user && !submitting) router.replace("/select-role");
  }, [user, loading, submitting, router]);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      if (isRegister) {
        if (kataSandi !== konfirmasiSandi)
          throw new Error("Konfirmasi kata sandi tidak sama.");
        await register(namaLengkap, nim, identitas, kataSandi);
      } else {
        await login(identitas, kataSandi);
      }
      // Hard navigation: guarantees the next page reads the freshly stored
      // token, with no client router/navigation race.
      window.location.assign("/select-role");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login gagal.");
      setSubmitting(false);
    }
  }

  return (
    <div
      className="app-shell login-shell"
      style={{
        minHeight: "100dvh",
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
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            marginBottom: "1.25rem",
          }}
        >
          <div className="flex items-center gap-4" aria-label="Logo institusi">
            <Image
              src={unsLogo}
              alt="Universitas Sebelas Maret"
              width={56}
              height={56}
              className="h-14 w-14 object-contain"
              priority
            />
            <span
              className="h-9 w-px bg-outline-variant/50"
              aria-hidden="true"
            />
            <Image
              src={ubdLogo}
              alt="Universiti Brunei Darussalam"
              width={44}
              height={56}
              className="h-14 w-11 object-contain"
              priority
            />
          </div>
        </div>
        <h1
          style={{
            fontSize: "1.5rem",
            fontWeight: 800,
            textAlign: "center",
            margin: 0,
          }}
        >
          {isRegister ? "Daftar Akun" : "Masuk ke Portal"}
        </h1>
        <p
          style={{
            fontSize: "0.85rem",
            color: "var(--text-muted)",
            textAlign: "center",
            marginTop: "0.4rem",
          }}
        >
          {isRegister
            ? "Pendaftaran ini khusus untuk akun mahasiswa."
            : "EvalAI Academic — AI Clinical Misconception"}
        </p>

        <form
          onSubmit={onSubmit}
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "1rem",
            marginTop: "1.5rem",
          }}
        >
          {isRegister && (
            <label
              htmlFor="register-full-name"
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "0.35rem",
                fontSize: "0.8rem",
                fontWeight: 600,
                color: "var(--text-muted)",
              }}
            >
              Nama Lengkap
              <div style={{ position: "relative" }}>
                <UserRound
                  size={18}
                  style={{
                    position: "absolute",
                    left: "12px",
                    top: "50%",
                    transform: "translateY(-50%)",
                    color: "var(--text-dim)",
                  }}
                />
                <input
                  id="register-full-name"
                  type="text"
                  autoComplete="name"
                  required
                  value={namaLengkap}
                  onChange={(e) => setNamaLengkap(e.target.value)}
                  placeholder="Nama lengkap"
                  className="form-input"
                  style={{ paddingLeft: "2.4rem" }}
                />
              </div>
            </label>
          )}
          {isRegister && (
            <label
              htmlFor="register-nim"
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "0.35rem",
                fontSize: "0.8rem",
                fontWeight: 600,
                color: "var(--text-muted)",
              }}
            >
              NIM
              <div style={{ position: "relative" }}>
                <UserRound
                  size={18}
                  style={{
                    position: "absolute",
                    left: "12px",
                    top: "50%",
                    transform: "translateY(-50%)",
                    color: "var(--text-dim)",
                  }}
                />
                <input
                  id="register-nim"
                  type="text"
                  autoComplete="username"
                  required
                  value={nim}
                  onChange={(e) => setNim(e.target.value.toUpperCase())}
                  placeholder="Nomor Induk Mahasiswa"
                  className="form-input"
                  style={{ paddingLeft: "2.4rem" }}
                />
              </div>
            </label>
          )}
          <label
            htmlFor="auth-email"
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "0.35rem",
              fontSize: "0.8rem",
              fontWeight: 600,
              color: "var(--text-muted)",
            }}
          >
            Email
            <div style={{ position: "relative" }}>
              <UserRound
                size={18}
                style={{
                  position: "absolute",
                  left: "12px",
                  top: "50%",
                  transform: "translateY(-50%)",
                  color: "var(--text-dim)",
                }}
              />
              <input
                id="auth-email"
                type="email"
                autoComplete="email"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                enterKeyHint="next"
                required
                value={identitas}
                onChange={(e) => setIdentitas(e.target.value)}
                placeholder="nama@email.com"
                className="form-input"
                style={{ paddingLeft: "2.4rem" }}
              />
            </div>
          </label>

          <label
            htmlFor="auth-password"
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "0.35rem",
              fontSize: "0.8rem",
              fontWeight: 600,
              color: "var(--text-muted)",
            }}
          >
            Kata Sandi
            <div style={{ position: "relative" }}>
              <Lock
                size={18}
                style={{
                  position: "absolute",
                  left: "12px",
                  top: "50%",
                  transform: "translateY(-50%)",
                  color: "var(--text-dim)",
                }}
              />
              <input
                id="auth-password"
                type={showPassword ? "text" : "password"}
                autoComplete={isRegister ? "new-password" : "current-password"}
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                enterKeyHint="go"
                required
                value={kataSandi}
                onChange={(e) => setKataSandi(e.target.value)}
                placeholder="••••••••"
                className="form-input"
                style={{ paddingLeft: "2.4rem", paddingRight: "3.25rem" }}
              />
              <button
                type="button"
                aria-label={
                  showPassword
                    ? "Sembunyikan kata sandi"
                    : "Tampilkan kata sandi"
                }
                aria-pressed={showPassword}
                onClick={(event) => {
                  // Inside a <label>: stop the label from forwarding the tap to
                  // the input, which otherwise steals focus from the toggle.
                  event.preventDefault();
                  event.stopPropagation();
                  setShowPassword((visible) => !visible);
                }}
                style={{
                  position: "absolute",
                  right: "2px",
                  top: "50%",
                  transform: "translateY(-50%)",
                  width: "44px",
                  height: "44px",
                  zIndex: 2,
                  background: "transparent",
                  border: "none",
                  color: "var(--text-dim)",
                  cursor: "pointer",
                  padding: 0,
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  touchAction: "manipulation",
                }}
              >
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </label>

          {isRegister && (
            <label
              htmlFor="register-password-confirmation"
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "0.35rem",
                fontSize: "0.8rem",
                fontWeight: 600,
                color: "var(--text-muted)",
              }}
            >
              Konfirmasi Kata Sandi
              <div style={{ position: "relative" }}>
                <Lock
                  size={18}
                  style={{
                    position: "absolute",
                    left: "12px",
                    top: "50%",
                    transform: "translateY(-50%)",
                    color: "var(--text-dim)",
                  }}
                />
                <input
                  id="register-password-confirmation"
                  type={showPassword ? "text" : "password"}
                  autoComplete="new-password"
                  required
                  value={konfirmasiSandi}
                  onChange={(e) => setKonfirmasiSandi(e.target.value)}
                  placeholder="Ulangi kata sandi"
                  className="form-input"
                  style={{ paddingLeft: "2.4rem" }}
                />
              </div>
            </label>
          )}

          <button
            type="submit"
            className="btn-primary"
            disabled={submitting}
            style={{
              padding: "0.75rem 1.25rem",
              fontSize: "0.9rem",
              opacity: submitting ? 0.6 : 1,
            }}
          >
            {submitting
              ? "Memproses..."
              : isRegister
                ? "Daftar Akun"
                : "Masuk ke Akun"}
            <ArrowRight size={16} />
          </button>
        </form>
        <p
          style={{
            margin: "1.25rem 0 0",
            textAlign: "center",
            fontSize: "0.85rem",
            color: "var(--text-muted)",
          }}
        >
          {isRegister ? "Sudah memiliki akun?" : "Belum memiliki akun?"}{" "}
          <button
            type="button"
            onClick={() => {
              setIsRegister(!isRegister);
              setError("");
            }}
            style={{
              border: 0,
              background: "transparent",
              color: "var(--primary)",
              fontWeight: 700,
              cursor: "pointer",
              padding: 0,
            }}
          >
            {isRegister ? "Masuk" : "Daftar"}
          </button>
        </p>
      </div>
      <FeedbackModal
        open={!!error}
        message={error}
        onClose={() => setError("")}
      />
    </div>
  );
}
