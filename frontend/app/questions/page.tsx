"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CircleCheck, ClipboardList, FileUp, Plus, Send, Trash2, TriangleAlert } from "lucide-react";
import { useAuth } from "../components/AuthProvider";
import QuestionBankImport from "../components/QuestionBankImport";

type Indicator = { label: string; description: string; weight: number };
type ExamQuestion = { prompt: string; model_answer: string; indicators: Indicator[] };
type Subject = { id: string; name: string };
type QuestionSet = { id: string; code: string; title: string; subject_name: string; question_count: number; is_active: boolean; latest_versions: { is_published: boolean }[] };

const blankQuestion = (): ExamQuestion => ({ prompt: "", model_answer: "", indicators: [{ label: "Ketepatan konsep", description: "", weight: 1 }] });

export default function QuestionsPage() {
  const { user, token, loading } = useAuth();
  const router = useRouter();
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [sets, setSets] = useState<QuestionSet[]>([]);
  const [subjectId, setSubjectId] = useState("");
  const [code, setCode] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [questions, setQuestions] = useState<ExamQuestion[]>([blankQuestion()]);
  const [publish, setPublish] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [creationMode, setCreationMode] = useState<"manual" | "template" | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!token) return;
    const [summaryResponse, setsResponse] = await Promise.all([
      fetch("/api/dashboard/summary", { headers: { Authorization: `Bearer ${token}` } }),
      fetch("/api/questions", { headers: { Authorization: `Bearer ${token}` } }),
    ]);
    const summary = await summaryResponse.json();
    setSubjects(summary?.summary?.my_subjects ?? []);
    setSets(await setsResponse.json());
    if (summary?.summary?.my_subjects?.[0]?.id) setSubjectId((current) => current || summary.summary.my_subjects[0].id);
  }, [token]);

  useEffect(() => {
    if (loading) return;
    if (!user || !token) { router.replace("/login"); return; }
    void load().catch(() => setError("Gagal memuat paket ujian."));
  }, [loading, user, token, router, load]);

  const totals = useMemo(() => questions.map((question) => question.indicators.reduce((sum, indicator) => sum + (Number(indicator.weight) || 0), 0)), [questions]);
  const updateQuestion = (index: number, field: "prompt" | "model_answer", value: string) => setQuestions((current) => current.map((question, questionIndex) => questionIndex === index ? { ...question, [field]: value } : question));
  const updateIndicator = (questionIndex: number, indicatorIndex: number, field: keyof Indicator, value: string | number) => setQuestions((current) => current.map((question, index) => index !== questionIndex ? question : { ...question, indicators: question.indicators.map((indicator, innerIndex) => innerIndex === indicatorIndex ? { ...indicator, [field]: value } : indicator) }));
  const reset = () => { setCode(""); setTitle(""); setDescription(""); setQuestions([blankQuestion()]); setPublish(false); setShowForm(false); setCreationMode(null); };

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!token) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const response = await fetch("/api/questions", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ subject_id: subjectId, code, title, description, questions, publish }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || JSON.stringify(data.questions) || "Gagal menyimpan paket ujian.");
      setMessage(`Paket ${data.code} berhasil disimpan dengan ${data.question_count} pertanyaan.`); reset(); await load();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Gagal menyimpan paket ujian."); } finally { setBusy(false); }
  }

  async function publishSet(id: string) {
    if (!token) return;
    const response = await fetch(`/api/questions/${id}/publish`, { method: "POST", headers: { Authorization: `Bearer ${token}` } });
    const data = await response.json();
    if (!response.ok) { setError(data.detail || "Paket belum siap diterbitkan."); return; }
    setMessage(data.message); await load();
  }

  if (loading || !user) return null;
  return <div style={{ maxWidth: "1080px", margin: "0 auto" }}>
    <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"><div><div className="inline-flex items-center gap-2 rounded-full border border-primary-fixed-dim bg-primary-fixed/60 px-3 py-1 text-xs font-bold uppercase tracking-wider text-primary"><ClipboardList size={14} /> Paket Ujian</div><h1 className="mt-2 font-display text-2xl font-bold text-on-surface">Manajemen Paket Ujian</h1><p className="text-sm text-on-surface-variant">Satu kode berisi banyak pertanyaan konseptual yang dikerjakan sebagai satu ujian.</p></div><button type="button" onClick={() => { setShowForm(true); setCreationMode(null); }} className="btn-primary"><Plus size={18} /> Buat Paket Ujian</button></header>
    {error && <div role="alert" className="mt-5 flex gap-2 rounded-lg border border-error/40 bg-error-container p-4 text-sm text-on-error-container"><TriangleAlert size={18} />{error}</div>}{message && <div role="status" className="mt-5 flex gap-2 rounded-lg border border-primary-fixed-dim bg-primary-fixed/60 p-4 text-sm text-primary"><CircleCheck size={18} />{message}</div>}
    <div className="mt-8 overflow-hidden rounded-xl border border-outline-variant/40 bg-surface-container-lowest"><table className="w-full text-left text-sm"><thead className="border-b border-outline-variant/40 bg-surface-container-low text-on-surface-variant"><tr><th className="px-5 py-4">Kode</th><th className="px-5 py-4">Paket</th><th className="px-5 py-4">Mata Kuliah</th><th className="px-5 py-4">Status</th><th className="px-5 py-4 text-right">Aksi</th></tr></thead><tbody className="divide-y divide-outline-variant/30">{sets.map((item) => { const published = item.latest_versions?.length > 0 && item.latest_versions.every((version) => version.is_published); return <tr key={item.id}><td className="px-5 py-4 font-mono-ui font-bold text-primary">{item.code}</td><td className="px-5 py-4"><div className="font-semibold text-on-surface">{item.title}</div><div className="text-xs text-on-surface-variant">{item.question_count} pertanyaan</div></td><td className="px-5 py-4 text-on-surface-variant">{item.subject_name}</td><td className="px-5 py-4"><span className={`badge ${published ? "badge-active" : "badge-draft"}`}>{published ? "Terbit" : "Draft"}</span></td><td className="px-5 py-4 text-right">{!published && <button type="button" onClick={() => void publishSet(item.id)} className="btn-secondary text-xs"><Send size={14} /> Terbitkan paket</button>}</td></tr>; })}</tbody></table>{!sets.length && <p className="p-10 text-center text-sm text-on-surface-variant">Belum ada paket ujian.</p>}</div>
    {showForm && <div className="fixed inset-0 z-[200] flex items-start justify-center overflow-y-auto bg-black/60 p-4"><div className="my-8 w-full max-w-3xl rounded-2xl border border-outline-variant/40 bg-surface-container-lowest p-6 shadow-2xl"><div className="flex items-center justify-between border-b border-outline-variant/30 pb-4"><div><h2 className="font-display text-xl font-bold text-on-surface">Buat Paket Ujian</h2><p className="mt-1 text-xs text-on-surface-variant">Pilih cara membuat paket ujian.</p></div><button type="button" onClick={reset} className="text-xl text-on-surface-variant">×</button></div>{!creationMode && <div className="mt-6 grid gap-4 sm:grid-cols-2"><button type="button" onClick={() => setCreationMode("manual")} className="glass-card flex flex-col items-start p-5 text-left"><span className="inline-flex h-11 w-11 items-center justify-center rounded-lg bg-primary-fixed text-primary"><Plus size={22} /></span><h3 className="mt-4 font-display text-base font-bold text-on-surface">Buat Manual</h3><p className="mt-1 text-sm text-on-surface-variant">Tambahkan pertanyaan, jawaban referensi, dan indikator satu per satu.</p><span className="mt-4 text-xs font-bold text-primary">Pilih cara ini</span></button><button type="button" onClick={() => setCreationMode("template")} className="glass-card flex flex-col items-start p-5 text-left"><span className="inline-flex h-11 w-11 items-center justify-center rounded-lg bg-primary-fixed text-primary"><FileUp size={22} /></span><h3 className="mt-4 font-display text-base font-bold text-on-surface">Gunakan Template</h3><p className="mt-1 text-sm text-on-surface-variant">Unggah CSV bank soal dan bank jawaban secara bulk.</p><span className="mt-4 text-xs font-bold text-primary">Pilih cara ini</span></button></div>}{creationMode === "template" && token && <div className="mt-5"><button type="button" onClick={() => setCreationMode(null)} className="mb-2 text-xs font-semibold text-on-surface-variant hover:text-primary">← Kembali ke pilihan</button><QuestionBankImport subjects={subjects} token={token} onImported={() => { setMessage("Bank soal berhasil diimpor sebagai paket draft."); reset(); void load(); }} /></div>}{creationMode === "manual" && <form onSubmit={submit}><div className="mt-5 grid gap-4 sm:grid-cols-2"><select value={subjectId} onChange={(event) => setSubjectId(event.target.value)} required className="form-select"><option value="">Pilih mata kuliah</option>{subjects.map((subject) => <option key={subject.id} value={subject.id}>{subject.name}</option>)}</select><input value={code} onChange={(event) => setCode(event.target.value.toUpperCase())} required placeholder="Kode paket, mis. FIS-NEWTON-01" className="form-input" /><input value={title} onChange={(event) => setTitle(event.target.value)} required placeholder="Judul ujian" className="form-input sm:col-span-2" /><textarea value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Instruksi atau deskripsi ujian" rows={2} className="form-input sm:col-span-2" /></div><div className="mt-6 space-y-5">{questions.map((question, questionIndex) => <section key={questionIndex} className="rounded-xl border border-outline-variant/40 bg-surface-container-low p-4"><div className="flex items-center justify-between"><h3 className="font-semibold text-on-surface">Pertanyaan {questionIndex + 1}</h3>{questions.length > 1 && <button type="button" onClick={() => setQuestions((current) => current.filter((_, index) => index !== questionIndex))} className="text-error"><Trash2 size={16} /></button>}</div><textarea value={question.prompt} onChange={(event) => updateQuestion(questionIndex, "prompt", event.target.value)} required placeholder="Pertanyaan konseptual" rows={4} className="form-input mt-3" /><textarea value={question.model_answer} onChange={(event) => updateQuestion(questionIndex, "model_answer", event.target.value)} required placeholder="Jawaban referensi" rows={3} className="form-input mt-3" /><div className="mt-3 space-y-2">{question.indicators.map((indicator, indicatorIndex) => <div key={indicatorIndex} className="grid grid-cols-[1fr_90px_32px] gap-2"><input value={indicator.label} onChange={(event) => updateIndicator(questionIndex, indicatorIndex, "label", event.target.value)} required placeholder="Indikator konsep" className="form-input" /><input type="number" step="0.0001" min="0.0001" max="1" value={indicator.weight} onChange={(event) => updateIndicator(questionIndex, indicatorIndex, "weight", Number(event.target.value))} required className="form-input" /><button type="button" onClick={() => setQuestions((current) => current.map((item, index) => index === questionIndex ? { ...item, indicators: item.indicators.filter((_, innerIndex) => innerIndex !== indicatorIndex) } : item))} className="text-error">×</button></div>)}</div><div className="mt-2 flex items-center justify-between text-xs"><button type="button" onClick={() => setQuestions((current) => current.map((item, index) => index === questionIndex ? { ...item, indicators: [...item.indicators, { label: "", description: "", weight: 0.1 }] } : item))} className="font-semibold text-primary">+ Tambah indikator</button><span className={Math.abs((totals[questionIndex] ?? 0) - 1) < 0.001 ? "text-tertiary" : "text-error"}>Total bobot: {(totals[questionIndex] ?? 0).toFixed(4)}</span></div></section>)}</div><button type="button" onClick={() => setQuestions((current) => [...current, blankQuestion()])} className="btn-secondary mt-4"><Plus size={16} /> Tambah pertanyaan</button><label className="mt-5 flex items-center gap-2 text-sm text-on-surface"><input type="checkbox" checked={publish} onChange={(event) => setPublish(event.target.checked)} /> Terbitkan setelah semua pertanyaan valid</label><div className="mt-6 flex justify-end gap-3 border-t border-outline-variant/30 pt-4"><button type="button" onClick={reset} className="btn-secondary">Batal</button><button type="submit" disabled={busy} className="btn-primary">{busy ? "Menyimpan..." : "Simpan paket"}</button></div></form>}</div></div>}
  </div>;
}
