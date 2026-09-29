"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Compass,
  GraduationCap,
  Lightbulb,
  PenLine,
  Sparkles,
  TriangleAlert,
} from "lucide-react";

import { useAuth } from "../../components/AuthProvider";
import AppSelect from "../../components/AppSelect";
import PageContainer from "../../components/PageContainer";
import PageHeader from "../../components/PageHeader";
import { apiFetch } from "../../lib/api";
import {
  fmtDate,
  getSemanticStatus,
  type StudentAttempt,
  type StudentQuestionGroup,
  type StudentSetGroup,
} from "../../lib/studentSubmissions";

const errMsg = (err: unknown) =>
  err instanceof Error ? err.message : String(err);

const STUDENT_FRIENDLY_CATEGORIES: Record<
  string,
  { label: string; desc: string; cardCls: string }
> = {
  SC: {
    label: "Paham Konsep Utuh",
    desc: "Anda memahami konsep dan alasan ilmiah dengan konsisten dan tepat.",
    cardCls: "diag-card-sc",
  },
  LK: {
    label: "Perlu Penguatan Konsep",
    desc: "Pengetahuan konsep masih perlu diperdalam atau diperkuat agar Anda lebih yakin.",
    cardCls: "diag-card-lk",
  },
  FN: {
    label: "Penalaran Tepat, Perlu Perbaikan Kesimpulan",
    desc: "Alasan atau penalaran ilmiah Anda sudah baik, namun perhatikan kembali kesimpulan akhirnya.",
    cardCls: "diag-card-fn",
  },
  FP: {
    label: "Perlu Penyelarasan Konsep & Alasan",
    desc: "Kesimpulan jawaban benar, tetapi alasan yang digunakan masih memiliki celah pemahaman konsep.",
    cardCls: "diag-card-fp",
  },
  MSC: {
    label: "Perlu Rekonstruksi Konsep",
    desc: "Terdapat miskonsepsi konsep yang perlu diperbaiki melalui pendalaman materi yang tepat.",
    cardCls: "diag-card-msc",
  },
};

