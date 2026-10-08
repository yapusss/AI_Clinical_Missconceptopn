"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import {
  AlertTriangle,
  ArrowLeft,
  Award,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  GraduationCap,
  Info,
  Lightbulb,
  MessageSquare,
  PenLine,
  XCircle,
} from "lucide-react";

import { useAuth } from "../../components/AuthProvider";
import AppSelect from "../../components/AppSelect";
import PageContainer from "../../components/PageContainer";
import PageHeader from "../../components/PageHeader";
import RichTextContent from "../../components/RichTextContent";
import FeedbackModal from "../../components/FeedbackModal";
import { apiFetch } from "../../lib/api";
import {
  fmtDate,
  getSemanticStatus,
  type StudentAttempt,
  type StudentQuestionGroup,
  type StudentPackageGroup,
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

const fmtPct = (num: number) => {
  return num % 1 === 0 ? `${num.toFixed(0)}%` : `${num.toFixed(1)}%`;
};

const SCORE_POLICY_LABEL: Record<string, string> = {
  HIGHEST: "Nilai Tertinggi",
  AVERAGE: "Nilai Rata-rata",
  LAST_ATTEMPT: "Nilai Percobaan Terakhir",
};

export default function SubmissionPackageDetailPage() {
  return (
    <Suspense fallback={null}>
      <SubmissionPackageDetailPageContent />
    </Suspense>
  );
}

function SubmissionPackageDetailPageContent() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const params = useParams<{ packageId: string }>();
  const searchParams = useSearchParams();
  const packageId = params?.packageId as string | undefined;

  const [group, setGroup] = useState<StudentPackageGroup | null>(null);
  const [fetching, setFetching] = useState(true);
  const [error, setError] = useState("");

  const [activeQuestionIdx, setActiveQuestionIdx] = useState(0);
  const [selectedAttemptByQuestion, setSelectedAttemptByQuestion] = useState<
    Record<string, number>
  >({});

  const load = useCallback(async () => {
    if (!packageId) {
      setFetching(false);
      setError("Paket evaluasi tidak teridentifikasi.");
      return;
    }
    try {
      const data = await apiFetch<StudentPackageGroup>(
        `/student/submission-packages/${packageId}`,
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
  }, [packageId, searchParams]);

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
    window.scrollTo({ top: 0, behavior: "smooth" });
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

      {fetching ? (
        <p className="mt-8 text-sm text-on-surface-variant">
          Memuat rincian evaluasi diagnostik...
        </p>
      ) : group && activeQuestion ? (
        <div className="space-y-4">
          <PageHeader
            title={group.title}
            description={`Mata Kuliah: ${group.subject_name} • Kode: ${group.code}`}
            icon={GraduationCap}
            eyebrow={
              <span className="text-xs font-bold uppercase tracking-wider text-primary font-mono-ui">
                Hasil Evaluasi Diagnostik Konseptual
              </span>
            }
          />

          <div className="flex flex-col lg:flex-row gap-5 items-start">
            {/* AREA KIRI: DETAIL SOAL, JAWABAN MAHASISWA & 3 KARTU FEEDBACK */}
            <main className="flex-1 min-w-0 space-y-4">
              <section className="glass-panel overflow-hidden rounded-2xl border border-outline-variant/40 shadow-sm p-4 sm:p-6 space-y-5">
                <div className="flex flex-col gap-2 border-b border-outline-variant/30 pb-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-center gap-2">
                    <span className="font-mono-ui text-base font-bold text-primary">
                      Soal Nomor {activeQuestion.order_index}
                    </span>
                    <span className="text-sm font-mono-ui text-on-surface-variant">
                      dari {group.questions.length} Soal
                    </span>
                  </div>

                  <div className="flex items-center gap-3">
                    <div className="flex items-center gap-1.5 text-xs">
                      <span className="text-on-surface-variant text-xs font-semibold uppercase tracking-wide">
                        Percobaan:
                      </span>
                      {attemptsDesc.length <= 1 ? (
                        <span className="inline-flex min-w-[95px] items-center justify-center rounded-lg border border-outline-variant/30 bg-surface-container-low px-3 py-1.5 text-xs font-semibold text-on-surface-variant">
                          {attemptsDesc.length === 0
                            ? "Belum ada"
                            : `Ke-${currentAttempt?.attempt_no ?? 1}`}
                        </span>
                      ) : (
                        <AppSelect
                          value={
                            currentAttempt
                              ? String(currentAttempt.attempt_no)
                              : ""
                          }
                          onValueChange={(val) => {
                            if (val)
                              handleSelectAttempt(
                                activeQuestion.question_id,
                                Number.parseInt(val, 10),
                              );
                          }}
                          ariaLabel="Pilih Percobaan"
                          placeholder={`Ke-${currentAttempt?.attempt_no ?? 1}`}
                          className="min-w-[95px] text-xs"
                          options={attemptsDesc.map((att) => ({
                            value: String(att.attempt_no),
                            label: `Ke-${att.attempt_no}`,
                          }))}
                        />
                      )}
                    </div>

                    {currentAttempt ? (
                      <span
                        className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${
                          getSemanticStatus(currentAttempt.status).badgeClass
                        }`}
                      >
                        {getSemanticStatus(currentAttempt.status).badgeLabel}
                      </span>
                    ) : (
                      <span className="badge badge-draft text-xs">
                        Belum Dijawab
                      </span>
                    )}
                  </div>
                </div>

                <div className="rounded-xl border border-primary/30 border-l-4 border-l-primary bg-primary-fixed p-4 shadow-sm sm:p-5">
                  <div className="flex items-center gap-2">
                    <Lightbulb size={18} className="shrink-0 text-primary" />
                    <h3 className="text-sm font-bold uppercase tracking-wider text-primary">
                      Pertanyaan Konseptual
                    </h3>
                  </div>
                  <RichTextContent
                    html={activeQuestion.prompt}
                    className="mt-2.5 text-xl leading-relaxed font-semibold text-on-surface"
                  />
                </div>

                {!currentAttempt ? (
                  <div className="mt-4 flex flex-col gap-3 rounded-xl border border-outline-variant/40 bg-surface-container-lowest p-5 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="text-sm font-semibold text-on-surface">
                        Anda belum mengumpulkan jawaban untuk butir pertanyaan
                        ini.
                      </p>
                      <p className="text-xs text-on-surface-variant mt-0.5">
                        Silakan buka lembar soal untuk melengkapi jawaban
                        evaluasi.
                      </p>
                    </div>
                    <Link
                      href={`/sets/${group.package_id}?code=${encodeURIComponent(group.code)}`}
                      className="btn-primary shrink-0 no-underline"
                    >
                      <PenLine size={16} />
                      Kerjakan Sekarang
                    </Link>
                  </div>
                ) : (
                  <article className="mt-3 rounded-xl border border-outline-variant/30 bg-surface-container-low p-4 sm:p-5 space-y-4">
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-outline-variant/20 pb-2.5">
                      <span className="font-mono-ui text-sm font-bold text-on-surface">
                        Jawaban Anda
                      </span>
                      <span className="text-xs text-on-surface-variant">
                        Dikirim: {fmtDate(currentAttempt.submitted_at)}
                      </span>
                    </div>

                    {/* Tanggapan Jawaban Mahasiswa */}
                    <div className="space-y-3">
                      <div className="grid grid-cols-1 gap-3">
                        <div className="rounded-lg border border-outline-variant/30 bg-surface-container-lowest p-3">
                          <span className="text-xs font-bold uppercase tracking-wide text-on-surface-variant">
                            1. Jawaban singkat
                          </span>
                          <p className="mt-1 text-base font-semibold text-on-surface">
                            {currentAttempt.tier1_answer ||
                              currentAttempt.answer_text ||
                              "-"}
                          </p>
                        </div>

                        <div className="flex items-center justify-between gap-3 rounded-lg border border-outline-variant/30 bg-surface-container-lowest px-3 py-2.5">
                          <span className="text-xs font-bold uppercase tracking-wide text-on-surface-variant">
                            2. Keyakinan Jawaban
                          </span>
                          <p className="text-base font-bold text-primary font-mono-ui">
                            Skala {currentAttempt.tier2_confidence ?? 1} / 6 (
                            {(currentAttempt.tier2_confidence ?? 1) >= 4
                              ? "Yakin"
                              : "Tidak Yakin"}
                            )
                          </p>
                        </div>

                        <div className="rounded-lg border border-outline-variant/30 bg-surface-container-lowest p-3">
                          <span className="text-xs font-bold uppercase tracking-wide text-on-surface-variant">
                            3. Alasan jawaban
                          </span>
                          <p className="mt-1 text-base text-on-surface whitespace-pre-wrap leading-relaxed">
                            {currentAttempt.tier3_reason ||
                              currentAttempt.answer_text ||
                              "-"}
                          </p>
                        </div>

                        <div className="flex items-center justify-between gap-3 rounded-lg border border-outline-variant/30 bg-surface-container-lowest px-3 py-2.5">
                          <span className="text-xs font-bold uppercase tracking-wide text-on-surface-variant">
                            4. Keyakinan Alasan
                          </span>
                          <p className="text-base font-bold text-primary font-mono-ui">
                            Skala {currentAttempt.tier4_confidence ?? 1} / 6 (
                            {(currentAttempt.tier4_confidence ?? 1) >= 4
                              ? "Yakin"
                              : "Tidak Yakin"}
                            )
                          </p>
                        </div>
                      </div>
                    </div>

                    {/* HASIL EVALUASI TERVALIDASI: STATUS BINER & 3 KARTU FEEDBACK */}
                    {currentAttempt.status === "VALIDATED" &&
                    currentAttempt.evaluation ? (
                      <div className="mt-4 space-y-4 border-t border-outline-variant/20 pt-4">
                        {/* Status Biner Butir Soal Ini */}
                        <div className="rounded-xl border border-outline-variant/40 bg-surface-container-lowest p-4">
                          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                            <div>
                              <span className="text-xs font-bold uppercase tracking-wider text-on-surface-variant">
                                Status Butir Soal Ini:
                              </span>
                              <div className="mt-1 flex items-center gap-2">
                                {currentAttempt.evaluation.percentage_correct >=
                                99.9 ? (
                                  <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg font-mono-ui text-sm font-extrabold bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/40">
                                    <CheckCircle2 size={16} />
                                    Jawaban Benar
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg font-mono-ui text-sm font-extrabold bg-rose-500/15 text-rose-600 dark:text-rose-400 border border-rose-500/40">
                                    <XCircle size={16} />
                                    Jawaban Belum Tepat
                                  </span>
                                )}
                              </div>
                            </div>

                            {currentAttempt.four_tier_diagnosis?.category &&
                              STUDENT_FRIENDLY_CATEGORIES[
                                currentAttempt.four_tier_diagnosis.category
                              ] && (
                                <div
                                  className={`diag-card ${
                                    STUDENT_FRIENDLY_CATEGORIES[
                                      currentAttempt.four_tier_diagnosis
                                        .category
                                    ].cardCls
                                  } px-3 py-1.5 text-right max-w-xs`}
                                >
                                  <span className="block text-xs font-bold font-mono-ui diag-title">
                                    {
                                      STUDENT_FRIENDLY_CATEGORIES[
                                        currentAttempt.four_tier_diagnosis
                                          .category
                                      ].label
                                    }
                                  </span>
                                  <span className="block text-xs diag-desc mt-0.5">
                                    {
                                      STUDENT_FRIENDLY_CATEGORIES[
                                        currentAttempt.four_tier_diagnosis
                                          .category
                                      ].desc
                                    }
                                  </span>
                                </div>
                              )}
                          </div>
                        </div>

                        {/* REFERENSI & MATERI — IN DEVELOPMENT (umpan balik mahasiswa dipindah ke rencana berikutnya) */}
                        <div className="rounded-lg border border-dashed border-outline-variant/40 bg-surface-container-lowest/60 p-4 space-y-1">
                          <div className="flex items-center gap-1.5 text-sm font-bold uppercase tracking-wider text-on-surface-variant">
                            <Info size={15} className="text-primary" />
                            Referensi &amp; Materi Pembelajaran
                            <span className="rounded-full border border-primary/30 bg-primary-fixed px-2 py-0.5 text-[10px] font-bold normal-case tracking-normal text-primary">
                              In Development
                            </span>
                          </div>
                          <p className="text-xs text-on-surface-variant leading-relaxed">
                            Area ini nantinya berisi daftar buku, referensi, dan
                            sumber materi pilihan AI untuk membantu Anda
                            memperbaiki miskonsepsi. Fitur sedang dalam
                            pengembangan.
                          </p>
                        </div>

                        {currentAttempt.evaluation.validator_name && (
                          <p className="text-xs text-on-surface-variant">
                            Divalidasi oleh:{" "}
                            <strong className="text-on-surface">
                              {currentAttempt.evaluation.validator_name}
                            </strong>
                            {currentAttempt.evaluation.validated_at
                              ? ` · ${fmtDate(currentAttempt.evaluation.validated_at)}`
                              : ""}
                          </p>
                        )}
                      </div>
                    ) : (
                      <div className="mt-4 rounded-lg border border-outline-variant/20 bg-surface-container-lowest p-4 text-sm text-on-surface-variant">
                        <p className="font-semibold text-on-surface">
                          {currentAttempt.status === "ANALYZING" ||
                          currentAttempt.status === "SUBMITTED"
                            ? "Sedang dianalisis AI."
                            : currentAttempt.status === "ANALYSIS_FAILED" ||
                                currentAttempt.status === "REJECTED"
                              ? "Menunggu analisis ulang AI."
                              : "Menunggu validasi dosen."}
                        </p>
                      </div>
                    )}
                  </article>
                )}

                {/* Navigasi Soal Bawah */}
                <footer className="mt-4 flex items-center justify-between border-t border-outline-variant/20 pt-4">
                  <button
                    type="button"
                    onClick={() =>
                      handleSelectQuestion(Math.max(0, activeQuestionIdx - 1))
                    }
                    disabled={activeQuestionIdx === 0}
                    className="btn-secondary text-sm !py-2 !px-4 disabled:opacity-40 cursor-pointer"
                  >
                    <ChevronLeft size={15} />
                    Soal Sebelumnya
                  </button>

                  <span className="text-sm font-mono-ui text-on-surface-variant font-semibold">
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
                    className="btn-secondary text-sm !py-2 !px-4 disabled:opacity-40 cursor-pointer"
                  >
                    Soal Selanjutnya
                    <ChevronRight size={15} />
                  </button>
                </footer>
              </section>
            </main>

            {/* SIDEBAR KANAN: DAFTAR SOAL + KARTU NILAI AKHIR PAKET (100%, 75%, 50%, ETC) */}
            <aside className="w-full lg:w-52 shrink-0 lg:sticky lg:top-6 space-y-3">
              {/* 1. KOTAK DAFTAR SOAL */}
              <div className="rounded-xl border border-outline-variant/40 bg-surface-container-lowest p-3.5 shadow-sm">
                <div className="flex items-center justify-between border-b border-outline-variant/30 pb-2.5">
                  <h3 className="font-bold text-sm text-on-surface uppercase tracking-wide">
                    Daftar Soal
                  </h3>
                  <span className="text-xs text-on-surface-variant font-mono-ui">
                    {group.questions.length} Soal
                  </span>
                </div>

                <div className="flex flex-wrap items-center gap-2 py-3">
                  {group.questions.map((q, idx) => {
                    const isCurrent = idx === activeQuestionIdx;
                    const isAnswered = q.attempts.length > 0;
                    const isValidated = q.attempts.some(
                      (a) => a.status === "VALIDATED",
                    );
                    const isCorrect = q.attempts.some(
                      (a) =>
                        a.status === "VALIDATED" &&
                        (a.evaluation?.percentage_correct ?? 0) >= 99.9,
                    );

                    let boxBorderCls =
                      "border-outline-variant/50 bg-surface-container text-on-surface-variant";
                    let dotColor = "bg-slate-400";
                    let statusTitle = "Belum Dijawab";

                    if (isValidated) {
                      if (isCorrect) {
                        boxBorderCls =
                          "border-emerald-500/60 bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 font-bold";
                        dotColor = "bg-emerald-400";
                        statusTitle = "Jawaban Benar";
                      } else {
                        boxBorderCls =
                          "border-rose-500/60 bg-rose-500/15 text-rose-600 dark:text-rose-400 font-bold";
                        dotColor = "bg-rose-400";
                        statusTitle = "Jawaban Salah";
                      }
                    } else if (isAnswered) {
                      boxBorderCls =
                        "border-amber-500/60 bg-amber-500/15 text-amber-600 dark:text-amber-400 font-bold";
                      dotColor = "bg-amber-400";
                      statusTitle = "Menunggu Validasi";
                    }

                    return (
                      <button
                        key={q.question_id}
                        type="button"
                        onClick={() => handleSelectQuestion(idx)}
                        className={`relative flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border font-mono-ui text-sm transition-all cursor-pointer shadow-sm ${boxBorderCls} ${
                          isCurrent
                            ? "ring-2 ring-primary ring-offset-2 ring-offset-surface-container-lowest font-extrabold !text-white !bg-primary !border-primary"
                            : "hover:border-primary/60"
                        }`}
                        title={`Soal ${idx + 1}: ${statusTitle}`}
                      >
                        {idx + 1}
                        <span
                          className={`absolute -top-1 -right-1 h-2 w-2 rounded-full border border-surface-container-lowest ${dotColor}`}
                        />
                      </button>
                    );
                  })}
                </div>

                <div className="pt-2 border-t border-outline-variant/30 space-y-1 text-xs text-on-surface-variant font-medium">
                  <div className="flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full bg-emerald-400 shrink-0" />
                    <span>Jawaban Benar</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full bg-rose-400 shrink-0" />
                    <span>Jawaban Salah</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full bg-amber-400 shrink-0" />
                    <span>Menunggu Validasi</span>
                  </div>
                </div>
              </div>

              {/* 2. KARTU NILAI AKHIR PAKET (PERSENTASE BERSIH: 100%, 75%, 50%, ETC) TEPAT DI BAWAH KOTAK DAFTAR SOAL */}
              <div className="rounded-xl border border-outline-variant/40 bg-surface-container-lowest p-4 shadow-sm">
                <span className="text-sm font-bold uppercase tracking-wider text-on-surface-variant block">
                  {SCORE_POLICY_LABEL[group.score_policy ?? "LAST_ATTEMPT"]}:
                </span>
                <span className="font-mono-ui text-3xl font-black text-on-surface mt-1.5 block">
                  {fmtPct(group.overall_score ?? 0)}
                </span>
              </div>
            </aside>
          </div>
        </div>
      ) : null}
      <FeedbackModal
        open={!!error}
        message={error}
        onClose={() => setError("")}
      />
    </PageContainer>
  );
}
