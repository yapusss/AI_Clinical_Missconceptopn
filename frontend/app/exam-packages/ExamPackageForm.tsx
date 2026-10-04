"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  ChevronRight,
  ClipboardList,
  Save,
  TriangleAlert,
} from "lucide-react";
import { useAuth } from "../components/AuthProvider";
import PageContainer from "../components/PageContainer";
import PageHeader from "../components/PageHeader";

type BankSet = {
  id: string;
  title: string;
  topic_id?: string | null;
  topic_name?: string | null;
  latest_versions: {
    question_id: string;
    prompt_preview: string;
    is_published: boolean;
  }[];
};
type ExistingPackage = {
  id: string;
  code: string;
  title: string;
  question_ids: string[];
  opens_at: string | null;
  closes_at: string | null;
  duration_minutes: number | null;
  max_attempts: number | null;
  score_policy: "HIGHEST" | "AVERAGE" | "LAST_ATTEMPT";
  is_active: boolean;
};

const generatedCode = () =>
  `PKG-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}-${crypto.randomUUID().slice(0, 4).toUpperCase()}`;
const localDateTime = (value: string | null) =>
  value ? new Date(value).toISOString().slice(0, 16) : "";
const isoOrNull = (value: string) =>
  value ? new Date(value).toISOString() : null;
const errorMessage = (data: Record<string, unknown>) =>
  data.detail ||
  Object.values(data).flat().join(" ") ||
  "Permintaan gagal diproses.";

