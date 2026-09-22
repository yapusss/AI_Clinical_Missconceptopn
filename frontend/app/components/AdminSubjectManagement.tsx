"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { CircleCheck, CircleStop, Eye, Pencil, X } from "lucide-react";
import ConfirmDialog from "./ConfirmDialog";
import ListToolbar from "./ListToolbar";

type Lecturer = { id: string; full_name: string; email: string };
type Subject = { id: string; name: string; slug: string; description: string; is_active: boolean; lecturers: Lecturer[]; topic_count: number };
const blankForm = { name: "", slug: "", description: "", lecturer_ids: [] as string[] };

export default function AdminSubjectManagement({ token, canManageCourses }: { token: string; canManageCourses: boolean }) {
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [lecturers, setLecturers] = useState<Lecturer[]>([]);
  const [search, setSearch] = useState("");
  const [form, setForm] = useState(blankForm);
  const [editing, setEditing] = useState<Subject | null>(null);
  const [pendingDeactivate, setPendingDeactivate] = useState<Subject | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const headers = { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
  const responseMessage = async (response: Response) => { const data = await response.json().catch(() => ({})); return data.detail || Object.values(data).flat().join(" ") || "Permintaan gagal diproses."; };
  const load = async () => {
    const subjectResponse = await fetch("/api/admin/subjects", { headers });
    const lecturerResponse = canManageCourses ? await fetch("/api/admin/users/lecturers", { headers }) : null;
    if (!subjectResponse.ok || (lecturerResponse && !lecturerResponse.ok)) throw new Error("Gagal memuat mata kuliah.");
    setSubjects(await subjectResponse.json());
    if (lecturerResponse) setLecturers(await lecturerResponse.json());
  };
  useEffect(() => { void load().catch((caught) => setError(caught instanceof Error ? caught.message : "Gagal memuat data.")); }, [token]);
  const openForm = (subject?: Subject) => { setEditing(subject ?? null); setForm(subject ? { name: subject.name, slug: subject.slug, description: subject.description, lecturer_ids: subject.lecturers.map((lecturer) => lecturer.id) } : blankForm); setShowForm(true); setError(""); };
  const save = async (event: React.FormEvent) => {
    event.preventDefault(); setBusy(true); setError("");
    try { const response = await fetch(editing ? `/api/admin/subjects/${editing.id}` : "/api/admin/subjects", { method: editing ? "PATCH" : "POST", headers, body: JSON.stringify(form) }); if (!response.ok) throw new Error(await responseMessage(response)); setShowForm(false); await load(); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Gagal menyimpan mata kuliah."); } finally { setBusy(false); }
  };
  const toggle = async (subject: Subject) => { const response = await fetch(`/api/admin/subjects/${subject.id}`, { method: "PATCH", headers, body: JSON.stringify({ is_active: !subject.is_active }) }); if (!response.ok) { setError(await responseMessage(response)); return; } await load(); };
  const visibleSubjects = subjects.filter((subject) => `${subject.name} ${subject.slug}`.toLowerCase().includes(search.toLowerCase()));

  return <div className={canManageCourses ? "" : "course-read-only"} style={{ maxWidth: "1180px", margin: "0 auto" }}>
    <header><h1 className="font-display text-2xl font-bold text-on-surface">{canManageCourses ? "Kelola Mata Kuliah" : "Mata Kuliah"}</h1><p className="mt-1 text-sm text-on-surface-variant">{canManageCourses ? "Atur mata kuliah dan dosen pengampu. Topik dikelola dari halaman detail mata kuliah." : "Lihat mata kuliah yang Anda ampu dan kelola topiknya dari halaman detail."}</p></header>
    {error && <div role="alert" className="mt-5 rounded-lg border border-error/40 bg-error-container p-3 text-sm text-on-error-container">{error}</div>}
    <div className="mt-6"><ListToolbar addLabel="Tambah mata kuliah" onAdd={canManageCourses ? () => openForm() : undefined} searchValue={search} onSearchChange={setSearch} searchPlaceholder="Cari mata kuliah atau kode..." /></div>
    <section className="mt-5 overflow-hidden rounded-xl border border-outline-variant/40 bg-surface-container-lowest"><div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="bg-surface-container-low text-xs font-semibold uppercase text-on-surface-variant"><tr><th className="px-5 py-3">Mata kuliah</th><th className="px-5 py-3">Dosen</th><th className="px-5 py-3">Topik</th><th className="px-5 py-3">Status</th><th className="px-5 py-3 text-right">Aksi</th></tr></thead><tbody className="divide-y divide-outline-variant/30">{visibleSubjects.map((subject) => <tr key={subject.id}><td className="px-5 py-4"><p className="font-semibold text-on-surface">{subject.name}</p><p className="font-mono-ui text-xs text-on-surface-variant">{subject.slug}</p></td><td className="px-5 py-4 text-xs text-on-surface-variant">{subject.lecturers.length ? subject.lecturers.map((lecturer) => lecturer.full_name).join(", ") : "Belum ditetapkan"}</td><td className="px-5 py-4">{subject.topic_count}</td><td className="px-5 py-4"><span className={`badge ${subject.is_active ? "badge-active" : "badge-revoked"}`}>{subject.is_active ? "Aktif" : "Nonaktif"}</span></td><td className="px-5 py-4"><div className="flex justify-end gap-2"><Link href={`/admin/subjects/${subject.id}`} className="btn-secondary table-action-button" aria-label={`Lihat ${subject.name}`} title="Lihat detail"><Eye size={18} stroke="#4f46e5" strokeWidth={2.5} /></Link><button type="button" onClick={() => openForm(subject)} className="btn-secondary table-action-button" aria-label={`Edit ${subject.name}`} title="Edit"><Pencil size={18} stroke="#4f46e5" strokeWidth={2.5} /></button><button type="button" onClick={() => subject.is_active ? setPendingDeactivate(subject) : void toggle(subject)} className="btn-secondary table-action-button" aria-label={subject.is_active ? `Nonaktifkan ${subject.name}` : `Aktifkan ${subject.name}`} title={subject.is_active ? "Nonaktifkan" : "Aktifkan"}>{subject.is_active ? <CircleStop size={18} stroke="#dc2626" strokeWidth={2.5} /> : <CircleCheck size={18} stroke="#16a34a" strokeWidth={2.5} />}</button></div></td></tr>)}</tbody></table></div></section>
    {showForm && <div className="fixed inset-0 z-[200] flex items-start justify-center overflow-y-auto bg-black/60 p-4"><form onSubmit={save} className="my-8 w-full max-w-2xl rounded-2xl border border-outline-variant/40 bg-surface-container-lowest p-6 shadow-2xl"><div className="flex items-center justify-between border-b border-outline-variant/30 pb-4"><h2 className="font-display text-xl font-bold text-on-surface">{editing ? "Edit mata kuliah" : "Tambah mata kuliah"}</h2><button type="button" onClick={() => setShowForm(false)} className="text-on-surface-variant" aria-label="Tutup"><X size={20} /></button></div><div className="mt-5 grid gap-4 sm:grid-cols-2"><input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required placeholder="Nama mata kuliah" className="form-input" /><input value={form.slug} onChange={(event) => setForm({ ...form, slug: event.target.value })} placeholder="Kode mata kuliah" className="form-input" /><textarea value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} placeholder="Deskripsi" rows={3} className="form-input sm:col-span-2" /><div className="sm:col-span-2"><p className="mb-2 text-xs font-semibold uppercase text-on-surface-variant">Dosen pengampu</p><div className="grid gap-2 sm:grid-cols-2">{lecturers.map((lecturer) => <label key={lecturer.id} className="flex items-center gap-2 rounded-lg border border-outline-variant/40 p-3 text-sm text-on-surface"><input type="checkbox" checked={form.lecturer_ids.includes(lecturer.id)} onChange={() => setForm((current) => ({ ...current, lecturer_ids: current.lecturer_ids.includes(lecturer.id) ? current.lecturer_ids.filter((id) => id !== lecturer.id) : [...current.lecturer_ids, lecturer.id] }))} />{lecturer.full_name}</label>)}</div></div></div><div className="mt-6 flex justify-end gap-3"><button type="button" onClick={() => setShowForm(false)} className="btn-secondary">Batal</button><button type="submit" disabled={busy} className="btn-primary">{busy ? "Menyimpan..." : "Simpan"}</button></div></form></div>}
    <ConfirmDialog open={!!pendingDeactivate} title="Nonaktifkan mata kuliah?" description={`Mata kuliah "${pendingDeactivate?.name ?? ""}" tidak tersedia untuk aktivitas baru hingga diaktifkan kembali.`} confirmLabel="Nonaktifkan" onCancel={() => setPendingDeactivate(null)} onConfirm={() => { if (pendingDeactivate) void toggle(pendingDeactivate); setPendingDeactivate(null); }} />
  </div>;
}
