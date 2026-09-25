"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowLeft, BookOpen, Pencil, Tags, Trash2 } from "lucide-react";
import ConfirmDialog from "./ConfirmDialog";
import FormModal from "./FormModal";
import ListToolbar from "./ListToolbar";
import PageContainer from "./PageContainer";
import PageHeader from "./PageHeader";

type Subject = { id: string; name: string; slug: string; description: string; is_active: boolean; lecturers: { id: string; full_name: string; email: string }[] };
type Topic = { id: string; name: string; description: string };
const blankTopic = { name: "", description: "" };

export default function SubjectDetailManagement({ token, subjectId }: { token: string; subjectId: string }) {
  const [subject, setSubject] = useState<Subject | null>(null);
  const [topics, setTopics] = useState<Topic[]>([]);
  const [search, setSearch] = useState("");
  const [viewMode, setViewMode] = useState<"table" | "cards">("table");
  const [sortOrder, setSortOrder] = useState("NAME_ASC");
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
  const visibleTopics = topics.filter((topic) => `${topic.name} ${topic.description}`.toLowerCase().includes(search.toLowerCase())).sort((a, b) => sortOrder === "NAME_DESC" ? b.name.localeCompare(a.name) : a.name.localeCompare(b.name));

  return <PageContainer>
    <Link href="/admin/subjects" className="mb-5 inline-flex items-center gap-2 text-sm font-semibold text-primary"><ArrowLeft size={16} /> Kembali ke mata kuliah</Link>
    {error && <div role="alert" className="mb-5 rounded-lg border border-error/40 bg-error-container p-3 text-sm text-on-error-container">{error}</div>}
    {subject && <><PageHeader title={subject.name} description={subject.slug} icon={BookOpen} eyebrow={<span className="text-xs font-bold uppercase tracking-wider text-primary">Mata Kuliah</span>} action={<span className={`badge ${subject.is_active ? "badge-active" : "badge-revoked"}`}>{subject.is_active ? "Aktif" : "Nonaktif"}</span>} /><section className="mt-6 rounded-xl border border-outline-variant/40 bg-surface-container-lowest p-6">{subject.description && <p className="text-sm text-on-surface-variant">{subject.description}</p>}<div className={subject.description ? "mt-5 border-t border-outline-variant/30 pt-4" : ""}><p className="text-xs font-semibold uppercase text-on-surface-variant">Dosen Pengampu</p><p className="mt-1 text-sm text-on-surface">{subject.lecturers.length ? subject.lecturers.map((lecturer) => lecturer.full_name).join(", ") : "Belum ditetapkan"}</p></div></section></>}
    <section className="mt-6"><div><h2 className="font-display text-xl font-bold text-on-surface">Topik</h2><p className="mt-1 text-sm text-on-surface-variant">Kelola topik untuk mata kuliah ini.</p></div><div className="mt-4"><ListToolbar addLabel="Tambah topik" onAdd={() => openForm()} searchValue={search} onSearchChange={setSearch} searchPlaceholder="Cari topik..." sortOptions={[{ value: "NAME_ASC", label: "Nama A-Z", direction: "asc" }, { value: "NAME_DESC", label: "Nama Z-A", direction: "desc" }]} currentSort={sortOrder} onSortChange={setSortOrder} viewMode={viewMode} onViewModeChange={setViewMode} /></div><div className={`mt-5 overflow-hidden rounded-xl border border-outline-variant/40 bg-surface-container-lowest ${viewMode === "cards" ? "list-card-view" : ""}`}><table className="w-full text-left text-sm"><thead className="bg-surface-container-low text-xs font-semibold uppercase text-on-surface-variant"><tr><th className="px-5 py-3">Topik</th><th className="px-5 py-3 text-right">Aksi</th></tr></thead><tbody className="divide-y divide-outline-variant/30">{visibleTopics.map((topic) => <tr key={topic.id}><td className="px-5 py-4"><p className="font-semibold text-on-surface">{topic.name}</p>{topic.description && <p className="mt-1 text-xs text-on-surface-variant">{topic.description}</p>}</td><td className="px-5 py-4"><div className="flex justify-end gap-2"><button type="button" onClick={() => openForm(topic)} className="btn-secondary table-action-button" title="Edit" aria-label={`Edit ${topic.name}`}><Pencil size={18} stroke="#4f46e5" strokeWidth={2.5} /></button><button type="button" onClick={() => setDeleting(topic)} className="btn-secondary table-action-button" title="Hapus" aria-label={`Hapus ${topic.name}`}><Trash2 size={18} stroke="#dc2626" strokeWidth={2.5} /></button></div></td></tr>)}</tbody></table></div></section>
    {showForm && <FormModal title={editing ? "Edit topik" : "Tambah topik"} subtitle={editing ? "Perbarui nama dan deskripsi topik." : "Tambahkan topik untuk mata kuliah ini."} icon={Tags} onClose={() => setShowForm(false)} onSubmit={save} footer={<><button type="button" onClick={() => setShowForm(false)} className="btn-secondary w-full sm:w-auto">Batal</button><button type="submit" disabled={busy} className="btn-primary w-full sm:w-auto">{busy ? "Menyimpan..." : "Simpan"}</button></>}><section className="rounded-xl border border-outline-variant/50 p-4"><div className="mb-3 flex items-center gap-2 text-base font-semibold text-on-surface"><Tags size={18} className="text-primary" />Informasi topik</div><div className="grid gap-4"><div><label htmlFor="topic-name" className="mb-1.5 block text-sm font-medium text-on-surface-variant">Nama topik</label><input id="topic-name" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required placeholder="Masukkan nama topik" className="form-input" /></div><div><label htmlFor="topic-description" className="mb-1.5 block text-sm font-medium text-on-surface-variant">Deskripsi</label><textarea id="topic-description" value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} placeholder="Tambahkan deskripsi topik" rows={3} className="form-input" /></div></div></section></FormModal>}
    <ConfirmDialog open={!!deleting} title="Hapus topik?" description={`Topik "${deleting?.name ?? ""}" akan dihapus.`} confirmLabel="Hapus topik" onCancel={() => setDeleting(null)} onConfirm={() => { if (deleting) void remove(deleting); }} />
  </PageContainer>;
}
