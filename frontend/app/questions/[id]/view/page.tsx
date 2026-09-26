"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import QuestionForm, { ExamQuestion } from "../../../components/QuestionForm";

export default function ViewQuestionPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params?.id;

  const [loading, setLoading] = useState(true);
  const [initialData, setInitialData] = useState<{
    code: string;
    title: string;
    description: string;
    subject_id: string;
    topic_id?: string;
    topic_name?: string;
    questions: ExamQuestion[];
    is_published?: boolean;
  } | null>(null);

  useEffect(() => {
    if (!id) return;
    const token = localStorage.getItem("token") ?? sessionStorage.getItem("token");
    if (!token) {
      router.replace("/login");
      return;
    }

    fetch(`/api/questions/${id}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((res) => {
        if (!res.ok) throw new Error("Gagal mengambil data soal.");
        return res.json();
      })
      .then((data) => {
        const questionsList: ExamQuestion[] = (data.questions ?? []).map(
          (q: {
            versions?: {
              prompt?: string;
              model_answer?: string;
              indicators?: { label: string; description?: string; weight: string | number }[];
            }[];
          }) => {
            const v = q.versions?.[0];
            return {
              prompt: v?.prompt ?? "",
              model_answer: v?.model_answer ?? "",
              indicators: (v?.indicators ?? []).map((ind) => ({
                label: ind.label,
                description: ind.description ?? "",
                weight: Math.round(Number(ind.weight) * 100),
                isCustom: !["Akurasi", "Penjelasan", "Kelengkapan"].includes(ind.label),
              })),
            };
          }
        );

        const isPublished = data.questions?.some(
          (q: { versions?: { is_published?: boolean }[] }) =>
            q.versions?.some((v) => v.is_published)
        );

        setInitialData({
          code: data.code ?? "",
          title: data.title ?? "",
          description: data.description ?? "",
          subject_id: data.subject_id ?? "",
          topic_id: data.topic_id ?? "",
          topic_name: data.topic_name ?? "",
          questions: questionsList,
          is_published: isPublished,
        });
      })
      .catch(() => {
        router.replace("/questions");
      })
      .finally(() => {
        setLoading(false);
      });
  }, [id, router]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center font-body">
        <p className="text-sm text-on-surface-variant">Memuat data paket soal...</p>
      </div>
    );
  }

  return <QuestionForm isEditing={true} isReadOnly={true} setId={id} initialData={initialData ?? undefined} />;
}