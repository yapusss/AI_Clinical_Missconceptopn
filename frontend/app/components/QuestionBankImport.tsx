"use client";

import { useState } from "react";
import { CheckCircle2, FileUp, TriangleAlert } from "lucide-react";

type Subject = { id: string; name: string };

export default function QuestionBankImport({ subjects, token, onImported }: { subjects: Subject[]; token: string; onImported: () => void }) {
  const [subjectId, setSubjectId] = useState(subjects[0]?.id ?? "");
  const [code, setCode] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [job, setJob] = useState<{ id: string; status: string; total_rows: number; valid_rows: number; invalid_rows: number; errors: { row: number; messages: string[] }[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function downloadTemplate() {
    const response = await fetch("/api/question-import-template", { headers: { Authorization: `Bearer ${token}` } });
    if (!response.ok) { setError("Template tidak dapat diunduh."); return; }
    const url = URL.createObjectURL(await response.blob());
    const link = document.createElement("a"); link.href = url; link.download = "template-bank-soal.xlsx"; link.click(); URL.revokeObjectURL(url);
  }

  async function upload(event: React.FormEvent) {
    event.preventDefault();
    if (!file) { setError("Pilih file CSV atau Excel terlebih dahulu."); return; }
    setBusy(true); setError("");
    const body = new FormData(); body.append("subject_id", subjectId); body.append("code", code); body.append("title", title); body.append("description", description); body.append("file", file);
    try {
      const response = await fetch("/api/question-imports", { method: "POST", headers: { Authorization: `Bearer ${token}` }, body });
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || "Import gagal.");
      setJob({ id: data.import_id, status: data.status, total_rows: data.total_rows, valid_rows: data.valid_rows, invalid_rows: data.invalid_rows, errors: data.errors ?? [] });
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Import gagal."); } finally { setBusy(false); }
  }

  async function commit() {
    if (!job) return;
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/question-imports/${job.id}/commit`, { method: "POST", headers: { Authorization: `Bearer ${token}` } });
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || "Commit import gagal.");
      setJob(null); setFile(null); setCode(""); setTitle(""); setDescription(""); onImported();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Commit import gagal."); } finally { setBusy(false); }
  }

  return <section className="mt-8 rounded-xl border border-outline-variant/40 bg-surface-container-low p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="font-display text-lg font-bold text-on-surface">Import bank soal + bank jawaban</h2><p className="mt-1 text-xs text-on-surface-variant">Nomor soal mencocokkan pertanyaan dan jawaban. ID teknis dibuat otomatis oleh sistem.</p></div><button type="button" onClick={() => void downloadTemplate()} className="btn-secondary text-xs">Unduh template Excel</button></div>
    <form onSubmit={upload} className="mt-4 grid gap-3 sm:grid-cols-2"><select value={subjectId} onChange={(event) => setSubjectId(event.target.value)} required className="form-select"><option value="">Pilih mata kuliah</option>{subjects.map((subject) => <option key={subject.id} value={subject.id}>{subject.name}</option>)}</select><input value={code} onChange={(event) => setCode(event.target.value.toUpperCase())} required placeholder="Kode paket" className="form-input" /><input value={title} onChange={(event) => setTitle(event.target.value)} required placeholder="Judul paket" className="form-input sm:col-span-2" /><textarea value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Deskripsi atau instruksi" rows={2} className="form-input sm:col-span-2" /><input type="file" accept=".csv,.xlsx,.xlsm,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(event) => setFile(event.target.files?.[0] ?? null)} required className="form-input sm:col-span-2" /><button type="submit" disabled={busy} className="btn-primary sm:col-span-2"><FileUp size={16} />{busy ? "Memproses..." : "Validasi file"}</button></form>
    {error && <div role="alert" className="mt-4 flex gap-2 rounded-lg border border-error/40 bg-error-container p-3 text-xs text-on-error-container"><TriangleAlert size={16} />{error}</div>}
    {job && <div className="mt-4 rounded-lg border border-outline-variant/40 bg-surface-container-lowest p-4"><div className="flex flex-wrap gap-3 text-xs text-on-surface"><span>Total: <b>{job.total_rows}</b></span><span>Valid: <b className="text-tertiary">{job.valid_rows}</b></span><span>Error: <b className="text-error">{job.invalid_rows}</b></span></div>{job.errors.length > 0 && <ul className="mt-3 space-y-1 text-xs text-error">{job.errors.slice(0, 8).map((item) => <li key={item.row}>Baris {item.row}: {item.messages.join(" ")}</li>)}</ul>}{job.status === "READY_TO_IMPORT" ? <button type="button" onClick={() => void commit()} disabled={busy} className="btn-primary mt-4 text-xs"><CheckCircle2 size={15} /> Commit sebagai paket draft</button> : <p className="mt-3 text-xs text-error">Perbaiki file berdasarkan error di atas lalu upload ulang.</p>}</div>}
  </section>;
}