"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Plus,
  Send,
  Trash2,
  TriangleAlert,
  X,
} from "lucide-react";
import AppSelect from "./AppSelect";
import ConfirmDialog from "./ConfirmDialog";
import PageContainer from "./PageContainer";

export type ExamQuestion = {
  id?: string;
  prompt: string;
  short_answer: string;
  alasan: string;
};

export type Subject = {
  id: string;
  name: string;
};

export type Topic = {
  id: string;
  name: string;
};

type Props = {
  isEditing?: boolean;
  isReadOnly?: boolean;
  setId?: string;
  initialData?: {
    code: string;
    title: string;
    description: string;
    subject_id: string;
    topic_id?: string;
    topic_name?: string;
    questions: ExamQuestion[];
    is_published?: boolean;
  };
};

const blankQuestion = (): ExamQuestion => ({
  prompt: "",
  short_answer: "",
  alasan: "",
});

export default function QuestionForm({ isEditing = false, isReadOnly = false, setId, initialData }: Props) {
  const router = useRouter();

  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [subjectId, setSubjectId] = useState(initialData?.subject_id ?? "");
  const [topics, setTopics] = useState<Topic[]>([]);
  const [topicId, setTopicId] = useState(initialData?.topic_id ?? "");
  const [title, setTitle] = useState(initialData?.title ?? "");
  const [description, setDescription] = useState(initialData?.description ?? "");
  const [questions, setQuestions] = useState<ExamQuestion[]>(
    initialData?.questions && initialData.questions.length > 0
      ? initialData.questions
      : [blankQuestion()]
  );
  const [publish, setPublish] = useState(initialData?.is_published ?? false);

  const [activeIndex, setActiveIndex] = useState(0);

  const [isDirty, setIsDirty] = useState(false);
  const [showExitModal, setShowExitModal] = useState(false);
  const [showSubmitModal, setShowSubmitModal] = useState(false);
  const [pendingQuestionRemoval, setPendingQuestionRemoval] = useState<number | null>(null);
  const [validationModalError, setValidationModalError] = useState<string | null>(null);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    const token = localStorage.getItem("token") ?? sessionStorage.getItem("token");
    if (!token) return;

    fetch("/api/dashboard/summary", {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((res) => res.json())
      .then((data) => {
        const list: Subject[] = data?.summary?.my_subjects ?? [];
        setSubjects(list);
        setSubjectId((curr) => {
          if (curr) return curr;
          if (initialData?.subject_id) return initialData.subject_id;
          const stored = !isEditing ? sessionStorage.getItem("imported_package") : null;
          if (stored) {
            try {
              const parsed = JSON.parse(stored);
              if (parsed.subject_id) return parsed.subject_id;
            } catch {}
          }
          return list.length > 0 ? list[0].id : "";
        });
      })
      .catch(() => {});
  }, [initialData, isEditing]);

  useEffect(() => {
    if (!subjectId) {
      setTopics([]);
      setTopicId("");
      return;
    }
    const token = localStorage.getItem("token") ?? sessionStorage.getItem("token");
    if (!token) return;

    fetch(`/api/admin/subjects/${subjectId}/topics`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((res) => (res.ok ? res.json() : []))
      .then((data: Topic[]) => {
        setTopics(data);
        if (initialData?.topic_id && data.some((t) => t.id === initialData.topic_id)) {
          setTopicId(initialData.topic_id);
        } else if (!topicId && data.length > 0) {
          const stored = !isEditing ? sessionStorage.getItem("imported_package") : null;
          if (stored) {
            try {
              const parsed = JSON.parse(stored);
              if (parsed.topic_id && data.some((t) => t.id === parsed.topic_id)) {
                setTopicId(parsed.topic_id);
              }
            } catch {}
          }
        }
      })
      .catch(() => setTopics([]));
  }, [subjectId, initialData?.topic_id, isEditing]);

  useEffect(() => {
    if (initialData) {
      if (initialData.subject_id) setSubjectId(initialData.subject_id);
      if (initialData.topic_id) setTopicId(initialData.topic_id);
      if (initialData.title) setTitle(initialData.title);
      if (initialData.description) setDescription(initialData.description);
      if (initialData.questions && initialData.questions.length > 0) {
        setQuestions(initialData.questions);
      }
      setPublish(initialData.is_published ?? false);
    } else if (!isEditing) {
      const stored = sessionStorage.getItem("imported_package");
      if (stored) {
        try {
          const parsed = JSON.parse(stored);
          if (parsed.subject_id) setSubjectId(parsed.subject_id);
          if (parsed.topic_id) setTopicId(parsed.topic_id);
          if (parsed.title) setTitle(parsed.title);
          if (parsed.description) setDescription(parsed.description);
          if (parsed.questions && Array.isArray(parsed.questions) && parsed.questions.length > 0) {
            setQuestions(
              parsed.questions.map((q: Partial<ExamQuestion>) => ({
                prompt: q.prompt ?? "",
                short_answer: q.short_answer ?? "",
                alasan: q.alasan ?? "",
              }))
            );
            setActiveIndex(0);
          }
        } catch {}
      }
    }
  }, [initialData, isEditing]);

  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (isDirty && !isReadOnly) {
        e.preventDefault();
      }
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [isDirty, isReadOnly]);

  const selectedTopicName =
    topics.find((topic) => topic.id === topicId)?.name ?? initialData?.topic_name ?? "";

  const questionValidity = useMemo(() => {
    return questions.map((q) => {
      const hasPrompt = q.prompt.trim().length > 0;
      const hasShortAnswer = q.short_answer.trim().length > 0;
      const hasAlasan = q.alasan.trim().length > 0;
      return hasPrompt && hasShortAnswer && hasAlasan;
    });
  }, [questions]);

  const updateQuestionField = (
    index: number,
    field: "prompt" | "short_answer" | "alasan",
    value: string
  ) => {
    if (isReadOnly) return;
    setIsDirty(true);
    setQuestions((current) =>
      current.map((q, i) => (i === index ? { ...q, [field]: value } : q))
    );
  };

  const addQuestion = () => {
    if (isReadOnly) return;
    setIsDirty(true);
    setQuestions((current) => [...current, blankQuestion()]);
    setActiveIndex(questions.length);
  };

  const confirmRemoveQuestion = () => {
    if (isReadOnly || pendingQuestionRemoval === null) return;
    setIsDirty(true);
    const indexToRemove = pendingQuestionRemoval;
    setQuestions((current) => current.filter((_, i) => i !== indexToRemove));
    if (activeIndex >= indexToRemove && activeIndex > 0) {
      setActiveIndex(activeIndex - 1);
    }
    setPendingQuestionRemoval(null);
  };

  const validateForm = (): string | null => {
    if (!subjectId || subjectId.trim() === "") {
      return "Mata kuliah belum dipilih";
    }
    if (!topicId || topicId.trim() === "") {
      return "Topik belum ditentukan. Tambahkan soal dari salah satu topik pada halaman mata kuliah.";
    }
    if (!title || title.trim() === "") {
      return "Judul ujian belum diisi";
    }

    for (let i = 0; i < questions.length; i++) {
      const q = questions[i];
      const qNum = i + 1;
      const unfilled: string[] = [];

      if (!q.prompt || q.prompt.trim() === "") {
        unfilled.push("Pertanyaan");
      }
      if (!q.short_answer || q.short_answer.trim() === "") {
        unfilled.push("Jawaban Singkat");
      }
      if (!q.alasan || q.alasan.trim() === "") {
        unfilled.push("Alasan Jawaban");
      }

      if (unfilled.length > 0) {
        return `Bagian ${unfilled.join(", ")} pada Soal ${qNum} belum diisi`;
      }
    }

    return null;
  };

  const executeSave = async (forceDraft: boolean = false) => {
    const token = localStorage.getItem("token") ?? sessionStorage.getItem("token");
    if (!token) {
      router.replace("/login");
      return;
    }

    setError("");
    setMessage("");

    const validationError = validateForm();
    if (validationError) {
      const actionName = isEditing ? "Gagal memperbarui paket ujian" : "Gagal membuat paket ujian";
      const fullError = `${actionName}: ${validationError}`;
      setError(fullError);
      setValidationModalError(validationError);
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }

    setBusy(true);

    const targetPublish = forceDraft ? false : publish;

    const payloadQuestions = questions.map((q) => ({
      prompt: q.prompt,
      short_answer: q.short_answer,
      model_answer: q.alasan,
      indicators: [],
    }));

    try {
      if (isEditing && setId) {
        const payload = {
          topic_id: topicId,
          title,
          description,
          prompt: payloadQuestions[0]?.prompt ?? "",
          short_answer: payloadQuestions[0]?.short_answer ?? "",
          model_answer: payloadQuestions[0]?.model_answer ?? "",
          indicators: [],
          publish: targetPublish,
        };

        const res = await fetch(`/api/questions/${setId}`, {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(payload),
        });

        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.detail || "Gagal memperbarui paket ujian.");
        }

        setIsDirty(false);
        sessionStorage.removeItem("imported_package");
        setMessage("Paket ujian berhasil diperbarui.");
        setTimeout(() => goToSubject(), 1000);
      } else {
        const payload = {
          subject_id: subjectId,
          topic_id: topicId,
          title,
          description,
          questions: payloadQuestions,
          publish: targetPublish,
        };

        const res = await fetch("/api/questions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(payload),
        });

        const data = await res.json();
        if (!res.ok) {
          const errMsgFromBackend =
            data.subject_id?.[0] ||
            data.topic_id?.[0] ||
            data.code?.[0] ||
            data.indicators ||
            data.detail ||
            "Gagal membuat paket ujian.";
          throw new Error(errMsgFromBackend);
        }

        setIsDirty(false);
        sessionStorage.removeItem("imported_package");
        setMessage("Paket ujian berhasil dibuat.");
        setTimeout(() => goToSubject(), 1000);
      }
    } catch (err) {
      const actionName = isEditing ? "Gagal memperbarui paket ujian" : "Gagal membuat paket ujian";
      const errText = err instanceof Error ? err.message : "Terjadi kesalahan.";
      setError(`${actionName}: ${errText}`);
      setValidationModalError(errText);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } finally {
      setBusy(false);
    }
  };

  const goToSubject = () => {
    if (subjectId) {
      router.push(`/admin/subjects/${subjectId}`);
    } else {
      router.push("/admin/subjects");
    }
  };

  const handleExit = () => {
    if (isReadOnly) {
      goToSubject();
      return;
    }
    if (isDirty) {
      setShowExitModal(true);
    } else {
      sessionStorage.removeItem("imported_package");
      goToSubject();
    }
  };

  const renderQuestionCard = (q: ExamQuestion, qIndex: number) => {
    return (
      <div
        key={qIndex}
        id={`question-card-${qIndex}`}
        className="rounded-xl border border-outline-variant/40 bg-surface-container-low p-5 space-y-5"
      >
        <div className="flex items-center justify-between border-b border-outline-variant/30 pb-3">
          <div className="flex items-center gap-2">
            <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-surface-container-high font-mono-ui text-xs font-bold text-on-surface">
              {qIndex + 1}
            </span>
            <h3 className="font-semibold text-on-surface">Pertanyaan Nomor {qIndex + 1}</h3>
            {q.id && (
              <span
                className="font-mono-ui text-[11px] font-semibold text-on-surface-variant bg-surface-container px-2 py-0.5 rounded border border-outline-variant/40"
                title={`ID Soal: ${q.id}`}
              >
                #{q.id.slice(0, 8)}
              </span>
            )}
          </div>
          {questions.length > 1 && !isEditing && !isReadOnly && (
            <button
              type="button"
              onClick={() => setPendingQuestionRemoval(qIndex)}
              className="inline-flex items-center justify-center p-2 rounded-lg bg-red-600 hover:bg-red-700 text-white font-semibold transition-colors shadow-sm cursor-pointer"
              title="Hapus pertanyaan ini"
              aria-label={`Hapus Pertanyaan ${qIndex + 1}`}
            >
              <Trash2 color="white" size={16} />
            </button>
          )}
        </div>

        <div>
          <label className="block text-xs font-semibold uppercase text-on-surface-variant">
            Pertanyaan
          </label>
          <textarea
            value={q.prompt}
            onChange={(e) => updateQuestionField(qIndex, "prompt", e.target.value)}
            disabled={isReadOnly}
            required
            rows={3}
            placeholder="Tuliskan butir soal konseptual di sini..."
            className="form-input mt-1 w-full disabled:opacity-80"
          />
        </div>

        <div>
          <label className="block text-xs font-semibold uppercase text-on-surface-variant">
            Jawaban Singkat
          </label>
          <textarea
            value={q.short_answer}
            onChange={(e) => updateQuestionField(qIndex, "short_answer", e.target.value)}
            disabled={isReadOnly}
            required
            rows={2}
            placeholder="Tuliskan jawaban singkat / kunci jawaban yang benar..."
            className="form-input mt-1 w-full disabled:opacity-80"
          />
        </div>

        <div>
          <label className="block text-xs font-semibold uppercase text-on-surface-variant">
            Alasan Jawaban
          </label>
          <textarea
            value={q.alasan}
            onChange={(e) => updateQuestionField(qIndex, "alasan", e.target.value)}
            disabled={isReadOnly}
            required
            rows={4}
            placeholder="Uraikan alasan / penjelasan rinci yang mendasari jawaban singkat di atas..."
            className="form-input mt-1 w-full disabled:opacity-80"
          />
        </div>
      </div>
    );
  };

  return (
    <PageContainer>
      <div className="flex items-center justify-between mb-4">
        <button
          type="button"
          onClick={handleExit}
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-on-surface-variant hover:text-primary cursor-pointer"
        >
          <ArrowLeft size={14} /> Kembali ke mata kuliah
        </button>
      </div>

      <header className="mb-6">
        <h1 className="font-display text-2xl font-bold text-on-surface">
          {isReadOnly ? "Lihat Paket Soal" : isEditing ? "Edit Paket Soal" : "Buat Paket Ujian Baru"}
        </h1>
        <p className="text-sm text-on-surface-variant mt-1">
          {isReadOnly
            ? "Tinjau butir pertanyaan, jawaban singkat, dan alasan jawaban pada paket ini."
            : "Atur informasi paket soal, lalu lengkapi pertanyaan, jawaban singkat, dan alasan jawaban."}
        </p>
      </header>

      {error && (
        <div role="alert" className="mb-5 flex gap-2 rounded-lg border border-error/40 bg-error-container p-4 text-sm text-on-error-container">
          <TriangleAlert size={18} />
          {error}
        </div>
      )}

      {message && (
        <div role="status" className="mb-5 flex gap-2 rounded-lg border border-primary-fixed-dim bg-primary-fixed/60 p-4 text-sm text-primary">
          <CheckCircle2 size={18} />
          {message}
        </div>
      )}

      <form onSubmit={(e) => { e.preventDefault(); setShowSubmitModal(true); }}>
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 items-start">
          <div className="lg:col-span-3 space-y-6">
            <section className="rounded-xl border border-outline-variant/40 bg-surface-container-lowest p-5 space-y-4">
              <h2 className="font-semibold text-on-surface text-base">Identitas Paket Ujian</h2>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="block text-xs font-semibold uppercase text-on-surface-variant">
                    Mata Kuliah
                  </label>
                  <AppSelect
                    value={subjectId}
                    onValueChange={(val) => {
                      if (isReadOnly) return;
                      setIsDirty(true);
                      setSubjectId(val);
                    }}
                    disabled={isEditing || isReadOnly}
                    className="mt-1 w-full"
                    ariaLabel="Mata Kuliah"
                    placeholder="Pilih mata kuliah"
                    options={subjects.map((s) => ({ value: s.id, label: s.name }))}
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold uppercase text-on-surface-variant">
                    Topik (Sub-Bab)
                  </label>
                  <input
                    value={selectedTopicName}
                    readOnly
                    disabled
                    placeholder="Topik belum ditentukan"
                    className="form-input mt-1 w-full cursor-not-allowed bg-surface-container disabled:opacity-80"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold uppercase text-on-surface-variant">
                    Judul Ujian
                  </label>
                  <input
                    value={title}
                    onChange={(e) => {
                      setIsDirty(true);
                      setTitle(e.target.value);
                    }}
                    disabled={isReadOnly}
                    required
                    placeholder="Judul asesmen konseptual..."
                    className="form-input mt-1 w-full disabled:opacity-80"
                  />
                </div>

                <div className="sm:col-span-2">
                  <label className="block text-xs font-semibold uppercase text-on-surface-variant">
                    Instruksi Pengerjaan
                  </label>
                  <textarea
                    value={description}
                    onChange={(e) => {
                      setIsDirty(true);
                      setDescription(e.target.value);
                    }}
                    disabled={isReadOnly}
                    placeholder="Petunjuk atau instruksi untuk mahasiswa..."
                    rows={2}
                    className="form-input mt-1 w-full disabled:opacity-80"
                  />
                </div>
              </div>
            </section>

            <div className="space-y-4">
              {questions[activeIndex] && renderQuestionCard(questions[activeIndex], activeIndex)}

              <div className="flex items-center justify-between pt-2">
                <button
                  type="button"
                  onClick={() => setActiveIndex((prev) => Math.max(0, prev - 1))}
                  disabled={activeIndex === 0}
                  className="btn-secondary text-xs disabled:opacity-40 cursor-pointer"
                >
                  <ArrowLeft size={14} /> Soal Sebelumnya
                </button>

                <span className="text-xs text-on-surface-variant font-mono-ui">
                  Soal {activeIndex + 1} dari {questions.length}
                </span>

                {activeIndex === questions.length - 1 ? (
                  !isReadOnly ? (
                    <button
                      type="button"
                      onClick={addQuestion}
                      className="btn-primary text-xs cursor-pointer"
                    >
                      <Plus size={14} /> Tambah Soal
                    </button>
                  ) : <div />
                ) : (
                  <button
                    type="button"
                    onClick={() => setActiveIndex((prev) => Math.min(questions.length - 1, prev + 1))}
                    className="btn-secondary text-xs cursor-pointer"
                  >
                    Soal Selanjutnya <ArrowRight size={14} />
                  </button>
                )}
              </div>
            </div>

            {!isReadOnly && (
              <div className="flex flex-col sm:flex-row items-center justify-between gap-4 border-t border-outline-variant/30 pt-4">
                <label className="flex items-center gap-2 text-sm text-on-surface cursor-pointer">
                  <input
                    type="checkbox"
                    checked={publish}
                    onChange={(e) => {
                      setIsDirty(true);
                      setPublish(e.target.checked);
                    }}
                    className="h-4 w-4 rounded border-outline-variant text-primary"
                  />
                  Terbitkan paket sekarang
                </label>

                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={handleExit}
                    className="btn-secondary px-6 py-2.5 min-w-[140px] text-sm font-semibold justify-center cursor-pointer"
                  >
                    Batal
                  </button>
                  <button
                    type="submit"
                    disabled={busy}
                    className="btn-primary px-6 py-2.5 min-w-[140px] text-sm font-semibold justify-center cursor-pointer"
                  >
                    <Send size={16} />
                    {busy ? "Menyimpan..." : isEditing ? "Perbarui Paket" : "Simpan Paket"}
                  </button>
                </div>
              </div>
            )}
          </div>

          <aside className="lg:col-span-1 sticky top-6 space-y-4">
            <div className="rounded-xl border border-outline-variant/40 bg-surface-container-lowest p-4 shadow-sm">
              <div className="flex items-center justify-between border-b border-outline-variant/30 pb-3">
                <h3 className="font-semibold text-sm text-on-surface">Daftar Nomor Soal</h3>
                <span className="text-xs text-on-surface-variant font-mono-ui">
                  {questions.length} Soal
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-2.5 py-4">
                {questions.map((_, idx) => {
                  const isValid = questionValidity[idx];
                  const isActive = activeIndex === idx;

                  return (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => setActiveIndex(idx)}
                      className={`relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full font-mono-ui text-xs font-bold transition-all !text-white shadow-sm cursor-pointer ${
                        isActive
                          ? "bg-primary ring-2 ring-primary ring-offset-2 ring-offset-surface-container-lowest"
                          : "bg-slate-700 hover:bg-slate-600"
                      }`}
                    >
                      {idx + 1}
                      <span
                        className={`absolute top-0 right-0 h-2.5 w-2.5 rounded-full border border-surface-container-lowest ${
                          isValid ? "bg-emerald-400" : "bg-amber-400"
                        }`}
                        title={isValid ? "Lengkap" : "Belum lengkap"}
                      />
                    </button>
                  );
                })}
              </div>

              {!isEditing && !isReadOnly && (
                <button
                  type="button"
                  onClick={addQuestion}
                  className="w-full btn-secondary text-xs mt-2 justify-center cursor-pointer"
                >
                  <Plus size={14} /> Tambah Soal
                </button>
              )}

              <div className="mt-4 pt-3 border-t border-outline-variant/30 space-y-2 text-[11px] text-on-surface-variant">
                <div className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-emerald-400" />
                  <span>Lengkap</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-amber-400" />
                  <span>Masih ada kolom kosong</span>
                </div>
              </div>
            </div>
          </aside>
        </div>
      </form>

      <ConfirmDialog
        open={pendingQuestionRemoval !== null}
        title="Hapus Soal Ini?"
        description={`Apakah Anda yakin ingin menghapus Soal Nomor ${(pendingQuestionRemoval ?? 0) + 1}? Tindakan ini tidak dapat dibatalkan.`}
        confirmLabel="Hapus Soal"
        onCancel={() => setPendingQuestionRemoval(null)}
        onConfirm={confirmRemoveQuestion}
      />

      <ConfirmDialog
        open={showSubmitModal}
        title={isEditing ? "Perbarui Paket Ujian?" : "Simpan Paket Ujian?"}
        description={
          publish
            ? "Apakah Anda yakin ingin menyimpan dan langsung menerbitkan paket soal ini untuk mahasiswa?"
            : "Apakah Anda yakin ingin menyimpan paket soal ini sebagai draft?"
        }
        confirmLabel={isEditing ? "Ya, Perbarui" : "Ya, Simpan"}
        onCancel={() => setShowSubmitModal(false)}
        onConfirm={() => {
          setShowSubmitModal(false);
          void executeSave(false);
        }}
      />

      {showExitModal && (
        <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-md rounded-2xl border border-outline-variant/40 bg-surface-container-lowest p-6 shadow-2xl space-y-4">
            <div className="flex items-start justify-between gap-3">
              <h3 className="font-display text-lg font-bold text-on-surface">Tinggalkan Halaman?</h3>
              <button
                type="button"
                onClick={() => setShowExitModal(false)}
                className="text-on-surface-variant hover:text-on-surface cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>
            <p className="text-sm leading-6 text-on-surface-variant">
              Anda belum menyimpan soal ini. Apakah ingin menyimpannya sebagai draft atau membuang perubahan?
            </p>
            <div className="flex flex-wrap items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowExitModal(false)}
                className="btn-secondary text-xs cursor-pointer"
              >
                Lanjut Edit
              </button>
              <button
                type="button"
                onClick={() => {
                  setIsDirty(false);
                  setShowExitModal(false);
                  sessionStorage.removeItem("imported_package");
                  goToSubject();
                }}
                className="btn-danger text-xs cursor-pointer"
              >
                Buang Soal
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowExitModal(false);
                  void executeSave(true);
                }}
                className="btn-primary text-xs cursor-pointer"
              >
                Simpan ke Draft
              </button>
            </div>
          </div>
        </div>
      )}

      {validationModalError && (
        <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-md rounded-2xl border border-error/40 bg-surface-container-lowest p-6 shadow-2xl space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2.5 text-error">
                <TriangleAlert size={22} />
                <h3 className="font-display text-lg font-bold text-on-surface">Peringatan Pengisian Soal</h3>
              </div>
              <button
                type="button"
                onClick={() => setValidationModalError(null)}
                className="text-on-surface-variant hover:text-on-surface cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>
            <p className="text-sm leading-6 text-on-surface-variant">
              {validationModalError}
            </p>
            <div className="flex justify-end pt-2">
              <button
                type="button"
                onClick={() => setValidationModalError(null)}
                className="btn-primary text-xs cursor-pointer"
              >
                Mengerti
              </button>
            </div>
          </div>
        </div>
      )}
    </PageContainer>
  );
}
