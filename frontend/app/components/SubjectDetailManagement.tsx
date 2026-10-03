"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ArrowLeft, BookOpen, ChevronDown, ChevronRight, ClipboardList, FileText, Pencil, Plus, Tags, Trash2 } from "lucide-react";
import ConfirmDialog from "./ConfirmDialog";
import FormModal from "./FormModal";
import PageContainer from "./PageContainer";
import PageHeader from "./PageHeader";

type Subject = { id: string; name: string; slug: string; description: string; is_active: boolean };
type Topic = { id: string; name: string; description: string };
type BankSet = { id: string; topic_id: string; title: string; question_count: number; latest_versions: { question_id: string; prompt_preview: string; is_published: boolean }[] };
type ExamPackage = { id: string; code: string; title: string; description: string; question_count: number; is_active: boolean };
const blankTopic = { name: "", description: "" };
const blankPackage = { code: "", title: "", description: "", question_ids: [] as string[] };

export default function SubjectDetailManagement({ token, subjectId, lecturerView = false }: { token: string; subjectId: string; lecturerView?: boolean }) {
  const router = useRouter();
  const [subject, setSubject] = useState<Subject | null>(null);
  const [topics, setTopics] = useState<Topic[]>([]);
  const [bankSets, setBankSets] = useState<BankSet[]>([]);
  const [packages, setPackages] = useState<ExamPackage[]>([]);
  const [activeTab, setActiveTab] = useState<"TOPICS" | "PACKAGES">("TOPICS");
  const [expandedTopics, setExpandedTopics] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [form, setForm] = useState(blankTopic);
  const [editing, setEditing] = useState<Topic | null>(null);
  const [deleting, setDeleting] = useState<Topic | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const headers = { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
  const message = async (response: Response) => { const data = await response.json().catch(() => ({})); return data.detail || Object.values(data).flat().join(" ") || "Permintaan gagal diproses."; };

  const load = async () => {
    const requests = [fetch(`/api/admin/subjects/${subjectId}`, { headers }), fetch(`/api/admin/subjects/${subjectId}/topics`, { headers })];
    if (lecturerView) requests.push(fetch(`/api/questions?subject_id=${subjectId}`, { headers }), fetch(`/api/exam-packages?subject_id=${subjectId}`, { headers }));
    const [subjectResponse, topicResponse, bankResponse, packageResponse] = await Promise.all(requests);
    if (!subjectResponse.ok || !topicResponse.ok) throw new Error("Mata kuliah tidak ditemukan.");
    setSubject(await subjectResponse.json());
    const nextTopics = await topicResponse.json();
    setTopics(nextTopics);
    setExpandedTopics(nextTopics.map((topic: Topic) => topic.id));
    if (bankResponse?.ok) setBankSets(await bankResponse.json());
    if (packageResponse?.ok) setPackages(await packageResponse.json());
  };

  useEffect(() => { void load().catch((caught) => setError(caught instanceof Error ? caught.message : "Gagal memuat data.")); }, [subjectId, token, lecturerView]);
  const openTopicForm = (topic?: Topic) => { setEditing(topic ?? null); setForm(topic ? { name: topic.name, description: topic.description } : blankTopic); setShowForm(true); setError(""); };
  const saveTopic = async (event: React.FormEvent) => { event.preventDefault(); setBusy(true); setError(""); try { const response = await fetch(editing ? `/api/admin/topics/${editing.id}` : `/api/admin/subjects/${subjectId}/topics`, { method: editing ? "PATCH" : "POST", headers, body: JSON.stringify(form) }); if (!response.ok) throw new Error(await message(response)); setShowForm(false); await load(); } catch (caught) { setError(caught instanceof Error ? caught.message : "Gagal menyimpan topik."); } finally { setBusy(false); } };
  const removeTopic = async (topic: Topic) => { const response = await fetch(`/api/admin/topics/${topic.id}`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } }); if (!response.ok) { setError(await message(response)); return; } setDeleting(null); await load(); };
  const togglePackage = async (id: string) => { const response = await fetch(`/api/exam-packages/${id}/toggle-active`, { method: "PATCH", headers }); if (!response.ok) { setError(await message(response)); return; } await load(); };

  return <PageContainer>
    <style jsx global>{`section.mt-7 > div.mt-6 > div.flex > button.btn-primary { display: none; } section.mt-7 article a[title="Tambah soal"] { padding-top: 0.5rem; padding-bottom: 0.5rem; } section.mt-7 article a[title="Tambah soal"] svg { width: 1.25rem; height: 1.25rem; } section.mt-7 article > div:last-child { animation: topic-expand 240ms ease-out; } @keyframes topic-expand { from { opacity: 0; transform: translateY(-0.35rem); } to { opacity: 1; transform: translateY(0); } } @media (prefers-reduced-motion: reduce) { section.mt-7 article > div:last-child { animation: none; } }`}</style>
    <Link href="/admin/subjects" className="mb-5 inline-flex items-center gap-2 text-sm font-semibold text-primary"><ArrowLeft size={16} /> Kembali ke mata kuliah</Link>
    {error && <div role="alert" className="mb-5 rounded-lg border border-error/40 bg-error-container p-3 text-sm text-on-error-container">{error}</div>}
    {subject && <><PageHeader title={subject.name} description={subject.slug} icon={BookOpen} eyebrow={<span className="text-xs font-bold uppercase tracking-wider text-primary">Mata Kuliah</span>} action={<span className={`badge ${subject.is_active ? "badge-active" : "badge-revoked"}`}>{subject.is_active ? "Aktif" : "Nonaktif"}</span>} />{subject.description && <p className="mt-3 max-w-3xl text-sm leading-6 text-on-surface-variant">{subject.description}</p>}</>}
    {lecturerView ? <LecturerWorkspace subjectId={subjectId} topics={topics} bankSets={bankSets} packages={packages} activeTab={activeTab} setActiveTab={setActiveTab} expandedTopics={expandedTopics} setExpandedTopics={setExpandedTopics} onAddTopic={() => openTopicForm()} onCreatePackage={() => router.push(`/exam-packages/create?subject_id=${subjectId}`)} onTogglePackage={togglePackage} /> : <AdminTopics topics={topics} search={search} setSearch={setSearch} openForm={openTopicForm} setDeleting={setDeleting} />}
    {lecturerView && activeTab === "TOPICS" && topics.length > 0 && <button type="button" onClick={() => openTopicForm()} className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed border-primary/50 bg-primary/5 px-5 py-4 text-sm font-semibold text-primary transition-colors hover:border-primary hover:bg-primary/10"><span className="grid size-7 place-items-center rounded-md bg-primary text-white"><Plus size={17} strokeWidth={3} /></span>Tambah topik</button>}
    {lecturerView && activeTab === "PACKAGES" && packages.length > 0 && <div className="mt-5 flex justify-end"><Link href={`/exam-packages/create?subject_id=${subjectId}`} className="btn-primary no-underline"><Plus size={17} /> Buat Paket Ujian</Link></div>}
    {showForm && <FormModal title={editing ? "Edit topik" : "Tambah topik"} subtitle="Perbarui nama dan deskripsi topik." icon={Tags} onClose={() => setShowForm(false)} onSubmit={saveTopic} footer={<><button type="button" onClick={() => setShowForm(false)} className="btn-secondary">Batal</button><button type="submit" disabled={busy} className="btn-primary">{busy ? "Menyimpan..." : "Simpan"}</button></>}><div className="space-y-4"><div><label htmlFor="topic-name" className="mb-1.5 block text-sm font-medium text-on-surface-variant">Nama topik</label><input id="topic-name" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required className="form-input" /></div><div><label htmlFor="topic-description" className="mb-1.5 block text-sm font-medium text-on-surface-variant">Deskripsi</label><textarea id="topic-description" value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} rows={3} className="form-input" /></div></div></FormModal>}
    <ConfirmDialog open={!!deleting} title="Hapus topik?" description={`Topik "${deleting?.name ?? ""}" akan dihapus.`} confirmLabel="Hapus topik" onCancel={() => setDeleting(null)} onConfirm={() => { if (deleting) void removeTopic(deleting); }} />
  </PageContainer>;
}

