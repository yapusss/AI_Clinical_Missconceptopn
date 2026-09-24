"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  CircleCheck,
  ClipboardList,
  Send,
  TriangleAlert,
} from "lucide-react";

import { useAuth } from "../../components/AuthProvider";
import { apiFetch } from "../../lib/api";

type LatestSubmission = {
  submission_id: string;
  attempt_no: number;
  status: string;
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
  const [started, setStarted] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [remainingSeconds, setRemainingSeconds] = useState(45 * 60);

  const load = useCallback(async () => {
    if (!code) {
      setFetching(false);
      setError(
        "Kode soal tidak ditemukan pada tautan. Silakan masukkan kode kembali.",
      );
      return;
    }
    setFetching(true);
    setError("");
    try {
      const res = await apiFetch<StudentSet>(
        `/student/sets?code=${encodeURIComponent(code)}`,
      );
      setData(res);
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

  const handleContinue = () => {
    if (!data || !activeQuestion) return;
    if (!(answers[activeQuestion.question_id] ?? "").trim()) {
      setError("Jawaban tidak boleh kosong.");
      return;
    }
    setError("");
    setActiveIndex((index) => Math.min(index + 1, data.questions.length - 1));
  };

  const handleSubmit = async () => {
    if (!data) return;
    const incomplete = data.questions.find(
      (question) => !(answers[question.question_id] ?? "").trim(),
    );
    if (incomplete) {
      setError(
        `Jawab pertanyaan ${incomplete.order_index} sebelum mengumpulkan jawaban.`,
      );
      setActiveIndex(data.questions.indexOf(incomplete));
      return;
    }
    setError("");
    setNotice("");
    setSubmitting(true);
    try {
      const res = await apiFetch<PackageSubmitResult>(
        `/student/sets/${setId}/submissions`,
        {
          method: "POST",
          body: JSON.stringify({
            answers: data.questions.map((question) => ({
              question_id: question.question_id,
              answer_text: answers[question.question_id].trim(),
            })),
          }),
        },
      );
      const submissionsByQuestion = new Map(
        res.submissions.map((submission) => [
          submission.question_id,
          submission,
        ]),
      );
      setData((prev) =>
        prev
          ? {
              ...prev,
              questions: prev.questions.map((item) =>
                submissionsByQuestion.has(item.question_id)
                  ? {
                      ...item,
                      latest_submission: {
                        submission_id: submissionsByQuestion.get(
                          item.question_id,
                        )!.submission_id,
                        attempt_no: submissionsByQuestion.get(item.question_id)!
                          .attempt_no,
                        status: submissionsByQuestion.get(item.question_id)!
                          .status,
                        submitted_at: submissionsByQuestion.get(
                          item.question_id,
                        )!.submitted_at,
                      },
                    }
                  : item,
              ),
            }
          : prev,
      );
      setAnswers({});
      router.replace("/code");
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setSubmitting(false);
    }
  };

  if (loading || !user) return null;

  const answered = data
    ? data.questions.filter((q) => q.latest_submission).length
    : 0;
  const activeQuestion = data?.questions[activeIndex];
  const formattedTime = `${String(Math.floor(remainingSeconds / 60)).padStart(2, "0")}:${String(remainingSeconds % 60).padStart(2, "0")}`;

  if (data && !started) {
    return (
      <div style={{ maxWidth: "760px", margin: "0 auto" }}>
        <Link
          href="/code"
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-on-surface-variant hover:text-primary"
        >
          <ArrowLeft size={14} /> Kembali ke input kode
        </Link>
        <section className="glass-panel mt-6 rounded-xl border border-outline-variant/40 p-8">
          <div className="inline-flex items-center gap-2 rounded-full border border-primary-fixed-dim bg-primary-fixed/60 px-3 py-1 text-xs font-bold uppercase tracking-wider text-primary">
            <ClipboardList size={14} /> Instruksi Ujian
          </div>
          <h1 className="mt-3 font-display text-2xl font-bold text-on-surface">
            {data.title}
          </h1>
          <p className="mt-2 whitespace-pre-line text-sm text-on-surface-variant">
            {data.description ||
              "Jawab seluruh pertanyaan dengan menjelaskan alasan konseptual Anda."}
          </p>
          <ul className="mt-6 space-y-2 text-sm text-on-surface-variant">
            <li>{data.questions.length} pertanyaan</li>
            <li>Durasi 45 menit</li>
            <li>
              Jawab seluruh pertanyaan, lalu kumpulkan jawaban sebagai satu
              paket
            </li>
          </ul>
          <button
            type="button"
            onClick={() => setStarted(true)}
            className="btn-primary mt-8"
          >
            Mulai Ujian <Send size={16} />
          </button>
        </section>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: "1080px", margin: "0 auto" }}>
      <Link
        href="/code"
        className="inline-flex items-center gap-1.5 text-xs font-semibold text-on-surface-variant hover:text-primary"
      >
        <ArrowLeft size={14} />
        Kembali ke input kode
      </Link>

      <div className="mt-3 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-primary-fixed-dim bg-primary-fixed/60 px-3 py-1 text-xs font-bold uppercase tracking-wider text-primary">
            <ClipboardList size={14} color="var(--primary)" />
            Lembar Evaluasi Mahasiswa
          </div>
          <h1 className="mt-2 font-display text-2xl font-bold tracking-tight text-on-surface">
            {data?.title ?? "Memuat soal..."}
          </h1>
          <p className="text-sm text-on-surface-variant">
            {data ? (
              <>
                Kode Soal{" "}
                <span className="font-mono-ui font-bold text-primary">
                  {data.code}
                </span>{" "}
                • {data.subject_name} • {data.questions.length} pertanyaan
              </>
            ) : (
              "Menyiapkan lembar evaluasi..."
            )}
          </p>
        </div>

        {data && data.questions.length > 0 && (
          <div className="glass-panel rounded-lg border border-outline-variant/40 px-4 py-3 text-xs font-semibold text-on-surface-variant">
            <span className="font-mono-ui text-primary">{formattedTime}</span> ·
            Terjawab{" "}
            <span className="font-mono-ui text-primary">{answered}</span> /{" "}
            {data.questions.length}
          </div>
        )}
      </div>

      {error && (
        <div
          role="alert"
          className="mt-6 flex items-center gap-3 rounded-lg border border-error/40 bg-error-container p-4 text-sm text-on-error-container"
        >
          <TriangleAlert size={20} />
          <span>{error}</span>
        </div>
      )}

      {notice && (
        <div
          role="status"
          className="mt-6 flex items-center gap-3 rounded-lg border border-primary-fixed-dim bg-primary-fixed/60 p-4 text-sm text-primary"
        >
          <CircleCheck size={20} />
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
        <div className="mt-8 space-y-6">
          {activeQuestion &&
            [activeQuestion].map((question) => {
              const latest = question.latest_submission;
              const meta = latest ? statusMeta(latest.status) : null;
              const isFinalQuestion =
                activeIndex === (data?.questions.length ?? 0) - 1;

              return (
                <section
                  key={question.question_id}
                  className="glass-panel overflow-hidden rounded-xl border border-outline-variant/40 shadow-sm"
                >
                  <header className="flex flex-col gap-3 border-b border-outline-variant/40 bg-surface-container-low px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wider text-on-surface-variant">
                        Pertanyaan {question.order_index} dari{" "}
                        {data?.questions.length}
                      </p>
                      <p className="font-mono-ui text-[11px] text-on-surface-variant">
                        Versi soal v{question.version_number}
                      </p>
                    </div>

                    {latest && meta ? (
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`badge ${meta.cls}`}>
                          {meta.label}
                        </span>
                        <span className="text-[11px] text-on-surface-variant">
                          Percobaan ke-{latest.attempt_no} •{" "}
                          {fmtDate(latest.submitted_at)}
                        </span>
                      </div>
                    ) : (
                      <span className="badge badge-draft">Belum dijawab</span>
                    )}
                  </header>

                  <div className="px-6 py-5">
                    <p className="whitespace-pre-line text-sm font-semibold text-on-surface">
                      {question.prompt}
                    </p>

                    <div className="mt-4">
                      <label className="block text-xs font-semibold uppercase text-on-surface-variant">
                        Jawaban &amp; Alasan Anda
                      </label>
                      <textarea
                        rows={5}
                        value={answers[question.question_id] ?? ""}
                        onChange={(e) =>
                          setAnswers((prev) => ({
                            ...prev,
                            [question.question_id]: e.target.value,
                          }))
                        }
                        placeholder="Tuliskan jawaban beserta alasan konseptual Anda..."
                        className="mt-1 block w-full rounded-lg border border-outline-variant/60 bg-surface-container-lowest px-3 py-2 text-sm text-on-surface focus:border-primary focus:outline-none"
                      />
                      <p className="mt-1 text-[11px] text-on-surface-variant">
                        Maksimal 20.000 karakter. Mengirim ulang akan tercatat
                        sebagai percobaan baru.
                      </p>
                    </div>

                    <div className="mt-4 flex justify-end">
                      <button
                        type="button"
                        onClick={
                          isFinalQuestion ? handleSubmit : handleContinue
                        }
                        disabled={submitting}
                        style={{ color: "#ffffff" }}
                        className="inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-2 text-sm font-semibold shadow-sm transition-colors hover:bg-primary-container disabled:opacity-50"
                      >
                        <Send size={16} color="#ffffff" />
                        {submitting
                          ? "Mengirim..."
                          : isFinalQuestion
                            ? "Kumpulkan Jawaban"
                            : "Soal Selanjutnya"}
                      </button>
                    </div>
                  </div>
                </section>
              );
            })}
        </div>
      )}
      {started && data && data.questions.length > 1 && (
        <nav
          className="mt-6 flex flex-wrap gap-2"
          aria-label="Navigasi pertanyaan"
        >
          {data.questions.map((question, index) => (
            <button
              key={question.question_id}
              type="button"
              onClick={() => setActiveIndex(index)}
              className={`inline-flex h-9 w-9 items-center justify-center rounded-lg border text-sm font-semibold ${index === activeIndex ? "border-primary bg-primary text-white" : "border-outline-variant/50 text-on-surface"}`}
            >
              {index + 1}
            </button>
          ))}
        </nav>
      )}
    </div>
  );
}

export default function AnswerSetPage() {
  return (
    <Suspense fallback={null}>
      <AnswerSetContent />
    </Suspense>
  );
}
