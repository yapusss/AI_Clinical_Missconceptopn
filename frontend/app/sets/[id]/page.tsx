"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import {
  AlertTriangle,
  ArrowLeft,
  ClipboardList,
  HelpCircle,
  LogOut,
  Send,
  TriangleAlert,
  X,
} from "lucide-react";

import { useAuth } from "../../components/AuthProvider";
import { apiFetch } from "../../lib/api";
import PageContainer from "../../components/PageContainer";
import PageHeader from "../../components/PageHeader";
import RichTextContent from "../../components/RichTextContent";

type StudentQuestion = {
  question_id: string;
  order_index: number;
  version_id: string;
  version_number: number;
  prompt: string;
};

type StudentSet = {
  id: string;
  code: string;
  title: string;
  description: string;
  subject_id: string;
  subject_name: string;
  is_active: boolean;
  questions: StudentQuestion[];
};

type QuestionAnswer = {
  t1_answer: string;
  t2_confidence: number | null; // 1 - 6
  t3_reason: string;
  t4_confidence: number | null; // 1 - 6
};

const CONFIDENCE_LEVELS = [
  { val: 1, label: "1", desc: "Sangat Ragu", type: "TY" },
  { val: 2, label: "2", desc: "Tidak Yakin", type: "TY" },
  { val: 3, label: "3", desc: "Kurang Yakin", type: "TY" },
  { val: 4, label: "4", desc: "Cukup Yakin", type: "Y" },
  { val: 5, label: "5", desc: "Yakin", type: "Y" },
  { val: 6, label: "6", desc: "Sangat Yakin", type: "Y" },
];

const REASON_KEYWORDS = [
  "karena",
  "sebab",
  "oleh karena itu",
  "dikarenakan",
  "karna",
];

