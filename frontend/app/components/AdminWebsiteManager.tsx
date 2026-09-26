"use client";

import { useEffect, useState } from "react";
import PageContainer from "./PageContainer";

type ContentItem = { title: string; body: string };

type WebsiteSection = {
  id: string; key: string; title: string; eyebrow: string; body: string; image_url: string;
  button_label: string; button_url: string; content_json: ContentItem[]; order_index: number; is_visible: boolean;
};

const DEFAULTS: Record<string, Omit<WebsiteSection, "id">> = {
  hero: { key: "hero", eyebrow: "Evaluasi konseptual berbantuan AI", title: "Temukan miskonsepsi sebelum menjadi kebiasaan belajar.", body: "EvalAI Academic membantu pengajar memahami jawaban mahasiswa lebih dalam, dari evaluasi berbasis kode hingga validasi hasil analisis AI.", image_url: "", button_label: "", button_url: "", content_json: [], order_index: 1, is_visible: true },
  features: { key: "features", eyebrow: "Dirancang untuk evaluasi bermakna", title: "Dari jawaban mentah menjadi keputusan pembelajaran.", body: "Satu sistem untuk mempersiapkan evaluasi, memahami jawaban, dan menjaga keputusan akademik tetap berada di tangan pengajar.", image_url: "", button_label: "", button_url: "", content_json: [{ title: "Ujian berbasis kode", body: "Mahasiswa masuk ke evaluasi melalui satu kode paket tanpa penugasan mata kuliah yang rumit." }, { title: "Analisis miskonsepsi AI", body: "Jawaban uraian dianalisis untuk menemukan tingkat pemahaman dan potensi miskonsepsi konsep." }, { title: "Validasi dosen", body: "Hasil AI tetap berada dalam kendali pengajar: tinjau, terima, atau koreksi sebelum final." }, { title: "Import bank soal", body: "Percepat persiapan evaluasi dengan import soal dan validasi data sebelum digunakan." }], order_index: 2, is_visible: true },
  workflow: { key: "workflow", eyebrow: "Alur yang jelas", title: "Evaluasi yang tetap manusiawi, meski dibantu AI.", body: "AI mempercepat pembacaan pola. Dosen tetap menjadi pengambil keputusan atas hasil evaluasi.", image_url: "", button_label: "", button_url: "", content_json: [{ title: "Buat paket", body: "Dosen menyusun pertanyaan konseptual atau mengimpor bank soal." }, { title: "Bagikan kode", body: "Mahasiswa memasukkan kode paket untuk memulai evaluasi." }, { title: "Analisis jawaban", body: "AI memetakan pemahaman dan indikasi miskonsepsi dari jawaban uraian." }, { title: "Validasi hasil", body: "Dosen menyetujui atau menyempurnakan hasil sebelum digunakan sebagai evaluasi." }], order_index: 3, is_visible: true },
  roles: { key: "roles", eyebrow: "Satu sistem, tiga peran", title: "Buat evaluasi konseptual lebih mudah ditelusuri dan lebih siap ditindaklanjuti.", body: "", image_url: "", button_label: "", button_url: "", content_json: [{ title: "Admin", body: "Memantau operasi dan menjaga sistem tetap siap." }, { title: "Dosen", body: "Menyusun paket serta memvalidasi pemahaman." }, { title: "Mahasiswa", body: "Mengerjakan evaluasi cukup dengan kode paket." }], order_index: 4, is_visible: true },
};

