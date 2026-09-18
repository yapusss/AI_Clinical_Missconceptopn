"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { useAuth } from "../components/AuthProvider";
import { Icon } from "../components/Icon";

export default function LoginPage() {
  const { login } = useAuth();
  const router = useRouter();
  const [identitas, setIdentitas] = useState("");
  const [kataSandi, setKataSandi] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      await login(identitas, kataSandi);
      router.push("/select-role");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="relative flex min-h-screen flex-col justify-between overflow-x-hidden bg-gradient-to-b from-white via-[#F0F7FF] to-[#E6F0FA] font-body text-on-surface antialiased">
      {/* Architectural background grid & ambient tints */}
      <div className="pointer-events-none fixed inset-0 z-0 grid-pattern" aria-hidden />
      <div className="pointer-events-none fixed -top-40 -left-40 z-0 h-96 w-96 rounded-full bg-primary-fixed-dim/30 blur-3xl" aria-hidden />
      <div className="pointer-events-none fixed top-1/3 -right-32 z-0 h-80 w-80 rounded-full bg-surface-container-highest/60 blur-3xl" aria-hidden />

      {/* Academic header anchor */}
      <header className="relative z-10 mx-auto flex w-full max-w-[1680px] items-center justify-between px-6 py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-outline-variant/40 bg-surface-container-lowest text-primary shadow-sm">
            <Icon name="school" className="h-6 w-6" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-display text-lg font-bold tracking-tight text-primary">
                EvalAI Academic
              </span>
            </div>
            <p className="font-body text-xs text-on-surface-variant">
              Universites - AI Clinical Missconception
            </p>
          </div>
        </div>

        <div className="hidden items-center gap-4 text-on-surface-variant sm:flex">
          <div className="flex items-center gap-2 rounded-lg border border-outline-variant/30 bg-surface-container-lowest/80 px-3 py-1.5 shadow-xs backdrop-blur-sm">
            <span className="h-2 w-2 animate-pulse rounded-full bg-tertiary-fixed-dim" />
            <span className="text-xs font-medium text-on-surface">Server Akademik Normal</span>
          </div>
          <a
            href="#bantuan"
            className="flex items-center gap-1.5 py-1 text-on-surface-variant transition-colors hover:text-primary"
          >
            <Icon name="help" className="h-[18px] w-[18px]" />
            <span>Bantuan &amp; FAQ</span>
          </a>
        </div>
      </header>

      {/* Main centered glassmorphic pane */}
      <div className="relative z-10 flex flex-1 flex-col items-center justify-center px-4 py-8 sm:py-12">
        <div className="w-full max-w-[480px]">
          <div className="glass-tier-2 rounded-xl p-8 transition-all duration-200 sm:p-10">
            <div className="mb-8 text-center sm:text-left">
              <div className="mb-3 inline-flex items-center gap-1.5 rounded-md border border-primary-fixed-dim bg-primary-fixed/50 px-2.5 py-1 text-primary">
                <Icon name="verified_user" className="h-[15px] w-[15px]" />
                <span className="text-xs font-semibold">Autentikasi Civitas Academica</span>
              </div>
              <h1 className="font-display text-2xl font-bold tracking-tight text-on-surface">
                Masuk ke Portal
              </h1>
              <p className="mt-1.5 text-sm text-on-surface-variant">
                Gunakan kredensial resmi Universitas Terbuka untuk mengakses lembar
                evaluasi dan ujian.
              </p>
            </div>

            <form onSubmit={onSubmit} className="space-y-5">
              <div className="space-y-1.5">
                <label
                  htmlFor="identitas"
                  className="block text-sm font-medium text-on-surface"
                >
                  Username
                </label>
                <div className="relative">
                  <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3.5 text-outline">
                    <Icon name="badge" className="h-5 w-5" />
                  </div>
                  <input
                    id="identitas"
                    name="identitas"
                    type="email"
                    autoComplete="username"
                    required
                    value={identitas}
                    onChange={(e) => setIdentitas(e.target.value)}
                    placeholder="Contoh: 041234567 atau dosen@ut.ac.id"
                    className="w-full rounded-lg border border-[#CBD5E1] bg-surface-container-lowest py-2.5 pl-10 pr-3.5 text-on-surface outline-none transition-all duration-150 placeholder:text-outline/70 focus:border-primary-container focus:ring-2 focus:ring-primary-container/20"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label
                    htmlFor="kata_sandi"
                    className="block text-sm font-medium text-on-surface"
                  >
                    Kata Sandi
                  </label>
                  <a
                    href="#lupa-sandi"
                    className="text-xs font-semibold text-primary-container transition-colors hover:text-primary hover:underline"
                  >
                    Lupa Kata Sandi?
                  </a>
                </div>
                <div className="relative">
                  <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3.5 text-outline">
                    <Icon name="lock" className="h-5 w-5" />
                  </div>
                  <input
                    id="kata_sandi"
                    name="kata_sandi"
                    type={showPassword ? "text" : "password"}
                    autoComplete="current-password"
                    required
                    value={kataSandi}
                    onChange={(e) => setKataSandi(e.target.value)}
                    placeholder="Masukkan kata sandi akun Anda"
                    className="w-full rounded-lg border border-[#CBD5E1] bg-surface-container-lowest py-2.5 pl-10 pr-10 text-on-surface outline-none transition-all duration-150 placeholder:text-outline/70 focus:border-primary-container focus:ring-2 focus:ring-primary-container/20"
                  />
                  <button
                    type="button"
                    aria-label="Tampilkan atau sembunyikan kata sandi"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute inset-y-0 right-0 flex items-center pr-3 text-outline outline-none hover:text-on-surface"
                  >
                    <Icon
                      name={showPassword ? "visibility_off" : "visibility"}
                      className="h-5 w-5"
                    />
                  </button>
                </div>
              </div>

              <div className="flex items-center justify-between pt-1">
                <label className="flex cursor-pointer select-none items-center gap-2.5">
                  <input
                    type="checkbox"
                    defaultChecked
                    className="h-4 w-4 cursor-pointer rounded border border-[#CBD5E1] bg-surface-container-lowest text-primary-container focus:ring-primary-container/30"
                  />
                  <span className="text-xs font-normal text-on-surface-variant">
                    Ingat saya di perangkat ini
                  </span>
                </label>
              </div>

              {error && (
                <div
                  role="alert"
                  className="rounded-lg border border-error/40 bg-error-container px-3.5 py-2.5 text-sm text-on-error-container"
                >
                  {error}
                </div>
              )}

              <div className="pt-2">
                <button
                  type="submit"
                  disabled={submitting}
                  className="group flex w-full items-center justify-center gap-2 rounded-lg bg-primary-container px-4 py-2.5 text-sm font-semibold text-on-primary shadow-sm transition-all duration-150 hover:bg-blue-700 active:scale-[0.99] disabled:opacity-60"
                >
                  <span>{submitting ? "Pangatut..." : "Masuk ke Akun"}</span>
                  <Icon
                    name="arrow_forward"
                    className="h-[18px] w-[18px] transition-transform group-hover:translate-x-0.5"
                  />
                </button>
              </div>
            </form>

            <div className="relative my-6 flex items-center justify-center">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-outline-variant/40" />
              </div>
              <span className="relative bg-surface-container-lowest/90 px-3 font-mono-ui text-[11px] uppercase tracking-wider text-outline">
                Akses Khusus Ujian
              </span>
            </div>

            <div className="glass-tier-1 rounded-lg border border-outline-variant/40 p-3.5 transition-all hover:border-primary-fixed-dim">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="flex h-8 w-8 items-center justify-center rounded bg-surface-container-high text-primary">
                    <Icon name="key" className="h-[18px] w-[18px]" />
                  </div>
                  <div>
                    <h4 className="text-sm font-semibold text-on-surface">
                      Peserta Ujian Daring?
                    </h4>
                    <p className="text-xs text-on-surface-variant">
                      Langsung menuju ruang uji tanpa login penuh
                    </p>
                  </div>
                </div>
                <a
                  href="#token-cbt"
                  className="inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs font-semibold text-primary transition-colors hover:bg-surface-container hover:text-primary-container"
                >
                  <span>Token CBT</span>
                  <Icon name="chevron_right" className="h-4 w-4" />
                </a>
              </div>
            </div>
          </div>

          <div className="mt-6 flex flex-col items-center space-y-2 text-center">
            <div className="inline-flex items-center gap-2 text-xs text-on-surface-variant">
              <Icon name="lock" className="h-4 w-4 text-tertiary-container" />
              <span>Koneksi Terenkripsi TLS 1.3 End-to-End • Sertifikasi ISO 27001</span>
            </div>
            </div>
        </div>
      </div>

      {/* Academic footer */}
      <footer className="relative z-10 mx-auto flex w-full max-w-[1680px] flex-col items-center justify-between gap-3 border-t border-outline-variant/30 px-6 py-4 text-xs text-on-surface-variant sm:flex-row">
        <span>© 2025 Universitas Terbuka. Seluruh hak cipta dilindungi.</span>
        <div className="flex items-center gap-6">
          <a href="#panduan" className="transition-colors hover:text-primary">
            Panduan Registrasi
          </a>
          <a href="#kebijakan" className="transition-colors hover:text-primary">
            Kebijakan Privasi
          </a>
          <a href="#status" className="flex items-center gap-1 transition-colors hover:text-primary">
            <Icon name="verified_user" className="h-4 w-4" />
            <span>Pusat Integritas</span>
          </a>
        </div>
      </footer>
    </main>
  );
}