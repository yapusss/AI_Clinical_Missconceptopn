"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  CircleCheck,
  CircleStop,
  ChevronDown,
  ChevronUp,
  ClipboardList,
  Download,
  Eye,
  FileSpreadsheet,
  FileText,
  Filter,
  FileUp,
  GraduationCap,
  Layers,
  Pencil,
  Plus,
  Send,
  TriangleAlert,
  X,
} from "lucide-react";
import { useAuth } from "../components/AuthProvider";
import ConfirmDialog from "../components/ConfirmDialog";
import ListToolbar from "../components/ListToolbar";
import PageContainer from "../components/PageContainer";
import PageHeader from "../components/PageHeader";
import QuestionBankImport from "../components/QuestionBankImport";

type Indicator = {
  label: string;
  description: string;
  weight: number;
};

type QuestionVersionDetail = {
  prompt: string;
  model_answer: string;
  indicators?: Indicator[];
};

type QuestionItem = {
  id: string;
  order_index: number;
  versions?: QuestionVersionDetail[];
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

type Subject = {
  id: string;
  name: string;
};

type QuestionSetDetail = QuestionSet & {
  description?: string;
  questions?: QuestionItem[];
};

export default function QuestionsPage() {
  const { user, token, loading } = useAuth();
  const router = useRouter();
  const [mounted, setMounted] = useState(false);

  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [sets, setSets] = useState<QuestionSet[]>([]);
  const [viewingSet, setViewingSet] = useState<QuestionSetDetail | null>(null);
  const [viewModalMode, setViewModalMode] = useState<"per_question" | "all_questions">("per_question");
  const [activeModalIndex, setActiveModalIndex] = useState(0);

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [activeImportTab, setActiveImportTab] = useState(false);

  const [pendingDeactivate, setPendingDeactivate] = useState<QuestionSet | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilters, setStatusFilters] = useState<string[]>([]);
  const [subjectFilterIds, setSubjectFilterIds] = useState<string[]>([]);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [sortOrder, setSortOrder] = useState("CODE_ASC");
  const filterRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const closeFilters = (event: MouseEvent) => {
      if (!filterRef.current?.contains(event.target as Node)) setFiltersOpen(false);
    };
    if (filtersOpen) document.addEventListener("mousedown", closeFilters);
    return () => document.removeEventListener("mousedown", closeFilters);
  }, [filtersOpen]);

  const load = useCallback(async () => {
    if (!token) return;
    const [summaryRes, setsRes] = await Promise.all([
      fetch("/api/dashboard/summary", { headers: { Authorization: `Bearer ${token}` } }),
      fetch("/api/questions", { headers: { Authorization: `Bearer ${token}` } }),
    ]);

    const summary = await summaryRes.json();
    setSubjects(summary?.summary?.my_subjects ?? []);
    setSets(await setsRes.json());
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

  const visibleSets = sets
    .filter((item) =>
      `${item.code} ${item.title} ${item.subject_name} ${item.is_active ? "aktif" : "nonaktif"}`
        .toLowerCase()
        .includes(search.toLowerCase()) &&
      (!statusFilters.length || statusFilters.includes(item.is_active ? "ACTIVE" : "INACTIVE")) &&
      (!subjectFilterIds.length || subjectFilterIds.includes(item.subject_name)),
    )
    .sort((a, b) => {
      if (sortOrder === "TITLE_ASC") return a.title.localeCompare(b.title);
      if (sortOrder === "TITLE_DESC") return b.title.localeCompare(a.title);
      return a.code.localeCompare(b.code);
    });

  const subjects = [...new Set(sets.map((item) => item.subject_name).filter(Boolean))].sort();
  const filterCount = statusFilters.length + subjectFilterIds.length;
  const toggleFilter = (value: string, selected: string[], setSelected: (next: string[]) => void) => {
    setSelected(selected.includes(value) ? selected.filter((item) => item !== value) : [...selected, value]);
  };

  async function downloadTemplate() {
    if (!token) return;
    try {
      const response = await fetch("/api/question-import-template", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) throw new Error("Gagal mengunduh template Excel.");
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "template-bank-soal-multi-matkul.xlsx";
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal mengunduh template.");
    }
  }

  async function exportPackage(item: QuestionSet) {
    if (!token) return;
    try {
      const response = await fetch(`/api/questions/${item.id}/export`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) throw new Error("Gagal mengekspor paket ke Excel.");
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${item.code}-export.xlsx`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal mengekspor paket.");
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

  async function viewSet(item: QuestionSet) {
    if (!token) return;
    setError("");
    try {
      const response = await fetch(`/api/questions/${item.id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || "Gagal memuat detail paket ujian.");
      setViewingSet({ ...item, ...data });
      setActiveModalIndex(0);
      setViewModalMode("per_question");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Gagal memuat detail paket ujian.");
    }
  }

  if (!mounted || loading) {
    return (
      <main className="flex min-h-screen items-center justify-center font-body">
        <p className="text-sm text-on-surface-variant">Memuat data soal...</p>
      </main>
    );
  }

  if (!user) return null;

  return (
    <PageContainer>
      <PageHeader
        title="Manajemen Paket Ujian"
        description="Satu kode berisi pertanyaan konseptual yang dikerjakan sebagai satu evaluasi."
        icon={ClipboardList}
      />

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

      <div className="mt-6">
        <ListToolbar
          addLabel="Buat paket ujian"
          onAdd={() => {
            setActiveImportTab(false);
            setShowCreateModal(true);
          }}
          searchValue={search}
          onSearchChange={setSearch}
          searchPlaceholder="Cari kode, judul, atau mata kuliah..."
          filters={<div ref={filterRef} className="relative"><button type="button" onClick={() => setFiltersOpen((open) => !open)} className={`list-toolbar-icon gap-1 px-2.5 ${filtersOpen || filterCount ? "!border-primary !text-primary bg-primary/10" : ""}`} aria-label={`Filter paket ujian${filterCount ? `, ${filterCount} dipilih` : ""}`} aria-expanded={filtersOpen} title="Filter paket ujian"><Filter size={17} aria-hidden="true" />{filtersOpen ? <ChevronUp size={14} aria-hidden="true" /> : <ChevronDown size={14} aria-hidden="true" />}</button>{filtersOpen && <div className="absolute right-0 top-[calc(100%+8px)] z-50 w-[320px] overflow-hidden rounded-xl border border-outline-variant/60 bg-surface-container-lowest p-3 shadow-2xl"><div className="flex items-center justify-between border-b border-outline-variant/40 pb-2"><p className="text-xs font-bold uppercase tracking-wide text-on-surface">Filter terpadu ({filterCount} dipilih)</p><button type="button" onClick={() => { setStatusFilters([]); setSubjectFilterIds([]); }} disabled={!filterCount} className="text-xs font-semibold text-primary disabled:cursor-not-allowed disabled:text-on-surface-variant">Reset</button></div><fieldset className="mt-3"><legend className="rounded-md bg-primary/10 px-2 py-1 text-xs font-bold uppercase tracking-wide text-primary">Status paket</legend><div className="mt-2 space-y-1">{[{ value: "ACTIVE", label: "Aktif" }, { value: "INACTIVE", label: "Nonaktif" }].map((option) => <label key={option.value} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-2 text-sm text-on-surface hover:bg-surface-container"><input type="checkbox" checked={statusFilters.includes(option.value)} onChange={() => toggleFilter(option.value, statusFilters, setStatusFilters)} className="h-4 w-4 rounded border-outline-variant accent-primary" />{option.label}</label>)}</div></fieldset><fieldset className="mt-3 border-t border-outline-variant/40 pt-3"><legend className="rounded-md bg-primary/10 px-2 py-1 text-xs font-bold uppercase tracking-wide text-primary">Mata kuliah</legend><div className="mt-2 max-h-52 space-y-1 overflow-y-auto">{subjects.length ? subjects.map((subject) => <label key={subject} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-2 text-sm text-on-surface hover:bg-surface-container"><input type="checkbox" checked={subjectFilterIds.includes(subject)} onChange={() => toggleFilter(subject, subjectFilterIds, setSubjectFilterIds)} className="h-4 w-4 rounded border-outline-variant accent-primary" />{subject}</label>) : <p className="px-2 py-2 text-sm text-on-surface-variant">Belum ada mata kuliah.</p>}</div></fieldset></div>}</div>}
          sortOptions={[{ value: "CODE_ASC", label: "Kode A-Z", direction: "asc" }, { value: "TITLE_ASC", label: "Judul A-Z", direction: "asc" }, { value: "TITLE_DESC", label: "Judul Z-A", direction: "desc" }]}
          currentSort={sortOrder}
          onSortChange={setSortOrder}
        />
      </div>

      <div className="mt-8 rounded-xl border border-outline-variant/40 bg-surface-container-lowest shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-outline-variant/40 bg-surface-container-low text-on-surface-variant font-semibold">
              <tr>
                <th className="px-4 py-3.5 text-left whitespace-nowrap">Kode</th>
                <th className="px-4 py-3.5 text-left">Paket</th>
                <th className="px-4 py-3.5 text-left whitespace-nowrap">Mata Kuliah</th>
                <th className="px-4 py-3.5 text-left whitespace-nowrap">Publikasi</th>
                <th className="px-4 py-3.5 text-left whitespace-nowrap">Ketersediaan</th>
                <th className="px-4 py-3.5 text-left whitespace-nowrap">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-outline-variant/30">
              {visibleSets.map((item) => {
                const published =
                  item.latest_versions?.length > 0 &&
                  item.latest_versions.every((version) => version.is_published);

                return (
                  <tr key={item.id} className="hover:bg-primary-fixed/5 transition-colors">
                    <td className="px-4 py-3.5 font-mono-ui font-bold text-primary text-left whitespace-nowrap align-middle">
                      {item.code}
                    </td>

                    <td className="px-4 py-3.5 text-left align-middle max-w-[160px] sm:max-w-[220px]">
                      <div className="font-semibold text-on-surface leading-snug break-all sm:break-words">
                        {item.title}
                      </div>
                      <div className="text-xs text-on-surface-variant mt-0.5 whitespace-nowrap">
                        {item.question_count} pertanyaan
                      </div>
                    </td>

                    <td className="px-4 py-3.5 text-left text-on-surface-variant whitespace-nowrap align-middle">
                      {item.subject_name}
                    </td>

                    <td className="px-4 py-3.5 text-left align-middle whitespace-nowrap">
                      <span className={`badge ${published ? "badge-active" : "badge-draft"}`}>
                        {published ? "Terbit" : "Draft"}
                      </span>
                    </td>

                    <td className="px-4 py-3.5 text-left align-middle whitespace-nowrap">
                      <span
                        className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold whitespace-nowrap ${
                          item.is_active
                            ? "border border-tertiary/40 bg-tertiary/10 text-tertiary"
                            : "border border-error/40 bg-error/10 text-error"
                        }`}
                      >
                        {item.is_active ? "Aktif" : "Nonaktif"}
                      </span>
                    </td>

                    <td className="px-5 py-4 text-left">
                      <div className="flex flex-wrap items-center justify-start gap-2">
                        <button
                            type="button"
                            onClick={() => router.push(`/questions/${item.id}/view`)}
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
                          onClick={() => router.push(`/questions/${item.id}/edit`)}
                          className="btn-secondary table-action-button"
                          aria-label="Edit paket ujian"
                          title="Edit paket ujian"
                        >
                          <Pencil size={18} stroke="#4f46e5" strokeWidth={2.5} aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          onClick={() => void exportPackage(item)}
                          className="btn-secondary table-action-button"
                          aria-label="Export paket ke Excel"
                          title="Export ke Excel"
                        >
                          <Download size={18} stroke="#4f46e5" strokeWidth={2.5} aria-hidden="true" />
                        </button>

                        <button
                          type="button"
                          onClick={() =>
                            item.is_active
                              ? setPendingDeactivate(item)
                              : void toggleActiveSet(item.id)
                          }
                          className={`btn-secondary table-action-button transition-colors ${
                            item.is_active
                              ? "border-error/40 bg-surface-container-lowest text-error hover:bg-error-container/40"
                              : "border-tertiary/40 bg-surface-container-lowest text-tertiary hover:bg-tertiary-container/30"
                          }`}
                          aria-label={item.is_active ? "Nonaktifkan paket ujian" : "Aktifkan paket ujian"}
                          title={item.is_active ? "Nonaktifkan paket ujian" : "Aktifkan paket ujian"}
                        >
                          {item.is_active ? (
                            <CircleStop size={18} stroke="#dc2626" strokeWidth={2.5} aria-hidden="true" />
                          ) : (
                            <CircleCheck size={18} stroke="#059669" strokeWidth={2.5} aria-hidden="true" />
                          )}
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
          <p className="p-8 text-center text-sm text-on-surface-variant">
            Belum ada paket ujian.
          </p>
        )}
      </div>

      {showCreateModal && (
        <div className="fixed inset-0 z-[200] flex items-start justify-center overflow-y-auto bg-black/60 p-4">
          <div className="my-8 w-full max-w-2xl rounded-2xl border border-outline-variant/40 bg-surface-container-lowest p-6 shadow-2xl space-y-5">
            <div className="flex items-center justify-between border-b border-outline-variant/30 pb-4">
              <div>
                <h2 className="font-display text-xl font-bold text-on-surface">
                  {activeImportTab ? "Import Bank Soal" : "Kelola Paket Ujian"}
                </h2>
                <p className="mt-1 text-xs text-on-surface-variant">
                  Pilih metode pembuatan paket soal atau gunakan format template Excel.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowCreateModal(false)}
                className="text-on-surface-variant hover:text-on-surface"
              >
                <X size={20} />
              </button>
            </div>

            {!activeImportTab ? (
              <div className="grid gap-4 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowCreateModal(false);
                    router.push("/questions/create");
                  }}
                  className="glass-card flex flex-col items-start p-5 text-left transition-colors hover:border-primary cursor-pointer"
                >
                  <span className="inline-flex h-11 w-11 items-center justify-center rounded-lg bg-primary-fixed text-primary">
                    <Plus size={22} />
                  </span>
                  <h3 className="mt-4 font-display text-base font-bold text-on-surface">
                    Buat Manual
                  </h3>
                  <p className="mt-1 text-sm text-on-surface-variant">
                    Buka editor khusus per-soal dengan palet nomor soal ujian dan rubrik penilaian 100.
                  </p>
                  <span className="mt-4 text-xs font-bold text-primary">
                    Mulai Buat Soal →
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => setActiveImportTab(true)}
                  className="glass-card flex flex-col items-start p-5 text-left transition-colors hover:border-primary cursor-pointer"
                >
                  <span className="inline-flex h-11 w-11 items-center justify-center rounded-lg bg-primary-fixed text-primary">
                    <FileUp size={22} />
                  </span>
                  <h3 className="mt-4 font-display text-base font-bold text-on-surface">
                    Import dari Excel
                  </h3>
                  <p className="mt-1 text-sm text-on-surface-variant">
                    Unggah file soal dan jawaban secara massal menggunakan file Excel (.xlsx).
                  </p>
                  <span className="mt-4 text-xs font-bold text-primary">
                    Buka Form Import →
                  </span>
                </button>
              </div>
            ) : (
              <div>
                <button
                  type="button"
                  onClick={() => setActiveImportTab(false)}
                  className="mb-4 text-xs font-semibold text-primary hover:underline flex items-center gap-1 cursor-pointer"
                >
                  ← Kembali ke pilihan metode
                </button>
                {token && (
                  <QuestionBankImport
                    token={token}
                  />
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {viewingSet && (
        <div className="fixed inset-0 z-[200] flex items-start justify-center overflow-y-auto bg-black/60 p-4">
          <div className="my-8 w-full max-w-4xl rounded-2xl border border-outline-variant/40 bg-surface-container-lowest p-6 shadow-2xl space-y-4">
            <div className="flex items-start justify-between gap-4 border-b border-outline-variant/30 pb-4">
              <div>
                <p className="font-mono-ui text-xs font-bold text-primary">{viewingSet.code}</p>
                <h2 className="mt-1 font-display text-xl font-bold text-on-surface">
                  {viewingSet.title}
                </h2>
                <p className="mt-1 text-sm text-on-surface-variant">{viewingSet.subject_name}</p>
              </div>

              <div className="flex items-center gap-3">
                <div className="flex items-center rounded-lg border border-outline-variant/40 bg-surface-container-low p-1 text-xs">
                  <button
                    type="button"
                    onClick={() => setViewModalMode("per_question")}
                    className={`flex items-center gap-1 px-2.5 py-1 rounded font-semibold ${
                      viewModalMode === "per_question"
                        ? "bg-primary text-white"
                        : "text-on-surface-variant hover:text-on-surface"
                    }`}
                  >
                    <FileText size={13} /> Per Soal
                  </button>
                  <button
                    type="button"
                    onClick={() => setViewModalMode("all_questions")}
                    className={`flex items-center gap-1 px-2.5 py-1 rounded font-semibold ${
                      viewModalMode === "all_questions"
                        ? "bg-primary text-white"
                        : "text-on-surface-variant hover:text-on-surface"
                    }`}
                  >
                    <Layers size={13} /> Semua Soal
                  </button>
                </div>

                <button
                  type="button"
                  onClick={() => setViewingSet(null)}
                  aria-label="Tutup detail"
                  className="text-on-surface-variant hover:text-on-surface"
                >
                  <X size={20} />
                </button>
              </div>
            </div>

            {viewingSet.description && (
              <p className="whitespace-pre-line text-sm text-on-surface-variant">
                {viewingSet.description}
              </p>
            )}

            {(() => {
              const qList = viewingSet.questions ?? [];
              if (qList.length === 0) {
                return (
                  <p className="text-sm text-on-surface-variant py-4">
                    Belum ada pertanyaan pada paket ini.
                  </p>
                );
              }

              if (viewModalMode === "per_question") {
                const currentQ = qList[activeModalIndex];
                const version = currentQ?.versions?.[0];

                return (
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-4 items-start pt-2">
                    <div className="md:col-span-3 rounded-xl border border-outline-variant/40 bg-surface-container-low p-4 space-y-3">
                      <div className="flex items-center justify-between">
                        <h3 className="font-semibold text-on-surface">
                          Pertanyaan {activeModalIndex + 1}
                        </h3>
                      </div>
                      <p className="whitespace-pre-line text-sm text-on-surface">
                        {version?.prompt}
                      </p>

                      <p className="text-xs font-semibold uppercase text-on-surface-variant pt-2">
                        Jawaban Referensi
                      </p>
                      <p className="whitespace-pre-line text-sm text-on-surface-variant">
                        {version?.model_answer}
                      </p>

                      {version?.indicators && version.indicators.length > 0 && (
                        <div className="pt-2">
                          <p className="text-xs font-semibold uppercase text-on-surface-variant mb-2">
                            Rubrik Penilaian
                          </p>
                          <div className="space-y-1.5">
                            {version.indicators.map((ind, iIdx) => (
                              <div
                                key={iIdx}
                                className="flex items-center justify-between text-xs rounded border border-outline-variant/30 p-2 bg-surface-container-lowest"
                              >
                                <div>
                                  <span className="font-semibold text-on-surface">{ind.label}</span>
                                  {ind.description && (
                                    <span className="text-on-surface-variant ml-2">
                                      - {ind.description}
                                    </span>
                                  )}
                                </div>
                                <span className="font-mono-ui font-bold text-primary">
                                  {Math.round(Number(ind.weight) * 100)} / 100
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>

                    <div className="md:col-span-1 rounded-xl border border-outline-variant/40 bg-surface-container-lowest p-3">
                      <p className="text-xs font-semibold text-on-surface mb-2">Pilih Nomor Soal</p>
                      <div className="flex flex-wrap gap-2">
                        {qList.map((_, idx) => (
                          <button
                            key={idx}
                            type="button"
                            onClick={() => setActiveModalIndex(idx)}
                            className={`flex h-8 w-8 items-center justify-center rounded-full font-mono-ui text-xs font-bold !text-white transition-colors ${
                              activeModalIndex === idx
                                ? "bg-primary shadow ring-2 ring-primary/40"
                                : "bg-slate-700 hover:bg-slate-600"
                            }`}
                          >
                            {idx + 1}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                );
              }

              return (
                <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-2">
                  {qList.map((q, idx) => {
                    const version = q.versions?.[0];
                    return (
                      <section
                        key={idx}
                        className="rounded-xl border border-outline-variant/40 bg-surface-container-low p-4 space-y-2"
                      >
                        <h3 className="font-semibold text-on-surface">Pertanyaan {idx + 1}</h3>
                        <p className="whitespace-pre-line text-sm text-on-surface">
                          {version?.prompt}
                        </p>
                        <p className="text-xs font-semibold uppercase text-on-surface-variant pt-2">
                          Jawaban referensi
                        </p>
                        <p className="whitespace-pre-line text-sm text-on-surface-variant">
                          {version?.model_answer}
                        </p>
                        {version?.indicators && version.indicators.length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-2">
                            {version.indicators.map((ind, iIdx) => (
                              <span key={iIdx} className="badge badge-role text-xs">
                                {ind.label} · {Math.round(Number(ind.weight) * 100)}%
                              </span>
                            ))}
                          </div>
                        )}
                      </section>
                    );
                  })}
                </div>
              );
            })()}
          </div>
        </div>
      )}

      <ConfirmDialog
        open={!!pendingDeactivate}
        title="Nonaktifkan paket ujian?"
        description={`Paket "${pendingDeactivate?.title ?? ""}" tidak lagi dapat digunakan mahasiswa sampai diaktifkan kembali.`}
        confirmLabel="Nonaktifkan"
        onCancel={() => setPendingDeactivate(null)}
        onConfirm={() => {
          if (pendingDeactivate) void toggleActiveSet(pendingDeactivate.id);
          setPendingDeactivate(null);
        }}
      />
    </PageContainer>
  );
}
