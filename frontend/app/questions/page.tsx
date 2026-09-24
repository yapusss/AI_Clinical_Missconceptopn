"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  CircleCheck,
  CircleStop,
  ClipboardList,
  Eye,
  FileText,
  GraduationCap,
  Layers,
  Pencil,
  Send,
  TriangleAlert,
  X,
} from "lucide-react";
import { useAuth } from "../components/AuthProvider";
import ConfirmDialog from "../components/ConfirmDialog";
import ListToolbar from "../components/ListToolbar";
import PageContainer from "../components/PageContainer";
import PageHeader from "../components/PageHeader";

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

type QuestionSetDetail = QuestionSet & {
  description?: string;
  questions?: QuestionItem[];
};

export default function QuestionsPage() {
  const { user, token, loading } = useAuth();
  const router = useRouter();
  const [mounted, setMounted] = useState(false);

  const [sets, setSets] = useState<QuestionSet[]>([]);
  const [viewingSet, setViewingSet] = useState<QuestionSetDetail | null>(null);
  const [viewModalMode, setViewModalMode] = useState<"per_question" | "all_questions">("per_question");
  const [activeModalIndex, setActiveModalIndex] = useState(0);

  const [pendingDeactivate, setPendingDeactivate] = useState<QuestionSet | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");

  const load = useCallback(async () => {
    if (!token) return;
    const setsResponse = await fetch("/api/questions", {
      headers: { Authorization: `Bearer ${token}` },
    });
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

  const visibleSets = sets.filter((item) =>
    `${item.code} ${item.title} ${item.subject_name} ${item.is_active ? "aktif" : "nonaktif"}`
      .toLowerCase()
      .includes(search.toLowerCase())
  );

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
        eyebrow={<span className="inline-flex items-center gap-2 rounded-full border border-primary-fixed-dim bg-primary-fixed/60 px-3 py-1 text-xs font-bold uppercase tracking-wider text-primary"><ClipboardList size={14} /> Paket Ujian</span>}
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
          onAdd={() => router.push("/questions/create")}
          searchValue={search}
          onSearchChange={setSearch}
          searchPlaceholder="Cari kode, judul, atau mata kuliah..."
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
                <th className="px-4 py-3.5 text-left whitespace-nowrap">Status</th>
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
                      <div className="flex flex-col items-start gap-1">
                        <span className={`badge ${published ? "badge-active" : "badge-draft"}`}>
                          {published ? "Terbit" : "Draft"}
                        </span>
                        <span
                          className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold whitespace-nowrap ${
                            item.is_active
                              ? "border border-tertiary/40 bg-tertiary/10 text-tertiary"
                              : "border border-error/40 bg-error/10 text-error"
                          }`}
                        >
                          {item.is_active ? "Aktif" : "Nonaktif"}
                        </span>
                      </div>
                    </td>

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
                          onClick={() => router.push(`/questions/${item.id}/edit`)}
                          className="btn-secondary table-action-button"
                          aria-label="Edit paket ujian"
                          title="Edit paket ujian"
                        >
                          <Pencil size={18} stroke="#4f46e5" strokeWidth={2.5} aria-hidden="true" />
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
                      <div className="grid grid-cols-3 gap-1.5">
                        {qList.map((_, idx) => (
                          <button
                            key={idx}
                            type="button"
                            onClick={() => setActiveModalIndex(idx)}
                            className={`h-8 rounded font-mono-ui text-xs font-bold ${
                              activeModalIndex === idx
                                ? "bg-primary text-white"
                                : "bg-surface-container-low text-on-surface hover:bg-surface-container-high"
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
