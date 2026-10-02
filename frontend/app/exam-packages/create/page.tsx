"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, ClipboardList, Save, TriangleAlert } from "lucide-react";
import { useAuth } from "../../components/AuthProvider";
import PageContainer from "../../components/PageContainer";
import PageHeader from "../../components/PageHeader";

type BankSet = {
  id: string;
  title: string;
  latest_versions: { question_id: string; prompt_preview: string; is_published: boolean }[];
};

export default function CreateExamPackagePage() {
  const { token, loading } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const subjectId = searchParams.get("subject_id") ?? "";
  const [bankSets, setBankSets] = useState<BankSet[]>([]);
  const [code, setCode] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [questionIds, setQuestionIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!token || !subjectId) return;
    fetch(`/api/questions?subject_id=${subjectId}`, { headers: { Authorization: `Bearer ${token}` } })
      .then((response) => response.ok ? response.json() : Promise.reject())
      .then(setBankSets)
      .catch(() => setError("Gagal memuat bank soal."));
  }, [subjectId, token]);

  const questions = bankSets.flatMap((set) => set.latest_versions
    .filter((version) => version.is_published)
    .map((version) => ({ ...version, setTitle: set.title })));
  const toggleQuestion = (id: string) => setQuestionIds((selected) => selected.includes(id) ? selected.filter((value) => value !== id) : [...selected, id]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!token || !subjectId || !questionIds.length) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/exam-packages", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ subject_id: subjectId, code, title, description, question_ids: questionIds, is_active: true }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || Object.values(data).flat().join(" ") || "Gagal membuat paket ujian.");
      router.replace(`/admin/subjects/${subjectId}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Gagal membuat paket ujian.");
    } finally {
      setBusy(false);
    }
  };

  if (loading) return null;
  return <PageContainer>
    <button type="button" onClick={() => router.back()} className="inline-flex items-center gap-2 text-sm font-semibold text-primary"><ArrowLeft size={16} /> Kembali ke mata kuliah</button>
    <PageHeader className="mt-5" title="Buat Paket Ujian" description="Pilih soal yang sudah diterbitkan dari bank soal. Mahasiswa mengakses paket ini menggunakan kode paket." icon={ClipboardList} />
    {error && <div role="alert" className="mt-5 flex gap-2 rounded-lg border border-error/40 bg-error-container p-4 text-sm text-on-error-container"><TriangleAlert size={18} />{error}</div>}
    <form onSubmit={submit} className="mt-6 space-y-6">
      <section className="rounded-xl border border-outline-variant/40 bg-surface-container-lowest p-5"><div className="grid gap-4 sm:grid-cols-2"><div><label htmlFor="package-code" className="mb-1.5 block text-sm font-medium text-on-surface">Kode paket</label><input id="package-code" value={code} onChange={(event) => setCode(event.target.value.toUpperCase())} required placeholder="Contoh: BIO-UTS-01" className="form-input" /></div><div><label htmlFor="package-title" className="mb-1.5 block text-sm font-medium text-on-surface">Judul paket</label><input id="package-title" value={title} onChange={(event) => setTitle(event.target.value)} required placeholder="Contoh: UTS Biologi" className="form-input" /></div></div><div className="mt-4"><label htmlFor="package-description" className="mb-1.5 block text-sm font-medium text-on-surface">Instruksi untuk mahasiswa</label><textarea id="package-description" value={description} onChange={(event) => setDescription(event.target.value)} rows={3} className="form-input" /></div></section>
      <section className="rounded-xl border border-outline-variant/40 bg-surface-container-lowest p-5"><div className="flex flex-wrap items-end justify-between gap-2"><div><h2 className="font-display text-lg font-bold text-on-surface">Pilih Soal Bank</h2><p className="mt-1 text-sm text-on-surface-variant">Hanya soal yang telah diterbitkan dapat digunakan.</p></div><span className="badge badge-active">{questionIds.length} dipilih</span></div><div className="mt-4 divide-y divide-outline-variant/30 overflow-hidden rounded-xl border border-outline-variant/40">{questions.map((question) => <label key={question.question_id} className="flex cursor-pointer gap-3 p-4 transition-colors hover:bg-surface-container"><input type="checkbox" checked={questionIds.includes(question.question_id)} onChange={() => toggleQuestion(question.question_id)} className="mt-1 size-4 accent-primary" /><span><span className="block text-xs font-semibold text-primary">{question.setTitle}</span><span className="mt-1 block text-sm text-on-surface">{question.prompt_preview}</span></span></label>)}{!questions.length && <p className="p-6 text-center text-sm text-on-surface-variant">Belum ada soal bank yang diterbitkan.</p>}</div></section>
      <div className="flex justify-end gap-3"><button type="button" onClick={() => router.back()} className="btn-secondary">Batal</button><button type="submit" disabled={busy || !questionIds.length} className="btn-primary"><Save size={17} />{busy ? "Menyimpan..." : "Buat dan Aktifkan Paket"}</button></div>
    </form>
  </PageContainer>;
}