function LecturerWorkspace({ subjectId, topics, bankSets, packages, activeTab, setActiveTab, expandedTopics, setExpandedTopics, onAddTopic, onCreatePackage, onTogglePackage }: { subjectId: string; topics: Topic[]; bankSets: BankSet[]; packages: ExamPackage[]; activeTab: "TOPICS" | "PACKAGES"; setActiveTab: (tab: "TOPICS" | "PACKAGES") => void; expandedTopics: string[]; setExpandedTopics: (ids: string[]) => void; onAddTopic: () => void; onCreatePackage: () => void; onTogglePackage: (id: string) => void }) {
  const router = useRouter();
  useEffect(() => {
    if (activeTab !== "PACKAGES") return;
    const rows = document.querySelectorAll<HTMLTableRowElement>("section.mt-7 table tbody tr");
    const cleanup = Array.from(rows).map((row, index) => {
      const item = packages[index];
      if (!item) return () => {};
      const openReview = (event: MouseEvent) => {
        if ((event.target as Element).closest("button, a, input")) return;
        router.push(`/exam-packages/${item.id}`);
      };
      const openReviewByKeyboard = (event: KeyboardEvent) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          router.push(`/exam-packages/${item.id}`);
        }
      };
      row.classList.add("cursor-pointer", "transition-colors", "hover:bg-surface-container");
      row.tabIndex = 0;
      row.setAttribute("role", "link");
      row.setAttribute("aria-label", `Tinjau mahasiswa paket ${item.code}`);
      row.addEventListener("click", openReview);
      row.addEventListener("keydown", openReviewByKeyboard);
      return () => {
        row.removeEventListener("click", openReview);
        row.removeEventListener("keydown", openReviewByKeyboard);
        row.classList.remove("cursor-pointer", "transition-colors", "hover:bg-surface-container");
        row.removeAttribute("tabindex");
        row.removeAttribute("role");
        row.removeAttribute("aria-label");
      };
    });
    return () => cleanup.forEach((remove) => remove());
  }, [activeTab, packages, router]);
  return <section className="mt-7"><div className="flex border-b border-outline-variant/40"><button type="button" onClick={() => setActiveTab("TOPICS")} className={`border-b-2 px-5 py-3 text-sm font-semibold ${activeTab === "TOPICS" ? "border-primary text-primary" : "border-transparent text-on-surface-variant"}`}>Bank Soal</button><button type="button" onClick={() => setActiveTab("PACKAGES")} className={`border-b-2 px-5 py-3 text-sm font-semibold ${activeTab === "PACKAGES" ? "border-primary text-primary" : "border-transparent text-on-surface-variant"}`}>Paket Ujian</button></div>{activeTab === "PACKAGES" ? <div className="mt-6"><div className="flex flex-wrap items-center justify-between gap-4"><div><h2 className="font-display text-xl font-bold text-on-surface">Paket Ujian</h2><p className="mt-1 text-sm text-on-surface-variant">Pilih soal dari bank untuk dibagikan kepada mahasiswa melalui kode paket.</p></div><button type="button" onClick={onCreatePackage} className="btn-primary"><Plus size={17} /> Buat Paket Ujian</button></div>{packages.length ? <div className="mt-5 overflow-hidden rounded-xl border border-outline-variant/40 bg-surface-container-lowest"><table className="w-full text-left text-sm"><thead className="bg-surface-container-low text-xs font-semibold uppercase text-on-surface-variant"><tr><th className="px-5 py-3">Kode</th><th className="px-5 py-3">Paket</th><th className="px-5 py-3">Soal</th><th className="px-5 py-3">Status</th><th className="px-5 py-3 text-right">Aksi</th></tr></thead><tbody className="divide-y divide-outline-variant/30">{packages.map((item) => <tr key={item.id}><td className="px-5 py-4 font-mono-ui text-xs font-bold text-primary">{item.code}</td><td className="px-5 py-4"><p className="font-semibold text-on-surface">{item.title}</p>{item.description && <p className="mt-1 text-xs text-on-surface-variant">{item.description}</p>}</td><td className="px-5 py-4">{item.question_count}</td><td className="px-5 py-4"><span className={`badge ${item.is_active ? "badge-active" : "badge-draft"}`}>{item.is_active ? "Aktif" : "Draft"}</span></td><td className="px-5 py-4 text-right"><button type="button" onClick={() => onTogglePackage(item.id)} className="btn-secondary text-xs">{item.is_active ? "Nonaktifkan" : "Aktifkan"}</button></td></tr>)}</tbody></table></div> : <button type="button" onClick={onCreatePackage} className="mt-5 flex w-full flex-col items-center rounded-2xl border-2 border-dashed border-primary/50 bg-primary/5 px-6 py-10 text-center hover:border-primary hover:bg-primary/10"><span className="grid size-12 place-items-center rounded-xl bg-primary text-white"><ClipboardList size={25} /></span><span className="mt-4 font-display text-lg font-bold text-on-surface">Buat paket ujian pertama</span><span className="mt-1 text-sm text-on-surface-variant">Pilih soal yang sudah diterbitkan dari bank soal.</span></button>}</div> : topics.length === 0 ? <button type="button" onClick={onAddTopic} className="mt-6 flex w-full flex-col items-center rounded-2xl border-2 border-dashed border-primary/50 bg-primary/5 px-6 py-10 text-center hover:border-primary hover:bg-primary/10"><span className="grid size-12 place-items-center rounded-xl bg-primary text-white"><Plus size={26} /></span><span className="mt-4 font-display text-lg font-bold text-on-surface">Buat topik pertama</span><span className="mt-1 text-sm text-on-surface-variant">Kelompokkan soal yang akan digunakan pada paket ujian.</span></button> : <div className="mt-5 space-y-4">{topics.map((topic) => { const sets = bankSets.filter((set) => set.topic_id === topic.id); const expanded = expandedTopics.includes(topic.id); return <article key={topic.id} className="overflow-hidden rounded-2xl border border-outline-variant/40 bg-surface-container-lowest"><button type="button" onClick={() => setExpandedTopics(expanded ? expandedTopics.filter((id) => id !== topic.id) : [...expandedTopics, topic.id])} className="flex w-full items-center gap-3 bg-primary/10 px-5 py-4 text-left hover:bg-primary/15"><span className="text-primary">{expanded ? <ChevronDown size={19} /> : <ChevronRight size={19} />}</span><span className="flex-1"><span className="block font-display text-lg font-bold text-on-surface">{topic.name}</span>{topic.description && <span className="block text-sm text-on-surface-variant">{topic.description}</span>}</span><span className="text-xs font-semibold text-on-surface-variant">{sets.reduce((count, set) => count + set.question_count, 0)} soal</span></button>{expanded && <div className="divide-y divide-outline-variant/30 px-5">{sets.length ? sets.map((set) => <Link key={set.id} href={`/questions/${set.id}/view`} className="flex items-center gap-3 py-4 no-underline hover:text-primary"><FileText size={17} className="text-secondary" /><span><span className="block font-semibold text-on-surface">{set.title}</span><span className="text-xs text-on-surface-variant">{set.question_count} soal</span></span></Link>) : <p className="py-5 text-sm text-on-surface-variant">Belum ada soal pada topik ini.</p>}<Link href={`/questions/create?subject_id=${topics.find((item) => item.id === topic.id) ? "" : ""}&topic_id=${topic.id}`} className="flex items-center justify-center py-4 text-primary no-underline hover:scale-110" aria-label={`Tambah soal ke topik ${topic.name}`} title="Tambah soal"><Plus size={34} strokeWidth={3} /></Link></div>}</article>; })}</div>}</section>;
}

