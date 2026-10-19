"use client";

import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  BookOpen,
  FileText,
  Loader2,
  RefreshCw,
  RotateCcw,
  Trash2,
  Upload,
} from "lucide-react";

import { useAuth } from "../components/AuthProvider";
import AppSelect from "../components/AppSelect";
import ConfirmDialog from "../components/ConfirmDialog";
import FeedbackModal from "../components/FeedbackModal";
import PageContainer from "../components/PageContainer";
import PageHeader from "../components/PageHeader";
import { apiFetch } from "../lib/api";

type SubjectOption = {
  id: string;
  slug: string;
  name: string;
  image_url?: string;
};

type Material = {
  id: string;
  subject_id: string;
  topic_id: string | null;
  title: string;
  mime_type: string;
  ingest_status: "PENDING" | "READY" | "FAILED";
  ingest_error: string | null;
  chunk_count: number | null;
  created_at: string;
  file_name: string | null;
};

const ALLOWED_EXTENSIONS = [".pdf", ".md", ".markdown", ".txt"];

const STATUS_META: Record<
  string,
  { label: string; cls: string; hint: string }
> = {
  READY: {
    label: "READY",
    cls: "badge-active",
    hint: "Dokumen siap dipakai sebagai sumber referensi.",
  },
  PENDING: {
    label: "ANALYZING",
    cls: "badge-draft",
    hint: "Sedang diproses. Status berubah sendiri begitu dokumen siap.",
  },
  FAILED: {
    label: "FAILED",
    cls: "badge-revoked",
    hint: "Pemrosesan gagal; lihat pesan galat.",
  },
};

