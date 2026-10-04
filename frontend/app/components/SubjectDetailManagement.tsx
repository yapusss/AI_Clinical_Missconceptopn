"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  ArrowLeft,
  BookOpen,
  ChevronDown,
  ChevronRight,
  CircleCheck,
  CircleStop,
  ClipboardList,
  Copy,
  FileText,
  FileUp,
  Pencil,
  Plus,
  Tags,
  Trash2,
  X,
} from "lucide-react";
import ConfirmDialog from "./ConfirmDialog";
import FormModal from "./FormModal";
import AppSelect from "./AppSelect";
import ListToolbar from "./ListToolbar";
import PageContainer from "./PageContainer";
import PageHeader from "./PageHeader";
import QuestionBankImport from "./QuestionBankImport";
import RowMenu from "./RowMenu";

type Subject = {
  id: string;
  name: string;
  slug: string;
  description: string;
  is_active: boolean;
};
type Topic = { id: string; name: string; description: string };
type BankSet = {
  id: string;
  topic_id: string;
  title: string;
  question_count: number;
  latest_versions: {
    question_id: string;
    prompt_preview: string;
    is_published: boolean;
  }[];
};
type ExamPackage = {
  id: string;
  code: string;
  title: string;
  description?: string;
  subject_id: string;
  question_count: number;
  is_active: boolean;
  created_at: string;
};
const blankTopic = { name: "", description: "" };