function ExamPackageForm({ bankSets, form, setForm, busy, onClose, onSubmit }: { bankSets: BankSet[]; form: typeof blankPackage; setForm: (next: typeof blankPackage) => void; busy: boolean; onClose: () => void; onSubmit: (event: React.FormEvent) => void }) {
  const questions = bankSets.flatMap((set) => set.latest_versions.filter((version) => version.is_published).map((version) => ({ ...version, setTitle: set.title })));
  const toggleQuestion = (id: string) => setForm({ ...form, question_ids: form.question_ids.includes(id) ? form.question_ids.filter((value) => value !== id) : [...form.question_ids, id] });
  return <FormModal title="Buat Paket Ujian" subtitle="Paket aktif dapat diakses mahasiswa menggunakan kode paket." icon={ClipboardList} onClose={onClose} onSubmit={onSubmit} maxWidth="max-w-2xl" footer={<><button type="button" onClick={onClose} className="btn-secondary">Batal</button><button type="submit" disabled={busy || !form.question_ids.length} className="btn-primary">{busy ? "Menyimpan..." : "Buat & Aktifkan"}</button></>}><div className="space-y-4"><div className="grid gap-4 sm:grid-cols-2"><div><label htmlFor="exam-code" className="mb-1.5 block text-sm font-medium text-on-surface-variant">Kode paket</label><input id="exam-code" value={form.code} onChange={(event) => setForm({ ...form, code: event.target.value.toUpperCase() })} required placeholder="Contoh: FIS-UTS-01" className="form-input" /></div><div><label htmlFor="exam-title" className="mb-1.5 block text-sm font-medium text-on-surface-variant">Judul paket</label><input id="exam-title" value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} required className="form-input" /></div></div><div><label htmlFor="exam-description" className="mb-1.5 block text-sm font-medium text-on-surface-variant">Instruksi</label><textarea id="exam-description" value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} rows={2} className="form-input" /></div><fieldset><legend className="text-sm font-semibold text-on-surface">Pilih soal bank ({form.question_ids.length})</legend><p className="mt-1 text-xs text-on-surface-variant">Hanya soal yang telah diterbitkan dapat dimasukkan.</p><div className="mt-3 max-h-72 divide-y divide-outline-variant/30 overflow-y-auto rounded-xl border border-outline-variant/40">{questions.map((question) => <label key={question.question_id} className="flex cursor-pointer gap-3 p-4 hover:bg-surface-container"><input type="checkbox" checked={form.question_ids.includes(question.question_id)} onChange={() => toggleQuestion(question.question_id)} className="mt-1 size-4 accent-primary" /><span><span className="block text-xs font-semibold text-primary">{question.setTitle}</span><span className="mt-1 block text-sm text-on-surface">{question.prompt_preview}</span></span></label>)}{!questions.length && <p className="p-5 text-sm text-on-surface-variant">Belum ada soal bank yang diterbitkan.</p>}</div></fieldset></div></FormModal>;
}

