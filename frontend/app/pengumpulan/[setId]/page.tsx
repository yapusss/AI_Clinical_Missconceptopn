"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, ClipboardList, Info, PenLine, TriangleAlert } from "lucide-react";

import { useAuth } from "../../components/AuthProvider";
import { apiFetch } from "../../lib/api";
import {
  fmtDate,
  statusMeta,
  summarizeSetStatus,
  type StudentAttempt,
  type StudentQuestionGroup,
  type StudentSetGroup,
} from "../../lib/studentSubmissions";

const errMsg = (err: unknown) => (err instanceof Error ? err.message : String(err));

const EVAL_FIELDS: { key: keyof NonNullable<StudentAttempt["evaluation"]>; label: string }[] = [
  { key: "percentage_correct", label: "Skor" },
  { key: "tier_label", label: "Tingkat Pemahaman" },
  { key: "explanation", label: "Penjelasan Analisis" },
  { key: "suggested_materials", label: "Materi Disarankan" },
];

function EvaluationBlock({ attempt }: { attempt: StudentAttempt }) {
  const meta = statusMeta(attempt.status);
  const evaluation = attempt.evaluation;

  const renderValue = (key: (typeof EVAL_FIELDS)[number]["key"]) => {
    const value = evaluation?.[key];
    if (value === undefined || value === null || value === "") return "—";
    return Array.isArray(value) ? value.join(", ") : String(value);
  };

  return (
    <div className="mt-4 rounded-lg border border-dashed border-outline-variant/60 bg-surface-container-low/50 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold uppercase tracking-wider text-on-surface-variant">
          Evaluasi
        </span>
        {meta.hint && <span className="text-[11px] text-on-surface-variant">• {meta.hint}</span>}
      </div>

      <dl className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {EVAL_FIELDS.map((field) => (
          <div key={field.key}>
            <dt className="text-[11px] font-semibold uppercase tracking-wider text-on-surface-variant">
              {field.label}
            </dt>
            <dd className="mt-0.5 text-sm text-on-surface">{renderValue(field.key)}</dd>
          </div>
        ))}
      </dl>

      <p className="mt-3 flex items-start gap-2 text-[11px] text-on-surface-variant">
        <Info size={14} color="var(--primary)" style={{ flexShrink: 0, marginTop: 1 }} />
        <span>
          Kolom evaluasi akan terisi otomatis setelah dosen memvalidasi hasil analisis AI. Anda tidak
          akan melihat keluaran mentah sistem.
        </span>
      </p>
    </div>
  );
}

function QuestionCard({
  question,
  total,
  setGroup,
}: {
  question: StudentQuestionGroup;
  total: number;
  setGroup: StudentSetGroup;
}) {
  const newest = question.attempts.length
    ? [...question.attempts].sort((a, b) => b.attempt_no - a.attempt_no)
    : [];
  const latest = newest[0];
  const meta = latest ? statusMeta(latest.status) : null;

  return (
    <section className="glass-panel overflow-hidden rounded-xl border border-outline-variant/40 shadow-sm">
      <header className="flex flex-col gap-3 border-b border-outline-variant/40 bg-surface-container-low px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-surface-container-high font-mono-ui text-sm font-bold text-on-surface">
            {question.order_index}
          </span>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-on-surface-variant">
              Pertanyaan {question.order_index} dari {total}
            </p>
            <p className="font-mono-ui text-[11px] text-on-surface-variant">
              Versi soal v{question.version_number}
            </p>
          </div>
        </div>

        {latest && meta ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className={`badge ${meta.cls}`}>{meta.label}</span>
            <span className="text-[11px] text-on-surface-variant">
              {question.attempts.length} percobaan · terakhir {fmtDate(latest.submitted_at)}
            </span>
          </div>
        ) : (
          <span className="badge badge-draft">Belum dijawab</span>
        )}
      </header>

      <div className="px-6 py-5">
        <p className="text-xs font-semibold uppercase tracking-wider text-on-surface-variant">
          Pertanyaan
        </p>
        <p className="mt-1 whitespace-pre-line text-sm text-on-surface">{question.prompt}</p>

        {!latest ? (
          <div className="mt-4 flex flex-col gap-3 rounded-lg border border-outline-variant/40 bg-surface-container-lowest p-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-on-surface-variant">
              Anda belum mengumpulkan jawaban untuk pertanyaan ini.
            </p>
            <Link
              href={`/sets/${setGroup.set_id}?code=${encodeURIComponent(setGroup.code)}`}
              style={{ color: "#ffffff" }}
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold hover:bg-primary-container"
            >
              <PenLine size={16} color="#ffffff" />
              Kerjakan Sekarang
            </Link>
          </div>
        ) : (
          <>
            <p className="mt-4 text-xs font-semibold uppercase tracking-wider text-on-surface-variant">
              Jawaban Anda ({newest.length} percobaan)
            </p>

            <div className="mt-2 space-y-3">
              {newest.map((attempt, index) => {
                const attemptMeta = statusMeta(attempt.status);
                return (
                  <div
                    key={attempt.submission_id}
                    className="rounded-lg border border-outline-variant/40 bg-surface-container-lowest p-4"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono-ui text-xs font-bold text-on-surface">
                        Percobaan ke-{attempt.attempt_no}
                      </span>
                      <span className={`badge ${attemptMeta.cls}`}>{attemptMeta.label}</span>
                      <span className="text-[11px] text-on-surface-variant">
                        {fmtDate(attempt.submitted_at)}
                      </span>
                      {index === 0 && (
                        <span className="badge badge-role">Terbaru</span>
                      )}
                    </div>
                    <p className="mt-2 whitespace-pre-line text-sm text-on-surface">
                      {attempt.answer_text}
                    </p>
                  </div>
                );
              })}
            </div>

            {latest && <EvaluationBlock attempt={latest} />}
          </>
        )}
      </div>
    </section>
  );
}

