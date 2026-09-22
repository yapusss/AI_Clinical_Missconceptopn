"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  CircleCheck,
  CircleStop,
  ClipboardList,
  Eye,
  GraduationCap,
  Pencil,
  FileUp,
  Plus,
  Send,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import { useAuth } from "../components/AuthProvider";
import QuestionBankImport from "../components/QuestionBankImport";
import ConfirmDialog from "../components/ConfirmDialog";
import ListToolbar from "../components/ListToolbar";
import AppSelect from "../components/AppSelect";

type Indicator = {
  label: string;
  description: string;
  weight: number;
};

type ExamQuestion = {
  prompt: string;
  model_answer: string;
  indicators: Indicator[];
};

type Subject = {
  id: string;
  name: string;
};

type QuestionSet = {
  id: string;
  code: string;
  title: string;
  subject_name: string;
  question_count: number;
  is_active: boolean;
  latest_versions: { is_published: boolean }[];
};

type QuestionSetDetail = QuestionSet & {
  description?: string;
  versions?: { prompt: string; model_answer: string; indicators?: Indicator[] }[];
};

const blankQuestion = (): ExamQuestion => ({
  prompt: "",
  model_answer: "",
  indicators: [{ label: "Ketepatan konsep", description: "", weight: 1 }],
});