function AdminTopics({ topics, search, setSearch, openForm, setDeleting }: { topics: Topic[]; search: string; setSearch: (value: string) => void; openForm: (topic?: Topic) => void; setDeleting: (topic: Topic) => void }) {
  const visible = topics.filter((topic) => `${topic.name} ${topic.description}`.toLowerCase().includes(search.toLowerCase()));
  return <section className="mt-7"><div className="flex flex-wrap items-center justify-between gap-4"><div><h2 className="font-display text-xl font-bold text-on-surface">Topik</h2><p className="mt-1 text-sm text-on-surface-variant">Kelola topik untuk mata kuliah ini.</p></div><button type="button" className="btn-primary" onClick={() => openForm()}>Tambah topik</button></div><div className="mt-4"><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Cari topik..." className="form-input max-w-md" /></div><div className="mt-5 overflow-hidden rounded-xl border border-outline-variant/40 bg-surface-container-lowest"><table className="w-full text-left text-sm"><thead className="bg-surface-container-low text-xs font-semibold uppercase text-on-surface-variant"><tr><th className="px-5 py-3">Topik</th><th className="px-5 py-3 text-right">Aksi</th></tr></thead><tbody className="divide-y divide-outline-variant/30">{visible.map((topic) => <tr key={topic.id}><td className="px-5 py-4"><p className="font-semibold text-on-surface">{topic.name}</p>{topic.description && <p className="mt-1 text-xs text-on-surface-variant">{topic.description}</p>}</td><td className="px-5 py-4"><div className="flex justify-end gap-2"><button type="button" onClick={() => openForm(topic)} className="btn-secondary table-action-button"><Pencil size={17} /></button><button type="button" onClick={() => setDeleting(topic)} className="btn-secondary table-action-button text-error"><Trash2 size={17} /></button></div></td></tr>)}</tbody></table></div></section>;
}
