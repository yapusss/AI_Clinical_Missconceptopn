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
  Lightbulb,
  MessageSquare,
  PenLine,
  TriangleAlert,
  XCircle,
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

const fmtPct = (num: number) => {
  return num % 1 === 0 ? `${num.toFixed(0)}%` : `${num.toFixed(1)}%`;
};

export default function SubmissionSetDetailPage() {
  return (
    <Suspense fallback={null}>
      <SubmissionSetDetailPageContent />
    </Suspense>
  );
}

function SubmissionSetDetailPageContent() {
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
                    <span className="font-mono-ui text-sm font-bold text-primary">
                      Soal Nomor {activeQuestion.order_index}
                    </span>
                    <span className="text-xs font-mono-ui text-on-surface-variant">
                      dari {group.questions.length} Soal
                    </span>
                  </div>

                  <div className="flex items-center gap-3">
                    <div className="flex items-center gap-1.5 text-xs">
                      <span className="text-on-surface-variant text-xs font-semibold uppercase tracking-wide">
                        Percobaan:
                      </span>
                      <AppSelect
                        value={currentAttempt ? String(currentAttempt.attempt_no) : ""}
                        onValueChange={(val) => {
                          if (val)
                            handleSelectAttempt(
                              activeQuestion.question_id,
                              Number.parseInt(val, 10)
                            );
                        }}
                        ariaLabel="Pilih Percobaan"
                        disabled={attemptsDesc.length === 0}
                        placeholder={
                          attemptsDesc.length === 0
                            ? "Belum ada"
                            : `Ke-${currentAttempt?.attempt_no ?? 1}`
                        }
                        className="min-w-[95px] text-xs"
                        options={attemptsDesc.map((att) => ({
                          value: String(att.attempt_no),
                          label: `Ke-${att.attempt_no}`,
                        }))}
                      />
                    </div>

                    {currentAttempt ? (
                      <span
                        className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${
                          getSemanticStatus(currentAttempt.status).badgeClass
                        }`}
                      >
                        {getSemanticStatus(currentAttempt.status).badgeLabel}
                      </span>
                    ) : (
                      <span className="badge badge-draft text-xs">Belum Dijawab</span>
                    )}
                  </div>
                </div>

                <div>
                  <h3 className="text-xs font-bold uppercase tracking-wider text-on-surface-variant">
                    Pertanyaan Konseptual
                  </h3>
                  <p className="mt-1.5 whitespace-pre-line text-sm leading-relaxed text-on-surface font-medium">
                    {activeQuestion.prompt}
                  </p>
                </div>

                {!currentAttempt ? (
                  <div className="mt-4 flex flex-col gap-3 rounded-xl border border-outline-variant/40 bg-surface-container-lowest p-5 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="text-sm font-semibold text-on-surface">
                        Anda belum mengumpulkan jawaban untuk butir pertanyaan ini.
                      </p>
                      <p className="text-xs text-on-surface-variant mt-0.5">
                        Silakan buka lembar soal untuk melengkapi jawaban evaluasi.
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
                  <article className="mt-3 rounded-xl border border-outline-variant/30 bg-surface-container-low p-4 sm:p-5 space-y-4">
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-outline-variant/20 pb-2.5">
                      <span className="font-mono-ui text-xs font-bold text-on-surface">
                        Percobaan #{currentAttempt.attempt_no}
                      </span>
                      <span className="text-[11px] text-on-surface-variant">
                        Dikirim: {fmtDate(currentAttempt.submitted_at)}
                      </span>
                    </div>

                    {/* Tanggapan Jawaban Mahasiswa (Tier 1-4) */}
                    <div className="space-y-3">
                      <h4 className="text-[11px] font-bold uppercase tracking-wider text-on-surface-variant">
                        Rincian Tanggapan Anda:
                      </h4>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div className="rounded-lg border border-outline-variant/30 bg-surface-container-lowest p-3">
                          <span className="text-[10px] font-bold uppercase text-on-surface-variant">
                            1. Kesimpulan Jawaban (Tier 1)
                          </span>
                          <p className="mt-1 text-sm font-semibold text-on-surface">
                            {currentAttempt.tier1_answer || currentAttempt.answer_text || "-"}
                          </p>
                        </div>

                        <div className="rounded-lg border border-outline-variant/30 bg-surface-container-lowest p-3">
                          <span className="text-[10px] font-bold uppercase text-on-surface-variant">
                            2. Keyakinan Jawaban (Tier 2)
                          </span>
                          <p className="mt-1 text-sm font-bold text-primary font-mono-ui">
                            Skala {currentAttempt.tier2_confidence ?? 1} / 6 (
                            {(currentAttempt.tier2_confidence ?? 1) >= 4 ? "Yakin" : "Tidak Yakin"})
                          </p>
                        </div>

                        <div className="rounded-lg border border-outline-variant/30 bg-surface-container-lowest p-3 sm:col-span-2">
                          <span className="text-[10px] font-bold uppercase text-on-surface-variant">
                            3. Alasan / Penalaran Ilmiah (Tier 3)
                          </span>
                          <p className="mt-1 text-sm text-on-surface whitespace-pre-wrap leading-relaxed">
                            {currentAttempt.tier3_reason || currentAttempt.answer_text || "-"}
                          </p>
                        </div>

                        <div className="rounded-lg border border-outline-variant/30 bg-surface-container-lowest p-3 sm:col-span-2">
                          <span className="text-[10px] font-bold uppercase text-on-surface-variant">
                            4. Keyakinan Alasan (Tier 4)
                          </span>
                          <p className="mt-1 text-sm font-bold text-primary font-mono-ui">
                            Skala {currentAttempt.tier4_confidence ?? 1} / 6 (
                            {(currentAttempt.tier4_confidence ?? 1) >= 4 ? "Yakin" : "Tidak Yakin"})
                          </p>
                        </div>
                      </div>
                    </div>

                    {/* HASIL EVALUASI TERVALIDASI: STATUS BINER & 3 KARTU FEEDBACK */}
                    {currentAttempt.status === "VALIDATED" && currentAttempt.evaluation ? (
                      <div className="mt-4 space-y-4 border-t border-outline-variant/20 pt-4">
                        {/* Status Biner Butir Soal Ini */}
                        <div className="rounded-xl border border-outline-variant/40 bg-surface-container-lowest p-4">
                          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                            <div>
                              <span className="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant">
                                Status Butir Soal Ini:
                              </span>
                              <div className="mt-1 flex items-center gap-2">
                                {currentAttempt.evaluation.percentage_correct >= 99.9 ? (
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
                              STUDENT_FRIENDLY_CATEGORIES[currentAttempt.four_tier_diagnosis.category] && (
                                <div
                                  className={`diag-card ${
                                    STUDENT_FRIENDLY_CATEGORIES[currentAttempt.four_tier_diagnosis.category].cardCls
                                  } px-3 py-1.5 text-right max-w-xs`}
                                >
                                  <span className="block text-xs font-bold font-mono-ui diag-title">
                                    {STUDENT_FRIENDLY_CATEGORIES[currentAttempt.four_tier_diagnosis.category].label}
                                  </span>
                                  <span className="block text-[11px] diag-desc mt-0.5">
                                    {STUDENT_FRIENDLY_CATEGORIES[currentAttempt.four_tier_diagnosis.category].desc}
                                  </span>
                                </div>
                              )}
                          </div>
                        </div>

                        {/* TIGA KARTU UMPAN BALIK PEDAGOGIS */}
                        <div className="space-y-3">
                          <div className="flex items-center justify-between border-b border-outline-variant/20 pb-2">
                            <span className="text-xs font-bold uppercase tracking-wider text-on-surface flex items-center gap-1.5">
                              <GraduationCap size={16} className="text-primary" />
                              Umpan Balik Pembelajaran
                            </span>
                            {currentAttempt.evaluation.validator_name && (
                              <span className="text-[11px] text-on-surface-variant">
                                Divalidasi oleh:{" "}
                                <strong className="text-on-surface">
                                  {currentAttempt.evaluation.validator_name}
                                </strong>
                              </span>
                            )}
                          </div>

                          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                            {/* Kartu 1: 🟢 Yang Sudah Tepat */}
                            <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4 space-y-1.5 flex flex-col justify-between">
                              <div>
                                <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400">
                                  <CheckCircle2 size={16} className="shrink-0" />
                                  <h4 className="text-xs font-bold uppercase tracking-wider">
                                    Yang Sudah Tepat
                                  </h4>
                                </div>
                                <p className="mt-2 text-xs leading-relaxed text-on-surface">
                                  {currentAttempt.evaluation.student_feedback?.poin_tepat ||
                                    "Kesimpulan atau penalaran telah disampaikan dengan baik."}
                                </p>
                              </div>
                            </div>

                            {/* Kartu 2: 🟡 Bagian yang Perlu Diperbaiki */}
                            <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 space-y-1.5 flex flex-col justify-between">
                              <div>
                                <div className="flex items-center gap-2 text-amber-600 dark:text-amber-400">
                                  <AlertTriangle size={16} className="shrink-0" />
                                  <h4 className="text-xs font-bold uppercase tracking-wider">
                                    Letak Kekeliruan
                                  </h4>
                                </div>
                                <p className="mt-2 text-xs leading-relaxed text-on-surface">
                                  {currentAttempt.evaluation.student_feedback?.letak_kekeliruan &&
                                  currentAttempt.evaluation.student_feedback.letak_kekeliruan !== "-"
                                    ? currentAttempt.evaluation.student_feedback.letak_kekeliruan
                                    : "Tidak ada kekeliruan mendasar. Pemahaman Anda sudah konsisten."}
                                </p>
                              </div>
                            </div>

                            {/* Kartu 3: 🔵 Konsep yang Seharusnya */}
                            <div className="rounded-xl border border-sky-500/30 bg-sky-500/5 p-4 space-y-1.5 flex flex-col justify-between">
                              <div>
                                <div className="flex items-center gap-2 text-sky-600 dark:text-sky-400">
                                  <Lightbulb size={16} className="shrink-0" />
                                  <h4 className="text-xs font-bold uppercase tracking-wider">
                                    Konsep Seharusnya
                                  </h4>
                                </div>
                                <p className="mt-2 text-xs leading-relaxed text-on-surface whitespace-pre-wrap">
                                  {currentAttempt.evaluation.student_feedback?.konsep_seharusnya ||
                                    activeQuestion.model_answer}
                                </p>
                              </div>
                            </div>
                          </div>

                          {/* Catatan Tambahan Khusus Dosen */}
                          {currentAttempt.evaluation.clinical_feedback && (
                            <div className="rounded-lg border border-outline-variant/30 bg-surface-container-lowest p-3.5 space-y-1 text-xs">
                              <div className="flex items-center gap-1.5 font-bold text-on-surface text-xs mb-1">
                                <MessageSquare size={14} className="text-primary" />
                                <span>Catatan Tambahan Pengajar:</span>
                              </div>
                              <p className="text-xs text-on-surface-variant leading-relaxed whitespace-pre-wrap">
                                {currentAttempt.evaluation.clinical_feedback}
                              </p>
                            </div>
                          )}
                        </div>
                      </div>
                    ) : (
                      <div className="mt-4 rounded-lg border border-outline-variant/20 bg-surface-container-lowest p-3.5 text-xs text-on-surface-variant">
                        <p className="font-semibold text-on-surface">
                          {getSemanticStatus(currentAttempt.status).description}
                        </p>
                        <p className="mt-1 text-[11px] text-on-surface-variant">
                          Umpan balik diagnostik dan hasil akhir akan tampil setelah divalidasi oleh dosen pengampu.
                        </p>
                      </div>
                    )}
                  </article>
                )}

                {/* Navigasi Soal Bawah */}
                <footer className="mt-4 flex items-center justify-between border-t border-outline-variant/20 pt-4">
                  <button
                    type="button"
                    onClick={() => handleSelectQuestion(Math.max(0, activeQuestionIdx - 1))}
                    disabled={activeQuestionIdx === 0}
                    className="btn-secondary text-xs !py-1.5 !px-3 disabled:opacity-40 cursor-pointer"
                  >
                    <ChevronLeft size={14} />
                    Soal Sebelumnya
                  </button>

                  <span className="text-xs font-mono-ui text-on-surface-variant font-semibold">
                    Soal {activeQuestionIdx + 1} dari {group.questions.length}
                  </span>

                  <button
                    type="button"
                    onClick={() =>
                      handleSelectQuestion(
                        Math.min(group.questions.length - 1, activeQuestionIdx + 1)
                      )
                    }
                    disabled={activeQuestionIdx === group.questions.length - 1}
                    className="btn-secondary text-xs !py-1.5 !px-3 disabled:opacity-40 cursor-pointer"
                  >
                    Soal Selanjutnya
                    <ChevronRight size={14} />
                  </button>
                </footer>
              </section>
            </main>

            {/* SIDEBAR KANAN: DAFTAR SOAL + KARTU NILAI AKHIR PAKET (100%, 75%, 50%, ETC) */}
            <aside className="w-full lg:w-52 shrink-0 lg:sticky lg:top-6 space-y-3">
              {/* 1. KOTAK DAFTAR SOAL */}
              <div className="rounded-xl border border-outline-variant/40 bg-surface-container-lowest p-3.5 shadow-sm">
                <div className="flex items-center justify-between border-b border-outline-variant/30 pb-2.5">
                  <h3 className="font-bold text-xs text-on-surface uppercase tracking-wide">
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
                    const isValidated = q.attempts.some((a) => a.status === "VALIDATED");
                    const isCorrect = q.attempts.some(
                      (a) => a.status === "VALIDATED" && (a.evaluation?.percentage_correct ?? 0) >= 99.9
                    );

                    let boxBorderCls = "border-outline-variant/50 bg-surface-container text-on-surface-variant";
                    let dotColor = "bg-slate-400";
                    let statusTitle = "Belum Dijawab";

                    if (isValidated) {
                      if (isCorrect) {
                        boxBorderCls = "border-emerald-500/60 bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 font-bold";
                        dotColor = "bg-emerald-400";
                        statusTitle = "Jawaban Benar";
                      } else {
                        boxBorderCls = "border-rose-500/60 bg-rose-500/15 text-rose-600 dark:text-rose-400 font-bold";
                        dotColor = "bg-rose-400";
                        statusTitle = "Jawaban Salah";
                      }
                    } else if (isAnswered) {
                      boxBorderCls = "border-amber-500/60 bg-amber-500/15 text-amber-600 dark:text-amber-400 font-bold";
                      dotColor = "bg-amber-400";
                      statusTitle = "Menunggu Validasi";
                    }

                    return (
                      <button
                        key={q.question_id}
                        type="button"
                        onClick={() => handleSelectQuestion(idx)}
                        className={`relative flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border font-mono-ui text-xs transition-all cursor-pointer shadow-sm ${boxBorderCls} ${
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

                <div className="pt-2 border-t border-outline-variant/30 space-y-1 text-[11px] text-on-surface-variant font-medium">
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
                <span className="text-xs font-bold uppercase tracking-wider text-on-surface-variant block">
                  Nilai Akhir:
                </span>
                <span className="font-mono-ui text-3xl font-black text-on-surface mt-1.5 block">
                  {fmtPct(group.overall_score ?? 0)}
                </span>
              </div>
            </aside>
          </div>
        </div>
      ) : null}
    </PageContainer>
  );
}