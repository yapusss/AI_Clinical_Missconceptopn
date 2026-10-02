"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft,
  CircleCheck,
  CircleStop,
  ChevronDown,
  ChevronUp,
  ClipboardList,
  Download,
  Eye,
  Filter,
  FileUp,
  GraduationCap,
  MoreVertical,
  Pencil,
  Plus,
  Send,
  TriangleAlert,
  X,
} from "lucide-react";
import { useAuth } from "../../../components/AuthProvider";
import ConfirmDialog from "../../../components/ConfirmDialog";
import ListToolbar from "../../../components/ListToolbar";
import PageContainer from "../../../components/PageContainer";
import PageHeader from "../../../components/PageHeader";
import QuestionBankImport from "../../../components/QuestionBankImport";

type QuestionSet = {
  id: string;
  code: string;
  title: string;
  subject_id: string;
  subject_name: string;
  topic_id?: string | null;
  topic_name?: string | null;
  question_count: number;
  total_submissions_count?: number;
  distinct_students_count?: number;
  pending_validations_count?: number;
  is_active: boolean;
  latest_versions: { is_published: boolean }[];
};

type SubjectOption = {
  id: string;
  slug: string;
  name: string;
};

function derivedSubjects(sets: QuestionSet[]): SubjectOption[] {
  const seen = new Map<string, SubjectOption>();
  sets.forEach((item) => {
    if (item.subject_id && !seen.has(item.subject_id)) {
      seen.set(item.subject_id, { id: item.subject_id, slug: item.subject_id, name: item.subject_name });
    }
  });
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export default function QuestionSetSubjectPage() {
  const { user, token, loading } = useAuth();
  const router = useRouter();
  const params = useParams<{ subjectId: string }>();
  const activeSubjectId = params?.subjectId ?? "";
  const [mounted, setMounted] = useState(false);

  const [sets, setSets] = useState<QuestionSet[]>([]);
  const [subjectOptions, setSubjectOptions] = useState<SubjectOption[]>([]);
  const [activeMenuId, setActiveMenuId] = useState<string | null>(null);

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [activeImportTab, setActiveImportTab] = useState(false);

  const [pendingDeactivate, setPendingDeactivate] = useState<QuestionSet | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilters, setStatusFilters] = useState<string[]>([]);
  const [topicFilterNames, setTopicFilterNames] = useState<string[]>([]);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [sortOrder, setSortOrder] = useState("CODE_ASC");
  const filterRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleOutsideClick = (event: MouseEvent) => {
      if (!filterRef.current?.contains(event.target as Node)) setFiltersOpen(false);
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setActiveMenuId(null);
      }
    };
    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, []);

  const load = useCallback(async () => {
    if (!token) return;
    const headers = { Authorization: `Bearer ${token}` };
    const [questionsResponse, summaryResponse] = await Promise.all([
      fetch("/api/questions", { headers }),
      fetch("/api/dashboard/summary", { headers }),
    ]);

    const nextSets: QuestionSet[] = questionsResponse.ok ? await questionsResponse.json() : [];
    if (questionsResponse.ok) setSets(nextSets);

    if (summaryResponse.ok) {
      const summary = await summaryResponse.json();
      const nextSubjects: SubjectOption[] = summary.my_subjects ?? [];
      setSubjectOptions(nextSubjects.length ? nextSubjects : derivedSubjects(nextSets));
    } else {
      setSubjectOptions(derivedSubjects(nextSets));
    }
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
      (!activeSubjectId || item.subject_id === activeSubjectId) &&
      `${item.code} ${item.title} ${item.subject_name} ${item.topic_name || ""} ${item.is_active ? "aktif" : "nonaktif"}`
        .toLowerCase()
        .includes(search.toLowerCase()) &&
      (!statusFilters.length || statusFilters.includes(item.is_active ? "ACTIVE" : "INACTIVE")) &&
      (!topicFilterNames.length || (item.topic_name && topicFilterNames.includes(item.topic_name)))
    )
    .sort((a, b) => {
      if (sortOrder === "TITLE_ASC") return a.title.localeCompare(b.title);
      if (sortOrder === "TITLE_DESC") return b.title.localeCompare(a.title);
      return a.code.localeCompare(b.code);
    });

  const topics = [...new Set(visibleSets.map((item) => item.topic_name).filter(Boolean) as string[])].sort();
  const filterCount = statusFilters.length + topicFilterNames.length;
  const activeSubject = subjectOptions.find((subject) => subject.id === activeSubjectId);
  const activeSubjectName = activeSubject?.name ?? sets.find((item) => item.subject_id === activeSubjectId)?.subject_name ?? "Mata Kuliah";

  const toggleFilter = (value: string, selected: string[], setSelected: (next: string[]) => void) => {
    setSelected(selected.includes(value) ? selected.filter((item) => item !== value) : [...selected, value]);
  };

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

  if (!mounted || loading) return null;
  if (!user) return null;

  return (
    <PageContainer>
      <Link href="/questions" className="inline-flex items-center gap-2 text-sm font-semibold text-primary no-underline hover:underline">
        <ArrowLeft size={16} /> Kembali ke daftar mata kuliah
      </Link>
      <PageHeader
        className="mt-4"
        title={activeSubjectName}
        description="Kelola paket soal konseptual, pantau pengumpulan mahasiswa, dan verifikasi diagnosis miskonsepsi."
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
          filters={
            <div ref={filterRef} className="relative">
              <button
                type="button"
                onClick={() => setFiltersOpen((open) => !open)}
                className={`list-toolbar-icon gap-1 px-2.5 ${filtersOpen || filterCount ? "!border-primary !text-primary bg-primary/10" : ""}`}
                aria-label={`Filter paket ujian${filterCount ? `, ${filterCount} dipilih` : ""}`}
              >
                <Filter size={17} aria-hidden="true" />
                {filtersOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              </button>
              {filtersOpen && (
                <div className="absolute right-0 top-[calc(100%+8px)] z-50 w-[320px] overflow-hidden rounded-xl border border-outline-variant/60 bg-surface-container-lowest p-3 shadow-2xl">
                  <div className="flex items-center justify-between border-b border-outline-variant/40 pb-2">
                    <p className="text-xs font-bold uppercase tracking-wide text-on-surface">Filter ({filterCount} dipilih)</p>
                    <button
                      type="button"
                      onClick={() => { setStatusFilters([]); setTopicFilterNames([]); }}
                      disabled={!filterCount}
                      className="text-xs font-semibold text-primary disabled:cursor-not-allowed disabled:text-on-surface-variant"
                    >
                      Reset
                    </button>
                  </div>
                  <fieldset className="mt-3">
                    <legend className="rounded-md bg-primary/10 px-2 py-1 text-xs font-bold uppercase tracking-wide text-primary">Status Paket</legend>
                    <div className="mt-2 space-y-1">
                      {[{ value: "ACTIVE", label: "Aktif" }, { value: "INACTIVE", label: "Nonaktif" }].map((option) => (
                        <label key={option.value} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-2 text-sm text-on-surface hover:bg-surface-container">
                          <input type="checkbox" checked={statusFilters.includes(option.value)} onChange={() => toggleFilter(option.value, statusFilters, setStatusFilters)} className="h-4 w-4 rounded accent-primary" />
                          {option.label}
                        </label>
                      ))}
                    </div>
                  </fieldset>
                  {topics.length > 0 && (
                    <fieldset className="mt-3 border-t border-outline-variant/40 pt-3">
                      <legend className="rounded-md bg-primary/10 px-2 py-1 text-xs font-bold uppercase tracking-wide text-primary">Topik</legend>
                      <div className="mt-2 max-h-40 space-y-1 overflow-y-auto">
                        {topics.map((top) => (
                          <label key={top} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-2 text-sm text-on-surface hover:bg-surface-container">
                            <input type="checkbox" checked={topicFilterNames.includes(top)} onChange={() => toggleFilter(top, topicFilterNames, setTopicFilterNames)} className="h-4 w-4 rounded accent-primary" />
                            {top}
                          </label>
                        ))}
                      </div>
                    </fieldset>
                  )}
                </div>
              )}
            </div>
          }
          sortOptions={[
            { value: "CODE_ASC", label: "Kode A-Z", direction: "asc" },
            { value: "TITLE_ASC", label: "Judul A-Z", direction: "asc" },
            { value: "TITLE_DESC", label: "Judul Z-A", direction: "desc" },
          ]}
          currentSort={sortOrder}
          onSortChange={setSortOrder}
        />
      </div>

      <div className="mt-6 rounded-xl border border-outline-variant/40 bg-surface-container-lowest shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm border-collapse">
            <thead className="border-b border-outline-variant/40 bg-surface-container-low text-on-surface-variant font-semibold text-xs uppercase">
              <tr>
                <th className="px-5 py-3.5 whitespace-nowrap">Kode</th>
                <th className="px-5 py-3.5 whitespace-nowrap">Topik</th>
                <th className="px-5 py-3.5">Judul Paket</th>
                <th className="px-5 py-3.5 whitespace-nowrap">Mata Kuliah</th>
                <th className="px-5 py-3.5 whitespace-nowrap">Status</th>
                <th className="pl-10 pr-5 py-3.5 text-right whitespace-nowrap">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-outline-variant/30">
              {visibleSets.map((item) => {
                const published = item.latest_versions?.length > 0 && item.latest_versions.every((v) => v.is_published);
                const isMenuOpen = activeMenuId === item.id;

                return (
                  <tr
                    key={item.id}
                    onClick={() => router.push(`/questions/${item.id}`)}
                    className="hover:bg-primary-fixed/5 transition-colors cursor-pointer"
                  >
                    <td className="px-5 py-4 align-middle whitespace-nowrap">
                      <span className="font-mono-ui font-bold text-xs text-primary bg-primary/10 px-2 py-0.5 rounded border border-primary/20">
                        {item.code}
                      </span>
                    </td>

                    <td className="px-5 py-4 align-middle whitespace-nowrap">
                      {item.topic_name ? (
                        <span className="text-xs text-tertiary-container bg-tertiary-container/10 px-2 py-0.5 rounded border border-tertiary-container/30 font-medium">
                          {item.topic_name}
                        </span>
                      ) : (
                        <span className="text-xs text-on-surface-variant/70 italic">—</span>
                      )}
                    </td>

                    <td className="px-5 py-4 align-middle">
                      <p className="font-semibold text-on-surface text-sm leading-snug">
                        {item.title}
                      </p>
                    </td>

                    <td className="px-5 py-4 align-middle text-on-surface-variant font-medium whitespace-nowrap">
                      {item.subject_name}
                    </td>

                    <td className="px-5 py-4 align-middle whitespace-nowrap">
                      <span className={`badge w-fit ${!published ? "badge-draft" : item.is_active ? "badge-active" : "badge-inactive"}`}>
                        {!published ? "Draft" : item.is_active ? "Aktif" : "Nonaktif"}
                      </span>
                    </td>

                    <td
                      className="pl-10 pr-5 py-4 align-middle text-right whitespace-nowrap"
                      onClick={(event) => event.stopPropagation()}
                    >
                      <div className="flex items-center justify-end gap-1.5">
                        {/* Tinjau Pengumpulan */}
                        <button
                          type="button"
                          onClick={() => router.push(`/questions/${item.id}`)}
                          className="btn-primary table-action-button !size-8 cursor-pointer"
                          title="Tinjau Pengumpulan"
                          aria-label="Tinjau Pengumpulan"
                        >
                          <GraduationCap size={15} />
                        </button>

                        {/* Pratinjau Soal */}
                        <button
                          type="button"
                          onClick={() => router.push(`/questions/${item.id}/view`)}
                          className="btn-secondary table-action-button !size-8 cursor-pointer"
                          title="Pratinjau Soal"
                          aria-label="Pratinjau Soal"
                        >
                          <Eye size={15} className="text-primary" />
                        </button>

                        {/* Edit Paket */}
                        <button
                          type="button"
                          onClick={() => router.push(`/questions/${item.id}/edit`)}
                          className="btn-secondary table-action-button !size-8 cursor-pointer"
                          title="Edit Paket"
                          aria-label="Edit Paket"
                        >
                          <Pencil size={15} className="text-primary" />
                        </button>

                        {/* Ekspor ke Excel */}
                        <button
                          type="button"
                          onClick={() => void exportPackage(item)}
                          className="btn-secondary table-action-button !size-8 cursor-pointer"
                          title="Ekspor ke Excel"
                          aria-label="Ekspor ke Excel"
                        >
                          <Download size={15} className="text-primary" />
                        </button>

                        {/* Tombol Terbitkan (Hanya muncul jika draft) */}
                        {!published && (
                          <button
                            type="button"
                            onClick={() => void publishSet(item.id)}
                            className="btn-secondary table-action-button !size-8 !border-primary/50 text-primary cursor-pointer"
                            title="Terbitkan Paket"
                            aria-label="Terbitkan Paket"
                          >
                            <Send size={13} />
                          </button>
                        )}

                        {/* Toggle Aktif / Nonaktif */}
                        <button
                          type="button"
                          onClick={() => {
                            if (item.is_active) {
                              setPendingDeactivate(item);
                            } else {
                              void toggleActiveSet(item.id);
                            }
                          }}
                          className={`table-action-button !size-8 inline-flex items-center justify-center cursor-pointer rounded-[5px] border font-medium transition-colors ${
                            item.is_active
                              ? "!border-rose-500/60 bg-rose-500/10 text-rose-500 hover:!border-rose-500 hover:!bg-rose-500 hover:!text-white"
                              : "!border-emerald-500/60 bg-emerald-500/10 text-emerald-500 hover:!border-emerald-500 hover:!bg-emerald-500 hover:!text-white"
                          }`}
                          title={item.is_active ? "Nonaktifkan Paket" : "Aktifkan Paket"}
                          aria-label={item.is_active ? "Nonaktifkan Paket" : "Aktifkan Paket"}
                        >
                          {item.is_active ? <CircleStop size={15} /> : <CircleCheck size={15} />}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {!visibleSets.length && (
          <p className="p-8 text-center text-sm text-on-surface-variant">
            Belum ada paket ujian yang cocok dengan kriteria filter.
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
                className="text-on-surface-variant hover:text-on-surface cursor-pointer"
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
                  <h3 className="mt-4 font-display text-base font-bold text-on-surface">Buat Manual</h3>
                  <p className="mt-1 text-sm text-on-surface-variant">
                    Buka formulir editor khusus dengan rubrik indikator konsep dan acuan kebenaran.
                  </p>
                  <span className="mt-4 text-xs font-bold text-primary">Mulai Buat Soal →</span>
                </button>

                <button
                  type="button"
                  onClick={() => setActiveImportTab(true)}
                  className="glass-card flex flex-col items-start p-5 text-left transition-colors hover:border-primary cursor-pointer"
                >
                  <span className="inline-flex h-11 w-11 items-center justify-center rounded-lg bg-primary-fixed text-primary">
                    <FileUp size={22} />
                  </span>
                  <h3 className="mt-4 font-display text-base font-bold text-on-surface">Import dari Excel</h3>
                  <p className="mt-1 text-sm text-on-surface-variant">
                    Unggah soal dan jawaban referensi secara bulk via file template .xlsx.
                  </p>
                  <span className="mt-4 text-xs font-bold text-primary">Buka Form Import →</span>
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
                {token && <QuestionBankImport token={token} />}
              </div>
            )}
          </div>
        </div>
      )}

      <ConfirmDialog
        open={!!pendingDeactivate}
        title="Nonaktifkan paket ujian?"
        description={`Paket "${pendingDeactivate?.title ?? ""}" tidak dapat diakses mahasiswa sampai diaktifkan kembali.`}
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