export default function SubjectDetailManagement({
  token,
  subjectId,
  lecturerView = false,
  backHref = "/admin/subjects",
  backLabel = "Kembali ke mata kuliah",
}: {
  token: string;
  subjectId: string;
  lecturerView?: boolean;
  backHref?: string;
  backLabel?: string;
}) {
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
  const [deletingSet, setDeletingSet] = useState<BankSet | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [chooserTopic, setChooserTopic] = useState<Topic | null>(null);
  const [importTopic, setImportTopic] = useState<Topic | null>(null);
  const [busy, setBusy] = useState(false);
  const [duplicatingPackageId, setDuplicatingPackageId] = useState<string | null>(
    null,
  );
  const [error, setError] = useState("");
  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  };
  const message = async (response: Response) => {
    const data = await response.json().catch(() => ({}));
    return (
      data.detail ||
      Object.values(data).flat().join(" ") ||
      "Permintaan gagal diproses."
    );
  };

  const load = async () => {
    const requests = [
      fetch(`/api/admin/subjects/${subjectId}`, { headers }),
      fetch(`/api/admin/subjects/${subjectId}/topics`, { headers }),
    ];
    if (lecturerView)
      requests.push(
        fetch(`/api/questions?subject_id=${subjectId}`, { headers }),
        fetch(`/api/exam-packages?subject_id=${subjectId}`, { headers }),
      );
    const [subjectResponse, topicResponse, bankResponse, packageResponse] =
      await Promise.all(requests);
    if (!subjectResponse.ok || !topicResponse.ok)
      throw new Error("Mata kuliah tidak ditemukan.");
    setSubject(await subjectResponse.json());
    const nextTopics = await topicResponse.json();
    setTopics(nextTopics);
    setExpandedTopics(nextTopics.map((topic: Topic) => topic.id));
    if (bankResponse?.ok) setBankSets(await bankResponse.json());
    if (packageResponse?.ok) setPackages(await packageResponse.json());
  };

  useEffect(() => {
    void load().catch((caught) =>
      setError(caught instanceof Error ? caught.message : "Gagal memuat data."),
    );
  }, [subjectId, token, lecturerView]);
  const openTopicForm = (topic?: Topic) => {
    setEditing(topic ?? null);
    setForm(
      topic ? { name: topic.name, description: topic.description } : blankTopic,
    );
    setShowForm(true);
    setError("");
  };
  const saveTopic = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await fetch(
        editing
          ? `/api/admin/topics/${editing.id}`
          : `/api/admin/subjects/${subjectId}/topics`,
        {
          method: editing ? "PATCH" : "POST",
          headers,
          body: JSON.stringify(form),
        },
      );
      if (!response.ok) throw new Error(await message(response));
      setShowForm(false);
      await load();
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Gagal menyimpan topik.",
      );
    } finally {
      setBusy(false);
    }
  };
  const removeTopic = async (topic: Topic) => {
    setDeleting(null);
    const response = await fetch(`/api/admin/topics/${topic.id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) {
      setError(await message(response));
      return;
    }
    await load();
  };
  const removeSet = async (set: BankSet) => {
    const response = await fetch(`/api/questions/${set.id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) {
      setError(await message(response));
      return;
    }
    setDeletingSet(null);
    await load();
  };
  const togglePackage = async (id: string) => {
    const response = await fetch(`/api/exam-packages/${id}/toggle-active`, {
      method: "PATCH",
      headers,
    });
    if (!response.ok) {
      setError(await message(response));
      return;
    }
    await load();
  };
  const duplicatePackage = async (id: string) => {
    setDuplicatingPackageId(id);
    setError("");
    try {
      const response = await fetch(`/api/exam-packages/${id}/duplicate`, {
        method: "POST",
        headers,
      });
      if (!response.ok) throw new Error(await message(response));
      await load();
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Gagal menduplikasi paket.",
      );
    } finally {
      setDuplicatingPackageId(null);
    }
  };
  return (
    <PageContainer>
      <style jsx global>{`
        section.mt-7 > div.mt-6 > div.flex > button.btn-primary {
          display: none;
        }
        section.mt-7 article a[title="Tambah soal"] {
          padding-top: 0.5rem;
          padding-bottom: 0.5rem;
        }
        section.mt-7 article a[title="Tambah soal"] svg {
          width: 1.25rem;
          height: 1.25rem;
        }
        section.mt-7 article > div:last-child {
          animation: topic-expand 240ms ease-out;
        }
        @keyframes topic-expand {
          from {
            opacity: 0;
            transform: translateY(-0.35rem);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        @media (prefers-reduced-motion: reduce) {
          section.mt-7 article > div:last-child {
            animation: none;
          }
        }
      `}</style>
      <Link
        href={backHref}
        className="mb-5 inline-flex items-center gap-2 text-sm font-semibold text-primary"
      >
        <ArrowLeft size={16} /> {backLabel}
      </Link>
      {error && (
        <div
          role="alert"
          className="mb-5 rounded-lg border border-error/40 bg-error-container p-3 text-sm text-on-error-container"
        >
          {error}
        </div>
      )}
      {subject && (
        <>
          <PageHeader
            title={subject.name}
            description={subject.slug}
            icon={BookOpen}
            eyebrow={
              <span className="text-xs font-bold uppercase tracking-wider text-primary">
                Mata Kuliah
              </span>
            }
            action={
              <span className={`badge ${subject.is_active ? "badge-active" : "badge-revoked"}`}>
                {subject.is_active ? "Aktif" : "Nonaktif"}
              </span>
            }
          />
          {subject.description && (
            <p className="mt-3 max-w-3xl text-sm leading-6 text-on-surface-variant">
              {subject.description}
            </p>
          )}
        </>
      )}
      {lecturerView ? (
        <LecturerWorkspace
          topics={topics}
          bankSets={bankSets}
          packages={packages}
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          expandedTopics={expandedTopics}
          setExpandedTopics={setExpandedTopics}
          onAddTopic={() => openTopicForm()}
          onAddQuestion={(topic) => setChooserTopic(topic)}
          onEditTopic={openTopicForm}
          onDeleteTopic={setDeleting}
          onEditSet={(set) => router.push(`/questions/${set.id}/edit`)}
          onDeleteSet={setDeletingSet}
          onCreatePackage={() =>
            router.push(`/exam-packages/create?subject_id=${subjectId}`)
          }
          onTogglePackage={togglePackage}
          onDuplicatePackage={duplicatePackage}
          duplicatingPackageId={duplicatingPackageId}
        />
      ) : (
        <AdminTopics
          topics={topics}
          search={search}
          setSearch={setSearch}
          openForm={openTopicForm}
          setDeleting={setDeleting}
        />
      )}
      {lecturerView && activeTab === "TOPICS" && topics.length > 0 && (
        <button
          type="button"
          onClick={() => openTopicForm()}
          className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed border-primary/50 bg-primary/5 px-5 py-4 text-sm font-semibold text-primary transition-colors hover:border-primary hover:bg-primary/10"
        >
          <span className="grid size-7 place-items-center rounded-md bg-primary text-white">
            <Plus size={17} strokeWidth={3} />
          </span>
          Tambah topik
        </button>
      )}
      {showForm && (
        <FormModal
          title={editing ? "Edit topik" : "Tambah topik"}
          subtitle="Perbarui nama dan deskripsi topik."
          icon={Tags}
          onClose={() => setShowForm(false)}
          onSubmit={saveTopic}
          footer={
            <>
              <button
                type="button"
                onClick={() => setShowForm(false)}
                className="btn-secondary"
              >
                Batal
              </button>
              <button type="submit" disabled={busy} className="btn-primary">
                {busy ? "Menyimpan..." : "Simpan"}
              </button>
            </>
          }
        >
          <div className="space-y-4">
            <div>
              <label
                htmlFor="topic-name"
                className="mb-1.5 block text-sm font-medium text-on-surface-variant"
              >
                Nama topik
              </label>
              <input
                id="topic-name"
                value={form.name}
                onChange={(event) =>
                  setForm({ ...form, name: event.target.value })
                }
                required
                className="form-input"
              />
            </div>
            <div>
              <label
                htmlFor="topic-description"
                className="mb-1.5 block text-sm font-medium text-on-surface-variant"
              >
                Deskripsi
              </label>
              <textarea
                id="topic-description"
                value={form.description}
                onChange={(event) =>
                  setForm({ ...form, description: event.target.value })
                }
                rows={3}
                className="form-input"
              />
            </div>
          </div>
        </FormModal>
      )}
      {showImport && (
        <div
          className="fixed inset-0 z-[300] flex items-start justify-center overflow-y-auto bg-black/60 p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="my-8 w-full max-w-2xl rounded-2xl border border-outline-variant/40 bg-surface-container-lowest p-6 shadow-2xl space-y-5">
            <div className="flex items-center justify-between border-b border-outline-variant/30 pb-4">
              <div>
                <h2 className="font-display text-xl font-bold text-on-surface">
                  Import Bank Soal
                </h2>
                <p className="mt-1 text-xs text-on-surface-variant">
                  Unggah pertanyaan, jawaban singkat, dan alasan jawaban secara
                  bulk via file template .xlsx.
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setShowImport(false);
                  setImportTopic(null);
                }}
                className="text-on-surface-variant hover:text-on-surface cursor-pointer"
                aria-label="Tutup"
              >
                <X size={20} />
              </button>
            </div>
            <QuestionBankImport
              token={token}
              subjectId={subjectId}
              subjectName={subject?.name}
              topicId={importTopic?.id}
              topicName={importTopic?.name}
            />
          </div>
        </div>
      )}
      {chooserTopic && (
        <div
          className="fixed inset-0 z-[300] flex items-center justify-center bg-black/60 p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-md rounded-2xl border border-outline-variant/40 bg-surface-container-lowest p-6 shadow-2xl space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="font-display text-lg font-bold text-on-surface">
                  Tambah Soal
                </h3>
                <p className="mt-1 text-sm text-on-surface-variant">
                  Topik{" "}
                  <span className="font-semibold text-on-surface">
                    {chooserTopic.name}
                  </span>
                  . Pilih cara menambahkan soal.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setChooserTopic(null)}
                className="text-on-surface-variant hover:text-on-surface cursor-pointer"
                aria-label="Tutup"
              >
                <X size={18} />
              </button>
            </div>
            <div className="grid gap-3">
              <button
                type="button"
                onClick={() => {
                  const topic = chooserTopic;
                  setChooserTopic(null);
                  router.push(
                    `/questions/create?subject_id=${subjectId}&topic_id=${topic.id}`,
                  );
                }}
                className="glass-card flex items-center gap-3 p-4 text-left transition-colors hover:border-primary cursor-pointer"
              >
                <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary-fixed text-primary">
                  <Plus size={20} />
                </span>
                <span>
                  <span className="block font-semibold text-on-surface">
                    Buat Soal Baru
                  </span>
                  <span className="block text-xs text-on-surface-variant">
                    Isi manual pertanyaan, jawaban singkat, dan alasan.
                  </span>
                </span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setImportTopic(chooserTopic);
                  setChooserTopic(null);
                  setShowImport(true);
                }}
                className="glass-card flex items-center gap-3 p-4 text-left transition-colors hover:border-primary cursor-pointer"
              >
                <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary-fixed text-primary">
                  <FileUp size={20} />
                </span>
                <span>
                  <span className="block font-semibold text-on-surface">
                    Import Excel
                  </span>
                  <span className="block text-xs text-on-surface-variant">
                    Unggah banyak soal sekaligus dari template .xlsx.
                  </span>
                </span>
              </button>
            </div>
          </div>
        </div>
      )}
      <ConfirmDialog
        open={!!deleting}
        title="Hapus topik?"
        description={`Topik "${deleting?.name ?? ""}" akan dihapus.`}
        confirmLabel="Hapus topik"
        onCancel={() => setDeleting(null)}
        onConfirm={() => {
          if (deleting) void removeTopic(deleting);
        }}
      />
      <ConfirmDialog
        open={!!deletingSet}
        title="Hapus bank soal?"
        description={`Bank soal "${deletingSet?.title ?? ""}" akan dihapus dari daftar bank soal. Paket ujian yang sudah diterbitkan tidak akan berubah dan versi lama tetap tersimpan.`}
        confirmLabel="Hapus bank soal"
        onCancel={() => setDeletingSet(null)}
        onConfirm={() => {
          if (deletingSet) void removeSet(deletingSet);
        }}
      />
    </PageContainer>
  );
}

