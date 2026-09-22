"use client";

import { useEffect, useState } from "react";
import { CircleCheck, CircleStop, Pencil, Plus, Search, X } from "lucide-react";

type Subject = { id: string; name: string };
type ManagedUser = { id: string; email: string; full_name: string; is_active: boolean; created_at: string; subjects: Subject[] };

export default function AdminUserManagement({ role, title, description, token }: { role: "lecturers" | "students"; title: string; description: string; token: string }) {
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<ManagedUser | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ full_name: "", email: "", password: "", subject_ids: [] as string[] });
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    const [userResponse, subjectResponse] = await Promise.all([
      fetch(`/api/admin/users/${role}`, { headers: { Authorization: `Bearer ${token}` } }),
      fetch("/api/admin/subjects", { headers: { Authorization: `Bearer ${token}` } }),
    ]);
    if (!userResponse.ok) throw new Error("Gagal memuat data akun.");
    const data = await userResponse.json();
    if (!subjectResponse.ok) throw new Error("Gagal memuat daftar mata kuliah.");
    const subjectData = await subjectResponse.json();
    setUsers(data);
    setSubjects(subjectData);
  }

  useEffect(() => { void load().catch((caught) => setError(caught instanceof Error ? caught.message : "Gagal memuat data.")); }, [role, token]);

  function openCreate() { setEditing(null); setShowForm(true); setForm({ full_name: "", email: "", password: "", subject_ids: [] }); setError(""); }
  function openEdit(user: ManagedUser) { setEditing(user); setShowForm(true); setForm({ full_name: user.full_name, email: user.email, password: "", subject_ids: user.subjects.map((subject) => subject.id) }); setError(""); }
  function toggleSubject(id: string) { setForm((current) => ({ ...current, subject_ids: current.subject_ids.includes(id) ? current.subject_ids.filter((item) => item !== id) : [...current.subject_ids, id] })); }

  async function submit(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch(editing ? `/api/admin/users/${role}/${editing.id}` : `/api/admin/users/${role}`, { method: editing ? "PATCH" : "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ ...form, ...(editing ? {} : { is_active: true }) }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || Object.values(data).flat().join(" ") || "Gagal menyimpan akun.");
      setNotice(editing ? "Akun berhasil diperbarui." : "Akun berhasil dibuat."); setEditing(null); setShowForm(false); await load();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Gagal menyimpan akun."); } finally { setBusy(false); }
  }

  async function toggleActive(user: ManagedUser) {
    const response = await fetch(`/api/admin/users/${role}/${user.id}`, { method: "PATCH", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ is_active: !user.is_active }) });
    if (!response.ok) { setError("Status akun gagal diperbarui."); return; }
    setNotice(user.is_active ? "Akun dinonaktifkan." : "Akun diaktifkan."); await load();
  }

  const visible = users.filter((user) => `${user.full_name} ${user.email}`.toLowerCase().includes(search.toLowerCase()));
  return <div style={{ maxWidth: "1080px", margin: "0 auto" }}>
    <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between"><div><h1 className="font-display text-2xl font-bold text-on-surface">{title}</h1><p className="mt-1 text-sm text-on-surface-variant">{description}</p></div><button type="button" onClick={openCreate} className="btn-primary"><Plus size={17} /> Tambah akun</button></header>
    {error && <div role="alert" className="mt-5 rounded-lg border border-error/40 bg-error-container p-3 text-sm text-on-error-container">{error}</div>}{notice && <div role="status" className="mt-5 rounded-lg border border-primary-fixed-dim bg-primary-fixed/50 p-3 text-sm text-primary">{notice}</div>}
    <div className="mt-6 flex items-center gap-2"><Search size={16} color="var(--text-dim)" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Cari nama atau email" className="form-input" style={{ maxWidth: "360px" }} /></div>
    <div className="mt-5 overflow-hidden rounded-xl border border-outline-variant/40 bg-surface-container-lowest"><table className="w-full text-left text-sm"><thead className="border-b border-outline-variant/40 bg-surface-container-low text-on-surface-variant"><tr><th className="px-5 py-4">Nama</th><th className="px-5 py-4">Email</th><th className="px-5 py-4">Mata kuliah</th><th className="px-5 py-4">Status</th><th className="px-5 py-4 text-right">Aksi</th></tr></thead><tbody className="divide-y divide-outline-variant/30">{visible.map((user) => <tr key={user.id}><td className="px-5 py-4 font-semibold text-on-surface">{user.full_name}</td><td className="px-5 py-4 text-on-surface-variant">{user.email}</td><td className="px-5 py-4 text-on-surface-variant">{user.subjects.length ? user.subjects.map((subject) => subject.name).join(", ") : "Belum ditentukan"}</td><td className="px-5 py-4"><span className={`badge ${user.is_active ? "badge-active" : "badge-revoked"}`}>{user.is_active ? "Aktif" : "Nonaktif"}</span></td><td className="px-5 py-4"><div className="flex justify-end gap-2"><button type="button" onClick={() => openEdit(user)} className="btn-secondary h-10 w-10 justify-center p-0" aria-label={`Edit ${user.full_name}`} title="Edit akun"><Pencil size={16} aria-hidden="true" /></button><button type="button" onClick={() => void toggleActive(user)} className={`btn-secondary h-10 w-10 justify-center p-0 ${user.is_active ? "text-error hover:bg-error-container/40" : "text-tertiary hover:bg-tertiary-container/30"}`} aria-label={user.is_active ? `Nonaktifkan ${user.full_name}` : `Aktifkan ${user.full_name}`} title={user.is_active ? "Nonaktifkan akun" : "Aktifkan akun"}>{user.is_active ? <CircleStop size={16} aria-hidden="true" /> : <CircleCheck size={16} aria-hidden="true" />}</button></div></td></tr>)}</tbody></table>{!visible.length && <p className="p-10 text-center text-sm text-on-surface-variant">Belum ada akun.</p>}</div>
    {showForm && <div className="fixed inset-0 z-[200] flex items-start justify-center overflow-y-auto bg-black/60 p-4"><form onSubmit={submit} className="my-8 w-full max-w-xl rounded-2xl border border-outline-variant/40 bg-surface-container-lowest p-6 shadow-2xl"><div className="flex items-center justify-between border-b border-outline-variant/30 pb-4"><h2 className="font-display text-xl font-bold text-on-surface">{editing ? "Edit" : "Tambah"} {role === "lecturers" ? "Dosen" : "Mahasiswa"}</h2><button type="button" onClick={() => setShowForm(false)} className="text-xl text-on-surface-variant"><X size={18} /></button></div><div className="mt-5 space-y-3"><input value={form.full_name} onChange={(event) => setForm({ ...form, full_name: event.target.value })} required placeholder="Nama lengkap" className="form-input" /><input type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} required placeholder="Email" className="form-input" /><input type="password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} required={!editing} placeholder={editing ? "Password baru (opsional)" : "Password minimal 8 karakter"} className="form-input" /><div><p className="mb-2 text-xs font-semibold uppercase text-on-surface-variant">Mata kuliah</p><div className="space-y-2">{subjects.map((subject) => <label key={subject.id} className="flex items-center gap-2 text-sm text-on-surface"><input type="checkbox" checked={form.subject_ids.includes(subject.id)} onChange={() => toggleSubject(subject.id)} />{subject.name}</label>)}</div></div></div><div className="mt-6 flex justify-end gap-3 border-t border-outline-variant/30 pt-4"><button type="button" onClick={() => setShowForm(false)} className="btn-secondary">Batal</button><button type="submit" disabled={busy} className="btn-primary">{busy ? "Menyimpan..." : "Simpan akun"}</button></div></form></div>}
  </div>;
}
