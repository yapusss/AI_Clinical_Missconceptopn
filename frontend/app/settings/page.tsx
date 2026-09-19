"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Bell,
  Building2,
  CircleCheck,
  KeyRound,
  Moon,
  Palette,
  Save,
  ShieldCheck,
  Sun,
} from "lucide-react";

import { useAuth } from "../components/AuthProvider";
import { apiFetch } from "../lib/api";
import ThemeToggle from "../components/ThemeToggle";

type SubjectSummary = { slug: string; name: string };
type NotifSettings = { submissionAlerts: boolean; emailDigest: boolean; marketing: boolean };
type SystemSettings = { registrationOpen: boolean; requireValidation: boolean; autoPublish: boolean };

const DEFAULT_SETTINGS = {
  notifications: { submissionAlerts: true, emailDigest: false, marketing: false },
  system: { registrationOpen: true, requireValidation: false, autoPublish: false },
};

function loadPrefs(): { notifications: NotifSettings; system: SystemSettings } {
  try {
    const raw = localStorage.getItem("app_settings");
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<{ notifications: NotifSettings; system: SystemSettings }>;
    return {
      notifications: { ...DEFAULT_SETTINGS.notifications, ...(parsed.notifications ?? {}) },
      system: { ...DEFAULT_SETTINGS.system, ...(parsed.system ?? {}) },
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function Switch({
  checked,
  onChange,
  label,
  desc,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  desc: string;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "12px",
        padding: "0.75rem 0.9rem",
        borderRadius: "var(--radius-sm)",
        background: "var(--input-bg)",
        border: "1px solid var(--border-color)",
      }}
    >
      <div style={{ minWidth: 0 }}>
        <p style={{ fontSize: "0.85rem", fontWeight: 600, color: "var(--text-main)", margin: 0 }}>{label}</p>
        <p style={{ fontSize: "0.75rem", color: "var(--text-muted)", margin: "0.2rem 0 0" }}>{desc}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        style={{
          appearance: "none",
          width: "44px",
          height: "24px",
          borderRadius: "9999px",
          background: checked ? "var(--primary)" : "var(--input-border)",
          border: "none",
          cursor: "pointer",
          flexShrink: 0,
          position: "relative",
          transition: "background 0.2s ease",
        }}
      >
        <span
          style={{
            position: "absolute",
            top: "3px",
            left: checked ? "23px" : "3px",
            width: "18px",
            height: "18px",
            borderRadius: "50%",
            background: "#ffffff",
            transition: "left 0.2s cubic-bezier(0.4, 0, 0.2, 1)",
          }}
        />
      </button>
    </div>
  );
}

function SectionCard({
  icon,
  title,
  desc,
  children,
}: {
  icon: typeof ShieldCheck;
  title: string;
  desc: string;
  children: React.ReactNode;
}) {
  const Icon = icon;
  return (
    <section
      className="glass-card"
      style={{ padding: "1.25rem", borderRadius: "var(--radius-lg)" }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "0.25rem" }}>
        <div
          style={{
            width: "36px",
            height: "36px",
            borderRadius: "var(--radius-sm)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "rgba(99, 102, 241, 0.15)",
            color: "var(--primary)",
          }}
        >
          <Icon size={19} />
        </div>
        <div>
          <h2 style={{ fontSize: "1rem", fontWeight: 700, margin: 0 }}>{title}</h2>
          <p style={{ fontSize: "0.78rem", color: "var(--text-muted)", margin: "0.15rem 0 0" }}>{desc}</p>
        </div>
      </div>
      <div style={{ marginTop: "0.9rem" }}>{children}</div>
    </section>
  );
}

