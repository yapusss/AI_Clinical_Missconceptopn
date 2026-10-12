"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { BrainCircuit, Building2, Check, ChevronDown, Palette, ShieldCheck, Sun } from "lucide-react";

import { useAuth } from "../components/AuthProvider";
import { apiFetch } from "../lib/api";
import ThemeToggle from "../components/ThemeToggle";
import PageContainer from "../components/PageContainer";
import PageHeader from "../components/PageHeader";
import FeedbackModal from "../components/FeedbackModal";

type SubjectSummary = { slug: string; name: string };
type AiModel = { identifier: string; display_name: string; provider: string };
type AiSettings = { active_model_identifier: string; models: AiModel[] };

function SectionCard({
  icon: Icon,
  title,
  desc,
  children,
}: {
  icon: typeof ShieldCheck;
  title: string;
  desc: string;
  children: ReactNode;
}) {
  return (
    <section className="glass-card" style={{ padding: "1.25rem", borderRadius: "var(--radius-lg)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "0.25rem" }}>
        <div style={{ width: "36px", height: "36px", borderRadius: "var(--radius-sm)", display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(99, 102, 241, 0.15)", color: "var(--primary)" }}>
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
  const [aiSettings, setAiSettings] = useState<AiSettings | null>(null);
  const [selectedModel, setSelectedModel] = useState("");
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const isAdmin = user?.is_superuser === true;
  const modelMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!loading && (!user || !token)) {
      router.replace("/login");
      return;
    }
    if (!user || !token) return;

    apiFetch<{ summary: { my_subjects?: SubjectSummary[] } }>("/dashboard/summary")
      .then((data) => setSubjects(data?.summary?.my_subjects ?? []))
      .catch(() => {});

    if (user.is_superuser) {
      apiFetch<AiSettings>("/admin/ai/settings")
        .then((data) => {
          setAiSettings(data);
          setSelectedModel(data.active_model_identifier);
        })
        .catch((err: Error) => setError(err.message));
    }
  }, [user, token, loading, router]);

  useEffect(() => {
    function closeMenu(event: MouseEvent) {
      if (!modelMenuRef.current?.contains(event.target as Node)) setModelMenuOpen(false);
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setModelMenuOpen(false);
    }
    document.addEventListener("mousedown", closeMenu);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeMenu);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, []);

  async function activateModel() {
    if (!selectedModel) return;
    setAiLoading(true);
    setError("");
    setNotice("");
    try {
      const data = await apiFetch<{ active_model_identifier: string }>("/admin/ai/settings", {
        method: "PATCH",
        body: JSON.stringify({ identifier: selectedModel }),
      });
      setAiSettings((current) => current && { ...current, active_model_identifier: data.active_model_identifier });
      setNotice("Model aktif diperbarui. Analisis baru akan memakai model ini.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Model tidak dapat diperbarui.");
    } finally {
      setAiLoading(false);
    }
  }

  async function testModel() {
    if (!selectedModel) return;
    setAiLoading(true);
    setError("");
    setNotice("");
    try {
      const data = await apiFetch<{ detail: string }>("/admin/ai/test", {
        method: "POST",
        body: JSON.stringify({ identifier: selectedModel }),
      });
      setNotice(data.detail);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Koneksi model gagal.");
    } finally {
      setAiLoading(false);
    }
  }

  return (
    <PageContainer>
      <PageHeader className="mb-6" title="Settings" description="Informasi akun dan preferensi tampilan aplikasi." icon={ShieldCheck} />

      {notice && <p role="status" style={{ margin: "0 0 1.25rem", color: "var(--success, #16a34a)", fontSize: "0.85rem" }}>{notice}</p>}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))", gap: "20px" }}>
        <SectionCard icon={ShieldCheck} title="Akun" desc="Informasi identitas akun Anda.">
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px", fontSize: "0.85rem" }}>
            <span style={{ color: "var(--text-muted)" }}>Nama</span><strong>{user?.full_name}</strong>
            <span style={{ color: "var(--text-muted)" }}>Email</span><strong>{user?.email}</strong>
          </div>
        </SectionCard>

        <SectionCard icon={Palette} title="Tampilan" desc="Mode warna aplikasi.">
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", padding: "0.75rem 0.9rem", borderRadius: "var(--radius-sm)", background: "var(--input-bg)", border: "1px solid var(--border-color)" }}>
            <div>
              <p style={{ fontSize: "0.85rem", fontWeight: 600, color: "var(--text-main)", margin: 0 }}><Sun size={14} style={{ marginRight: "6px", verticalAlign: "middle", color: "var(--primary)" }} />Mode Gelap / Terang</p>
              <p style={{ fontSize: "0.75rem", color: "var(--text-muted)", margin: "0.2rem 0 0" }}>Beralih antara tema gelap dan terang.</p>
            </div>
            <ThemeToggle />
          </div>
        </SectionCard>

        <SectionCard icon={Building2} title="Mata Kuliah" desc="Mata kuliah yang Anda akses.">
          {subjects.length ? <ul style={{ margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: "8px", listStyle: "none" }}>
            {subjects.map((subject) => <li key={subject.slug} style={{ padding: "0.6rem 0.9rem", borderRadius: "var(--radius-sm)", background: "var(--input-bg)", border: "1px solid var(--border-color)", fontSize: "0.85rem", fontWeight: 600 }}>{subject.name}</li>)}
          </ul> : <p style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>Belum ada mata kuliah terdaftar.</p>}
        </SectionCard>

        {isAdmin && <SectionCard icon={BrainCircuit} title="Analisis AI" desc="Model yang dipakai untuk analisis baru.">
          <label style={{ display: "block", fontSize: "0.8rem", fontWeight: 600, marginBottom: "6px" }} htmlFor="ai-model">Model disetujui</label>
          <div ref={modelMenuRef} style={{ position: "relative" }}>
            <button
              id="ai-model"
              type="button"
              className="form-select"
              aria-haspopup="listbox"
              aria-expanded={modelMenuOpen}
              aria-controls="ai-model-options"
              disabled={aiLoading || !aiSettings}
              onClick={() => setModelMenuOpen((open) => !open)}
              style={{ display: "flex", alignItems: "center", justifyContent: "space-between", textAlign: "left", cursor: "pointer" }}
            >
              <span>{aiSettings?.models.find((model) => model.identifier === selectedModel)?.display_name ?? "Pilih model"}</span>
              <ChevronDown size={18} aria-hidden="true" style={{ color: "var(--text-muted)", transform: modelMenuOpen ? "rotate(180deg)" : undefined, transition: "transform 0.15s ease" }} />
            </button>
            {modelMenuOpen && <div id="ai-model-options" role="listbox" aria-labelledby="ai-model" style={{ position: "absolute", zIndex: 10, top: "calc(100% + 6px)", left: 0, right: 0, overflow: "hidden", border: "1px solid var(--input-border)", borderRadius: "var(--radius-sm)", background: "var(--bg-card)", boxShadow: "0 12px 28px rgba(0, 0, 0, 0.28)" }}>
              {aiSettings?.models.map((model) => {
                const selected = model.identifier === selectedModel;
                return <button key={model.identifier} type="button" role="option" aria-selected={selected} onClick={() => { setSelectedModel(model.identifier); setModelMenuOpen(false); }} style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", padding: "0.75rem 1rem", border: "none", borderBottom: "1px solid var(--border-color)", background: selected ? "rgba(99, 102, 241, 0.16)" : "transparent", color: "var(--text-main)", cursor: "pointer", fontSize: "0.9rem", fontWeight: selected ? 600 : 400, textAlign: "left" }}>
                  <span>{model.display_name} <span style={{ color: "var(--text-muted)", fontSize: "0.78rem" }}>({model.provider})</span></span>
                  {selected && <Check size={17} style={{ color: "var(--primary)", flexShrink: 0 }} />}
                </button>;
              })}
            </div>}
          </div>
          <p style={{ fontSize: "0.75rem", color: "var(--text-muted)", margin: "0.65rem 0" }}>Perubahan hanya berlaku untuk analisis baru. Kunci dan koneksi AI tetap dikelola melalui deployment.</p>
          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
            <button type="button" className="btn-secondary" onClick={testModel} disabled={aiLoading || !selectedModel}>Uji Koneksi</button>
            <button type="button" className="btn-primary" onClick={activateModel} disabled={aiLoading || !selectedModel || selectedModel === aiSettings?.active_model_identifier}>{aiLoading ? "Memproses..." : "Jadikan Aktif"}</button>
          </div>
        </SectionCard>}
      </div>
      <FeedbackModal open={!!error} message={error} onClose={() => setError("")} />
    </PageContainer>
  );
}
