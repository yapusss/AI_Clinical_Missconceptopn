"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "../components/AuthProvider";
import { CircleCheck, ClipboardList, Plus, TriangleAlert } from "lucide-react";

type Indicator = {
  label: string;
  description: string;
  weight: number;
};

type QuestionItem = {
  id: string;
  code: string;
  title: string;
  description: string;
  subject_id: string;
  subject_name: string;
  is_active: boolean;
  created_at: string;
  latest_version: {
    id: string;
    version_number: number;
    prompt_preview: string;
    is_published: boolean;
  } | null;
};

type SubjectOption = {
  id: string;
  slug: string;
  name: string;
};

type ApiError = {
  detail?: unknown;
  code?: unknown;
  indicators?: unknown;
  message?: string;
};

const errMsg = (err: unknown) => (err instanceof Error ? err.message : String(err));

export default function QuestionsPage() {
  const { user, token, loading } = useAuth();
  const router = useRouter();

  const [questions, setQuestions] = useState<QuestionItem[]>([]);
  const [subjects, setSubjects] = useState<SubjectOption[]>([]);
  const [fetching, setFetching] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  // Modal / Form state
  const [showModal, setShowModal] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [selectedQuestionId, setSelectedQuestionId] = useState<string | null>(null);

  // Form inputs (subject_id menggunakan UUID)
  const [formSubjectId, setFormSubjectId] = useState("");
  const [formCode, setFormCode] = useState("");
  const [formTitle, setFormTitle] = useState("");
  const [formDescription, setFormDescription] = useState("");
  const [formPrompt, setFormPrompt] = useState("");
  const [formModelAnswer, setFormModelAnswer] = useState("");
  const [formIndicators, setFormIndicators] = useState<Indicator[]>([
    { label: "Ketepatan Konsep Hukum II Newton", description: "Menjelaskan hubungan gaya, massa, dan percepatan", weight: 0.5 },
    { label: "Konsistensi Penalaran", description: "Penalaran logis tanpa kontradiksi", weight: 0.5 },
  ]);
  const [formPublish, setFormPublish] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const loadQuestions = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetch("/api/questions", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Gagal memuat daftar soal.");
      const data = await res.json();
      setQuestions(data);
    } catch (err) {
      setError(errMsg(err) || "Terjadi kesalahan saat memuat soal.");
    } finally {
      setFetching(false);
    }
  }, [token]);

  useEffect(() => {
    if (loading) return;
    if (!user || !token) {
      router.replace("/login");
      return;
    }

    // Load subjects dari summary (memperoleh id UUID dan name)
    fetch("/api/dashboard/summary", {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((res) => res.json())
      .then((d) => {
        const subs: SubjectOption[] = d?.summary?.my_subjects || [];
        setSubjects(subs);
        if (subs.length > 0) setFormSubjectId(subs[0].id);
      });

    fetch("/api/questions", {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((res) => {
        if (!res.ok) throw new Error("Gagal memuat daftar soal.");
        return res.json();
      })
      .then((data) => setQuestions(data))
      .catch((e) => setError(e instanceof Error ? e.message : "Terjadi kesalahan saat memuat soal."))
      .finally(() => setFetching(false));
  }, [user, token, loading, router]);

  // Handle Toggle Active (ACM-11)
  const handleToggleActive = async (id: string) => {
    if (!token) return;
    try {
      const res = await fetch(`/api/questions/${id}/toggle-active`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Gagal mengubah status.");
      setSuccess(data.message);
      setFetching(true);
      loadQuestions();
    } catch (err) {
      setError(errMsg(err));
    }
  };

  // Handle Edit Click (ACM-10)
  const handleEdit = async (item: QuestionItem) => {
    if (!token) return;
    try {
      const res = await fetch(`/api/questions/${item.id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Gagal memuat detail soal.");

      setIsEditing(true);
      setSelectedQuestionId(item.id);
      setFormCode(data.code);
      setFormTitle(data.title);
      setFormDescription(data.description || "");

      const latest = data.versions?.[0];
      if (latest) {
        setFormPrompt(latest.prompt);
        setFormModelAnswer(latest.model_answer);
        if (latest.indicators && latest.indicators.length > 0) {
          setFormIndicators(
            latest.indicators.map((i: Indicator) => ({
              label: i.label,
              description: i.description,
              weight: i.weight,
            }))
          );
        }
      }
      setShowModal(true);
    } catch (err) {
      setError(errMsg(err));
    }
  };

  // Submit Form (ACM-6, ACM-7, ACM-8, ACM-10)
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) return;

    setError("");
    setSuccess("");
    setSubmitting(true);

    try {
      const payload: Record<string, unknown> = {
        title: formTitle,
        description: formDescription,
        prompt: formPrompt,
        model_answer: formModelAnswer,
        indicators: formIndicators,
        publish: formPublish,
      };

      let res;
      if (isEditing && selectedQuestionId) {
        res = await fetch(`/api/questions/${selectedQuestionId}`, {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(payload),
        });
      } else {
        payload.code = formCode;
        payload.subject_id = formSubjectId;
        res = await fetch("/api/questions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(payload),
        });
      }

      let data: ApiError = {};
      const responseText = await res.text();
      try {
        data = JSON.parse(responseText);
      } catch {
        data = { detail: responseText || "Terjadi kesalahan server." };
      }

      if (!res.ok) {
        const msg = data.detail || (Array.isArray(data.code) ? data.code[0] : "") || (data.indicators ? data.indicators : "") || "Gagal menyimpan soal.";
        throw new Error(typeof msg === "string" ? msg : JSON.stringify(msg));
      }

      setSuccess(isEditing ? "Soal berhasil diperbarui." : "Soal baru berhasil ditambahkan.");
      setShowModal(false);
      resetForm();
      setFetching(true);
      loadQuestions();
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setSubmitting(false);
    }
  };

  const resetForm = () => {
    setIsEditing(false);
    setSelectedQuestionId(null);
    setFormCode("");
    setFormTitle("");
    setFormDescription("");
    setFormPrompt("");
    setFormModelAnswer("");
    setFormPublish(false);
  };

  const addIndicator = () => {
    setFormIndicators([...formIndicators, { label: "", description: "", weight: 0.1 }]);
  };

  const removeIndicator = (index: number) => {
    setFormIndicators(formIndicators.filter((_, i) => i !== index));
  };

  const updateIndicator = (index: number, field: keyof Indicator, value: string | number) => {
    const updated = [...formIndicators];
    updated[index] = { ...updated[index], [field]: value };
    setFormIndicators(updated);
  };

  const totalWeight = formIndicators.reduce((acc, curr) => acc + (Number(curr.weight) || 0), 0);

  if (loading || !user) return null;

  return (
    <div style={{ maxWidth: "1080px", margin: "0 auto" }}>
      {/* Hero & Aksi Tambah Soal */}
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              {/* Badge Bank Soal Dosen dengan warna khas EvalAI */}
              <div className="inline-flex items-center gap-2 rounded-full border border-primary-fixed-dim bg-primary-fixed/60 px-3 py-1 text-xs font-bold uppercase tracking-wider text-primary">
                <ClipboardList size={14} color="var(--primary)" />
                Bank Soal Dosen
              </div>
              <h1 className="mt-2 font-display text-2xl font-bold tracking-tight text-on-surface">
                Manajemen Soal Konseptual
              </h1>
              <p className="text-sm text-on-surface-variant">
                Kelola butir pertanyaan dinamika partikel, tentukan kunci referensi, dan atur kode akses mahasiswa.
              </p>
            </div>

            <button
              type="button"
              onClick={() => {
                resetForm();
                setShowModal(true);
              }}
              style={{ color: "#ffffff" }}
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold shadow-sm transition-colors hover:bg-primary-container focus-visible:ring-2 focus-visible:ring-primary/40"
            >
              <Plus size={20} color="#ffffff" />
              Tambah Soal Baru
            </button>
          </div>

          {/* Status Alerts */}
          {error && (
            <div role="alert" className="mt-6 flex items-center gap-3 rounded-lg border border-error/40 bg-error-container p-4 text-sm text-on-error-container">
              <TriangleAlert size={20} />
              <span>{error}</span>
            </div>
          )}

          {success && (
            <div role="status" className="mt-6 flex items-center gap-3 rounded-lg border border-primary-fixed-dim bg-primary-fixed/60 p-4 text-sm text-primary">
              <CircleCheck size={20} />
              <span>{success}</span>
            </div>
          )}

          {/* Questions Table */}
          <div className="mt-8 glass-tier-2 overflow-hidden rounded-xl border border-outline-variant/40 shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-outline-variant/40 bg-surface-container-low font-semibold text-on-surface-variant">
                  <tr>
                    <th className="px-6 py-4">Kode Soal</th>
                    <th className="px-6 py-4">Judul & Prompt</th>
                    <th className="px-6 py-4">Mata Kuliah</th>
                    <th className="px-6 py-4">Versi & Status</th>
                    <th className="px-6 py-4 text-center">Status Pengerjaan</th>
                    <th className="px-6 py-4 text-right">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-outline-variant/30">
                  {fetching ? (
                    <tr>
                      <td colSpan={6} className="px-6 py-8 text-center text-on-surface-variant">
                        Memuat daftar soal...
                      </td>
                    </tr>
                  ) : questions.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-6 py-12 text-center text-on-surface-variant">
                        Belum ada soal yang dibuat. Klik tombol <strong>Tambah Soal Baru</strong> untuk memulai.
                      </td>
                    </tr>
                  ) : (
                    questions.map((q) => (
                      <tr key={q.id} className="hover:bg-primary-fixed/10 transition-colors">
                        <td className="px-6 py-4 font-mono-ui font-bold text-primary">
                          {q.code}
                        </td>
                        <td className="px-6 py-4">
                          <p className="font-semibold text-on-surface">{q.title}</p>
                          <p className="text-xs text-on-surface-variant line-clamp-1 mt-0.5">
                            {q.latest_version?.prompt_preview || "-"}
                          </p>
                        </td>
                        <td className="px-6 py-4 text-on-surface-variant">
                          {q.subject_name}
                        </td>
                        <td className="px-6 py-4">
                          <span className="inline-flex items-center gap-1 rounded bg-surface-container-high px-2 py-0.5 font-mono-ui text-xs font-semibold text-on-surface">
                            v{q.latest_version?.version_number || 1}
                          </span>
                          {q.latest_version?.is_published ? (
                            <span className="ml-2 inline-flex items-center gap-1 text-xs font-medium text-tertiary">
                              <CircleCheck size={14} /> Publik
                            </span>
                          ) : (
                            <span className="ml-2 text-xs font-medium text-on-surface-variant">
                              Draft
                            </span>
                          )}
                        </td>
                        <td className="px-6 py-4 text-center">
                          <button
                            type="button"
                            onClick={() => handleToggleActive(q.id)}
                            title={q.is_active ? "Klik untuk menonaktifkan" : "Klik untuk mengaktifkan"}
                            className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
                              q.is_active
                                ? "bg-tertiary-container/30 text-tertiary border border-tertiary/40"
                                : "bg-error-container/40 text-error border border-error/40"
                            }`}
                          >
                            {q.is_active ? "Aktif" : "Nonaktif"}
                          </button>
                        </td>
                        <td className="px-6 py-4 text-right space-x-2">
                          <button
                            type="button"
                            onClick={() => handleEdit(q)}
                            className="inline-flex items-center gap-1 rounded border border-outline-variant/50 bg-surface-container-lowest px-2.5 py-1 text-xs font-semibold text-primary hover:bg-primary-fixed/40"
                          >
                            Edit
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

      {/* Modal Form Tambah/Edit Soal */}
      {showModal && (
        <div className="fixed inset-0 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm overflow-y-auto" style={{ zIndex: 200 }}>
          <div className="w-full max-w-2xl rounded-2xl border border-outline-variant/40 bg-surface-container-lowest p-6 shadow-2xl my-8">
            <div className="flex items-center justify-between border-b border-outline-variant/30 pb-4">
              <h2 className="font-display text-xl font-bold text-on-surface">
                {isEditing ? "Edit Soal Konseptual" : "Tambah Soal Konseptual Baru"}
              </h2>
              <button
                type="button"
                onClick={() => setShowModal(false)}
                className="text-on-surface-variant hover:text-on-surface text-lg font-bold"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSubmit} className="mt-5 space-y-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {!isEditing && (
                  <div>
                    <label className="block text-xs font-semibold uppercase text-on-surface-variant">
                      Mata Kuliah
                    </label>
                    <select
                      value={formSubjectId}
                      onChange={(e) => setFormSubjectId(e.target.value)}
                      required
                      className="mt-1 block w-full rounded-lg border border-outline-variant/60 bg-surface-container-lowest px-3 py-2 text-sm text-on-surface focus:border-primary focus:outline-none"
                    >
                      {subjects.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                <div className={isEditing ? "sm:col-span-2" : ""}>
                  <label className="block text-xs font-semibold uppercase text-on-surface-variant">
                    Kode Soal Unik (ACM-7)
                  </label>
                  <input
                    type="text"
                    value={formCode}
                    onChange={(e) => setFormCode(e.target.value.toUpperCase())}
                    disabled={isEditing}
                    placeholder="Contoh: FIS-NEWTON-01"
                    required
                    className="mt-1 block w-full rounded-lg border border-outline-variant/60 bg-surface-container-lowest px-3 py-2 font-mono-ui text-sm text-on-surface focus:border-primary focus:outline-none disabled:bg-surface-container-high/40"
                  />
                  <p className="mt-1 text-[11px] text-on-surface-variant">
                    Huruf besar, angka, dan strip (-). Kode ini digunakan mahasiswa saat pengerjaan.
                  </p>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase text-on-surface-variant">
                  Judul Pertanyaan
                </label>
                <input
                  type="text"
                  value={formTitle}
                  onChange={(e) => setFormTitle(e.target.value)}
                  placeholder="Misal: Penerapan Hukum II Newton pada Gerak Lift"
                  required
                  className="mt-1 block w-full rounded-lg border border-outline-variant/60 bg-surface-container-lowest px-3 py-2 text-sm text-on-surface focus:border-primary focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase text-on-surface-variant">
                  Prompt / Pertanyaan Konseptual (ACM-6)
                </label>
                <textarea
                  rows={4}
                  value={formPrompt}
                  onChange={(e) => setFormPrompt(e.target.value)}
                  placeholder="Tuliskan pertanyaan konseptual lengkap yang harus dijawab dan dijelaskan alasannya oleh mahasiswa..."
                  required
                  className="mt-1 block w-full rounded-lg border border-outline-variant/60 bg-surface-container-lowest px-3 py-2 text-sm text-on-surface focus:border-primary focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase text-on-surface-variant">
                  Jawaban Referensi / Model Answer (ACM-8)
                </label>
                <textarea
                  rows={4}
                  value={formModelAnswer}
                  onChange={(e) => setFormModelAnswer(e.target.value)}
                  placeholder="Tuliskan jawaban standar ilmiah yang tepat sebagai acuan analisis AI sistem..."
                  required
                  className="mt-1 block w-full rounded-lg border border-outline-variant/60 bg-surface-container-lowest px-3 py-2 text-sm text-on-surface focus:border-primary focus:outline-none"
                />
              </div>

              {/* Indikator Konsep */}
              <div className="rounded-xl border border-outline-variant/40 bg-surface-container-low p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-bold text-on-surface">Indikator Konsep Asesmen</h3>
                    <p className="text-xs text-on-surface-variant">
                      Total bobot harus tepat 1.0000 agar dapat dipublikasikan.
                    </p>
                  </div>
                  <span className={`font-mono-ui text-xs font-bold px-2.5 py-1 rounded ${Math.abs(totalWeight - 1.0) < 0.001 ? "bg-tertiary/20 text-tertiary" : "bg-error/20 text-error"}`}>
                    Total Bobot: {totalWeight.toFixed(4)}
                  </span>
                </div>

                <div className="mt-3 space-y-2">
                  {formIndicators.map((ind, idx) => (
                    <div key={idx} className="flex items-center gap-2">
                      <input
                        type="text"
                        placeholder="Label Indikator"
                        value={ind.label}
                        onChange={(e) => updateIndicator(idx, "label", e.target.value)}
                        required
                        className="flex-1 rounded-md border border-outline-variant/60 bg-surface-container-lowest px-2.5 py-1.5 text-xs text-on-surface"
                      />
                      <input
                        type="number"
                        step="any"
                        min="0.0001"
                        max="1.0000"
                        value={ind.weight}
                        onChange={(e) => updateIndicator(idx, "weight", parseFloat(e.target.value) || 0)}
                        required
                        className="w-24 rounded-md border border-outline-variant/60 bg-surface-container-lowest px-2.5 py-1.5 text-xs font-mono-ui text-on-surface"
                      />
                      <button
                        type="button"
                        onClick={() => removeIndicator(idx)}
                        disabled={formIndicators.length <= 1}
                        className="text-error hover:text-on-error-container text-xs disabled:opacity-40"
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>

                <button
                  type="button"
                  onClick={addIndicator}
                  className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline"
                >
                  <Plus size={14} /> Tambah Indikator
                </button>
              </div>

              {/* Publikasi */}
              <div className="flex items-center gap-2 pt-2">
                <input
                  type="checkbox"
                  id="formPublish"
                  checked={formPublish}
                  onChange={(e) => setFormPublish(e.target.checked)}
                  className="h-4 w-4 rounded border-outline-variant text-primary focus:ring-primary"
                />
                <label htmlFor="formPublish" className="text-xs font-medium text-on-surface">
                  Publikasikan langsung agar mahasiswa dapat mengerjakan sekarang (memerlukan bobot tepat 1.0000).
                </label>
              </div>

              {/* Actions */}
              <div className="mt-6 flex justify-end gap-3 border-t border-outline-variant/30 pt-4">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="rounded-lg border border-outline-variant/50 px-4 py-2 text-sm font-semibold text-on-surface-variant hover:bg-surface-container-high"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  style={{ color: "#ffffff" }}
                  className="rounded-lg bg-primary px-5 py-2 text-sm font-semibold hover:bg-primary-container disabled:opacity-50"
                >
                  {submitting ? "Menyimpan..." : isEditing ? "Perbarui Soal" : "Simpan Soal"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}