export default function SubmissionSetDetailPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const params = useParams<{ setId: string }>();
  const setId = params?.setId as string | undefined;

  const [group, setGroup] = useState<StudentSetGroup | null>(null);
  const [fetching, setFetching] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!setId) {
      setFetching(false);
      setError("Bank soal tidak dikenali pada tautan ini.");
      return;
    }
    try {
      const data = await apiFetch<StudentSetGroup>(`/student/submission-sets/${setId}`);
      setGroup(data);
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setFetching(false);
    }
  }, [setId]);

  useEffect(() => {
    if (loading) return;
    if (!user) {
      router.replace("/login");
      return;
    }
    void load();
  }, [user, loading, router, load]);

  if (loading || !user) return null;

  const status = group ? summarizeSetStatus(group.status_summary, group.status_counts) : null;

  return (
    <div style={{ maxWidth: "1080px", margin: "0 auto" }}>
      <Link
        href="/code#pengumpulan"
        className="inline-flex items-center gap-1.5 text-xs font-semibold text-on-surface-variant hover:text-primary"
      >
        <ArrowLeft size={14} />
        Kembali ke halaman Soal
      </Link>

      {error && (
        <div
          role="alert"
          className="mt-4 flex items-center gap-3 rounded-lg border border-error/40 bg-error-container p-4 text-sm text-on-error-container"
        >
          <TriangleAlert size={20} />
          <span>{error}</span>
        </div>
      )}

      {fetching ? (
        <p className="mt-6 text-sm text-on-surface-variant">Memuat rincian pengumpulan...</p>
      ) : group ? (
        <>
          <div className="mt-3 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-primary-fixed-dim bg-primary-fixed/60 px-3 py-1 text-xs font-bold uppercase tracking-wider text-primary">
                <ClipboardList size={14} color="var(--primary)" />
                Rincian Pengumpulan
              </div>
              <h1 className="mt-2 font-display text-2xl font-bold tracking-tight text-on-surface">
                {group.title}
              </h1>
              <p className="text-sm text-on-surface-variant">
                Kode Soal <span className="font-mono-ui font-bold text-primary">{group.code}</span> •{" "}
                {group.subject_name} • Terjawab {group.answered_count}/{group.question_count} soal •{" "}
                {group.total_attempts} pengumpulan
              </p>
            </div>

            {status && (
              <div className="glass-panel rounded-lg border border-outline-variant/40 px-4 py-3 text-right">
                <span className={`badge ${status.cls}`}>{status.label}</span>
                {status.detail && (
                  <p className="mt-1 text-[11px] text-on-surface-variant">{status.detail}</p>
                )}
              </div>
            )}
          </div>

          <div className="mt-8 space-y-6">
            {group.questions.map((question) => (
              <QuestionCard
                key={question.question_id}
                question={question}
                total={group.questions.length}
                setGroup={group}
              />
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}