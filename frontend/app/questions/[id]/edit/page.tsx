"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import QuestionForm, { ExamQuestion } from "../../../components/QuestionForm";

export default function EditQuestionPage() {
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
            id?: string;
            versions?: {
              prompt?: string;
              short_answer?: string;
              model_answer?: string;
            }[];
          }) => {
            const v = q.versions?.[0];
            return {
              id: q.id,
              prompt: v?.prompt ?? "",
              short_answer: v?.short_answer ?? "",
              alasan: v?.model_answer ?? "",
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
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-sm text-on-surface-variant">Memuat data paket soal...</p>
      </div>
    );
  }

  return <QuestionForm isEditing={true} setId={id} initialData={initialData ?? undefined} />;
}