const fmtDate = (value: string | null) => {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleString("id-ID", {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return value;
  }
};

export function ReferenceMaterials({
  subjectId: fixedSubjectId,
  embedded = false,
}: {
  subjectId?: string;
  embedded?: boolean;
}) {
  const { user, token, loading } = useAuth();
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [subjects, setSubjects] = useState<SubjectOption[]>([]);
  const [subjectId, setSubjectId] = useState("");
  const [materials, setMaterials] = useState<Material[]>([]);
  const [fetching, setFetching] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [uploading, setUploading] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<Material | null>(null);
  const [error, setError] = useState("");
  const [retryingId, setRetryingId] = useState<string | null>(null);
  // 'alive' | 'stale' | 'missing' from the retry response: a queued document only
  // becomes READY if something is actually draining the queue.
  const [ingestWorker, setIngestWorker] = useState<string | null>(null);

  useEffect(() => {
    if (loading) return;
    if (!user || !token) {
      router.replace("/login");
      return;
    }
    if (fixedSubjectId) {
      setSubjectId(fixedSubjectId);
      return;
    }
    void (async () => {
      try {
        const summary = await apiFetch<{
          my_subjects?: SubjectOption[];
          summary?: { my_subjects?: SubjectOption[] };
        }>("/dashboard/summary");
        const list = summary.summary?.my_subjects ?? summary.my_subjects ?? [];
        setSubjects(list);
        // Default to a subject that already has materials so the list is not
        // empty on first load; fall back to the first available subject.
        let preferred = "";
        try {
          const all = await apiFetch<Material[]>("/materials");
          preferred = all[0]?.subject_id ?? "";
        } catch {
          preferred = "";
        }
        setSubjectId((current) => current || preferred || list[0]?.id || "");
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Gagal memuat mata kuliah.",
        );
      }
    })();
  }, [user, token, loading, router, fixedSubjectId]);

  const load = useCallback(async () => {
    if (!token || !subjectId) {
      setMaterials([]);
      return;
    }
    setFetching(true);
    try {
      const rows = await apiFetch<Material[]>(
        `/materials?subject_id=${encodeURIComponent(subjectId)}`,
      );
      setMaterials(rows);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Gagal memuat materi referensi.",
      );
    } finally {
      setFetching(false);
    }
  }, [token, subjectId]);

  useEffect(() => {
    void load();
  }, [load]);

  const hasPending = materials.some((m) => m.ingest_status === "PENDING");

  useEffect(() => {
    // PENDING clears on the worker's next tick (10s). Without this the badge only
    // moves when the lecturer remembers to press "Muat ulang" — which is exactly how
    // a queue that nothing consumes stayed invisible.
    if (!hasPending) return;
    const timer = setInterval(() => {
      void load();
    }, 5000);
    return () => clearInterval(timer);
  }, [hasPending, load]);

  const handleRetry = async (item: Material) => {
    setError("");
    setRetryingId(item.id);
    try {
      const result = await apiFetch<Material & { ingest_worker?: string }>(
        `/materials/${item.id}/retry`,
        { method: "POST" },
      );
      setIngestWorker(result.ingest_worker ?? null);
      await load();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Gagal memproses ulang materi.",
      );
    } finally {
      setRetryingId(null);
    }
  };

  const handleUpload = async (event: React.FormEvent) => {
    event.preventDefault();
    setError("");
    if (!subjectId) {
      setError("Pilih mata kuliah terlebih dahulu.");
      return;
    }
    if (!file) {
      setError("Pilih berkas terlebih dahulu.");
      return;
    }
    const ext = `.${(file.name.split(".").pop() ?? "").toLowerCase()}`;
    if (!ALLOWED_EXTENSIONS.includes(ext)) {
      setError("Hanya file PDF, MD, atau TXT yang diizinkan.");
      return;
    }

    const form = new FormData();
    form.append("file", file);
    form.append("subject_id", subjectId);
    if (title.trim()) form.append("title", title.trim());

    setUploading(true);
    try {
      await apiFetch("/materials", { method: "POST", body: form });
      setFile(null);
      setTitle("");
      if (fileInputRef.current) fileInputRef.current.value = "";
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal mengunggah berkas.");
    } finally {
      setUploading(false);
    }
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    const target = pendingDelete;
    setPendingDelete(null);
    try {
      await apiFetch(`/materials/${target.id}`, { method: "DELETE" });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal menghapus materi.");
    }
  };

  if (loading || !user) return null;

  const Wrapper = embedded ? Fragment : PageContainer;

  return (
    <Wrapper>
      {!embedded && (
        <PageHeader
          title="Materi Referensi"
          description="Unggah buku acuan atau catatan untuk mata kuliah Anda. AI mengutipnya saat menilai penalaran mahasiswa."
          icon={BookOpen}
          action={
            <button
              type="button"
              onClick={() => void load()}
              disabled={fetching || !subjectId}
              className="btn-secondary inline-flex items-center gap-1.5 text-xs"
            >
              <RefreshCw size={14} className={fetching ? "animate-spin" : ""} />
              Muat ulang
            </button>
          }
        />
      )}
      {embedded && (
        <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-display text-xl font-bold text-on-surface">Materi Referensi</h2>
            <p className="mt-1 text-sm text-on-surface-variant">Sumber yang dipakai AI saat menilai penalaran mahasiswa pada mata kuliah ini.</p>
          </div>
          <button
            type="button"
            onClick={() => void load()}
            disabled={fetching || !subjectId}
            className="btn-secondary inline-flex items-center gap-1.5 text-xs"
          >
            <RefreshCw size={14} className={fetching ? "animate-spin" : ""} />
            Muat ulang
          </button>
        </div>
      )}

      <div className="mt-6 grid grid-cols-1 gap-5 lg:grid-cols-12 lg:items-start">
        {/* Upload panel */}
        <section className="glass-panel overflow-hidden rounded-xl border border-outline-variant/40 lg:col-span-5">
          <header className="border-b border-outline-variant/40 bg-surface-container-low px-5 py-3">
            <span className="text-xs font-bold uppercase tracking-wider text-on-surface-variant font-mono-ui">
              Unggah Materi
            </span>
          </header>

          <form onSubmit={handleUpload} className="space-y-4 p-5">
            {!fixedSubjectId && <div>
              <label
                htmlFor="material-subject"
                className="mb-1.5 block text-[11px] font-bold uppercase tracking-wider text-on-surface-variant"
              >
                Mata Kuliah
              </label>
              <AppSelect
                value={subjectId}
                onValueChange={setSubjectId}
                className="w-full"
                ariaLabel="Pilih mata kuliah"
                placeholder="Pilih mata kuliah..."
                options={subjects.map((s) => ({ value: s.id, label: s.name }))}
              />
            </div>}

            <div>
              <label
                htmlFor="material-file"
                className="mb-1.5 block text-[11px] font-bold uppercase tracking-wider text-on-surface-variant"
              >
                Berkas (PDF / MD / TXT)
              </label>
              <input
                ref={fileInputRef}
                id="material-file"
                type="file"
                accept=".pdf,.md,.markdown,.txt"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                className="form-input w-full text-xs file:mr-3 file:cursor-pointer file:rounded file:border-0 file:bg-primary-fixed file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-primary"
              />
              {file && (
                <p className="mt-1.5 font-mono-ui text-[11px] text-on-surface-variant">
                  {file.name} • {(file.size / 1024).toFixed(0)} KB
                </p>
              )}
            </div>

            <div>
              <label
                htmlFor="material-title"
                className="mb-1.5 block text-[11px] font-bold uppercase tracking-wider text-on-surface-variant"
              >
                Judul (opsional)
              </label>
              <input
                id="material-title"
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Default: nama berkas"
                className="form-input w-full text-xs"
              />
            </div>

            <button
              type="submit"
              disabled={uploading || !subjectId}
              className="btn-primary inline-flex w-full items-center justify-center gap-1.5 text-xs font-semibold"
            >
              <Upload size={15} />
              {uploading ? "Mengunggah..." : "Unggah Materi"}
            </button>

            <p className="rounded-lg border border-outline-variant/30 bg-surface-container-lowest p-3 text-[11px] leading-relaxed text-on-surface-variant">
              Dokumen diproses otomatis setelah diunggah. Statusnya berubah sendiri
              menjadi <strong>READY</strong> saat sudah bisa dipakai sebagai sumber
              referensi.
            </p>
          </form>
        </section>

        {/* List panel */}
        <section className="glass-panel overflow-hidden rounded-xl border border-outline-variant/40 lg:col-span-7">
          <header className="flex items-center justify-between border-b border-outline-variant/40 bg-surface-container-low px-5 py-3">
            <span className="text-xs font-bold uppercase tracking-wider text-on-surface-variant font-mono-ui">
              Daftar Materi
            </span>
            <span className="font-mono-ui text-[11px] text-on-surface-variant">
              {materials.length} dokumen
            </span>
          </header>

          <div className="p-5">
            {ingestWorker && ingestWorker !== "alive" && (
              <p className="mb-4 flex items-start gap-2 rounded-lg border border-error/40 bg-error-container/20 p-3 text-[11px] leading-relaxed text-error">
                <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                <span>
                  Pemrosesan dokumen sedang tidak berjalan, jadi dokumen baru akan
                  tetap berstatus <strong>ANALYZING</strong> tanpa selesai. Hubungi
                  admin sebelum materi ini diandalkan.
                </span>
              </p>
            )}
            {fetching && materials.length === 0 ? (
              <p className="text-sm text-on-surface-variant">Memuat materi...</p>
            ) : materials.length === 0 ? (
              <p className="text-sm text-on-surface-variant">
                Belum ada materi referensi untuk mata kuliah ini.
              </p>
            ) : (
              <ul className="space-y-3">
                {materials.map((item) => {
                  const meta = STATUS_META[item.ingest_status] ?? {
                    label: item.ingest_status,
                    cls: "badge-role",
                    hint: "",
                  };
                  return (
                    <li
                      key={item.id}
                      className="rounded-lg border border-outline-variant/30 bg-surface-container-lowest p-4"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex min-w-0 items-start gap-2.5">
                          <FileText size={17} className="mt-0.5 shrink-0 text-primary" />
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold text-on-surface">
                              {item.title}
                            </p>
                            <p className="mt-0.5 truncate font-mono-ui text-[11px] text-on-surface-variant">
                              {item.file_name ?? "—"} • {item.mime_type}
                            </p>
                          </div>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          <span className={`badge ${meta.cls}`} title={meta.hint}>
                            {item.ingest_status === "PENDING" ? (
                              <span className="inline-flex items-center gap-1">
                                <Loader2 size={11} className="animate-spin" />
                                {meta.label}
                              </span>
                            ) : (
                              meta.label
                            )}
                          </span>
                          {item.ingest_status !== "READY" && (
                            <button
                              type="button"
                              onClick={() => void handleRetry(item)}
                              disabled={retryingId === item.id}
                              className="inline-flex items-center gap-1 rounded-lg border border-outline-variant/40 px-2 py-1 text-[11px] font-semibold text-on-surface-variant hover:border-primary hover:text-primary disabled:cursor-not-allowed disabled:opacity-50"
                              aria-label={`Proses ulang ${item.title}`}
                              title={
                                item.ingest_status === "FAILED"
                                  ? "Proses ulang dokumen ini"
                                  : "Proses ulang bila dokumen tidak selesai diproses"
                              }
                            >
                              <RotateCcw
                                size={13}
                                className={retryingId === item.id ? "animate-spin" : ""}
                              />
                              Proses ulang
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => setPendingDelete(item)}
                            className="inline-flex size-8 items-center justify-center rounded-lg border border-outline-variant/40 text-on-surface-variant hover:border-error hover:text-error"
                            aria-label={`Hapus ${item.title}`}
                            title="Hapus materi"
                          >
                            <Trash2 size={15} />
                          </button>
                        </div>
                      </div>

                      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 font-mono-ui text-[11px] text-on-surface-variant">
                        <span>segmen: {item.chunk_count ?? "—"}</span>
                        <span>diunggah: {fmtDate(item.created_at)}</span>
                      </div>

                      {item.ingest_status === "PENDING" && (
                        <p
                          role="status"
                          className="mt-2 flex items-center gap-1.5 rounded border border-outline-variant/30 bg-surface-container-lowest p-2 text-[11px] leading-relaxed text-on-surface-variant"
                        >
                          <Loader2 size={12} className="animate-spin text-primary" />
                          Sedang menganalisis dokumen…
                        </p>
                      )}

                      {item.ingest_status === "FAILED" && item.ingest_error && (
                        <p className="mt-2 rounded border border-error/40 bg-error-container/20 p-2 text-[11px] leading-relaxed text-error">
                          {item.ingest_error}
                        </p>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </section>
      </div>

      <ConfirmDialog
        open={!!pendingDelete}
        title="Hapus materi referensi?"
        description={`"${pendingDelete?.title ?? ""}" beserta seluruh chunk-nya akan dihapus. Tindakan ini tidak dapat dibatalkan.`}
        confirmLabel="Hapus"
        onConfirm={() => void confirmDelete()}
        onCancel={() => setPendingDelete(null)}
      />

      <FeedbackModal open={!!error} message={error} onClose={() => setError("")} />
    </Wrapper>
  );
}

export default function MaterialsPage() {
  return <ReferenceMaterials />;
}