function AnswerSetContent() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const setId = params?.id as string | undefined;

  const searchParams = useSearchParams();
  const code = searchParams.get("code");

  const [data, setData] = useState<StudentSet | null>(null);
  const [fetching, setFetching] = useState(true);
  const [error, setError] = useState("");
  const [answers, setAnswers] = useState<Record<string, QuestionAnswer>>({});
  const [submitting, setSubmitting] = useState(false);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [showExitWarningModal, setShowExitWarningModal] = useState(false);
  const [started, setStarted] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);

  // Kembali ke atas setiap kali nomor soal berubah (prev/next/pill/submit-advance)
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, [activeIndex]);

  const storageKey = setId && user ? `exam_response_${setId}_${user.id}` : null;
  const passwordKey = setId ? `exam_package_password_${setId}` : null;

  // 1. Load Data Soal & Pulihkan Jawaban
  const load = useCallback(async () => {
    if (!code) {
      setFetching(false);
      setError("Kode soal tidak ditemukan pada tautan.");
      return;
    }
    setFetching(true);
    setError("");
    try {
      const password = passwordKey ? sessionStorage.getItem(passwordKey) ?? "" : "";
      const res = await apiFetch<StudentSet>(
        `/student/sets?code=${encodeURIComponent(code)}&password=${encodeURIComponent(password)}`,
      );
      setData(res);

      const initial: Record<string, QuestionAnswer> = {};
      res.questions.forEach((q) => {
        initial[q.question_id] = {
          t1_answer: "",
          t2_confidence: null,
          t3_reason: "",
          t4_confidence: null,
        };
      });

      if (storageKey) {
        const saved = localStorage.getItem(storageKey);
        if (saved) {
          try {
            const parsed = JSON.parse(saved);
            Object.assign(initial, parsed);
            setStarted(true);
          } catch {}
        }
      }

      setAnswers(initial);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setFetching(false);
    }
  }, [code, storageKey, passwordKey]);

  useEffect(() => {
    if (loading) return;
    if (!user) {
      router.replace("/login");
      return;
    }
    void load();
  }, [user, loading, router, load]);

  // 2. Simpan Progres Otomatis
  useEffect(() => {
    if (!storageKey || Object.keys(answers).length === 0) return;
    localStorage.setItem(storageKey, JSON.stringify(answers));
  }, [answers, storageKey]);

  // 3. Peringatan Browser saat keluar/refresh
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (started && !submitting) {
        e.preventDefault();
      }
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [started, submitting]);

  const activeQuestion = data?.questions[activeIndex];
  const currentAnswer = activeQuestion
    ? answers[activeQuestion.question_id] || {
        t1_answer: "",
        t2_confidence: null,
        t3_reason: "",
        t4_confidence: null,
      }
    : null;

  const updateCurrent = (patch: Partial<QuestionAnswer>) => {
    if (!activeQuestion) return;
    setAnswers((prev) => ({
      ...prev,
      [activeQuestion.question_id]: {
        ...(prev[activeQuestion.question_id] || {
          t1_answer: "",
          t2_confidence: null,
          t3_reason: "",
          t4_confidence: null,
        }),
        ...patch,
      },
    }));
  };

  const t1HasReasonKeyword = Boolean(
    currentAnswer?.t1_answer &&
    REASON_KEYWORDS.some((kw) =>
      currentAnswer.t1_answer.toLowerCase().includes(kw),
    ),
  );

  const isQuestionComplete = (qId: string) => {
    const a = answers[qId];
    if (!a) return false;
    return (
      a.t1_answer.trim().length > 0 &&
      a.t2_confidence !== null &&
      a.t3_reason.trim().length > 0 &&
      a.t4_confidence !== null
    );
  };

  const handleNextOrFinish = () => {
    if (!data || !activeQuestion || !currentAnswer) return;

    if (!currentAnswer.t1_answer.trim()) {
      setError("Harap isi kesimpulan jawaban Anda terlebih dahulu.");
      return;
    }
    if (currentAnswer.t2_confidence === null) {
      setError("Pilih tingkat keyakinan terhadap kesimpulan jawaban Anda.");
      return;
    }
    if (!currentAnswer.t3_reason.trim()) {
      setError("Harap isi alasan / penalaran ilmiah Anda terlebih dahulu.");
      return;
    }
    if (currentAnswer.t4_confidence === null) {
      setError("Pilih tingkat keyakinan terhadap alasan Anda.");
      return;
    }

    setError("");
    if (activeIndex < data.questions.length - 1) {
      setActiveIndex((idx) => idx + 1);
    } else {
      const incomplete = data.questions.find(
        (q) => !isQuestionComplete(q.question_id),
      );
      if (incomplete) {
        setError(
          `Pertanyaan nomor ${incomplete.order_index} belum diselesaikan secara lengkap.`,
        );
        setActiveIndex(data.questions.indexOf(incomplete));
        return;
      }
      setShowConfirmModal(true);
    }
  };

  const executeSubmit = async () => {
    if (!data || !setId) return;
    setShowConfirmModal(false);
    setError("");
    setSubmitting(true);

    try {
      const payloadAnswers = data.questions.map((q) => {
        const a = answers[q.question_id];
        return {
          question_id: q.question_id,
          tier1_answer: a.t1_answer.trim(),
          tier2_confidence: a.t2_confidence,
          tier3_reason: a.t3_reason.trim(),
          tier4_confidence: a.t4_confidence,
        };
      });

      await apiFetch(`/student/sets/${setId}/submissions`, {
        method: "POST",
        body: JSON.stringify({ answers: payloadAnswers, password: passwordKey ? sessionStorage.getItem(passwordKey) ?? "" : "" }),
      });

      if (storageKey) {
        localStorage.removeItem(storageKey);
      }

      router.replace("/code#pengumpulan");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  if (loading || !user) return null;

  // Layar Petunjuk Awal Sebelum Mulai
  if (data && !started) {
    return (
      <PageContainer>
        <button
          type="button"
          onClick={() => router.push("/code")}
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-on-surface-variant hover:text-primary cursor-pointer"
        >
          <ArrowLeft size={14} /> Kembali ke daftar soal
        </button>
        <section className="glass-panel mt-6 rounded-xl border border-outline-variant/40 p-8 space-y-5">
          <PageHeader
            title={data.title}
            description="Format Evaluasi Pemahaman Konseptual"
            icon={ClipboardList}
          />
          <div className="rounded-xl border border-primary/30 bg-primary/5 p-5 text-sm text-on-surface space-y-3">
            <h3 className="font-bold text-primary flex items-center gap-2">
              <ClipboardList size={18} /> Petunjuk Pengisian Soal:
            </h3>
            <ul className="list-disc pl-5 space-y-2 text-xs text-on-surface-variant leading-relaxed">
              <li>
                <strong>1. Kesimpulan / Jawaban Singkat:</strong> Tuliskan
                kesimpulan langsung atas pertanyaan, tanpa penjelasan panjang
                (maksimal 120 karakter).
              </li>
              <li>
                <strong>2. Tingkat Keyakinan Jawaban:</strong> Pilih skala
                keyakinan 1–6 terhadap kesimpulan Anda (1–3: Ragu / Tidak Yakin,
                4–6: Yakin).
              </li>
              <li>
                <strong>3. Alasan / Penalaran Ilmiah:</strong> Uraikan dasar
                logika dan penjelasan konsep ilmiah mengapa Anda memilih
                kesimpulan tersebut.
              </li>
              <li>
                <strong>4. Tingkat Keyakinan Alasan:</strong> Pilih skala
                keyakinan 1–6 terhadap kebenaran alasan ilmiah yang Anda
                berikan.
              </li>
              <li className="text-emerald-500 font-semibold">
                Seluruh kolom terbuka langsung dan jawaban Anda tersimpan
                otomatis pada perangkat ini.
              </li>
            </ul>
          </div>

          <button
            type="button"
            onClick={() => setStarted(true)}
            className="btn-primary mt-4 cursor-pointer"
          >
            Mulai Pengerjaan <Send size={16} />
          </button>
        </section>
      </PageContainer>
    );
  }

  const completedQuestionsCount = data
    ? data.questions.filter((q) => isQuestionComplete(q.question_id)).length
    : 0;

  return (
    <PageContainer>
      <div className="flex items-center justify-between mb-4">
        <button
          type="button"
          onClick={() => setShowExitWarningModal(true)}
          className="inline-flex items-center gap-1.5 text-sm font-semibold text-rose-400 hover:text-rose-300 cursor-pointer"
        >
          <LogOut size={15} /> Keluar dari Lembar Soal
        </button>
        <span className="text-sm font-mono-ui font-semibold text-primary">
          Soal Selesai: {completedQuestionsCount} /{" "}
          {data?.questions.length ?? 0}
        </span>
      </div>

      {error && (
        <div
          role="alert"
          className="mb-4 flex items-center gap-2.5 rounded-xl border border-error/40 bg-error-container p-3.5 text-xs text-on-error-container animate-fade-in"
        >
          <TriangleAlert size={16} className="shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {activeQuestion && currentAnswer && (
        <div className="flex flex-col gap-5 lg:flex-row lg:items-start">
        <div className="min-w-0 flex-1 space-y-5">
          {/* Teks Pertanyaan Konseptual */}
          <section className="rounded-xl border border-primary/30 border-l-4 border-l-primary bg-primary-fixed p-5 shadow-sm sm:p-6 space-y-2">
            <span className="font-mono-ui text-sm font-bold uppercase tracking-wider text-primary">
              Soal Nomor {activeQuestion.order_index} dari{" "}
              {data?.questions.length}
            </span>
            <RichTextContent html={activeQuestion.prompt} className="text-xl font-semibold leading-relaxed text-on-surface" />
          </section>

          {/* 1. Kesimpulan / Jawaban Singkat */}
          <section className="glass-panel rounded-xl border border-outline-variant/60 p-5 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-bold text-sm uppercase tracking-wider text-on-surface">
                  1. Kesimpulan / Jawaban Singkat
                </h3>
                <p className="text-xs text-on-surface-variant mt-0.5">
                  Maksimal 120 karakter.
                </p>
              </div>
              <span
                className={`text-xs font-mono-ui font-bold ${currentAnswer.t1_answer.length > 120 ? "text-error" : "text-on-surface-variant"}`}
              >
                {currentAnswer.t1_answer.length} / 120
              </span>
            </div>

            <input
              type="text"
              maxLength={120}
              value={currentAnswer.t1_answer}
              onChange={(e) => updateCurrent({ t1_answer: e.target.value })}
              placeholder="Contoh: Resultan gayanya nol."
              className="form-input text-sm w-full"
            />

            {t1HasReasonKeyword && (
              <div className="flex items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-2.5 text-xs text-amber-500">
                <AlertTriangle size={15} className="shrink-0" />
                <span>
                  Catatan: Terdeteksi kata sebab (&ldquo;karena/sebab&rdquo;).
                  Di bagian ini tuliskan kesimpulannya saja; alasan ilmiah
                  diuraikan pada kolom alasan di bawah.
                </span>
              </div>
            )}
          </section>

          {/* 2. Tingkat Keyakinan pada Jawaban */}
          <section className="glass-panel rounded-xl border border-outline-variant/60 p-5 space-y-3">
            <div>
              <h3 className="font-bold text-sm uppercase tracking-wider text-on-surface">
                2. Tingkat Keyakinan pada Jawaban
              </h3>
              <p className="text-xs text-on-surface-variant mt-0.5">
                Skala 1–3: Tidak Yakin, 4–6: Yakin.
              </p>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-2 pt-1">
              {CONFIDENCE_LEVELS.map((lvl) => {
                const isSelected = currentAnswer.t2_confidence === lvl.val;
                return (
                  <label
                    key={lvl.val}
                    className={`flex h-10 items-center justify-center rounded-lg border text-center cursor-pointer transition-all ${
                      isSelected
                        ? "border-primary bg-primary/20 text-primary font-bold shadow-sm"
                        : "border-outline-variant/40 bg-surface-container hover:bg-surface-container-high text-on-surface"
                    }`}
                  >
                    <input
                      type="radio"
                      name={`t2_conf_${activeQuestion.question_id}`}
                      value={lvl.val}
                      checked={isSelected}
                      onChange={() => updateCurrent({ t2_confidence: lvl.val })}
                      className="hidden"
                    />
                    <span className="font-mono-ui text-base">{lvl.val}</span>
                  </label>
                );
              })}
            </div>
          </section>

          {/* 3. Alasan / Penalaran Ilmiah */}
          <section className="glass-panel rounded-xl border border-outline-variant/60 p-5 space-y-3">
            <div>
              <h3 className="font-bold text-sm uppercase tracking-wider text-on-surface">
                3. Alasan / Penalaran Ilmiah
              </h3>
            </div>

            <textarea
              rows={4}
              value={currentAnswer.t3_reason}
              onChange={(e) => updateCurrent({ t3_reason: e.target.value })}
              placeholder="Uraikan penalaran ilmiah dan dasar konsep Anda di sini..."
              className="form-input text-sm w-full"
            />
          </section>

          {/* 4. Tingkat Keyakinan pada Alasan */}
          <section className="glass-panel rounded-xl border border-outline-variant/60 p-5 space-y-3">
            <div>
              <h3 className="font-bold text-sm uppercase tracking-wider text-on-surface">
                4. Tingkat Keyakinan pada Alasan
              </h3>
              <p className="text-xs text-on-surface-variant mt-0.5">
                Skala 1–3: Tidak Yakin, 4–6: Yakin.
              </p>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-2 pt-1">
              {CONFIDENCE_LEVELS.map((lvl) => {
                const isSelected = currentAnswer.t4_confidence === lvl.val;
                return (
                  <label
                    key={lvl.val}
                    className={`flex h-10 items-center justify-center rounded-lg border text-center cursor-pointer transition-all ${
                      isSelected
                        ? "border-primary bg-primary/20 text-primary font-bold shadow-sm"
                        : "border-outline-variant/40 bg-surface-container hover:bg-surface-container-high text-on-surface"
                    }`}
                  >
                    <input
                      type="radio"
                      name={`t4_conf_${activeQuestion.question_id}`}
                      value={lvl.val}
                      checked={isSelected}
                      onChange={() => updateCurrent({ t4_confidence: lvl.val })}
                      className="hidden"
                    />
                    <span className="font-mono-ui text-base">{lvl.val}</span>
                  </label>
                );
              })}
            </div>
          </section>

          {/* Navigasi Soal Bawah */}
          <div className="flex items-center justify-between pt-4 border-t border-outline-variant/30">
            <button
              type="button"
              disabled={activeIndex === 0}
              onClick={() => {
                setError("");
                setActiveIndex((idx) => Math.max(0, idx - 1));
              }}
              className="btn-secondary text-sm !py-2 !px-4 disabled:opacity-30 cursor-pointer"
            >
              ← Soal Sebelumnya
            </button>

            <span className="text-sm font-mono-ui text-on-surface-variant">
              Soal {activeIndex + 1} dari {data.questions.length}
            </span>

            <button
              type="button"
              onClick={handleNextOrFinish}
              className="btn-primary text-sm !py-2.5 !px-6 cursor-pointer"
            >
              {activeIndex === data.questions.length - 1 ? (
                <>
                  Selesai &amp; Kumpulkan Semua <Send size={14} />
                </>
              ) : (
                <>Lanjut ke Soal Berikutnya →</>
              )}
            </button>
          </div>
        </div>

        {/* SIDEBAR KANAN: DAFTAR SOAL (sama seperti view lain) */}
        <aside className="w-full shrink-0 space-y-3 lg:sticky lg:top-6 lg:w-52">
          <div className="rounded-xl border border-outline-variant/40 bg-surface-container-lowest p-3.5 shadow-sm">
            <div className="flex items-center justify-between border-b border-outline-variant/30 pb-2.5">
              <h3 className="font-bold text-sm uppercase tracking-wide text-on-surface">
                Daftar Soal
              </h3>
              <span className="font-mono-ui text-xs text-on-surface-variant">
                {data.questions.length} Soal
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-2 py-3">
              {data.questions.map((q, idx) => {
                const isDone = isQuestionComplete(q.question_id);
                const isCurrent = idx === activeIndex;
                const boxCls = isDone
                  ? "border-emerald-500/60 bg-emerald-500/15 font-bold text-emerald-600 dark:text-emerald-400"
                  : "border-outline-variant/50 bg-surface-container text-on-surface-variant";
                return (
                  <button
                    key={q.question_id}
                    type="button"
                    onClick={() => {
                      setError("");
                      setActiveIndex(idx);
                    }}
                    className={`relative flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border font-mono-ui text-sm transition-all cursor-pointer shadow-sm ${boxCls} ${
                      isCurrent
                        ? "ring-2 ring-primary ring-offset-2 ring-offset-surface-container-lowest font-extrabold !text-white !bg-primary !border-primary"
                        : "hover:border-primary/60"
                    }`}
                    title={`Soal ${idx + 1}: ${isDone ? "Sudah diisi" : "Belum diisi"}`}
                  >
                    {idx + 1}
                    <span
                      className={`absolute -top-1 -right-1 h-2 w-2 rounded-full border border-surface-container-lowest ${
                        isDone ? "bg-emerald-400" : "bg-slate-400"
                      }`}
                    />
                  </button>
                );
              })}
            </div>

            <div className="space-y-1 border-t border-outline-variant/30 pt-2 text-xs font-medium text-on-surface-variant">
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-400" />
                <span>Sudah Diisi</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 shrink-0 rounded-full bg-slate-400" />
                <span>Belum Diisi</span>
              </div>
            </div>
          </div>
        </aside>
        </div>
      )}

      {/* Modal Peringatan Keluar */}
      {showExitWarningModal && (
        <div
          className="fixed inset-0 z-[300] flex items-center justify-center bg-black/60 p-4"
          role="dialog"
        >
          <div className="w-full max-w-md rounded-2xl border border-outline-variant/50 bg-surface-container-lowest p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-display text-base font-bold text-on-surface flex items-center gap-2 text-rose-400">
                <AlertTriangle size={18} /> Keluar dari Lembar Soal?
              </h3>
              <button
                type="button"
                onClick={() => setShowExitWarningModal(false)}
                className="text-on-surface-variant hover:text-on-surface cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>
            <p className="text-sm text-on-surface-variant leading-relaxed">
              Jawaban yang telah Anda isi{" "}
              <strong>tersimpan aman di perangkat ini</strong>. Anda dapat
              kembali kapan saja untuk melanjutkan.
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowExitWarningModal(false)}
                className="btn-secondary text-xs cursor-pointer"
              >
                Lanjut Mengerjakan
              </button>
              <button
                type="button"
                onClick={() => router.push("/code")}
                className="btn-danger text-xs cursor-pointer"
              >
                Keluar Sementara
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Konfirmasi Pengumpulan Akhir */}
      {showConfirmModal && (
        <div
          className="fixed inset-0 z-[300] flex items-center justify-center bg-black/60 p-4"
          role="dialog"
        >
          <div className="w-full max-w-md rounded-2xl border border-outline-variant/50 bg-surface-container-lowest p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-display text-base font-bold text-on-surface flex items-center gap-2">
                <HelpCircle size={18} className="text-primary" /> Kumpulkan
                Seluruh Jawaban?
              </h3>
              <button
                type="button"
                onClick={() => setShowConfirmModal(false)}
                className="text-on-surface-variant hover:text-on-surface cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>
            <p className="text-sm text-on-surface-variant leading-relaxed">
              Seluruh pertanyaan pada{" "}
              <strong>{data?.questions.length} butir soal</strong> telah Anda
              lengkapi. Jawaban akan dikirimkan untuk evaluasi pemahaman konsep.
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowConfirmModal(false)}
                className="btn-secondary text-xs cursor-pointer"
              >
                Periksa Kembali
              </button>
              <button
                type="button"
                disabled={submitting}
                onClick={executeSubmit}
                className="btn-primary text-xs cursor-pointer"
              >
                {submitting ? "Mengirim..." : "Ya, Kumpulkan Jawaban"}
              </button>
            </div>
          </div>
        </div>
      )}
    </PageContainer>
  );
}

export default function AnswerSetPage() {
  return (
    <Suspense fallback={null}>
      <AnswerSetContent />
    </Suspense>
  );
}
