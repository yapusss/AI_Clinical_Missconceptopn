"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  FileText,
  Layers,
  Plus,
  Send,
  Trash2,
  TriangleAlert,
  X,
} from "lucide-react";
import AppSelect from "./AppSelect";
import ConfirmDialog from "./ConfirmDialog";
import PageContainer from "./PageContainer";
import PageHeader from "./PageHeader";
import indicatorPresets from "../lib/indicatorPresets.json";

export type Indicator = {
  label: string;
  description: string;
  weight: number;
  isCustom?: boolean;
};

export type ExamQuestion = {
  prompt: string;
  model_answer: string;
  indicators: Indicator[];
};

export type Subject = {
  id: string;
  name: string;
};

type Props = {
  isEditing?: boolean;
  setId?: string;
  initialData?: {
    code: string;
    title: string;
    description: string;
    subject_id: string;
    questions: ExamQuestion[];
    is_published?: boolean;
  };
};

const defaultIndicators = (): Indicator[] => [
  { label: "Akurasi", description: indicatorPresets[0]?.description ?? "", weight: 40, isCustom: false },
  { label: "Penjelasan", description: indicatorPresets[1]?.description ?? "", weight: 30, isCustom: false },
  { label: "Kelengkapan", description: indicatorPresets[2]?.description ?? "", weight: 30, isCustom: false },
];

const blankQuestion = (): ExamQuestion => ({
  prompt: "",
  model_answer: "",
  indicators: defaultIndicators(),
});