function ScoreExplanationCard({
  evaluation,
  diagnosisCategory,
}: {
  evaluation: NonNullable<StudentAttempt["evaluation"]>;
  diagnosisCategory?: string;
}) {
  const friendly = diagnosisCategory
    ? STUDENT_FRIENDLY_CATEGORIES[diagnosisCategory]
    : null;

  return (
    <div className="rounded-xl border border-outline-variant/40 bg-surface-container-lowest p-4 space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h4 className="text-xs font-bold uppercase tracking-wider text-on-surface-variant">
              Capaian Nilai Akhir
            </h4>
            {evaluation.is_score_modified && (
              <span className="inline-flex items-center gap-1 rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-amber-400">
                <Sparkles size={11} /> Disesuaikan Dosen
              </span>
            )}
          </div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="font-mono-ui text-3xl font-extrabold text-primary">
              {evaluation.percentage_correct.toFixed(1)}%
            </span>
          </div>
        </div>

        {friendly && (
          <div
            className={`diag-card ${friendly.cardCls} px-3.5 py-2 text-right`}
          >
            <span className="block text-xs font-bold font-mono-ui diag-title">
              {friendly.label}
            </span>
            <span className="block text-[11px] diag-desc mt-0.5 max-w-xs">
              {friendly.desc}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

function ActionableFeedbackSection({
  evaluation,
}: {
  evaluation: NonNullable<StudentAttempt["evaluation"]>;
}) {
  const hasConfirmedMisconceptions =
    evaluation.confirmed_misconceptions.length > 0;

  return (
    <section className="mt-4 rounded-xl border border-outline-variant/30 bg-surface-container-low p-4 sm:p-5">
      <div className="flex items-center justify-between border-b border-outline-variant/20 pb-3">
        <div className="flex items-center gap-2">
          <Compass size={17} className="text-primary" />
          <h3 className="font-display text-sm font-bold tracking-tight text-on-surface">
            Evaluasi Diagnostik &amp; Umpan Balik Dosen
          </h3>
        </div>
        {evaluation.validator_name && (
          <span className="text-[11px] text-on-surface-variant">
            Divalidasi oleh:{" "}
            <strong className="text-on-surface">
              {evaluation.validator_name}
            </strong>
          </span>
        )}
      </div>

      <div className="mt-3.5 space-y-3">
        <div className="rounded-lg border border-outline-variant/40 bg-surface-container-lowest p-4">
          <div className="flex items-center gap-2 text-on-surface mb-2">
            <Lightbulb size={16} className="text-primary" />
            <h4 className="text-xs font-bold uppercase tracking-wider text-on-surface-variant">
              Saran &amp; Catatan Perbaikan Pemahaman
            </h4>
          </div>

          {hasConfirmedMisconceptions && (
            <div className="mb-3 space-y-2">
              {evaluation.confirmed_misconceptions.map((m, idx) => (
                <div
                  key={idx}
                  className="rounded-lg border border-outline-variant/30 bg-surface-container-low p-3 text-xs leading-relaxed text-on-surface"
                >
                  <span className="font-bold text-primary">• {m.label}:</span>{" "}
                  {m.reasoning}
                </div>
              ))}
            </div>
          )}

          <p className="whitespace-pre-line text-xs leading-relaxed text-on-surface">
            {evaluation.clinical_feedback ||
              "Tidak ada catatan tambahan dari dosen."}
          </p>

          {evaluation.suggested_materials &&
            evaluation.suggested_materials.length > 0 && (
              <div className="mt-3.5 border-t border-outline-variant/20 pt-2.5 text-xs">
                <span className="font-bold text-on-surface-variant">
                  Materi Penguatan yang Disarankan:
                </span>
                <ul className="mt-1 list-disc pl-4 space-y-0.5 text-on-surface-variant">
                  {evaluation.suggested_materials.map((mat, i) => (
                    <li key={i}>{mat}</li>
                  ))}
                </ul>
              </div>
            )}
        </div>
      </div>
    </section>
  );
}

export default function SubmissionSetDetailPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const params = useParams<{ setId: string }>();
  const searchParams = useSearchParams();
  const setId = params?.setId as string | undefined;

  const [group, setGroup] = useState<StudentSetGroup | null>(null);
  const [fetching, setFetching] = useState(true);
  const [error, setError] = useState("");

  const [activeQuestionIdx, setActiveQuestionIdx] = useState(0);
  const [selectedAttemptByQuestion, setSelectedAttemptByQuestion] = useState<
    Record<string, number>
  >({});

  const load = useCallback(async () => {
    if (!setId) {
      setFetching(false);
      setError("Paket evaluasi tidak teridentifikasi.");
      return;
    }
    try {
      const data = await apiFetch<StudentSetGroup>(
        `/student/submission-sets/${setId}`,
      );
      setGroup(data);

      const qParam = searchParams.get("q");
      if (qParam) {
        const qNum = Number.parseInt(qParam, 10);
        if (!Number.isNaN(qNum) && qNum >= 1 && qNum <= data.questions.length) {
          setActiveQuestionIdx(qNum - 1);
        }
      }
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setFetching(false);
    }
  }, [setId, searchParams]);

  useEffect(() => {
    if (loading) return;
    if (!user) {
      router.replace("/login");
      return;
    }
    void load();
  }, [user, loading, router, load]);

  const activeQuestion: StudentQuestionGroup | undefined = useMemo(() => {
    if (!group || !group.questions.length) return undefined;
    return group.questions[activeQuestionIdx] ?? group.questions[0];
  }, [group, activeQuestionIdx]);

  const attemptsDesc: StudentAttempt[] = useMemo(() => {
    if (!activeQuestion) return [];
    return [...activeQuestion.attempts].sort(
      (a, b) => b.attempt_no - a.attempt_no,
    );
  }, [activeQuestion]);

  const currentAttempt: StudentAttempt | undefined = useMemo(() => {
    if (!activeQuestion || !attemptsDesc.length) return undefined;
    const chosenAttemptNo =
      selectedAttemptByQuestion[activeQuestion.question_id];
    if (chosenAttemptNo !== undefined) {
      const found = attemptsDesc.find((a) => a.attempt_no === chosenAttemptNo);
      if (found) return found;
    }
    return attemptsDesc[0];
  }, [activeQuestion, attemptsDesc, selectedAttemptByQuestion]);

  const handleSelectQuestion = (idx: number) => {
    setActiveQuestionIdx(idx);
  };

  const handleSelectAttempt = (questionId: string, attemptNo: number) => {
    setSelectedAttemptByQuestion((prev) => ({
      ...prev,
      [questionId]: attemptNo,
    }));
  };

  if (loading || !user) return null;

  return (
    <PageContainer>
      <div className="mb-3">
        <Link
          href="/code#pengumpulan"
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-on-surface-variant hover:text-primary transition-colors no-underline"
        >
          <ArrowLeft size={14} />
          Kembali ke Daftar Pengumpulan Soal
        </Link>
      </div>

      {error && (
        <div
          role="alert"
          className="mb-4 flex items-center gap-3 rounded-xl border border-error/40 bg-error-container p-4 text-sm text-on-error-container"
        >
          <TriangleAlert size={20} />
          <span>{error}</span>
        </div>
      )}

      {fetching ? (
        <p className="mt-8 text-sm text-on-surface-variant">
          Memuat rincian evaluasi diagnostik...
        </p>
      ) : group && activeQuestion ? (
        <div className="space-y-4">
          <PageHeader
            title={group.title}
            description={`Mata Kuliah: ${group.subject_name}${group.topic_name ? ` • Topik: ${group.topic_name}` : ""} • Kode: ${group.code}`}
            icon={GraduationCap}
            eyebrow={
              <span className="text-xs font-bold uppercase tracking-wider text-primary">
                Hasil Evaluasi Diagnostik Four-Tier
              </span>
            }
          />

          <main className="glass-panel overflow-hidden rounded-2xl border border-outline-variant/40 shadow-sm">
            {/* Navigation Toolbar */}
            <div className="border-b border-outline-variant/30 bg-surface-container-low/70 px-4 py-3 sm:px-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-xs font-bold uppercase tracking-wider text-on-surface-variant mr-1">
                    Navigasi soal:
                  </span>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {group.questions.map((q, idx) => {
                      const isCurrent = idx === activeQuestionIdx;
                      const isAnswered = q.attempts.length > 0;

                      let pillClass = "";
                      if (isCurrent) {
                        pillClass =
                          "bg-purple-200 text-slate-950 border-purple-400 font-bold dark:bg-purple-300 dark:text-slate-950 ring-2 ring-purple-400/40 shadow-sm";
                      } else if (isAnswered) {
                        pillClass =
                          "bg-emerald-500/20 text-emerald-300 border-emerald-500/40 hover:bg-emerald-500/30 font-medium";
                      } else {
                        pillClass =
                          "bg-white text-slate-900 border-slate-300 hover:bg-slate-100 font-semibold";
                      }

                      return (
                        <button
                          key={q.question_id}
                          type="button"
                          onClick={() => handleSelectQuestion(idx)}
                          className={`rounded-lg border px-3 py-1.5 text-xs font-mono-ui transition-all cursor-pointer ${pillClass}`}
                          aria-current={isCurrent ? "page" : undefined}
                        >
                          Soal {q.order_index}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-xs font-bold uppercase tracking-wider text-on-surface-variant whitespace-nowrap">
                    Pilih percobaan:
                  </span>
                  <AppSelect
                    value={
                      currentAttempt ? String(currentAttempt.attempt_no) : ""
                    }
                    onValueChange={(val) => {
                      if (activeQuestion && val) {
                        handleSelectAttempt(
                          activeQuestion.question_id,
                          Number.parseInt(val, 10),
                        );
                      }
                    }}
                    ariaLabel="Pilih Percobaan"
                    disabled={attemptsDesc.length === 0}
                    placeholder={
                      attemptsDesc.length === 0
                        ? "Belum ada percobaan"
                        : `Percobaan ${currentAttempt?.attempt_no ?? 1}`
                    }
                    className="min-w-[140px] sm:min-w-[160px]"
                    options={attemptsDesc.map((att) => ({
                      value: String(att.attempt_no),
                      label: `Percobaan ${att.attempt_no}`,
                    }))}
                  />
                </div>
              </div>
            </div>

            {/* Sub-Header */}
            <div className="flex flex-col gap-2 border-b border-outline-variant/30 bg-surface-container-low/30 px-4 py-2.5 sm:px-6 sm:flex-row sm:items-center sm:justify-between">
              <span className="font-mono-ui text-xs font-bold text-primary">
                Soal {activeQuestion.order_index} dari {group.questions.length}
              </span>

              {currentAttempt ? (
                <span
                  className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${
                    getSemanticStatus(currentAttempt.status).badgeClass
                  }`}
                >
                  {getSemanticStatus(currentAttempt.status).badgeLabel}
                </span>
              ) : (
                <span className="inline-flex items-center rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[11px] font-semibold text-amber-400">
                  Belum Dijawab
                </span>
              )}
            </div>

            <div className="px-4 py-5 sm:px-6">
              <div>
                <h3 className="text-xs font-bold uppercase tracking-wider text-on-surface-variant">
                  Pertanyaan Konseptual
                </h3>
                <p className="mt-1.5 whitespace-pre-line text-sm leading-relaxed text-on-surface font-medium">
                  {activeQuestion.prompt}
                </p>
              </div>

              {!currentAttempt ? (
                <div className="mt-6 flex flex-col gap-3 rounded-xl border border-outline-variant/40 bg-surface-container-lowest p-5 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-sm font-semibold text-on-surface">
                      Anda belum mengumpulkan jawaban untuk butir pertanyaan
                      ini.
                    </p>
                    <p className="text-xs text-on-surface-variant mt-0.5">
                      Silakan masuk ke lembar soal untuk melengkapi empat tier
                      diagnostik.
                    </p>
                  </div>
                  <Link
                    href={`/sets/${group.set_id}?code=${encodeURIComponent(group.code)}`}
                    className="btn-primary shrink-0 no-underline"
                  >
                    <PenLine size={16} />
                    Kerjakan Sekarang
                  </Link>
                </div>
              ) : (
                <article className="mt-5 rounded-xl border border-outline-variant/30 bg-surface-container-low p-4 sm:p-5">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-outline-variant/20 pb-2.5">
                    <span className="font-mono-ui text-xs font-bold text-on-surface">
                      Percobaan {currentAttempt.attempt_no}
                    </span>
                    <span className="text-[11px] text-on-surface-variant">
                      Dikirim: {fmtDate(currentAttempt.submitted_at)}
                    </span>
                  </div>

                  {/* Rincian Tanggapan Jawaban Mahasiswa */}
                  <div className="mt-3.5 space-y-3">
                    <h4 className="text-[11px] font-bold uppercase tracking-wider text-on-surface-variant">
                      Rincian Tanggapan Anda:
                    </h4>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="rounded-lg border border-outline-variant/30 bg-surface-container-lowest p-3">
                        <span className="text-[10px] font-bold uppercase text-on-surface-variant">
                          1. Kesimpulan Jawaban
                        </span>
                        <p className="mt-1 text-sm font-semibold text-on-surface font-mono-ui">
                          {currentAttempt.tier1_answer ||
                            currentAttempt.answer_text ||
                            "-"}
                        </p>
                      </div>

                      <div className="rounded-lg border border-outline-variant/30 bg-surface-container-lowest p-3">
                        <span className="text-[10px] font-bold uppercase text-on-surface-variant">
                          2. Tingkat Keyakinan Jawaban
                        </span>
                        <p className="mt-1 text-sm font-bold text-primary font-mono-ui">
                          Skala {currentAttempt.tier2_confidence ?? 1} / 6 (
                          {(currentAttempt.tier2_confidence ?? 1) >= 4
                            ? "Yakin"
                            : "Tidak Yakin"}
                          )
                        </p>
                      </div>

                      <div className="rounded-lg border border-outline-variant/30 bg-surface-container-lowest p-3 sm:col-span-2">
                        <span className="text-[10px] font-bold uppercase text-on-surface-variant">
                          3. Alasan / Penalaran Ilmiah
                        </span>
                        <p className="mt-1 text-sm text-on-surface whitespace-pre-wrap font-mono-ui leading-relaxed">
                          {currentAttempt.tier3_reason ||
                            currentAttempt.answer_text ||
                            "-"}
                        </p>
                      </div>

                      <div className="rounded-lg border border-outline-variant/30 bg-surface-container-lowest p-3 sm:col-span-2">
                        <span className="text-[10px] font-bold uppercase text-on-surface-variant">
                          4. Tingkat Keyakinan Alasan
                        </span>
                        <p className="mt-1 text-sm font-bold text-primary font-mono-ui">
                          Skala {currentAttempt.tier4_confidence ?? 1} / 6 (
                          {(currentAttempt.tier4_confidence ?? 1) >= 4
                            ? "Yakin"
                            : "Tidak Yakin"}
                          )
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Validated Diagnostic Results */}
                  {currentAttempt.status === "VALIDATED" &&
                  currentAttempt.evaluation ? (
                    <div className="mt-4 space-y-3 border-t border-outline-variant/20 pt-4">
                      <ScoreExplanationCard
                        evaluation={currentAttempt.evaluation}
                        diagnosisCategory={
                          currentAttempt.four_tier_diagnosis?.category
                        }
                      />
                      <ActionableFeedbackSection
                        evaluation={currentAttempt.evaluation}
                      />
                    </div>
                  ) : (
                    <div className="mt-4 rounded-lg border border-outline-variant/20 bg-surface-container-lowest p-3.5 text-xs text-on-surface-variant">
                      <p className="font-semibold text-on-surface">
                        {getSemanticStatus(currentAttempt.status).description}
                      </p>
                      <p className="mt-1 text-[11px] text-on-surface-variant">
                        Umpan balik diagnostik dan skor terinci akan tampil
                        setelah dosen memvalidasi tanggapan ini.
                      </p>
                    </div>
                  )}
                </article>
              )}

              <footer className="mt-6 flex items-center justify-between border-t border-outline-variant/20 pt-4">
                <button
                  type="button"
                  onClick={() =>
                    handleSelectQuestion(Math.max(0, activeQuestionIdx - 1))
                  }
                  disabled={activeQuestionIdx === 0}
                  className="btn-secondary text-xs !py-1.5 !px-3 disabled:opacity-40 cursor-pointer"
                >
                  <ChevronLeft size={14} />
                  Soal Sebelumnya
                </button>

                <span className="text-xs font-mono-ui text-on-surface-variant">
                  Soal {activeQuestionIdx + 1} dari {group.questions.length}
                </span>

                <button
                  type="button"
                  onClick={() =>
                    handleSelectQuestion(
                      Math.min(
                        group.questions.length - 1,
                        activeQuestionIdx + 1,
                      ),
                    )
                  }
                  disabled={activeQuestionIdx === group.questions.length - 1}
                  className="btn-secondary text-xs !py-1.5 !px-3 disabled:opacity-40 cursor-pointer"
                >
                  Soal Selanjutnya
                  <ChevronRight size={14} />
                </button>
              </footer>
            </div>
          </main>
        </div>
      ) : null}
    </PageContainer>
  );
}
