"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowLeft, Pencil, Trash2, X } from "lucide-react";
import ConfirmDialog from "./ConfirmDialog";
import ListToolbar from "./ListToolbar";

type Subject = { id: string; name: string; slug: string; description: string; is_active: boolean; lecturers: { id: string; full_name: string; email: string }[] };
type Topic = { id: string; name: string; description: string };
const blankTopic = { name: "", description: "" };

export default function SubjectDetailManagement({ token, subjectId }: { token: string; subjectId: string }) {
  const [subject, setSubject] = useState<Subject | null>(null);
  const [topics, setTopics] = useState<Topic[]>([]);
  const [search, setSearch] = useState("");
  const [form, setForm] = useState(blankTopic);
  const [editing, setEditing] = useState<Topic | null>(null);
  const [deleting, setDeleting] = useState<Topic | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const headers = { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
  const message = async (response: Response) => { const data = await response.json().catch(() => ({})); return data.detail || Object.values(data).flat().join(" ") || "Permintaan gagal diproses."; };
  const load = async () => { const [subjectResponse, topicResponse] = await Promise.all([fetch(`/api/admin/subjects/${subjectId}`, { headers }), fetch(`/api/admin/subjects/${subjectId}/topics`, { headers })]); if (!subjectResponse.ok || !topicResponse.ok) throw new Error("Mata kuliah tidak ditemukan."); setSubject(await subjectResponse.json()); setTopics(await topicResponse.json()); };
  useEffect(() => { void load().catch((caught) => setError(caught instanceof Error ? caught.message : "Gagal memuat data.")); }, [subjectId, token]);
  const openForm = (topic?: Topic) => { setEditing(topic ?? null); setForm(topic ? { name: topic.name, description: topic.description } : blankTopic); setShowForm(true); setError(""); };
  const save = async (event: React.FormEvent) => { event.preventDefault(); setBusy(true); setError(""); try { const response = await fetch(editing ? `/api/admin/topics/${editing.id}` : `/api/admin/subjects/${subjectId}/topics`, { method: editing ? "PATCH" : "POST", headers, body: JSON.stringify(form) }); if (!response.ok) throw new Error(await message(response)); setShowForm(false); await load(); } catch (caught) { setError(caught instanceof Error ? caught.message : "Gagal menyimpan topik."); } finally { setBusy(false); } };
  const remove = async (topic: Topic) => { const response = await fetch(`/api/admin/topics/${topic.id}`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } }); if (!response.ok) { setError(await message(response)); return; } setDeleting(null); await load(); };
  const visibleTopics = topics.filter((topic) => `${topic.name} ${topic.description}`.toLowerCase().includes(search.toLowerCase()));

  return <div style={{ maxWidth: "1180px", margin: "0 auto" }}>
    <Link href="/admin/subjects" className="mb-5 inline-flex items-center gap-2 text-sm font-semibold text-primary"><ArrowLeft size={16} /> Kembali ke mata kuliah</Link>
    {error && <div role="alert" className="mb-5 rounded-lg border border-error/40 bg-error-container p-3 text-sm text-on-error-container">{error}</div>}
    {subject && <section className="rounded-xl border border-outline-variant/40 bg-surface-container-lowest p-6"><div className="flex flex-wrap items-start justify-between gap-4"><div><div className="text-xs font-bold uppercase tracking-wider text-primary">Mata Kuliah</div><h1 className="mt-1 font-display text-2xl font-bold text-on-surface">{subject.name}</h1><p className="mt-1 font-mono-ui text-sm text-on-surface-variant">{subject.slug}</p></div><span className={`badge ${subject.is_active ? "badge-active" : "badge-revoked"}`}>{subject.is_active ? "Aktif" : "Nonaktif"}</span></div>{subject.description && <p className="mt-5 text-sm text-on-surface-variant">{subject.description}</p>}<div className="mt-5 border-t border-outline-variant/30 pt-4"><p className="text-xs font-semibold uppercase text-on-surface-variant">Dosen Pengampu</p><p className="mt-1 text-sm text-on-surface">{subject.lecturers.length ? subject.lecturers.map((lecturer) => lecturer.full_name).join(", ") : "Belum ditetapkan"}</p></div></section>}
    <section className="mt-6"><div><h2 className="font-display text-xl font-bold text-on-surface">Topik</h2><p className="mt-1 text-sm text-on-surface-variant">Kelola topik untuk mata kuliah ini.</p></div><div className="mt-4"><ListToolbar addLabel="Tambah topik" onAdd={() => openForm()} searchValue={search} onSearchChange={setSearch} searchPlaceholder="Cari topik..." /></div><div className="mt-5 overflow-hidden rounded-xl border border-outline-variant/40 bg-surface-container-lowest"><table className="w-full text-left text-sm"><thead className="bg-surface-container-low text-xs font-semibold uppercase text-on-surface-variant"><tr><th className="px-5 py-3">Topik</th><th className="px-5 py-3 text-right">Aksi</th></tr></thead><tbody className="divide-y divide-outline-variant/30">{visibleTopics.map((topic) => <tr key={topic.id}><td className="px-5 py-4"><p className="font-semibold text-on-surface">{topic.name}</p>{topic.description && <p className="mt-1 text-xs text-on-surface-variant">{topic.description}</p>}</td><td className="px-5 py-4"><div className="flex justify-end gap-2"><button type="button" onClick={() => openForm(topic)} className="btn-secondary table-action-button" title="Edit" aria-label={`Edit ${topic.name}`}><Pencil size={18} stroke="#4f46e5" strokeWidth={2.5} /></button><button type="button" onClick={() => setDeleting(topic)} className="btn-secondary table-action-button" title="Hapus" aria-label={`Hapus ${topic.name}`}><Trash2 size={18} stroke="#dc2626" strokeWidth={2.5} /></button></div></td></tr>)}</tbody></table></div></section>
    {showForm && <div className="fixed inset-0 z-[200] flex items-start justify-center overflow-y-auto bg-black/60 p-4"><form onSubmit={save} className="my-8 w-full max-w-xl rounded-2xl border border-outline-variant/40 bg-surface-container-lowest p-6 shadow-2xl"><div className="flex items-center justify-between border-b border-outline-variant/30 pb-4"><h2 className="font-display text-xl font-bold text-on-surface">{editing ? "Edit topik" : "Tambah topik"}</h2><button type="button" onClick={() => setShowForm(false)} className="text-on-surface-variant" aria-label="Tutup"><X size={20} /></button></div><div className="mt-5 space-y-4"><input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required placeholder="Nama topik" className="form-input" /><textarea value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} placeholder="Deskripsi" rows={3} className="form-input" /></div><div className="mt-6 flex justify-end gap-3"><button type="button" onClick={() => setShowForm(false)} className="btn-secondary">Batal</button><button type="submit" disabled={busy} className="btn-primary">{busy ? "Menyimpan..." : "Simpan"}</button></div></form></div>}
    <ConfirmDialog open={!!deleting} title="Hapus topik?" description={`Topik "${deleting?.name ?? ""}" akan dihapus.`} confirmLabel="Hapus topik" onCancel={() => setDeleting(null)} onConfirm={() => { if (deleting) void remove(deleting); }} />
  </div>;
}
