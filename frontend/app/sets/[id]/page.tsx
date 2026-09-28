"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
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

type FourTierAnswer = {
  t1_answer: string;
  t2_confidence: number | null; // 1 - 6
  t3_reason: string;
  t4_confidence: number | null; // 1 - 6
};

const CONFIDENCE_LEVELS = [
  { val: 1, label: "1 - Sangat Tidak Yakin", type: "TY" },
  { val: 2, label: "2 - Tidak Yakin", type: "TY" },
  { val: 3, label: "3 - Kurang Yakin", type: "TY" },
  { val: 4, label: "4 - Cukup Yakin", type: "Y" },
  { val: 5, label: "5 - Yakin", type: "Y" },
  { val: 6, label: "6 - Sangat Yakin", type: "Y" },
];

const REASON_KEYWORDS = ["karena", "sebab", "oleh karena itu", "dikarenakan", "karna"];

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
  const [answers, setAnswers] = useState<Record<string, FourTierAnswer>>({});
  const [submitting, setSubmitting] = useState(false);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [showExitWarningModal, setShowExitWarningModal] = useState(false);
  const [started, setStarted] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);

  const storageKey = setId && user ? `exam_answers_${setId}_${user.id}` : null;

  // 1. Load Data Soal & Pulihkan Jawaban Tersimpan (Persistent State)
  const load = useCallback(async () => {
    if (!code) {
      setFetching(false);
      setError("Kode soal tidak ditemukan pada tautan.");
      return;
    }
    setFetching(true);
    setError("");
    try {
      const res = await apiFetch<StudentSet>(`/student/sets?code=${encodeURIComponent(code)}`);
      setData(res);

      // Inisialisasi awal
      const initial: Record<string, FourTierAnswer> = {};
      res.questions.forEach((q) => {
        initial[q.question_id] = {
          t1_answer: "",
          t2_confidence: null,
          t3_reason: "",
          t4_confidence: null,
        };
      });

      // Cek apakah ada progress tersimpan di localStorage browser
      if (storageKey) {
        const saved = localStorage.getItem(storageKey);
        if (saved) {
          try {
            const parsed = JSON.parse(saved);
            Object.assign(initial, parsed);
            setStarted(true); // Langsung lanjutkan jika sudah ada pengerjaan
          } catch {}
        }
      }

      setAnswers(initial);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setFetching(false);
    }
  }, [code, storageKey]);

  useEffect(() => {
    if (loading) return;
    if (!user) {
      router.replace("/login");
      return;
    }
    void load();
  }, [user, loading, router, load]);

  // 2. Simpan Progres Otomatis setiap kali jawaban berubah
  useEffect(() => {
    if (!storageKey || Object.keys(answers).length === 0) return;
    localStorage.setItem(storageKey, JSON.stringify(answers));
  }, [answers, storageKey]);

  // 3. Peringatan Browser jika refresh / tutup tab
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

  const updateCurrent = (patch: Partial<FourTierAnswer>) => {
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
      REASON_KEYWORDS.some((kw) => currentAnswer.t1_answer.toLowerCase().includes(kw))
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
      setError("Isi kesimpulan singkat Anda pada Tier 1.");
      return;
    }
    if (currentAnswer.t2_confidence === null) {
      setError("Pilih tingkat keyakinan Anda pada Tier 2.");
      return;
    }
    if (!currentAnswer.t3_reason.trim()) {
      setError("Uraikan alasan ilmiah Anda pada Tier 3.");
      return;
    }
    if (currentAnswer.t4_confidence === null) {
      setError("Pilih tingkat keyakinan Anda pada Tier 4.");
      return;
    }

    setError("");
    if (activeIndex < data.questions.length - 1) {
      setActiveIndex((idx) => idx + 1);
    } else {
      setShowConfirmModal(true);
    }
  };

  const executeSubmit = async () => {
    if (!data) return;
    setShowConfirmModal(false);
    setError("");
    setSubmitting(true);

    try {
      const payloadAnswers = data.questions.map((q) => {
        const a = answers[q.question_id];
        return {
          question_id: q.question_id,
          answer_text: `[TIER 1]: ${a.t1_answer}\n[TIER 2]: ${a.t2_confidence}/6\n[TIER 3]: ${a.t3_reason}\n[TIER 4]: ${a.t4_confidence}/6`,
          tier1_answer: a.t1_answer,
          tier2_confidence: a.t2_confidence,
          tier3_reason: a.t3_reason,
          tier4_confidence: a.t4_confidence,
        };
      });

      await apiFetch(`/student/sets/${setId}/submissions`, {
        method: "POST",
        body: JSON.stringify({ answers: payloadAnswers }),
      });

      // Bersihkan penyimpanan lokal setelah submit berhasil
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
            description="Format Ujian 4-Tier Diagnostik Miskonsepsi Klinis"
            icon={ClipboardList}
          />
          <div className="rounded-xl border border-primary/30 bg-primary/5 p-5 text-sm text-on-surface space-y-3">
            <h3 className="font-bold text-primary flex items-center gap-2">
              <ClipboardList size={18} /> Aturan Pengerjaan 4-Tier:
            </h3>
            <ul className="list-disc pl-5 space-y-1.5 text-xs text-on-surface-variant leading-relaxed">
              <li>
                <strong>Tier 1 (Kesimpulan):</strong> Tuliskan kesimpulan singkat Anda (maksimal 120 karakter).
              </li>
              <li>
                <strong>Tier 2 (Keyakinan Jawaban):</strong> Pilih skala 1–6 seberapa yakin Anda dengan jawaban Tier 1.
              </li>
              <li>
                <strong>Tier 3 (Alasan):</strong> Tuliskan dasar penalaran dan prinsip ilmiah yang Anda gunakan.
              </li>
              <li>
                <strong>Tier 4 (Keyakinan Alasan):</strong> Pilih skala 1–6 seberapa yakin Anda dengan alasan di Tier 3.
              </li>
              <li className="text-emerald-400 font-semibold">
                Jawaban tersimpan otomatis di perangkat ini. Jika terjadi gangguan jaringan, Anda dapat melanjutkan kembali kapan saja.
              </li>
            </ul>
          </div>

          <button
            type="button"
            onClick={() => setStarted(true)}
            className="btn-primary mt-4 cursor-pointer"
          >
            Mulai Ujian 4-Tier <Send size={16} />
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
      {/* Header Bar dengan Tombol Keluar yang Memunculkan Warning */}
      <div className="flex items-center justify-between mb-4">
        <button
          type="button"
          onClick={() => setShowExitWarningModal(true)}
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-rose-400 hover:text-rose-300 cursor-pointer"
        >
          <LogOut size={14} /> Keluar dari Lembar Soal
        </button>
        <span className="text-xs font-mono-ui font-semibold text-primary">
          Soal Terisi Lengkap: {completedQuestionsCount} / {data?.questions.length ?? 0}
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
        <div className="space-y-5">
          {/* Box Pertanyaan */}
          <section className="glass-panel overflow-hidden rounded-xl border border-outline-variant/40 p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-outline-variant/30 pb-3">
              <span className="font-mono-ui text-xs font-bold uppercase tracking-wider text-primary">
                Soal Nomor {activeQuestion.order_index} dari {data?.questions.length}
              </span>
            </div>

            <p className="whitespace-pre-line text-base font-semibold text-on-surface leading-relaxed">
              {activeQuestion.prompt}
            </p>
          </section>

          {/* TIER 1: Jawaban Kesimpulan Singkat (Bebas Edit, Max 120 Karakter) */}
          <section className="glass-panel rounded-xl border border-outline-variant/60 p-5 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-bold text-xs uppercase tracking-wider text-on-surface">
                  Tier 1: Jawaban / Kesimpulan Singkat
                </h3>
                <p className="text-[11px] text-on-surface-variant">
                  Tuliskan kesimpulan saja, tanpa penjelasan (maksimal 120 karakter).
                </p>
              </div>
              <span className="text-xs font-mono-ui text-on-surface-variant">
                {currentAnswer.t1_answer.length} / 120
              </span>
            </div>

            <input
              type="text"
              maxLength={120}
              value={currentAnswer.t1_answer}
              onChange={(e) => updateCurrent({ t1_answer: e.target.value })}
              placeholder="Tuliskan kesimpulan Anda..."
              className="form-input text-xs w-full"
            />

            {t1HasReasonKeyword && (
              <div className="flex items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-2.5 text-[11px] text-amber-400">
                <AlertTriangle size={15} className="shrink-0" />
                <span>
                  Catatan: Terdeteksi kata &quot;karena/sebab&quot;. Di Tier 1 cukup kesimpulannya saja, penjelasan dituliskan pada Tier 3.
                </span>
              </div>
            )}
          </section>

          {/* TIER 2: Keyakinan Jawaban (Radio Button 1-6) */}
          <section className="glass-panel rounded-xl border border-outline-variant/60 p-5 space-y-3">
            <div>
              <h3 className="font-bold text-xs uppercase tracking-wider text-on-surface">
                Tier 2: Tingkat Keyakinan pada Jawaban Tier 1
              </h3>
              <p className="text-[11px] text-on-surface-variant">
                Pilih skala keyakinan 1–6 (1–3 = Tidak Yakin, 4–6 = Yakin).
              </p>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-2 pt-1">
              {CONFIDENCE_LEVELS.map((lvl) => {
                const isSelected = currentAnswer.t2_confidence === lvl.val;
                return (
                  <label
                    key={lvl.val}
                    className={`flex flex-col items-center justify-center p-3 rounded-lg border text-center cursor-pointer transition-all ${
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
                    <span className="font-mono-ui text-lg">{lvl.val}</span>
                    <span className="text-[10px] mt-0.5">{lvl.type === "TY" ? "Tidak Yakin" : "Yakin"}</span>
                  </label>
                );
              })}
            </div>
          </section>

          {/* TIER 3: Alasan Ilmiah */}
          <section className="glass-panel rounded-xl border border-outline-variant/60 p-5 space-y-3">
            <div>
              <h3 className="font-bold text-xs uppercase tracking-wider text-on-surface">
                Tier 3: Alasan Konseptual
              </h3>
              <p className="text-[11px] text-on-surface-variant">
                Jelaskan mengapa Anda menjawab demikian secara ilmiah.
              </p>
            </div>

            <textarea
              rows={4}
              value={currentAnswer.t3_reason}
              onChange={(e) => updateCurrent({ t3_reason: e.target.value })}
              placeholder="Uraikan alasan ilmiah Anda..."
              className="form-input text-xs w-full"
            />
          </section>

          {/* TIER 4: Keyakinan Alasan (Radio Button 1-6) */}
          <section className="glass-panel rounded-xl border border-outline-variant/60 p-5 space-y-3">
            <div>
              <h3 className="font-bold text-xs uppercase tracking-wider text-on-surface">
                Tier 4: Tingkat Keyakinan pada Alasan Tier 3
              </h3>
              <p className="text-[11px] text-on-surface-variant">
                Seberapa yakin Anda dengan ketepatan alasan ilmiah di Tier 3?
              </p>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-2 pt-1">
              {CONFIDENCE_LEVELS.map((lvl) => {
                const isSelected = currentAnswer.t4_confidence === lvl.val;
                return (
                  <label
                    key={lvl.val}
                    className={`flex flex-col items-center justify-center p-3 rounded-lg border text-center cursor-pointer transition-all ${
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
                    <span className="font-mono-ui text-lg">{lvl.val}</span>
                    <span className="text-[10px] mt-0.5">{lvl.type === "TY" ? "Tidak Yakin" : "Yakin"}</span>
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
              onClick={() => setActiveIndex((idx) => Math.max(0, idx - 1))}
              className="btn-secondary text-xs !py-2 !px-4 disabled:opacity-30 cursor-pointer"
            >
              ← Soal Sebelumnya
            </button>

            <span className="text-xs font-mono-ui text-on-surface-variant">
              Soal {activeIndex + 1} dari {data.questions.length}
            </span>

            <button
              type="button"
              onClick={handleNextOrFinish}
              className="btn-primary text-xs !py-2.5 !px-6 cursor-pointer"
            >
              {activeIndex === data.questions.length - 1 ? (
                <>Selesai &amp; Kumpulkan Semua <Send size={14} /></>
              ) : (
                <>Lanjut ke Soal Berikutnya →</>
              )}
            </button>
          </div>
        </div>
      )}

      {/* Navigasi Pill Nomor Soal */}
      {data && data.questions.length > 1 && (
        <nav className="mt-6 flex flex-wrap gap-2" aria-label="Navigasi nomor soal">
          {data.questions.map((q, idx) => {
            const isDone = isQuestionComplete(q.question_id);
            const isCurrent = idx === activeIndex;

            let pillStyle = "border-outline-variant/50 text-on-surface bg-surface-container-low";
            if (isCurrent) {
              pillStyle = "border-primary bg-primary text-white shadow-sm ring-2 ring-primary/40 font-bold";
            } else if (isDone) {
              pillStyle = "border-emerald-500/50 bg-emerald-500/15 text-emerald-400 font-semibold";
            }

            return (
              <button
                key={q.question_id}
                type="button"
                onClick={() => {
                  setError("");
                  setActiveIndex(idx);
                }}
                className={`inline-flex h-9 w-9 items-center justify-center rounded-lg border text-sm transition-all cursor-pointer ${pillStyle}`}
              >
                {idx + 1}
              </button>
            );
          })}
        </nav>
      )}

      {/* Modal Peringatan Keluar */}
      {showExitWarningModal && (
        <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/60 p-4" role="dialog">
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
              Ujian sedang berlangsung. Seluruh jawaban yang sudah Anda ketikkan <strong>tersimpan aman secara otomatis</strong> di perangkat ini. Anda dapat masuk kembali kapan saja untuk melanjutkan.
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

      {/* Modal Konfirmasi Kumpulkan Semua */}
      {showConfirmModal && (
        <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/60 p-4" role="dialog">
          <div className="w-full max-w-md rounded-2xl border border-outline-variant/50 bg-surface-container-lowest p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-display text-base font-bold text-on-surface flex items-center gap-2">
                <HelpCircle size={18} className="text-primary" /> Kumpulkan Ujian 4-Tier?
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
              Anda akan mengumpulkan jawaban untuk <strong>{data?.questions.length} butir soal</strong>. Jawaban akan langsung dikirim ke database untuk antrean evaluasi klinis.
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