export default function AdminWebsiteManager({ token }: { token: string }) {
  const [sections, setSections] = useState<WebsiteSection[]>([]);
  const [saved, setSaved] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const headers = { "Content-Type": "application/json", Authorization: `Bearer ${token}` };

  async function load() {
    const response = await fetch("/api/admin/website/sections", { headers: { Authorization: `Bearer ${token}` } });
    if (!response.ok) throw new Error("Gagal memuat konfigurasi website.");
    const data = await response.json() as WebsiteSection[];
    setSections(Object.keys(DEFAULTS).map((key) => { const saved = data.find((section) => section.key === key); return { id: saved?.id ?? "", ...DEFAULTS[key], ...saved, content_json: saved?.content_json?.length ? saved.content_json : DEFAULTS[key].content_json }; }));
    setSaved(true);
  }
  useEffect(() => { void load().catch((error: Error) => setMessage(error.message)); }, [token]);

  function update(key: string, field: keyof WebsiteSection, value: string | boolean | number | ContentItem[]) {
    setSections((current) => current.map((section) => section.key === key ? { ...section, [field]: value } : section));
    setSaved(false);
  }
  function loadDefaults() {
    setSections((current) => current.map((section) => ({ id: section.id, ...DEFAULTS[section.key] })));
    setSaved(false);
    setMessage("Nilai default dimuat. Tekan Simpan untuk menerapkannya.");
  }
  async function save() {
    setBusy(true); setMessage("");
    try {
      await Promise.all(sections.map(async (section) => {
        const response = await fetch(`/api/admin/website/sections/${section.id}`, { method: "PATCH", headers, body: JSON.stringify(section) });
        if (!response.ok) { const data = await response.json().catch(() => ({})); throw new Error(data.detail ?? "Gagal menyimpan konfigurasi."); }
      }));
      setSaved(true); setMessage("Konfigurasi landing page disimpan.");
      await load();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Gagal menyimpan konfigurasi."); }
    finally { setBusy(false); }
  }

  return <PageContainer>
    <div className="rounded-3xl border border-outline-variant/40 bg-surface-container-lowest p-6 shadow-sm sm:p-8">
      <div className="flex flex-col gap-5 border-b border-outline-variant/40 pb-5 sm:flex-row sm:items-start sm:justify-between"><div><p className="text-sm font-bold uppercase tracking-[.16em] text-primary">Landing Page Publik</p><p className="mt-2 text-sm text-on-surface-variant">{saved ? "Terakhir diperbarui: konfigurasi tersimpan" : "Terdapat perubahan yang belum disimpan"}</p></div><div className="flex gap-3"><button type="button" className="btn-secondary" onClick={loadDefaults}>Muat Default</button><button type="button" className="btn-primary" onClick={() => void save()} disabled={busy}>{busy ? "Menyimpan..." : "Simpan"}</button></div></div>
      {message && <p role="status" className="mt-4 text-sm font-medium text-primary">{message}</p>}
      <div className="mt-6 space-y-6"><SectionForm title="Hero Utama" section={sections.find((section) => section.key === "hero")} onChange={update} fields={["eyebrow", "title", "body", "image_url", "button_label", "button_url"]} /><SectionForm title="Section Fitur" section={sections.find((section) => section.key === "features")} onChange={update} fields={["eyebrow", "title", "body", "image_url"]} /><ContentEditor section={sections.find((section) => section.key === "features")} label="Konten kartu fitur" onChange={update} /><SectionForm title="Alur Evaluasi" section={sections.find((section) => section.key === "workflow")} onChange={update} fields={["eyebrow", "title", "body", "image_url"]} /><ContentEditor section={sections.find((section) => section.key === "workflow")} label="Konten langkah alur" onChange={update} numbered /><SectionForm title="Section Peran" section={sections.find((section) => section.key === "roles")} onChange={update} fields={["eyebrow", "title", "image_url", "button_label", "button_url"]} /><ContentEditor section={sections.find((section) => section.key === "roles")} label="Konten kartu peran" onChange={update} /></div>
    </div>
  </PageContainer>;
}

function SectionForm({ title, section, onChange, fields }: { title: string; section?: WebsiteSection; onChange: (key: string, field: keyof WebsiteSection, value: string | boolean | number) => void; fields: Array<"eyebrow" | "title" | "body" | "image_url" | "button_label" | "button_url"> }) {
  if (!section) return null;
  const labels = { eyebrow: "Label kecil", title: "Judul section", body: "Deskripsi", image_url: "URL gambar", button_label: "Label tombol", button_url: "Tautan tombol" };
  return <section className="rounded-3xl border border-primary/20 bg-surface-container-low p-5 sm:p-6"><div className="mb-5 flex flex-col gap-3 border-b border-outline-variant/30 pb-4 sm:flex-row sm:items-center sm:justify-between"><h2 className="font-display text-lg font-extrabold text-on-surface">{title}</h2><label className="flex items-center gap-2 text-sm font-semibold text-on-surface-variant"><input type="checkbox" checked={section.is_visible} onChange={(event) => onChange(section.key, "is_visible", event.target.checked)} /> Tampilkan section</label></div><div className="grid gap-x-5 gap-y-4 md:grid-cols-2">{fields.map((field) => <div key={field} className={field === "body" ? "md:col-span-2" : ""}><label className="mb-2 block text-xs font-bold uppercase tracking-[.14em] text-on-surface-variant">{labels[field]}</label>{field === "body" ? <textarea className="form-input min-h-28" value={section[field]} onChange={(event) => onChange(section.key, field, event.target.value)} /> : <input className="form-input" type={field === "image_url" ? "url" : "text"} value={section[field]} placeholder={field === "image_url" ? "https://..." : undefined} onChange={(event) => onChange(section.key, field, event.target.value)} />}</div>)}</div>{section.image_url && <div className="mt-5 overflow-hidden rounded-xl border border-outline-variant/40 bg-surface-container-lowest"><img src={section.image_url} alt={`Pratinjau ${title}`} className="h-32 w-full object-cover" /></div>}</section>;
}

function ContentEditor({ section, label, onChange, numbered = false }: { section?: WebsiteSection; label: string; onChange: (key: string, field: keyof WebsiteSection, value: string | boolean | number | ContentItem[]) => void; numbered?: boolean }) {
  if (!section) return null;
  return <section className="rounded-3xl border border-primary/20 bg-surface-container-low p-5 sm:p-6"><h3 className="text-xs font-bold uppercase tracking-[.14em] text-on-surface-variant">{label}</h3><div className="mt-4 grid gap-4 md:grid-cols-2">{section.content_json.map((item, index) => <div key={`${section.key}-${index}`} className="rounded-2xl border border-outline-variant/40 bg-surface-container-lowest p-4"><p className="mb-3 text-sm font-bold text-primary">{numbered ? `Langkah ${String(index + 1).padStart(2, "0")}` : `Kartu ${index + 1}`}</p><label className="mb-2 block text-xs font-bold uppercase tracking-[.12em] text-on-surface-variant">Judul</label><input className="form-input" value={item.title} onChange={(event) => onChange(section.key, "content_json", section.content_json.map((current, itemIndex) => itemIndex === index ? { ...current, title: event.target.value } : current))} /><label className="mb-2 mt-4 block text-xs font-bold uppercase tracking-[.12em] text-on-surface-variant">Deskripsi</label><textarea className="form-input min-h-24" value={item.body} onChange={(event) => onChange(section.key, "content_json", section.content_json.map((current, itemIndex) => itemIndex === index ? { ...current, body: event.target.value } : current))} /></div>)}</div></section>;
}