export default function SettingsPage() {
  const { user, token, loading } = useAuth();
  const router = useRouter();
  const [subjects, setSubjects] = useState<SubjectSummary[]>([]);
  // Loaded in an effect (not during render) so the server and first client render agree.
  const [notifications, setNotifications] = useState<NotifSettings>(DEFAULT_SETTINGS.notifications);
  const [system, setSystem] = useState<SystemSettings>(DEFAULT_SETTINGS.system);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!loading && (!user || !token)) {
      router.replace("/login");
      return;
    }
    if (!user || !token) return;
    apiFetch<{ summary: { my_subjects?: SubjectSummary[] } }>("/dashboard/summary")
      .then((d) => {
        const subs = d?.summary?.my_subjects ?? [];
        setSubjects(subs);
      })
      .catch(() => {});
  }, [user, token, loading, router]);

  function persistNotifications(next: NotifSettings) {
    setNotifications(next);
    const prefs = loadPrefs();
    localStorage.setItem("app_settings", JSON.stringify({ ...prefs, notifications: next }));
  }

  function persistSystem(next: SystemSettings) {
    setSystem(next);
    const prefs = loadPrefs();
    localStorage.setItem("app_settings", JSON.stringify({ ...prefs, system: next }));
  }

  function handlePasswordChange(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setNotice("");
    if (password.length < 8) {
      setError("Kata sandi minimal 8 karakter.");
      return;
    }
    if (password !== confirmPassword) {
      setError("Konfirmasi kata sandi tidak matc.");
      return;
    }
    setPassword("");
    setConfirmPassword("");
    setNotice("Perubahan kata sandi akan tersedia di fase berikutnya.");
  }

  return (
    <div style={{ maxWidth: "960px", margin: "0 auto" }}>
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
          <ShieldCheck size={26} />
        </div>
        <div>
          <h1 style={{ fontSize: "1.6rem", fontWeight: 800, margin: 0 }}>Settings</h1>
          <p style={{ fontSize: "0.9rem", color: "var(--text-muted)", margin: "0.2rem 0 0" }}>
            Konfigurasi akun, tampilan, notifikasi dan sistem.
          </p>
        </div>
      </header>

      {notice && (
        <div role="status" style={{ borderRadius: "var(--radius-sm)", border: "1px solid rgba(99, 102, 241, 0.25)", background: "rgba(99, 102, 241, 0.1)", color: "var(--text-muted)", fontSize: "0.85rem", padding: "0.7rem 1rem", marginBottom: "1.25rem" }}>
          <CircleCheck size={16} style={{ marginRight: "8px", verticalAlign: "middle" }} />
          {notice}
        </div>
      )}

      {error && (
        <div role="alert" style={{ borderRadius: "var(--radius-sm)", border: "1px solid rgba(239, 68, 68, 0.3)", background: "rgba(239, 68, 68, 0.12)", color: "#f87171", fontSize: "0.85rem", padding: "0.7rem 1rem", marginBottom: "1.25rem" }}>
          {error}
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))", gap: "20px" }}>
        <SectionCard icon={KeyRound} title="Akun & Keamanan" desc="Informasi identitas dan kata sandi.">
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
            <p style={{ fontSize: "0.75rem", color: "var(--text-muted)", margin: 0 }}>Nama</p>
            <p style={{ fontSize: "0.85rem", fontWeight: 600, color: "var(--text-main)", margin: 0 }}>{user?.full_name}</p>
            <p style={{ fontSize: "0.75rem", color: "var(--text-muted)", margin: 0 }}>Email</p>
            <p style={{ fontSize: "0.85rem", fontWeight: 600, color: "var(--text-main)", margin: 0 }}>{user?.email}</p>
          </div>
          <form
            onSubmit={handlePasswordChange}
            style={{ display: "flex", flexDirection: "column", gap: "10px", marginTop: "1rem" }}
          >
            <input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Kata sandi baru" className="form-input" />
            <input type="password" required value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} placeholder="Konfirmasi kata sandi" className="form-input" />
            <button type="submit" className="btn-secondary" style={{ justifyContent: "flex-start", padding: "0.6rem 0.9rem" }}>
              <Save size={16} color="var(--primary)" />
              Perbarui Kata Sandi
            </button>
          </form>
        </SectionCard>

        <SectionCard icon={Palette} title="Tampilan" desc="Mode kolor dan tampilan aplikasi.">
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "0.75rem 0.9rem",
              borderRadius: "var(--radius-sm)",
              background: "var(--input-bg)",
              border: "1px solid var(--border-color)",
            }}
          >
            <div>
              <p style={{ fontSize: "0.85rem", fontWeight: 600, color: "var(--text-main)", margin: 0 }}>
                <Sun size={14} style={{ marginRight: "6px", verticalAlign: "middle", color: "var(--primary)" }} />
                Mode Gelap / Terang
              </p>
              <p style={{ fontSize: "0.75rem", color: "var(--text-muted)", margin: "0.2rem 0 0" }}>
                Beralih antara tema gelap dan terang.
              </p>
            </div>
            <ThemeToggle />
          </div>
          <p style={{ fontSize: "0.78rem", color: "var(--text-muted)", marginTop: "0.9rem" }}>
            <Moon size={14} style={{ marginRight: "6px", verticalAlign: "middle", color: "var(--primary)" }} />
            Preferensi tema disimpan lokalis dan aktif untuk seluruh halaman.
          </p>
        </SectionCard>

        <SectionCard icon={Bell} title="Notifikasi" desc="Kontrol peransman alert dan laporan.">
          <Switch
            checked={notifications.submissionAlerts}
            onChange={(next) => persistNotifications({ ...notifications, submissionAlerts: next })}
            label="Alert pengumpulan"
            desc="Notifikasi wanneer mahasiswa indient een pengumpulan."
          />
          <Switch
            checked={notifications.emailDigest}
            onChange={(next) => persistNotifications({ ...notifications, emailDigest: next })}
            label="Digest email"
            desc="Ringkasan aktivitas periodek via email."
          />
          <Switch
            checked={notifications.marketing}
            onChange={(next) => persistNotifications({ ...notifications, marketing: next })}
            label="Update produk"
            desc="Berita functie en aankondiging platform."
          />
        </SectionCard>

        <SectionCard icon={Building2} title="Mata Kuliah" desc="Mata kuliah yang terdireksi op platform.">
          {subjects.length > 0 ? (
            <ul style={{ margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: "8px", listStyle: "none" }}>
              {subjects.map((s) => (
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
                  <span style={{ fontSize: "0.85rem", fontWeight: 600, color: "var(--text-main)" }}>{s.name}</span>
                  <span className="badge badge-active">Aktif</span>
                </li>
              ))}
            </ul>
          ) : (
            <p style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>Belum ada mata kuliah geregistreerd.</p>
          )}
        </SectionCard>

        <SectionCard icon={ShieldCheck} title="Sistem" desc="Peransman konfigurasi platform.">
          <Switch
            checked={system.registrationOpen}
            onChange={(next) => persistSystem({ ...system, registrationOpen: next })}
            label="Registrasi buka"
            desc="Laat nieuwe akun zich registreren."
          />
          <Switch
            checked={system.requireValidation}
            onChange={(next) => persistSystem({ ...system, requireValidation: next })}
            label="Validasi verplicht"
            desc="Verplicht validasi dosen voordat score definitief."
          />
          <Switch
            checked={system.autoPublish}
            onChange={(next) => persistSystem({ ...system, autoPublish: next })}
            label="Auto-publikasi"
            desc="Publikasi soal langsung wanneer bobot exact."
          />
        </SectionCard>
      </div>
    </div>
  );
}