export default function ExamPackageForm({
  subjectId,
  packageId,
}: {
  subjectId: string;
  packageId?: string;
}) {
  const { token, loading } = useAuth();
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [bankSets, setBankSets] = useState<BankSet[]>([]);
  const [code, setCode] = useState("");
  const [title, setTitle] = useState("");
  const [opensAt, setOpensAt] = useState("");
  const [closesAt, setClosesAt] = useState("");
  const [durationHours, setDurationHours] = useState("");
  const [maxAttempts, setMaxAttempts] = useState("");
  const [scorePolicy, setScorePolicy] = useState<ExistingPackage["score_policy"]>("LAST_ATTEMPT");
  const [password, setPassword] = useState("");
  const [questionIds, setQuestionIds] = useState<string[]>([]);
  const [collapsedTopics, setCollapsedTopics] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!packageId) setCode(generatedCode());
  }, [packageId]);
  useEffect(() => {
    if (!token || !subjectId) return;
    void Promise.all([
      fetch(`/api/questions?subject_id=${subjectId}`, {
        headers: { Authorization: `Bearer ${token}` },
      }),
      packageId
        ? fetch(`/api/exam-packages/${packageId}`, {
            headers: { Authorization: `Bearer ${token}` },
          })
        : Promise.resolve(null),
    ])
      .then(async ([questions, current]) => {
        if (!questions.ok) throw new Error("Gagal memuat bank soal.");
        setBankSets(await questions.json());
        if (current) {
          if (!current.ok)
            throw new Error(String(errorMessage(await current.json())));
          const item: ExistingPackage = await current.json();
          setCode(item.code);
          setTitle(item.title);
          setQuestionIds(item.question_ids);
          setOpensAt(localDateTime(item.opens_at));
          setClosesAt(localDateTime(item.closes_at));
          setDurationHours(
            item.duration_minutes
              ? (item.duration_minutes / 60).toString()
              : "",
          );
          setMaxAttempts(item.max_attempts?.toString() ?? "");
          setScorePolicy(item.score_policy);
        }
      })
      .catch((caught) =>
        setError(
          caught instanceof Error ? caught.message : "Gagal memuat paket.",
        ),
      );
  }, [packageId, subjectId, token]);

  const questions = bankSets.flatMap((set) =>
    set.latest_versions
      .filter((version) => version.is_published)
      .map((version) => ({
        ...version,
        setTitle: set.title,
        topicId: set.topic_id ?? "untopicked",
        topicName: set.topic_name ?? "Tanpa Topik",
      })),
  );
  const groups = questions.reduce<
    { topicId: string; topicName: string; questions: typeof questions }[]
  >((all, question) => {
    const group = all.find((item) => item.topicId === question.topicId);
    if (group) group.questions.push(question);
    else
      all.push({
        topicId: question.topicId,
        topicName: question.topicName,
        questions: [question],
      });
    return all;
  }, []);
  const toggleQuestion = (id: string) =>
    setQuestionIds((selected) =>
      selected.includes(id)
        ? selected.filter((value) => value !== id)
        : [...selected, id],
    );
  const validStepOne =
    code.trim().length >= 3 &&
    title.trim() &&
    (!opensAt || !closesAt || new Date(opensAt) < new Date(closesAt)) &&
    (!durationHours || Number(durationHours) > 0) &&
    (!maxAttempts || Number(maxAttempts) > 0);

  const save = async (isActive: boolean) => {
    if (!token || !validStepOne || (isActive && !questionIds.length)) return;
    setBusy(true);
    setError("");
    const payload: Record<string, unknown> = {
      subject_id: subjectId,
      code,
      title,
      question_ids: questionIds,
      is_active: isActive,
      opens_at: isoOrNull(opensAt),
      closes_at: isoOrNull(closesAt),
      duration_minutes: durationHours ? Number(durationHours) * 60 : null,
      max_attempts: maxAttempts ? Number(maxAttempts) : null,
      score_policy: scorePolicy,
    };
    if (password) payload.password = password;
    try {
      const response = await fetch(
        packageId ? `/api/exam-packages/${packageId}` : "/api/exam-packages",
        {
          method: packageId ? "PATCH" : "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(payload),
        },
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(String(errorMessage(data)));
      router.replace(`/admin/subjects/${subjectId}`);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Gagal menyimpan paket.",
      );
    } finally {
      setBusy(false);
    }
  };

  if (loading) return null;
  return (
    <PageContainer>
      <button
        type="button"
        onClick={() => router.push(`/admin/subjects/${subjectId}`)}
        className="inline-flex items-center gap-2 text-sm font-semibold text-primary"
      >
        <ArrowLeft size={16} /> Kembali ke mata kuliah
      </button>
      <PageHeader
        className="mt-5"
        title={packageId ? "Edit Paket Ujian" : "Buat Paket Ujian"}
        description="Susun pengaturan, pilih soal terbit, lalu tinjau sebelum menyimpan."
        icon={ClipboardList}
      />
      {error && (
        <div
          role="alert"
          className="mt-5 flex gap-2 rounded-lg border border-error/40 bg-error-container p-4 text-sm text-on-error-container"
        >
          <TriangleAlert size={18} />
          {error}
        </div>
      )}
      <div className="mt-6 rounded-xl border border-outline-variant/40 bg-surface-container-lowest p-5">
        {step === 1 && (
          <div className="space-y-5">
            <section className="glass-card rounded-xl border border-outline-variant/40 p-4 transition-colors hover:border-primary/40 sm:p-5">
              <h2 className="font-display text-lg font-bold">Informasi Paket</h2>
              <p className="mt-1 text-sm text-on-surface-variant">
                Gunakan kode dan judul yang mudah dikenali peserta.
              </p>
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <div>
                  <label
                    htmlFor="package-code"
                    className="mb-1.5 block text-sm font-medium"
                  >
                    Kode paket
                  </label>
                  <input
                    id="package-code"
                    value={code}
                    onChange={(event) =>
                      setCode(event.target.value.toUpperCase())
                    }
                    required
                    className="form-input"
                  />
                </div>
                <div>
                  <label
                    htmlFor="package-title"
                    className="mb-1.5 block text-sm font-medium"
                  >
                    Judul paket
                  </label>
                  <input
                    id="package-title"
                    value={title}
                    onChange={(event) => setTitle(event.target.value)}
                    required
                    className="form-input"
                  />
                </div>
              </div>
            </section>
            <section className="glass-card rounded-xl border border-outline-variant/40 p-4 transition-colors hover:border-primary/40 sm:p-5">
              <h2 className="font-display text-lg font-bold">Jadwal Ujian</h2>
              <p className="mt-1 text-sm text-on-surface-variant">
                Kosongkan jadwal atau durasi untuk membiarkan ujian tanpa batas tersebut.
              </p>
              <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                <div>
                  <label
                    htmlFor="opens-at"
                    className="mb-1.5 block text-sm font-medium"
                  >
                    Waktu buka
                  </label>
                  <input
                    id="opens-at"
                    type="datetime-local"
                    value={opensAt}
                    onChange={(event) => setOpensAt(event.target.value)}
                    className="form-input"
                  />
                </div>
                <div>
                  <label
                    htmlFor="closes-at"
                    className="mb-1.5 block text-sm font-medium"
                  >
                    Waktu tutup
                  </label>
                  <input
                    id="closes-at"
                    type="datetime-local"
                    value={closesAt}
                    onChange={(event) => setClosesAt(event.target.value)}
                    className="form-input"
                  />
                </div>
                <div>
                  <label
                    htmlFor="duration-hours"
                    className="mb-1.5 block text-sm font-medium"
                  >
                    Batas durasi (jam)
                  </label>
                  <input
                    id="duration-hours"
                    type="number"
                    min="0.5"
                    step="0.5"
                    value={durationHours}
                    onChange={(event) => setDurationHours(event.target.value)}
                    className="form-input"
                  />
                </div>
              </div>
              {opensAt && closesAt && new Date(opensAt) >= new Date(closesAt) && (
                <p className="mt-3 text-sm text-error">
                  Waktu tutup harus setelah waktu buka.
                </p>
              )}
            </section>
            <section className="glass-card rounded-xl border border-outline-variant/40 p-4 transition-colors hover:border-primary/40 sm:p-5">
              <h2 className="font-display text-lg font-bold">Akses Ujian</h2>
              <p className="mt-1 text-sm text-on-surface-variant">
                Atur batas percobaan dan password bila akses perlu dibatasi.
              </p>
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <div>
                  <label
                    htmlFor="max-attempts"
                    className="mb-1.5 block text-sm font-medium"
                  >
                    Maksimal percobaan
                  </label>
                  <input
                    id="max-attempts"
                    type="number"
                    min="1"
                    value={maxAttempts}
                    onChange={(event) => setMaxAttempts(event.target.value)}
                    className="form-input"
                  />
                </div>
                {Number(maxAttempts) > 1 && (
                  <div>
                    <label
                      htmlFor="score-policy"
                      className="mb-1.5 block text-sm font-medium"
                    >
                      Nilai yang diambil
                    </label>
                    <select
                      id="score-policy"
                      value={scorePolicy}
                      onChange={(event) =>
                        setScorePolicy(
                          event.target.value as ExistingPackage["score_policy"],
                        )
                      }
                      className="form-input"
                    >
                      <option value="HIGHEST">Nilai tertinggi</option>
                      <option value="AVERAGE">Nilai rata-rata</option>
                      <option value="LAST_ATTEMPT">Nilai percobaan terakhir</option>
                    </select>
                  </div>
                )}
                <div>
                  <label
                    htmlFor="package-password"
                    className="mb-1.5 block text-sm font-medium"
                  >
                    Password akses (opsional)
                  </label>
                  <input
                    id="package-password"
                    type="password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    placeholder={
                      packageId
                        ? "Kosongkan untuk mempertahankan password"
                        : "Tidak wajib"
                    }
                    className="form-input"
                  />
                </div>
              </div>
            </section>
          </div>
        )}
        {step === 2 && (
          <div>
            <div className="flex items-end justify-between">
              <div>
                <h2 className="font-display text-lg font-bold">
                  Pilih Soal Bank
                </h2>
                <p className="text-sm text-on-surface-variant">
                  Hanya soal yang telah diterbitkan.
                </p>
              </div>
              <span className="badge badge-active">
                {questionIds.length} dipilih
              </span>
            </div>
            <div className="mt-4 space-y-4">
              {groups.map((group) => {
                const collapsed = collapsedTopics.includes(group.topicId);
                return (
                  <section
                    key={group.topicId}
                    className="overflow-hidden rounded-xl border border-outline-variant/40"
                  >
                    <button
                      type="button"
                      onClick={() =>
                        setCollapsedTopics((topics) =>
                          collapsed
                            ? topics.filter((id) => id !== group.topicId)
                            : [...topics, group.topicId],
                        )
                      }
                      className="flex w-full justify-between bg-primary/10 px-4 py-3 text-left"
                    >
                      <span>
                        <b className="text-primary">Topik: {group.topicName}</b>
                        <span className="ml-2 text-xs">
                          {group.questions.length} soal
                        </span>
                      </span>
                      <ChevronRight
                        size={18}
                        className={collapsed ? "" : "rotate-90"}
                      />
                    </button>
                    {!collapsed && (
                      <div className="divide-y divide-outline-variant/30">
                        {group.questions.map((question) => (
                          <label
                            key={question.question_id}
                            className="flex cursor-pointer gap-3 p-4 hover:bg-surface-container"
                          >
                            <input
                              type="checkbox"
                              checked={questionIds.includes(
                                question.question_id,
                              )}
                              onChange={() =>
                                toggleQuestion(question.question_id)
                              }
                              className="mt-1 size-4 accent-primary"
                            />
                            <span>
                              <span className="block text-xs font-semibold text-primary">
                                {question.setTitle}
                              </span>
                              <span className="text-sm">
                                {question.prompt_preview}
                              </span>
                            </span>
                          </label>
                        ))}
                      </div>
                    )}
                  </section>
                );
              })}
            </div>
          </div>
        )}
        {step === 3 && (
          <div>
            <h2 className="font-display text-lg font-bold">Pratinjau Paket</h2>
            <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-on-surface-variant">Kode</dt>
                <dd className="font-mono-ui font-bold">{code}</dd>
              </div>
              <div>
                <dt className="text-on-surface-variant">Judul</dt>
                <dd className="font-semibold">{title}</dd>
              </div>
              <div>
                <dt className="text-on-surface-variant">Jadwal</dt>
                <dd>
                  {opensAt || "Kapan saja"} {closesAt && `sampai ${closesAt}`}
                </dd>
              </div>
              <div>
                <dt className="text-on-surface-variant">Aturan</dt>
                <dd>
                  {durationHours
                    ? `${durationHours} jam`
                    : "Tanpa batas durasi"}
                  ;{" "}
                  {maxAttempts
                    ? `${maxAttempts} percobaan`
                    : "tanpa batas percobaan"}
                </dd>
              </div>
            </dl>
            <ol className="mt-5 list-decimal space-y-3 pl-5">
              {questionIds.map((id) => (
                <li key={id}>
                  {questions.find((question) => question.question_id === id)
                    ?.prompt_preview || "Soal terpilih"}
                </li>
              ))}
            </ol>
            {!questionIds.length && (
              <p className="mt-4 text-sm text-error">
                Paket aktif memerlukan minimal satu soal.
              </p>
            )}
          </div>
        )}
      </div>
      <div className="mt-6 flex flex-wrap justify-between gap-3">
        <button
          type="button"
          onClick={() =>
            step === 1
              ? router.push(`/admin/subjects/${subjectId}`)
              : setStep(step - 1)
          }
          className="btn-secondary"
        >
          {step === 1 ? "Batal" : "Kembali"}
        </button>
        {step < 3 ? (
          <button
            type="button"
            onClick={() => {
              if (!validStepOne) {
                setError("Lengkapi pengaturan paket dengan benar.");
                return;
              }
              setError("");
              setStep(step + 1);
            }}
            className="btn-primary"
          >
            Lanjut <ChevronRight size={17} />
          </button>
        ) : (
          <div className="flex gap-3">
            <button
              type="button"
              disabled={busy}
              onClick={() => void save(false)}
              className="btn-secondary"
            >
              <Save size={17} /> Simpan Draft
            </button>
            <button
              type="button"
              disabled={busy || !questionIds.length}
              onClick={() => void save(true)}
              className="btn-primary"
            >
              <Save size={17} /> {busy ? "Menyimpan..." : "Aktifkan"}
            </button>
          </div>
        )}
      </div>
    </PageContainer>
  );
}
