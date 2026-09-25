"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  CircleCheck,
  ClipboardList,
  HelpCircle,
  Send,
  TriangleAlert,
  X,
} from "lucide-react";

import { useAuth } from "../../components/AuthProvider";
import { apiFetch } from "../../lib/api";
import PageContainer from "../../components/PageContainer";
import PageHeader from "../../components/PageHeader";

type LatestSubmission = {
  submission_id: string;
  attempt_no: number;
  status: string;
  answer_text?: string;
  submitted_at: string;
};

type StudentQuestion = {
  question_id: string;
  order_index: number;
  version_id: string;
  version_number: number;
  prompt: string;
  latest_submission: LatestSubmission | null;
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

type SubmitResult = LatestSubmission & {
  question_id: string;
  question_version_id: string;
};

type PackageSubmitResult = {
  set_id: string;
  submissions: SubmitResult[];
};

const errMsg = (err: unknown) =>
  err instanceof Error ? err.message : String(err);

const STATUS_META: Record<string, { label: string; cls: string }> = {
  SUBMITTED: { label: "Jawaban diterima", cls: "badge-review" },
  ANALYZING: { label: "Sedang dianalisis", cls: "badge-draft" },
  ANALYSIS_FAILED: { label: "Analisis gagal", cls: "badge-revoked" },
  PENDING_VALIDATION: { label: "Menunggu validasi dosen", cls: "badge-draft" },
  VALIDATED: { label: "Tervalidasi", cls: "badge-active" },
  REJECTED: { label: "Ditolak dosen", cls: "badge-revoked" },
};

const statusMeta = (status: string) =>
  STATUS_META[status] ?? { label: status, cls: "badge-role" };

const fmtDate = (value: string) => {
  try {
    return new Date(value).toLocaleString("id-ID", {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return value;
  }
};

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
  const [notice, setNotice] = useState("");
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [started, setStarted] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [remainingSeconds, setRemainingSeconds] = useState(45 * 60);

  const load = useCallback(async () => {
    if (!code) {
      setFetching(false);
      setError("Kode soal tidak ditemukan pada tautan.");
      return;
    }
    setFetching(true);
    setError("");
    try {
      const res = await apiFetch<StudentSet>(
        `/student/sets?code=${encodeURIComponent(code)}`,
      );
      setData(res);

      // Pre-populate answers with existing attempt text if available
      const initialAnswers: Record<string, string> = {};
      res.questions.forEach((q) => {
        if (q.latest_submission?.answer_text) {
          initialAnswers[q.question_id] = q.latest_submission.answer_text;
        }
      });
      setAnswers(initialAnswers);
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setFetching(false);
    }
  }, [code]);

  useEffect(() => {
    if (loading) return;
    if (!user) {
      router.replace("/login");
      return;
    }
    void load();
  }, [user, loading, router, load]);

  useEffect(() => {
    if (!started || remainingSeconds <= 0) return;
    const timer = window.setInterval(
      () => setRemainingSeconds((value) => Math.max(0, value - 1)),
      1000,
    );
    return () => window.clearInterval(timer);
  }, [started, remainingSeconds]);

  const activeQuestion = data?.questions[activeIndex];
  const isFinalQuestion = Boolean(
    data?.questions && activeIndex === data.questions.length - 1,
  );

  const handleContinue = () => {
    if (!data || !activeQuestion) return;
    const currentText = (answers[activeQuestion.question_id] ?? "").trim();
    if (!currentText) {
      setError("Jawaban pada soal ini tidak boleh kosong.");
      return;
    }
    setError("");
    setActiveIndex((index) => Math.min(index + 1, data.questions.length - 1));
  };

  const handleFinalSubmitCheck = () => {
    if (!data) return;

    // Verify all questions have an answer
    const emptyQuestion = data.questions.find(
      (q) => !(answers[q.question_id] ?? "").trim(),
    );

    if (emptyQuestion) {
      setError(
        `Pertanyaan nomor ${emptyQuestion.order_index} belum dijawab. Semua soal wajib diisi sebelum mengumpulkan.`,
      );
      setActiveIndex(data.questions.indexOf(emptyQuestion));
      return;
    }

    setError("");
    setShowConfirmModal(true);
  };

  const executeSubmit = async () => {
    if (!data) return;
    setShowConfirmModal(false);
    setError("");
    setNotice("");
    setSubmitting(true);
    try {
      await apiFetch<PackageSubmitResult>(
        `/student/sets/${setId}/submissions`,
        {
          method: "POST",
          body: JSON.stringify({
            answers: data.questions.map((question) => ({
              question_id: question.question_id,
              answer_text: (answers[question.question_id] ?? "").trim(),
            })),
          }),
        },
      );
      setAnswers({});
      router.replace("/code#pengumpulan");
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setSubmitting(false);
    }
  };

  if (loading || !user) return null;

  const currentFilledCount = data
    ? data.questions.filter(
        (q) => (answers[q.question_id] ?? "").trim().length > 0,
      ).length
    : 0;

  const formattedTime = `${String(Math.floor(remainingSeconds / 60)).padStart(2, "0")}:${String(remainingSeconds % 60).padStart(2, "0")}`;

  if (data && !started) {
    const isRepeatAttempt = data.questions.some(
      (q) => q.latest_submission !== null,
    );

    return (
      <PageContainer>
        <Link
          href="/code"
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-on-surface-variant hover:text-primary"
        >
          <ArrowLeft size={14} /> Kembali ke daftar soal
        </Link>
        <section className="glass-panel mt-6 rounded-xl border border-outline-variant/40 p-8">
          <PageHeader
            title={data.title}
            description={
              data.description ||
              "Jawab seluruh pertanyaan dengan menjelaskan alasan konseptual Anda."
            }
            icon={ClipboardList}
            eyebrow={
              <span className="text-xs font-bold uppercase tracking-wider text-primary">
                {isRepeatAttempt ? "Percobaan Lanjutan" : "Instruksi Ujian"}
              </span>
            }
          />
          <ul className="mt-6 space-y-2 text-sm text-on-surface-variant">
            <li>{data.questions.length} pertanyaan konseptual</li>
            <li>Durasi pengerjaan: 45 menit</li>
            {isRepeatAttempt ? (
              <li className="font-semibold text-primary">
                Anda sudah pernah mengerjakan paket ini. Pengerjaan baru ini
                akan tercatat sebagai percobaan baru.
              </li>
            ) : (
              <li>
                Jawab seluruh pertanyaan dan konfirmasi pengumpulan di butir
                soal terakhir.
              </li>
            )}
          </ul>
          <button
            type="button"
            onClick={() => setStarted(true)}
            className="btn-primary mt-8 cursor-pointer"
          >
            {isRepeatAttempt ? "Mulai Percobaan Baru" : "Mulai Ujian"}{" "}
            <Send size={16} />
          </button>
        </section>
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      <Link
        href="/code"
        className="inline-flex items-center gap-1.5 text-xs font-semibold text-on-surface-variant hover:text-primary"
      >
        <ArrowLeft size={14} />
        Kembali ke daftar soal
      </Link>

      <PageHeader
        className="mt-3"
        title={data?.title ?? "Memuat soal..."}
        description={
          data
            ? `Kode Soal ${data.code} • ${data.subject_name} • ${data.questions.length} pertanyaan`
            : "Menyiapkan lembar evaluasi..."
        }
        icon={ClipboardList}
        eyebrow={
          <span className="text-xs font-bold uppercase tracking-wider text-primary">
            Lembar Evaluasi Mahasiswa
          </span>
        }
        action={
          data && data.questions.length > 0 ? (
            <div className="glass-panel rounded-lg border border-outline-variant/40 px-4 py-3 text-xs font-semibold text-on-surface-variant">
              <span className="font-mono-ui text-primary">{formattedTime}</span>{" "}
              · Terisi{" "}
              <span className="font-mono-ui text-primary">
                {currentFilledCount}
              </span>{" "}
              / {data.questions.length}
            </div>
          ) : undefined
        }
      />

      {error && (
        <div
          role="alert"
          className="mt-4 flex items-center gap-3 rounded-lg border border-error/40 bg-error-container p-4 text-sm text-on-error-container animate-fade-in"
        >
          <TriangleAlert size={20} className="shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {notice && (
        <div
          role="status"
          className="mt-4 flex items-center gap-3 rounded-lg border border-primary-fixed-dim bg-primary-fixed/60 p-4 text-sm text-primary animate-fade-in"
        >
          <CircleCheck size={20} className="shrink-0" />
          <span>{notice}</span>
        </div>
      )}

      {fetching ? (
        <p className="mt-8 text-sm text-on-surface-variant">
          Memuat pertanyaan...
        </p>
      ) : data && data.questions.length === 0 ? (
        <div className="glass-panel mt-8 rounded-xl border border-outline-variant/40 p-8 text-center text-sm text-on-surface-variant">
          Belum ada pertanyaan yang dipublikasikan pada bank soal ini.
        </div>
      ) : (
        <div className="mt-6 space-y-6">
          {activeQuestion && (
            <section
              key={activeQuestion.question_id}
              className="glass-panel overflow-hidden rounded-xl border border-outline-variant/40 shadow-sm"
            >
              <header className="flex flex-col gap-3 border-b border-outline-variant/40 bg-surface-container-low px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-on-surface-variant">
                    Pertanyaan {activeQuestion.order_index} dari{" "}
                    {data?.questions.length}
                  </p>
                  <p className="font-mono-ui text-[11px] text-on-surface-variant">
                    Versi soal v{activeQuestion.version_number}
                  </p>
                </div>

                {activeQuestion.latest_submission ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`badge ${statusMeta(activeQuestion.latest_submission.status).cls}`}
                    >
                      {
                        statusMeta(activeQuestion.latest_submission.status)
                          .label
                      }
                    </span>
                    <span className="text-[11px] text-on-surface-variant">
                      Percobaan terakhir #
                      {activeQuestion.latest_submission.attempt_no} •{" "}
                      {fmtDate(activeQuestion.latest_submission.submitted_at)}
                    </span>
                  </div>
                ) : (
                  <span className="badge badge-draft">Belum ada riwayat</span>
                )}
              </header>

              <div className="px-6 py-5">
                <p className="whitespace-pre-line text-sm font-semibold text-on-surface leading-relaxed">
                  {activeQuestion.prompt}
                </p>

                <div className="mt-4">
                  <label className="block text-xs font-semibold uppercase text-on-surface-variant">
                    Jawaban &amp; Alasan Anda
                  </label>
                  <textarea
                    rows={6}
                    value={answers[activeQuestion.question_id] ?? ""}
                    onChange={(e) => {
                      setError("");
                      setAnswers((prev) => ({
                        ...prev,
                        [activeQuestion.question_id]: e.target.value,
                      }));
                    }}
                    placeholder="Tuliskan penjelasan konseptual Anda secara lengkap..."
                    className="mt-1 block w-full rounded-lg border border-outline-variant/60 bg-surface-container-lowest px-3 py-2 text-sm text-on-surface focus:border-primary focus:outline-none"
                  />
                  <p className="mt-1 text-[11px] text-on-surface-variant">
                    Jawaban yang dikirim akan tercatat sebagai percobaan baru.
                  </p>
                </div>

                <div className="mt-6 flex items-center justify-between border-t border-outline-variant/20 pt-4">
                  <span className="text-xs text-on-surface-variant">
                    Soal {activeIndex + 1} dari {data?.questions.length}
                  </span>

                  <div className="flex items-center gap-3">
                    {/* If there are multiple questions and not on final, show 'Soal Selanjutnya' */}
                    {!isFinalQuestion && (
                      <button
                        type="button"
                        onClick={handleContinue}
                        className="btn-secondary !py-2.5 !px-5 text-xs font-semibold cursor-pointer inline-flex items-center gap-2"
                      >
                        <span>Soal Selanjutnya</span>
                        <Send size={14} />
                      </button>
                    )}

                    {/* Submit button: available on final question OR if all questions are filled */}
                    {(isFinalQuestion ||
                      currentFilledCount === (data?.questions.length ?? 0)) && (
                      <button
                        type="button"
                        onClick={handleFinalSubmitCheck}
                        disabled={submitting}
                        className="btn-primary !py-2.5 !px-6 text-xs font-semibold cursor-pointer shadow-md inline-flex items-center gap-2"
                      >
                        <Send size={15} />
                        <span>
                          {submitting
                            ? "Memproses..."
                            : "Kumpulkan Semua Jawaban"}
                        </span>
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </section>
          )}
        </div>
      )}

      {/* Navigation Pills */}
      {started && data && data.questions.length > 1 && (
        <nav
          className="mt-6 flex flex-wrap gap-2"
          aria-label="Navigasi pertanyaan"
        >
          {data.questions.map((question, index) => {
            const isFilled =
              (answers[question.question_id] ?? "").trim().length > 0;
            const isCurrent = index === activeIndex;

            let btnClass =
              "border-outline-variant/50 text-on-surface bg-surface-container-low";
            if (isCurrent) {
              btnClass =
                "border-primary bg-primary text-white shadow-sm ring-2 ring-primary/40 font-bold";
            } else if (isFilled) {
              btnClass =
                "border-emerald-500/50 bg-emerald-500/15 text-emerald-400 font-semibold";
            }

            return (
              <button
                key={question.question_id}
                type="button"
                onClick={() => {
                  setError("");
                  setActiveIndex(index);
                }}
                className={`inline-flex h-9 w-9 items-center justify-center rounded-lg border text-sm transition-all cursor-pointer ${btnClass}`}
              >
                {index + 1}
              </button>
            );
          })}
        </nav>
      )}

      {/* Confirmation Modal */}
      {showConfirmModal && (
        <div
          className="fixed inset-0 z-[300] flex items-center justify-center bg-black/60 p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-md rounded-2xl border border-outline-variant/50 bg-surface-container-lowest p-6 shadow-2xl space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2.5 text-primary">
                <span className="p-2 rounded-xl bg-primary/10 text-primary">
                  <HelpCircle size={22} />
                </span>
                <h3 className="font-display text-lg font-bold text-on-surface">
                  Kumpulkan Seluruh Jawaban?
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setShowConfirmModal(false)}
                className="text-on-surface-variant hover:text-on-surface cursor-pointer p-1"
                aria-label="Tutup"
              >
                <X size={18} />
              </button>
            </div>

            <p className="text-sm leading-6 text-on-surface-variant">
              Anda akan mengumpulkan jawaban untuk{" "}
              <strong>{data?.questions.length ?? 0} butir soal</strong> pada
              paket <strong>&ldquo;{data?.title ?? ""}&rdquo;</strong>.
            </p>

            <div className="flex items-center justify-end gap-3 pt-3 border-t border-outline-variant/30">
              <button
                type="button"
                onClick={() => setShowConfirmModal(false)}
                className="btn-secondary text-xs !py-2 !px-4 cursor-pointer"
              >
                Periksa Kembali
              </button>
              <button
                type="button"
                onClick={executeSubmit}
                disabled={submitting}
                className="btn-primary text-xs !py-2 !px-5 cursor-pointer font-semibold shadow-sm"
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