export default function QuestionForm({ isEditing = false, setId, initialData }: Props) {
  const router = useRouter();

  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [subjectId, setSubjectId] = useState(initialData?.subject_id ?? "");
  const [code, setCode] = useState(initialData?.code ?? "");
  const [title, setTitle] = useState(initialData?.title ?? "");
  const [description, setDescription] = useState(initialData?.description ?? "");
  const [questions, setQuestions] = useState<ExamQuestion[]>(
    initialData?.questions && initialData.questions.length > 0
      ? initialData.questions
      : [blankQuestion()]
  );
  const [publish, setPublish] = useState(initialData?.is_published ?? false);

  const [viewMode, setViewMode] = useState<"per_question" | "all_questions">("per_question");
  const [activeIndex, setActiveIndex] = useState(0);

  const [isDirty, setIsDirty] = useState(false);
  const [showExitConfirm, setShowExitConfirm] = useState(false);
  const [pendingQuestionRemoval, setPendingQuestionRemoval] = useState<number | null>(null);
  const [validationModalError, setValidationModalError] = useState<string | null>(null);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const maxIndicatorsAllowed = indicatorPresets.length + 1;

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
        if (!initialData?.subject_id && list.length > 0) {
          setSubjectId(list[0].id);
        }
      })
      .catch(() => {});
  }, [initialData]);

  useEffect(() => {
    if (initialData) {
      setSubjectId(initialData.subject_id);
      setCode(initialData.code);
      setTitle(initialData.title);
      setDescription(initialData.description);
      if (initialData.questions.length > 0) {
        setQuestions(initialData.questions);
      }
      setPublish(initialData.is_published ?? false);
    }
  }, [initialData]);

  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (isDirty) {
        e.preventDefault();
      }
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [isDirty]);

  const questionTotals = useMemo(() => {
    return questions.map((q) =>
      q.indicators.reduce((acc, ind) => acc + (Number(ind.weight) || 0), 0)
    );
  }, [questions]);

  const questionValidity = useMemo(() => {
    return questions.map((q, idx) => {
      const hasPrompt = q.prompt.trim().length > 0;
      const hasModelAnswer = q.model_answer.trim().length > 0;
      const validTotal = Math.abs((questionTotals[idx] ?? 0) - 100) < 0.01;
      return hasPrompt && hasModelAnswer && validTotal;
    });
  }, [questions, questionTotals]);

  const updateQuestionField = (index: number, field: "prompt" | "model_answer", value: string) => {
    setIsDirty(true);
    setQuestions((current) =>
      current.map((q, i) => (i === index ? { ...q, [field]: value } : q))
    );
  };

  const addQuestion = () => {
    setIsDirty(true);
    setQuestions((current) => [...current, blankQuestion()]);
    setActiveIndex(questions.length);
  };

  const confirmRemoveQuestion = () => {
    if (pendingQuestionRemoval === null) return;
    setIsDirty(true);
    const indexToRemove = pendingQuestionRemoval;
    setQuestions((current) => current.filter((_, i) => i !== indexToRemove));
    if (activeIndex >= indexToRemove && activeIndex > 0) {
      setActiveIndex(activeIndex - 1);
    }
    setPendingQuestionRemoval(null);
  };

  const handleIndicatorPresetChange = (qIndex: number, indIndex: number, selectedLabel: string) => {
    setIsDirty(true);
    const isCustom = selectedLabel === "Lainnya";
    const foundPreset = indicatorPresets.find((p) => p.label === selectedLabel);

    let hadConflict = false;

    setQuestions((current) =>
      current.map((q, i) => {
        if (i !== qIndex) return q;

        const oldIndicator = q.indicators[indIndex];
        const oldLabel = oldIndicator?.label;

        const duplicateIndex = q.indicators.findIndex(
          (ind, j) => j !== indIndex && ind.label === selectedLabel && !ind.isCustom
        );

        if (duplicateIndex !== -1) {
          hadConflict = true;
        }

        return {
          ...q,
          indicators: q.indicators.map((ind, j) => {
            if (j === indIndex) {
              return {
                ...ind,
                label: isCustom ? "" : selectedLabel,
                description: foundPreset ? foundPreset.description : ind.description,
                isCustom,
              };
            }
            if (j === duplicateIndex) {
              const fallbackPreset = indicatorPresets.find(
                (p) =>
                  p.label !== selectedLabel &&
                  p.label !== oldLabel &&
                  !q.indicators.some((other, oIdx) => oIdx !== indIndex && oIdx !== duplicateIndex && other.label === p.label)
              );
              if (oldLabel && !oldIndicator.isCustom) {
                const oldPresetObj = indicatorPresets.find((p) => p.label === oldLabel);
                return {
                  ...ind,
                  label: oldLabel,
                  description: oldPresetObj ? oldPresetObj.description : ind.description,
                  isCustom: false,
                };
              }
              return {
                ...ind,
                label: fallbackPreset ? fallbackPreset.label : "",
                description: fallbackPreset ? fallbackPreset.description : "",
                isCustom: !fallbackPreset,
              };
            }
            return ind;
          }),
        };
      })
    );

    if (hadConflict) {
      setMessage(`Pilihan "${selectedLabel}" sudah diambil di indikator lain. Pilihan sebelumnya telah disesuaikan.`);
    }
  };

  const updateIndicatorField = (
    qIndex: number,
    indIndex: number,
    field: "label" | "description" | "weight",
    value: string | number
  ) => {
    setIsDirty(true);
    setQuestions((current) =>
      current.map((q, i) => {
        if (i !== qIndex) return q;
        return {
          ...q,
          indicators: q.indicators.map((ind, j) => {
            if (j !== indIndex) return ind;
            return { ...ind, [field]: value };
          }),
        };
      })
    );
  };

  const addIndicatorToQuestion = (qIndex: number) => {
    const currentQ = questions[qIndex];
    if (!currentQ || currentQ.indicators.length >= maxIndicatorsAllowed) return;
    setIsDirty(true);

    const usedLabels = new Set(currentQ.indicators.map((ind) => ind.label));
    const nextPreset = indicatorPresets.find((p) => !usedLabels.has(p.label));

    const newInd: Indicator = nextPreset
      ? { label: nextPreset.label, description: nextPreset.description, weight: 0, isCustom: false }
      : { label: "", description: "", weight: 0, isCustom: true };

    setQuestions((current) =>
      current.map((q, i) => {
        if (i !== qIndex) return q;
        return {
          ...q,
          indicators: [...q.indicators, newInd],
        };
      })
    );
  };

  const removeIndicatorFromQuestion = (qIndex: number, indIndex: number) => {
    setIsDirty(true);
    setQuestions((current) =>
      current.map((q, i) => {
        if (i !== qIndex) return q;
        return {
          ...q,
          indicators: q.indicators.filter((_, j) => j !== indIndex),
        };
      })
    );
  };

  const validateForm = (): string | null => {
    if (!subjectId || subjectId.trim() === "") {
      return "Mata kuliah belum dipilih";
    }
    if (!code || code.trim() === "") {
      return "Kode paket belum diisi";
    }
    if (!title || title.trim() === "") {
      return "Judul ujian belum diisi";
    }

    for (let i = 0; i < questions.length; i++) {
      const q = questions[i];
      const qNum = i + 1;
      const unfilled: string[] = [];

      if (!q.prompt || q.prompt.trim() === "") {
        unfilled.push("Pertanyaan Konseptual");
      }
      if (!q.model_answer || q.model_answer.trim() === "") {
        unfilled.push("Jawaban Referensi");
      }

      for (let j = 0; j < q.indicators.length; j++) {
        const ind = q.indicators[j];
        if (ind.isCustom && (!ind.label || ind.label.trim() === "")) {
          unfilled.push(`Label Indikator Kustom #${j + 1}`);
        }
      }

      const totalWeight = questionTotals[i] ?? 0;
      const weightNot100 = Math.abs(totalWeight - 100) >= 0.01;

      if (unfilled.length > 0 && weightNot100) {
        return `Bagian ${unfilled.join(", ")} pada Soal ${qNum} belum diisi dan rubrik penilaian belum bernilai 100 (saat ini ${totalWeight})`;
      }
      if (unfilled.length > 0) {
        return `Bagian ${unfilled.join(", ")} pada Soal ${qNum} belum diisi`;
      }
      if (weightNot100) {
        return `Indikator rubrik penilaian pada Soal ${qNum} belum 100 (saat ini ${totalWeight})`;
      }
    }

    return null;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
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

    const payloadQuestions = questions.map((q) => ({
      prompt: q.prompt,
      model_answer: q.model_answer,
      indicators: q.indicators.map((ind) => ({
        label: ind.label.trim() || "Indikator",
        description: ind.description,
        weight: (Number(ind.weight) / 100).toFixed(4),
      })),
    }));

    try {
      if (isEditing && setId) {
        const payload = {
          title,
          description,
          prompt: payloadQuestions[0]?.prompt ?? "",
          model_answer: payloadQuestions[0]?.model_answer ?? "",
          indicators: payloadQuestions[0]?.indicators ?? [],
          publish,
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
        setMessage("Paket ujian berhasil diperbarui.");
        setTimeout(() => router.push("/questions"), 1000);
      } else {
        const payload = {
          subject_id: subjectId,
          code,
          title,
          description,
          questions: payloadQuestions,
          publish,
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
            data.code?.[0] ||
            data.indicators ||
            data.detail ||
            "Gagal membuat paket ujian.";
          throw new Error(errMsgFromBackend);
        }

        setIsDirty(false);
        setMessage("Paket ujian berhasil dibuat.");
        setTimeout(() => router.push("/questions"), 1000);
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

  const handleExit = () => {
    if (isDirty) {
      setShowExitConfirm(true);
    } else {
      router.push("/questions");
    }
  };

  const renderQuestionCard = (q: ExamQuestion, qIndex: number) => {
    const total = questionTotals[qIndex] ?? 0;
    const hasCustom = q.indicators.some((ind) => ind.isCustom);
    const canAddMoreIndicators = q.indicators.length < maxIndicatorsAllowed;

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
          </div>
          {questions.length > 1 && !isEditing && (
            <button
              type="button"
              onClick={() => setPendingQuestionRemoval(qIndex)}
              className="inline-flex items-center justify-center p-2 rounded-lg bg-red-600 hover:bg-red-700 text-white font-semibold transition-colors shadow-sm"
              title="Hapus pertanyaan ini"
              aria-label={`Hapus Pertanyaan ${qIndex + 1}`}
            >
              <Trash2 color="white" size={16} />
            </button>
          )}
        </div>

        <div>
          <label className="block text-xs font-semibold uppercase text-on-surface-variant">
            Pertanyaan Konseptual
          </label>
          <textarea
            value={q.prompt}
            onChange={(e) => updateQuestionField(qIndex, "prompt", e.target.value)}
            required
            rows={3}
            placeholder="Tuliskan butir soal konseptual di sini..."
            className="form-input mt-1 w-full"
          />
        </div>

        <div>
          <label className="block text-xs font-semibold uppercase text-on-surface-variant">
            Jawaban Referensi (Model Answer)
          </label>
          <textarea
            value={q.model_answer}
            onChange={(e) => updateQuestionField(qIndex, "model_answer", e.target.value)}
            required
            rows={3}
            placeholder="Tuliskan jawaban model referensi ilmiah yang menjadi acuan penilaian..."
            className="form-input mt-1 w-full"
          />
        </div>

        <div className="border-t border-outline-variant/30 pt-4">
          <div className="flex items-center justify-between">
            <div>
              <h4 className="text-xs font-semibold uppercase text-on-surface-variant">
                Indikator Rubrik Penilaian
              </h4>
              <p className="text-[11px] text-on-surface-variant">
                Pilih kriteria penilaian dari daftar tetap atau tambahkan satu kriteria khusus.
              </p>
            </div>
            <span
              className={`font-mono-ui text-xs font-bold ${
                Math.abs(total - 100) < 0.01 ? "text-tertiary" : "text-error"
              }`}
            >
              Total Bobot: {total} / 100
            </span>
          </div>

          <div className="mt-3 space-y-3">
            {q.indicators.map((ind, indIndex) => {
              const currentLabel = ind.isCustom ? "Lainnya" : ind.label;
              return (
                <div
                  key={indIndex}
                  className="rounded-lg border border-outline-variant/40 bg-surface-container-lowest p-3 space-y-2"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <select
                      value={currentLabel}
                      onChange={(e) => handleIndicatorPresetChange(qIndex, indIndex, e.target.value)}
                      className="form-select flex-1 min-w-[140px] text-xs"
                    >
                      {indicatorPresets.map((preset) => (
                        <option key={preset.label} value={preset.label}>
                          {preset.label}
                        </option>
                      ))}
                      <option value="Lainnya" disabled={hasCustom && !ind.isCustom}>
                        Lainnya (Kustom)
                      </option>
                    </select>

                    {ind.isCustom && (
                      <input
                        type="text"
                        value={ind.label}
                        onChange={(e) =>
                          updateIndicatorField(qIndex, indIndex, "label", e.target.value)
                        }
                        placeholder="Nama kriteria kustom"
                        required
                        className="form-input flex-1 min-w-[140px] text-xs"
                      />
                    )}

                    <div className="flex items-center rounded-lg border border-input-border bg-input-bg px-2 py-1.5 shrink-0">
                      <input
                        type="number"
                        min="0"
                        max="100"
                        step="1"
                        value={ind.weight === 0 ? "" : ind.weight}
                        placeholder="0"
                        onChange={(e) => {
                          const val = e.target.value;
                          updateIndicatorField(qIndex, indIndex, "weight", val === "" ? 0 : Number(val));
                        }}
                        required
                        className="w-10 bg-transparent text-right font-mono-ui text-xs text-on-surface outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                      />
                      <span className="ml-1 text-xs font-mono-ui text-on-surface-variant font-medium select-none">
                        / 100
                      </span>
                    </div>

                    <button
                      type="button"
                      onClick={() => removeIndicatorFromQuestion(qIndex, indIndex)}
                      disabled={q.indicators.length <= 1}
                      className="text-error hover:text-on-error-container disabled:opacity-30 px-2 py-1 font-bold text-base"
                      title="Hapus indikator"
                    >
                      ×
                    </button>
                  </div>

                  <input
                    type="text"
                    value={ind.description}
                    onChange={(e) =>
                      updateIndicatorField(qIndex, indIndex, "description", e.target.value)
                    }
                    placeholder="Deskripsi atau panduan penilaian kriteria ini..."
                    className="form-input w-full text-xs"
                  />
                </div>
              );
            })}
          </div>

          <div className="mt-3 flex items-center justify-between">
            {canAddMoreIndicators ? (
              <button
                type="button"
                onClick={() => addIndicatorToQuestion(qIndex)}
                className="text-xs font-semibold text-primary hover:underline inline-flex items-center gap-1"
              >
                <Plus size={14} /> Tambah Indikator
              </button>
            ) : (
              <span className="text-[11px] text-on-surface-variant font-medium">
                Semua pilihan indikator telah digunakan.
              </span>
            )}

            {hasCustom && (
              <span className="text-[11px] text-on-surface-variant">
                Opsi &quot;Lainnya&quot; telah digunakan (maksimal 1 per soal)
              </span>
            )}
          </div>
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
          <ArrowLeft size={14} /> Kembali ke daftar paket
        </button>

        <div className="flex items-center rounded-lg border border-outline-variant/40 bg-surface-container-low p-1 text-xs">
          <button
            type="button"
            onClick={() => setViewMode("per_question")}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md font-semibold transition-colors ${
              viewMode === "per_question"
                ? "bg-primary text-white"
                : "text-on-surface-variant hover:text-on-surface"
            }`}
          >
            <FileText size={14} /> Per Soal
          </button>
          <button
            type="button"
            onClick={() => setViewMode("all_questions")}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md font-semibold transition-colors ${
              viewMode === "all_questions"
                ? "bg-primary text-white"
                : "text-on-surface-variant hover:text-on-surface"
            }`}
          >
            <Layers size={14} /> Semua Soal
          </button>
        </div>
      </div>

      <PageHeader className="mb-6" title={isEditing ? "Edit Paket Soal" : "Buat Paket Ujian Baru"} description="Atur informasi paket soal, pertanyaan esai konseptual, dan rubrik penilaian berbobot total 100." icon={FileText} />

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

      <form onSubmit={handleSubmit}>
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
                      setIsDirty(true);
                      setSubjectId(val);
                    }}
                    disabled={isEditing}
                    className="mt-1 w-full"
                    ariaLabel="Mata Kuliah"
                    placeholder="Pilih mata kuliah"
                    options={subjects.map((s) => ({ value: s.id, label: s.name }))}
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold uppercase text-on-surface-variant">
                    Kode Paket
                  </label>
                  <input
                    value={code}
                    onChange={(e) => {
                      setIsDirty(true);
                      setCode(e.target.value.toUpperCase());
                    }}
                    disabled={isEditing}
                    required
                    placeholder="Misal: FIS-NEWT-01"
                    className="form-input mt-1 w-full font-mono-ui"
                  />
                </div>

                <div className="sm:col-span-2">
                  <label className="block text-xs font-semibold uppercase text-on-surface-variant">
                    Judul Ujian
                  </label>
                  <input
                    value={title}
                    onChange={(e) => {
                      setIsDirty(true);
                      setTitle(e.target.value);
                    }}
                    required
                    placeholder="Judul asesmen konseptual..."
                    className="form-input mt-1 w-full"
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
                    placeholder="Petunjuk atau instruksi untuk mahasiswa..."
                    rows={2}
                    className="form-input mt-1 w-full"
                  />
                </div>
              </div>
            </section>

            {viewMode === "per_question" ? (
              <div className="space-y-4">
                {questions[activeIndex] && renderQuestionCard(questions[activeIndex], activeIndex)}

                <div className="flex items-center justify-between pt-2">
                  <button
                    type="button"
                    onClick={() => setActiveIndex((prev) => Math.max(0, prev - 1))}
                    disabled={activeIndex === 0}
                    className="btn-secondary text-xs disabled:opacity-40"
                  >
                    <ArrowLeft size={14} /> Soal Sebelumnya
                  </button>

                  <span className="text-xs text-on-surface-variant font-mono-ui">
                    Soal {activeIndex + 1} dari {questions.length}
                  </span>

                  {activeIndex === questions.length - 1 ? (
                    <button
                      type="button"
                      onClick={addQuestion}
                      className="btn-primary text-xs"
                    >
                      <Plus size={14} /> Tambah Soal
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setActiveIndex((prev) => Math.min(questions.length - 1, prev + 1))}
                      className="btn-secondary text-xs"
                    >
                      Soal Selanjutnya <ArrowRight size={14} />
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <div className="space-y-6">
                {questions.map((q, idx) => renderQuestionCard(q, idx))}
              </div>
            )}

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
                Terbitkan paket sekarang (semua soal harus valid dan berbobot 100)
              </label>

              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={handleExit}
                  className="btn-secondary px-6 py-2.5 min-w-[140px] text-sm font-semibold justify-center"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={busy}
                  className="btn-primary px-6 py-2.5 min-w-[140px] text-sm font-semibold justify-center"
                >
                  <Send size={16} />
                  {busy ? "Menyimpan..." : isEditing ? "Perbarui Paket" : "Simpan Paket"}
                </button>
              </div>
            </div>
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
                  const isActive = viewMode === "per_question" && activeIndex === idx;

                  return (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => {
                        if (viewMode === "per_question") {
                          setActiveIndex(idx);
                        } else {
                          const elem = document.getElementById(`question-card-${idx}`);
                          elem?.scrollIntoView({ behavior: "smooth" });
                        }
                      }}
                      className={`relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full font-mono-ui text-xs font-bold transition-all !text-white shadow-sm ${
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
                        title={isValid ? "Lengkap & berbobot 100" : "Belum lengkap / belum 100"}
                      />
                    </button>
                  );
                })}
              </div>

              {!isEditing && (
                <button
                  type="button"
                  onClick={addQuestion}
                  className="w-full btn-secondary text-xs mt-2 justify-center"
                >
                  <Plus size={14} /> Tambah Soal
                </button>
              )}

              <div className="mt-4 pt-3 border-t border-outline-variant/30 space-y-2 text-[11px] text-on-surface-variant">
                <div className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-emerald-400" />
                  <span>Lengkap & berbobot 100</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-amber-400" />
                  <span>Belum berbobot 100 / kosong</span>
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
        open={showExitConfirm}
        title="Tinggalkan Halaman?"
        description="Anda belum menyimpan soal ini, apakah ingin tetap keluar dan membuang perubahan?"
        confirmLabel="Buang Perubahan"
        onCancel={() => setShowExitConfirm(false)}
        onConfirm={() => {
          setIsDirty(false);
          setShowExitConfirm(false);
          router.push("/questions");
        }}
      />

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
                className="text-on-surface-variant hover:text-on-surface"
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
                className="btn-primary text-xs"
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