export default function QuestionsPage() {
  const { user, token, loading } = useAuth();
  const router = useRouter();
  const [mounted, setMounted] = useState(false);

  // Data states
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [sets, setSets] = useState<QuestionSet[]>([]);

  // Form states
  const [editingId, setEditingId] = useState<string | null>(null);
  const [subjectId, setSubjectId] = useState("");
  const [code, setCode] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [questions, setQuestions] = useState<ExamQuestion[]>([blankQuestion()]);
  const [publish, setPublish] = useState(false);

  // UI states
  const [showForm, setShowForm] = useState(false);
  const [viewingSet, setViewingSet] = useState<QuestionSetDetail | null>(null);
  const [pendingDeactivate, setPendingDeactivate] = useState<QuestionSet | null>(null);
  const [pendingQuestionRemoval, setPendingQuestionRemoval] = useState<number | null>(null);
  const [creationMode, setCreationMode] = useState<"manual" | "template" | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");

  const load = useCallback(async () => {
    if (!token) return;
    const [summaryResponse, setsResponse] = await Promise.all([
      fetch("/api/dashboard/summary", { headers: { Authorization: `Bearer ${token}` } }),
      fetch("/api/questions", { headers: { Authorization: `Bearer ${token}` } }),
    ]);

    const summary = await summaryResponse.json();
    setSubjects(summary?.summary?.my_subjects ?? []);
    setSets(await setsResponse.json());

  }, [token]);

  useEffect(() => {
    setMounted(true);
    if (loading) return;
    if (!user || !token) {
      router.replace("/login");
      return;
    }
    void load().catch(() => setError("Gagal memuat paket ujian."));
  }, [loading, user, token, router, load]);

  const totals = useMemo(
    () =>
      questions.map((question) =>
        question.indicators.reduce(
          (sum, indicator) => sum + (Number(indicator.weight) || 0),
          0
        )
      ),
    [questions]
  );
  const visibleSets = sets.filter((item) => `${item.code} ${item.title} ${item.subject_name} ${item.is_active ? "aktif" : "nonaktif"}`.toLowerCase().includes(search.toLowerCase()));

  const updateQuestion = (
    index: number,
    field: "prompt" | "model_answer",
    value: string
  ) => {
    setQuestions((current) =>
      current.map((question, questionIndex) =>
        questionIndex === index ? { ...question, [field]: value } : question
      )
    );
  };

  const updateIndicator = (
    questionIndex: number,
    indicatorIndex: number,
    field: keyof Indicator,
    value: string | number
  ) => {
    setQuestions((current) =>
      current.map((question, index) =>
        index !== questionIndex
          ? question
          : {
              ...question,
              indicators: question.indicators.map((indicator, innerIndex) =>
                innerIndex === indicatorIndex
                  ? { ...indicator, [field]: value }
                  : indicator
              ),
            }
      )
    );
  };

  const reset = () => {
    setEditingId(null);
    setCode("");
    setTitle("");
    setDescription("");
    setQuestions([blankQuestion()]);
    setPublish(false);
    setShowForm(false);
    setCreationMode(null);
  };

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!token) return;
    setBusy(true);
    setError("");
    setMessage("");

    try {
      const url = editingId ? `/api/questions/${editingId}` : "/api/questions";
      const method = editingId ? "PUT" : "POST";
      const payload = editingId
        ? {
            title,
            description,
            prompt: questions[0]?.prompt,
            model_answer: questions[0]?.model_answer,
            indicators: questions[0]?.indicators,
            publish,
          }
        : {
            subject_id: subjectId,
            code,
            title,
            description,
            questions,
            publish,
          };

      const response = await fetch(url, {
        method,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(
          data.detail ||
            (data.code ? data.code[0] : "") ||
            JSON.stringify(data.questions) ||
            "Gagal menyimpan paket ujian."
        );
      }

      setMessage(
        editingId
          ? "Paket ujian berhasil diperbarui."
          : `Paket ${data.code} berhasil disimpan dengan ${data.question_count || questions.length} pertanyaan.`
      );
      reset();
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Gagal menyimpan paket ujian.");
    } finally {
      setBusy(false);
    }
  }

  async function publishSet(id: string) {
    if (!token) return;
    try {
      const response = await fetch(`/api/questions/${id}/publish`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await response.json();
      if (!response.ok) {
        setError(data.detail || "Paket belum siap diterbitkan.");
        return;
      }
      setMessage(data.message || "Paket berhasil diterbitkan.");
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Gagal menerbitkan paket.");
    }
  }

  async function toggleActiveSet(id: string) {
    if (!token) return;
    try {
      const response = await fetch(`/api/questions/${id}/toggle-active`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.detail || "Gagal mengubah status soal.");
      }
      setMessage(data.message || "Status berhasil diperbarui.");
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Gagal mengubah status soal.");
    }
  }

  async function editSet(item: QuestionSet) {
    if (!token) return;
    setError("");
    try {
      const response = await fetch(`/api/questions/${item.id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.detail || "Gagal memuat detail soal.");
      }

      setEditingId(item.id);
      setCode(data.code || item.code);
      setTitle(data.title || item.title);
      setDescription(data.description || "");
      if (data.subject_id) setSubjectId(data.subject_id);

      if (data.versions && data.versions.length > 0) {
        const loadedQuestions = data.versions.map((v: any) => ({
          prompt: v.prompt || "",
          model_answer: v.model_answer || "",
          indicators:
            v.indicators?.length > 0
              ? v.indicators.map((ind: any) => ({
                  label: ind.label,
                  description: ind.description || "",
                  weight: Number(ind.weight) || 0,
                }))
              : [{ label: "Ketepatan konsep", description: "", weight: 1 }],
        }));
        setQuestions(loadedQuestions);
      }

      setCreationMode("manual");
      setShowForm(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Gagal memuat data soal untuk diedit.");
    }
  }

  async function viewSet(item: QuestionSet) {
    if (!token) return;
    setError("");
    try {
      const response = await fetch(`/api/questions/${item.id}`, { headers: { Authorization: `Bearer ${token}` } });
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || "Gagal memuat detail paket ujian.");
      setViewingSet({ ...item, ...data });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Gagal memuat detail paket ujian.");
    }
  }

  if (!mounted || loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-gradient-to-b from-white via-[#F0F7FF] to-[#E6F0FA] font-body">
        <p className="text-sm text-on-surface-variant">Memuat data soal...</p>
      </main>
    );
  }

  if (!user) return null;

  return (
    <div className="w-full max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Header Halaman */}
      <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-primary-fixed-dim bg-primary-fixed/60 px-3 py-1 text-xs font-bold uppercase tracking-wider text-primary">
            <ClipboardList size={14} /> Paket Ujian
          </div>
          <h1 className="mt-2 font-display text-2xl font-bold text-on-surface">
            Manajemen Paket Ujian
          </h1>
          <p className="text-sm text-on-surface-variant">
            Satu kode berisi pertanyaan konseptual yang dikerjakan sebagai satu evaluasi.
          </p>
        </div>

      </header>

      {/* Alerts */}
      {error && (
        <div
          role="alert"
          className="mt-5 flex gap-2 rounded-lg border border-error/40 bg-error-container p-4 text-sm text-on-error-container"
        >
          <TriangleAlert size={18} />
          {error}
        </div>
      )}

      {message && (
        <div
          role="status"
          className="mt-5 flex gap-2 rounded-lg border border-primary-fixed-dim bg-primary-fixed/60 p-4 text-sm text-primary"
        >
          <CircleCheck size={18} />
          {message}
        </div>
      )}

      <div className="mt-6"><ListToolbar addLabel="Buat paket ujian" onAdd={() => { reset(); setShowForm(true); setCreationMode(null); }} searchValue={search} onSearchChange={setSearch} searchPlaceholder="Cari kode, judul, atau mata kuliah..." /></div>

      {/* Tabel Daftar Soal Responsif */}
      <div className="mt-8 rounded-xl border border-outline-variant/40 bg-surface-container-lowest shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="border-b border-outline-variant/40 bg-surface-container-low text-on-surface-variant font-semibold">
              <tr>
                <th className="px-5 py-4 text-left">Kode</th>
                <th className="px-5 py-4 text-left">Paket</th>
                <th className="px-5 py-4 text-left">Mata Kuliah</th>
                <th className="px-5 py-4 text-left">Status</th>
                <th className="px-5 py-4 text-left">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-outline-variant/30">
              {visibleSets.map((item) => {
                const published =
                  item.latest_versions?.length > 0 &&
                  item.latest_versions.every((version) => version.is_published);

                return (
                  <tr key={item.id} className="hover:bg-primary-fixed/5 transition-colors">
                    {/* Kode Soal */}
                    <td className="px-5 py-4 font-mono-ui font-bold text-primary text-left">
                      {item.code}
                    </td>

                    {/* Judul Paket */}
                    <td className="px-5 py-4 text-left">
                      <div className="font-semibold text-on-surface">{item.title}</div>
                      <div className="text-xs text-on-surface-variant">
                        {item.question_count} pertanyaan
                      </div>
                    </td>

                    {/* Mata Kuliah */}
                    <td className="px-5 py-4 text-left text-on-surface-variant">
                      {item.subject_name}
                    </td>

                    {/* Status Publikasi & Aktif */}
                    <td className="px-5 py-4 text-left">
                      <div className="inline-flex items-center gap-2">
                        <span className={`badge ${published ? "badge-active" : "badge-draft"}`}>
                          {published ? "Terbit" : "Draft"}
                        </span>
                        <span
                          className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${
                            item.is_active
                              ? "border border-tertiary/40 bg-tertiary/10 text-tertiary"
                              : "border border-error/40 bg-error/10 text-error"
                          }`}
                        >
                          {item.is_active ? "Aktif" : "Nonaktif"}
                        </span>
                      </div>
                    </td>

                    {/* Icon-only table actions retain text labels for assistive technology. */}
                    <td className="px-5 py-4 text-left">
                      <div className="flex flex-wrap items-center justify-start gap-2">
                        <button
                          type="button"
                          onClick={() => void viewSet(item)}
                          className="btn-secondary table-action-button"
                          aria-label={`Lihat detail ${item.title}`}
                          title="Lihat detail"
                        >
                          <Eye size={18} stroke="#4f46e5" strokeWidth={2.5} aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          onClick={() => router.push(`/questions/${item.id}`)}
                          className="btn-secondary table-action-button"
                          aria-label={`Tinjau progres mahasiswa untuk ${item.title}`}
                          title="Tinjau progres mahasiswa"
                        >
                          <GraduationCap size={18} stroke="#4f46e5" strokeWidth={2.5} aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          onClick={() => void editSet(item)}
                          className="btn-secondary table-action-button"
                          aria-label="Edit paket ujian"
                          title="Edit paket ujian"
                        >
                          <Pencil size={18} stroke="#4f46e5" strokeWidth={2.5} aria-hidden="true" />
                        </button>

                        <button
                          type="button"
                          onClick={() => item.is_active ? setPendingDeactivate(item) : void toggleActiveSet(item.id)}
                          className={`btn-secondary table-action-button transition-colors ${
                            item.is_active
                              ? "text-error hover:bg-error-container/40"
                              : "text-tertiary hover:bg-tertiary-container/30"
                          }`}
                          aria-label={item.is_active ? "Nonaktifkan paket ujian" : "Aktifkan paket ujian"}
                          title={item.is_active ? "Nonaktifkan paket ujian" : "Aktifkan paket ujian"}
                        >
                          {item.is_active ? <CircleStop size={18} stroke="#dc2626" strokeWidth={2.5} aria-hidden="true" /> : <CircleCheck size={18} stroke="#059669" strokeWidth={2.5} aria-hidden="true" />}
                        </button>

                        {!published && (
                          <button
                            type="button"
                            onClick={() => void publishSet(item.id)}
                            className="btn-secondary table-action-button text-primary"
                            aria-label="Terbitkan paket ujian"
                            title="Terbitkan paket ujian"
                          >
                            <Send size={18} stroke="#4f46e5" strokeWidth={2.5} aria-hidden="true" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {!sets.length && (
          <p className="p-10 text-center text-sm text-on-surface-variant">
            Belum ada paket ujian.
          </p>
        )}
      </div>

      {viewingSet && (
        <div className="fixed inset-0 z-[200] flex items-start justify-center overflow-y-auto bg-black/60 p-4">
          <div className="my-8 w-full max-w-3xl rounded-2xl border border-outline-variant/40 bg-surface-container-lowest p-6 shadow-2xl">
            <div className="flex items-start justify-between gap-4 border-b border-outline-variant/30 pb-4">
              <div><p className="font-mono-ui text-xs font-bold text-primary">{viewingSet.code}</p><h2 className="mt-1 font-display text-xl font-bold text-on-surface">{viewingSet.title}</h2><p className="mt-1 text-sm text-on-surface-variant">{viewingSet.subject_name}</p></div>
              <button type="button" onClick={() => setViewingSet(null)} aria-label="Tutup detail" className="text-on-surface-variant hover:text-on-surface">×</button>
            </div>
            {viewingSet.description && <p className="mt-4 whitespace-pre-line text-sm text-on-surface-variant">{viewingSet.description}</p>}
            <div className="mt-5 space-y-4">{(viewingSet.versions ?? []).map((version, index) => <section key={index} className="rounded-xl border border-outline-variant/40 bg-surface-container-low p-4"><h3 className="font-semibold text-on-surface">Pertanyaan {index + 1}</h3><p className="mt-2 whitespace-pre-line text-sm text-on-surface">{version.prompt}</p><p className="mt-3 text-xs font-semibold uppercase text-on-surface-variant">Jawaban referensi</p><p className="mt-1 whitespace-pre-line text-sm text-on-surface-variant">{version.model_answer}</p>{version.indicators?.length ? <div className="mt-3 flex flex-wrap gap-2">{version.indicators.map((indicator, indicatorIndex) => <span key={indicatorIndex} className="badge badge-role">{indicator.label} · {indicator.weight}</span>)}</div> : null}</section>)}</div>
          </div>
        </div>
      )}

      <ConfirmDialog open={!!pendingDeactivate} title="Nonaktifkan paket ujian?" description={`Paket "${pendingDeactivate?.title ?? ""}" tidak lagi dapat digunakan mahasiswa sampai diaktifkan kembali.`} confirmLabel="Nonaktifkan" onCancel={() => setPendingDeactivate(null)} onConfirm={() => { if (pendingDeactivate) void toggleActiveSet(pendingDeactivate.id); setPendingDeactivate(null); }} />
      <ConfirmDialog open={pendingQuestionRemoval !== null} title="Hapus pertanyaan?" description="Pertanyaan yang belum disimpan ini akan dihapus dari formulir paket ujian." confirmLabel="Hapus pertanyaan" onCancel={() => setPendingQuestionRemoval(null)} onConfirm={() => { if (pendingQuestionRemoval !== null) setQuestions((current) => current.filter((_, index) => index !== pendingQuestionRemoval)); setPendingQuestionRemoval(null); }} />

      {/* Modal Dialog Form Buat / Edit Paket */}
      {showForm && (
        <div className="fixed inset-0 z-[200] flex items-start justify-center overflow-y-auto bg-black/60 p-4">
          <div className="my-8 w-full max-w-3xl rounded-2xl border border-outline-variant/40 bg-surface-container-lowest p-6 shadow-2xl">
            {/* Modal Header */}
            <div className="flex items-center justify-between border-b border-outline-variant/30 pb-4">
              <div>
                <h2 className="font-display text-xl font-bold text-on-surface">
                  {editingId ? "Edit Paket Ujian" : "Buat Paket Ujian"}
                </h2>
                <p className="mt-1 text-xs text-on-surface-variant">
                  {editingId
                    ? "Perbarui butir pertanyaan, jawaban referensi, dan indikator konsep."
                    : "Pilih cara membuat paket ujian."}
                </p>
              </div>
              <button
                type="button"
                onClick={reset}
                className="text-xl font-bold text-on-surface-variant hover:text-on-surface"
              >
                ×
              </button>
            </div>

            {/* Pemilihan Mode (Hanya saat pembuatan baru) */}
            {!creationMode && !editingId && (
              <div className="mt-6 grid gap-4 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() => setCreationMode("manual")}
                  className="glass-card flex flex-col items-start p-5 text-left transition-colors hover:border-primary"
                >
                  <span className="inline-flex h-11 w-11 items-center justify-center rounded-lg bg-primary-fixed text-primary">
                    <Plus size={22} />
                  </span>
                  <h3 className="mt-4 font-display text-base font-bold text-on-surface">
                    Buat Manual
                  </h3>
                  <p className="mt-1 text-sm text-on-surface-variant">
                    Tambahkan pertanyaan, jawaban referensi, dan indikator satu per satu.
                  </p>
                  <span className="mt-4 text-xs font-bold text-primary">
                    Pilih cara ini →
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => setCreationMode("template")}
                  className="glass-card flex flex-col items-start p-5 text-left transition-colors hover:border-primary"
                >
                  <span className="inline-flex h-11 w-11 items-center justify-center rounded-lg bg-primary-fixed text-primary">
                    <FileUp size={22} />
                  </span>
                  <h3 className="mt-4 font-display text-base font-bold text-on-surface">
                    Gunakan Template
                  </h3>
                  <p className="mt-1 text-sm text-on-surface-variant">
                    Unggah file CSV/Excel bank soal dan bank jawaban secara bulk.
                  </p>
                  <span className="mt-4 text-xs font-bold text-primary">
                    Pilih cara ini →
                  </span>
                </button>
              </div>
            )}

            {/* Mode Import Template */}
            {creationMode === "template" && token && (
              <div className="mt-5">
                <button
                  type="button"
                  onClick={() => setCreationMode(null)}
                  className="mb-3 text-xs font-semibold text-on-surface-variant hover:text-primary"
                >
                  ← Kembali ke pilihan mode
                </button>
                <QuestionBankImport
                  subjects={subjects}
                  token={token}
                  onImported={() => {
                    setMessage("Bank soal berhasil diimpor sebagai paket draft.");
                    reset();
                    void load();
                  }}
                />
              </div>
            )}

            {/* Mode Manual Form (Pembuatan Baru & Edit) */}
            {creationMode === "manual" && (
              <form onSubmit={submit} className="mt-5 space-y-6">
                {/* Meta Paket Soal */}
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label className="block text-xs font-semibold uppercase text-on-surface-variant">
                      Mata Kuliah
                    </label>
                    <AppSelect value={subjectId} onValueChange={setSubjectId} disabled={!!editingId} className="mt-1 w-full" ariaLabel="Mata Kuliah" placeholder="Pilih mata kuliah" options={subjects.map((subject) => ({ value: subject.id, label: subject.name }))} />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold uppercase text-on-surface-variant">
                      Kode Paket Unik
                    </label>
                    <input
                      value={code}
                      onChange={(event) => setCode(event.target.value.toUpperCase())}
                      disabled={!!editingId}
                      required
                      placeholder="Kode paket, mis. FIS-NEWTON-01"
                      className="form-input mt-1 w-full font-mono-ui"
                    />
                  </div>

                  <div className="sm:col-span-2">
                    <label className="block text-xs font-semibold uppercase text-on-surface-variant">
                      Judul Ujian
                    </label>
                    <input
                      value={title}
                      onChange={(event) => setTitle(event.target.value)}
                      required
                      placeholder="Judul ujian konseptual"
                      className="form-input mt-1 w-full"
                    />
                  </div>

                  <div className="sm:col-span-2">
                    <label className="block text-xs font-semibold uppercase text-on-surface-variant">
                      Deskripsi / Instruksi Pengerjaan
                    </label>
                    <textarea
                      value={description}
                      onChange={(event) => setDescription(event.target.value)}
                      placeholder="Instruksi pengerjaan bagi mahasiswa"
                      rows={2}
                      className="form-input mt-1 w-full"
                    />
                  </div>
                </div>

                {/* Daftar Pertanyaan */}
                <div className="space-y-5">
                  {questions.map((question, questionIndex) => (
                    <section
                      key={questionIndex}
                      className="rounded-xl border border-outline-variant/40 bg-surface-container-low p-5"
                    >
                      <div className="flex items-center justify-between border-b border-outline-variant/30 pb-3">
                        <h3 className="font-semibold text-on-surface">
                          Pertanyaan {questionIndex + 1}
                        </h3>
                        {questions.length > 1 && !editingId && (
                          <button
                            type="button"
                            onClick={() => setPendingQuestionRemoval(questionIndex)}
                            className="text-error hover:text-on-error-container"
                            title="Hapus pertanyaan ini"
                          >
                            <Trash2 size={16} />
                          </button>
                        )}
                      </div>

                      {/* Prompt Pertanyaan */}
                      <div className="mt-4">
                        <label className="block text-xs font-semibold uppercase text-on-surface-variant">
                          Pertanyaan Konseptual
                        </label>
                        <textarea
                          value={question.prompt}
                          onChange={(event) =>
                            updateQuestion(questionIndex, "prompt", event.target.value)
                          }
                          required
                          placeholder="Tuliskan teks pertanyaan konseptual lengkap..."
                          rows={4}
                          className="form-input mt-1 w-full"
                        />
                      </div>

                      {/* Jawaban Referensi */}
                      <div className="mt-4">
                        <label className="block text-xs font-semibold uppercase text-on-surface-variant">
                          Jawaban Referensi (Model Answer)
                        </label>
                        <textarea
                          value={question.model_answer}
                          onChange={(event) =>
                            updateQuestion(questionIndex, "model_answer", event.target.value)
                          }
                          required
                          placeholder="Tuliskan jawaban referensi ilmiah yang tepat..."
                          rows={3}
                          className="form-input mt-1 w-full"
                        />
                      </div>

                      {/* Indikator Konsep */}
                      <div className="mt-4">
                        <label className="block text-xs font-semibold uppercase text-on-surface-variant">
                          Indikator Konsep Asesmen
                        </label>
                        <div className="mt-2 space-y-2">
                          {question.indicators.map((indicator, indicatorIndex) => (
                            <div
                              key={indicatorIndex}
                              className="grid grid-cols-[1fr_90px_32px] gap-2 items-center"
                            >
                              <input
                                value={indicator.label}
                                onChange={(event) =>
                                  updateIndicator(
                                    questionIndex,
                                    indicatorIndex,
                                    "label",
                                    event.target.value
                                  )
                                }
                                required
                                placeholder="Label indikator konsep"
                                className="form-input"
                              />
                              <input
                                type="number"
                                step="any"
                                min="0"
                                max="1"
                                value={indicator.weight}
                                onChange={(event) =>
                                  updateIndicator(
                                    questionIndex,
                                    indicatorIndex,
                                    "weight",
                                    Number(event.target.value)
                                  )
                                }
                                required
                                className="form-input font-mono-ui"
                              />
                              <button
                                type="button"
                                onClick={() =>
                                  setQuestions((current) =>
                                    current.map((item, index) =>
                                      index === questionIndex
                                        ? {
                                            ...item,
                                            indicators: item.indicators.filter(
                                              (_, innerIndex) => innerIndex !== indicatorIndex
                                            ),
                                          }
                                        : item
                                    )
                                  )
                                }
                                disabled={question.indicators.length <= 1}
                                className="text-error disabled:opacity-30 text-base font-bold text-center"
                              >
                                ×
                              </button>
                            </div>
                          ))}
                        </div>

                        <div className="mt-3 flex items-center justify-between text-xs">
                          <button
                            type="button"
                            onClick={() =>
                              setQuestions((current) =>
                                current.map((item, index) =>
                                  index === questionIndex
                                    ? {
                                        ...item,
                                        indicators: [
                                          ...item.indicators,
                                          { label: "", description: "", weight: 0.1 },
                                        ],
                                      }
                                    : item
                                )
                              )
                            }
                            className="font-semibold text-primary hover:underline"
                          >
                            + Tambah indikator
                          </button>
                          <span
                            className={`font-mono-ui font-bold ${
                              Math.abs((totals[questionIndex] ?? 0) - 1) < 0.001
                                ? "text-tertiary"
                                : "text-error"
                            }`}
                          >
                            Total bobot: {(totals[questionIndex] ?? 0).toFixed(4)}
                          </span>
                        </div>
                      </div>
                    </section>
                  ))}
                </div>

                {/* Tambah Pertanyaan Baru */}
                {!editingId && (
                  <button
                    type="button"
                    onClick={() => setQuestions((current) => [...current, blankQuestion()])}
                    className="btn-secondary"
                  >
                    <Plus size={16} /> Tambah pertanyaan
                  </button>
                )}

                {/* Checklist Publikasi */}
                <label className="flex items-center gap-2 pt-2 text-sm text-on-surface">
                  <input
                    type="checkbox"
                    checked={publish}
                    onChange={(event) => setPublish(event.target.checked)}
                    className="h-4 w-4 rounded border-outline-variant text-primary"
                  />
                  Terbitkan setelah semua pertanyaan valid (memerlukan bobot tepat 1.0000)
                </label>

                {/* Footer Modal Actions */}
                <div className="flex justify-end gap-3 border-t border-outline-variant/30 pt-4">
                  <button type="button" onClick={reset} className="btn-secondary">
                    Batal
                  </button>
                  <button type="submit" disabled={busy} className="btn-primary">
                    {busy
                      ? "Menyimpan..."
                      : editingId
                      ? "Perbarui paket"
                      : "Simpan paket"}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