function LecturerWorkspace({
  topics,
  bankSets,
  packages,
  activeTab,
  setActiveTab,
  expandedTopics,
  setExpandedTopics,
  onAddTopic,
  onAddQuestion,
  onEditTopic,
  onDeleteTopic,
  onEditSet,
  onDeleteSet,
  onCreatePackage,
  onTogglePackage,
  onDuplicatePackage,
  duplicatingPackageId,
}: {
  topics: Topic[];
  bankSets: BankSet[];
  packages: ExamPackage[];
  activeTab: "TOPICS" | "PACKAGES";
  setActiveTab: (tab: "TOPICS" | "PACKAGES") => void;
  expandedTopics: string[];
  setExpandedTopics: (ids: string[]) => void;
  onAddTopic: () => void;
  onAddQuestion: (topic: Topic) => void;
  onEditTopic: (topic: Topic) => void;
  onDeleteTopic: (topic: Topic) => void;
  onEditSet: (set: BankSet) => void;
  onDeleteSet: (set: BankSet) => void;
  onCreatePackage: () => void;
  onTogglePackage: (id: string) => void;
  onDuplicatePackage: (id: string) => void;
  duplicatingPackageId: string | null;
}) {
  const router = useRouter();
  const [packageSearch, setPackageSearch] = useState("");
  const [packageStatus, setPackageStatus] = useState("ALL");
  const [packageSort, setPackageSort] = useState("NEWEST");
  const visiblePackages = packages
    .filter((item) =>
      `${item.code} ${item.title}`
        .toLowerCase()
        .includes(packageSearch.toLowerCase()),
    )
    .filter((item) => packageStatus === "ALL" || item.is_active === (packageStatus === "ACTIVE"))
    .sort((left, right) => {
      switch (packageSort) {
        case "OLDEST":
          return new Date(left.created_at).getTime() - new Date(right.created_at).getTime();
        case "CODE_ASC":
          return left.code.localeCompare(right.code);
        case "CODE_DESC":
          return right.code.localeCompare(left.code);
        case "TITLE_ASC":
          return left.title.localeCompare(right.title);
        default:
          return new Date(right.created_at).getTime() - new Date(left.created_at).getTime();
      }
    });
  return (
    <section className="mt-7">
      <div className="flex border-b border-outline-variant/40">
        <button
          type="button"
          onClick={() => setActiveTab("TOPICS")}
          className={`border-b-2 px-5 py-3 text-sm font-semibold ${activeTab === "TOPICS" ? "border-primary text-primary" : "border-transparent text-on-surface-variant"}`}
        >
          Bank Soal
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("PACKAGES")}
          className={`border-b-2 px-5 py-3 text-sm font-semibold ${activeTab === "PACKAGES" ? "border-primary text-primary" : "border-transparent text-on-surface-variant"}`}
        >
          Paket Ujian
        </button>
      </div>
      {activeTab === "PACKAGES" ? (
        <div className="mt-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h2 className="font-display text-xl font-bold text-on-surface">
                Paket Ujian
              </h2>
              <p className="mt-1 text-sm text-on-surface-variant">
                Pilih soal dari bank untuk dibagikan kepada mahasiswa melalui
                kode paket.
              </p>
            </div>
          </div>
          <div className="mt-5">
            <ListToolbar
              addLabel="Buat Paket Ujian"
              onAdd={onCreatePackage}
              searchValue={packageSearch}
              onSearchChange={setPackageSearch}
              searchPlaceholder="Cari kode atau judul paket..."
              filters={
                <AppSelect
                  value={packageStatus}
                  onValueChange={setPackageStatus}
                  ariaLabel="Filter status paket ujian"
                  className="min-w-40"
                  options={[
                    { value: "ALL", label: "Semua status" },
                    { value: "ACTIVE", label: "Aktif" },
                    { value: "INACTIVE", label: "Draft / nonaktif" },
                  ]}
                />
              }
              sortOptions={[
                { value: "NEWEST", label: "Terbaru", direction: "desc" },
                { value: "OLDEST", label: "Terlama", direction: "asc" },
                { value: "CODE_ASC", label: "Kode A-Z", direction: "asc" },
                { value: "CODE_DESC", label: "Kode Z-A", direction: "desc" },
                { value: "TITLE_ASC", label: "Judul A-Z", direction: "asc" },
              ]}
              currentSort={packageSort}
              onSortChange={setPackageSort}
            />
          </div>
          {packages.length ? (
            <div className="mt-5 overflow-hidden rounded-xl border border-outline-variant/40 bg-surface-container-lowest">
              <table className="w-full text-left text-sm">
                <thead className="bg-surface-container-low text-xs font-semibold uppercase text-on-surface-variant">
                  <tr>
                    <th className="px-5 py-3">Kode</th>
                    <th className="px-5 py-3">Paket</th>
                    <th className="px-5 py-3">Soal</th>
                    <th className="px-5 py-3">Status</th>
                    <th className="px-5 py-3 text-right">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-outline-variant/30">
                  {visiblePackages.map((item) => (
                    <tr
                      key={item.id}
                      tabIndex={0}
                      role="link"
                      aria-label={`Tinjau mahasiswa paket ${item.code}`}
                      onClick={() => router.push(`/exam-packages/${item.id}`)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          router.push(`/exam-packages/${item.id}`);
                        }
                      }}
                      className="cursor-pointer transition-colors hover:bg-surface-container"
                    >
                      <td className="px-5 py-4 font-mono-ui text-xs font-bold text-primary">
                        {item.code}
                      </td>
                      <td className="px-5 py-4">
                        <p className="font-semibold text-on-surface">
                          {item.title}
                        </p>
                        {item.description && (
                          <p className="mt-1 text-xs text-on-surface-variant">
                            {item.description}
                          </p>
                        )}
                      </td>
                      <td className="px-5 py-4">{item.question_count}</td>
                      <td className="px-5 py-4">
                        <span
                          className={`badge ${item.is_active ? "badge-active" : "badge-draft"}`}
                        >
                          {item.is_active ? "Aktif" : "Draft"}
                        </span>
                      </td>
                      <td className="px-5 py-4">
                        <div className="flex justify-end gap-2">
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              onTogglePackage(item.id);
                            }}
                            className="btn-secondary table-action-button"
                            aria-label={
                              item.is_active
                                ? `Nonaktifkan ${item.title}`
                                : `Aktifkan ${item.title}`
                            }
                            title={item.is_active ? "Nonaktifkan" : "Aktifkan"}
                          >
                            {item.is_active ? (
                              <CircleStop
                                size={18}
                                stroke="#dc2626"
                                strokeWidth={2.5}
                              />
                            ) : (
                              <CircleCheck
                                size={18}
                                stroke="#16a34a"
                                strokeWidth={2.5}
                              />
                            )}
                          </button>
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              onDuplicatePackage(item.id);
                            }}
                            disabled={duplicatingPackageId === item.id}
                            className="btn-secondary table-action-button"
                            aria-label={`Duplikat ${item.title}`}
                            title="Duplikat paket"
                          >
                            <Copy size={18} stroke="#4f46e5" strokeWidth={2.5} />
                          </button>
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              router.push(
                                `/exam-packages/${item.id}/edit?subject_id=${item.subject_id}`,
                              );
                            }}
                            className="btn-secondary table-action-button"
                            aria-label={`Edit ${item.title}`}
                            title="Edit paket"
                          >
                            <Pencil
                              size={18}
                              stroke="#4f46e5"
                              strokeWidth={2.5}
                            />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <button
              type="button"
              onClick={onCreatePackage}
              className="mt-5 flex w-full flex-col items-center rounded-2xl border-2 border-dashed border-primary/50 bg-primary/5 px-6 py-10 text-center hover:border-primary hover:bg-primary/10"
            >
              <span className="grid size-12 place-items-center rounded-xl bg-primary text-white">
                <ClipboardList size={25} />
              </span>
              <span className="mt-4 font-display text-lg font-bold text-on-surface">
                Buat paket ujian pertama
              </span>
              <span className="mt-1 text-sm text-on-surface-variant">
                Pilih soal yang sudah diterbitkan dari bank soal.
              </span>
            </button>
          )}
        </div>
      ) : topics.length === 0 ? (
        <button
          type="button"
          onClick={onAddTopic}
          className="mt-6 flex w-full flex-col items-center rounded-2xl border-2 border-dashed border-primary/50 bg-primary/5 px-6 py-10 text-center hover:border-primary hover:bg-primary/10"
        >
          <span className="grid size-12 place-items-center rounded-xl bg-primary text-white">
            <Plus size={26} />
          </span>
          <span className="mt-4 font-display text-lg font-bold text-on-surface">
            Buat topik pertama
          </span>
          <span className="mt-1 text-sm text-on-surface-variant">
            Kelompokkan soal yang akan digunakan pada paket ujian.
          </span>
        </button>
      ) : (
        <div className="mt-5 space-y-4">
          {topics.map((topic) => {
            const sets = bankSets.filter((set) => set.topic_id === topic.id);
            const expanded = expandedTopics.includes(topic.id);
            return (
              <article
                key={topic.id}
                className="overflow-hidden rounded-2xl border border-outline-variant/40 bg-surface-container-lowest"
              >
                <div className="flex items-center gap-3 bg-primary/10 px-5 py-4">
                  <button
                    type="button"
                    onClick={() =>
                      setExpandedTopics(
                        expanded
                          ? expandedTopics.filter((id) => id !== topic.id)
                          : [...expandedTopics, topic.id],
                      )
                    }
                    className="flex min-w-0 flex-1 items-center gap-3 text-left hover:text-primary"
                  >
                  <span className="text-primary">
                    {expanded ? (
                      <ChevronDown size={19} />
                    ) : (
                      <ChevronRight size={19} />
                    )}
                  </span>
                  <span className="flex-1">
                    <span className="block font-display text-lg font-bold text-on-surface">
                      {topic.name}
                    </span>
                    {topic.description && (
                      <span className="block text-sm text-on-surface-variant">
                        {topic.description}
                      </span>
                    )}
                  </span>
                  <span className="shrink-0 text-xs font-semibold text-on-surface-variant">
                    {sets.reduce((count, set) => count + set.question_count, 0)}{" "}
                    soal
                  </span>
                  </button>
                  <RowMenu
                    label={`Opsi topik ${topic.name}`}
                    items={[
                      { label: "Edit topik", icon: <Pencil size={14} />, onClick: () => onEditTopic(topic) },
                      { label: "Hapus topik", icon: <Trash2 size={14} />, danger: true, onClick: () => onDeleteTopic(topic) },
                    ]}
                  />
                </div>
                {expanded && (
                  <div className="divide-y divide-outline-variant/30 px-5">
                    {sets.length ? (
                      sets.map((set) => (
                        <div key={set.id} className="flex items-center gap-2 py-4">
                        <Link
                          href={`/questions/${set.id}/view`}
                          className="flex min-w-0 flex-1 items-center gap-3 no-underline hover:text-primary"
                        >
                          <FileText size={17} className="text-secondary" />
                          <span className="flex-1">
                            <span className="block font-semibold text-on-surface">
                              {set.title}
                            </span>
                            <span className="text-xs text-on-surface-variant">
                              {set.question_count} soal
                            </span>
                          </span>
                        </Link>
                        <RowMenu
                          label={`Opsi ${set.title}`}
                          items={[
                            { label: "Edit bank soal", icon: <Pencil size={14} />, onClick: () => onEditSet(set) },
                            { label: "Hapus bank soal", icon: <Trash2 size={14} />, danger: true, onClick: () => onDeleteSet(set) },
                          ]}
                        />
                        </div>
                      ))
                    ) : (
                      <p className="py-5 text-sm text-on-surface-variant">
                        Belum ada soal pada topik ini.
                      </p>
                    )}
                    <button
                      type="button"
                      onClick={() => onAddQuestion(topic)}
                      className="flex w-full items-center justify-center py-4 text-primary hover:scale-110"
                      aria-label={`Tambah soal ke topik ${topic.name}`}
                      title="Tambah soal"
                    >
                      <Plus size={34} strokeWidth={3} />
                    </button>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

function AdminTopics({
  topics,
  search,
  setSearch,
  openForm,
  setDeleting,
}: {
  topics: Topic[];
  search: string;
  setSearch: (value: string) => void;
  openForm: (topic?: Topic) => void;
  setDeleting: (topic: Topic) => void;
}) {
  const visible = topics.filter((topic) =>
    `${topic.name} ${topic.description}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  return (
    <section className="mt-7">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="font-display text-xl font-bold text-on-surface">
            Topik
          </h2>
          <p className="mt-1 text-sm text-on-surface-variant">
            Kelola topik untuk mata kuliah ini.
          </p>
        </div>
        <button
          type="button"
          className="btn-primary"
          onClick={() => openForm()}
        >
          Tambah topik
        </button>
      </div>
      <div className="mt-4">
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Cari topik..."
          className="form-input max-w-md"
        />
      </div>
      <div className="mt-5 overflow-hidden rounded-xl border border-outline-variant/40 bg-surface-container-lowest">
        <table className="w-full text-left text-sm">
          <thead className="bg-surface-container-low text-xs font-semibold uppercase text-on-surface-variant">
            <tr>
              <th className="px-5 py-3">Topik</th>
              <th className="px-5 py-3 text-right">Aksi</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-outline-variant/30">
            {visible.map((topic) => (
              <tr key={topic.id}>
                <td className="px-5 py-4">
                  <p className="font-semibold text-on-surface">{topic.name}</p>
                  {topic.description && (
                    <p className="mt-1 text-xs text-on-surface-variant">
                      {topic.description}
                    </p>
                  )}
                </td>
                <td className="px-5 py-4">
                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => openForm(topic)}
                      className="btn-secondary table-action-button"
                    >
                      <Pencil size={17} />
                    </button>
                    <button
                      type="button"
                      onClick={() => setDeleting(topic)}
                      className="btn-secondary table-action-button text-error"
                    >
                      <Trash2 size={17} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
