"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import QuestionForm, { ExamQuestion } from "../../components/QuestionForm";

export default function CreateQuestionPage() {
  const searchParams = useSearchParams();
  const [ready, setReady] = useState(false);
  const [importedData, setImportedData] = useState<{
    code: string;
    title: string;
    description: string;
    subject_id: string;
    topic_id?: string;
    topic_name?: string;
    questions: ExamQuestion[];
  } | null>(null);

  useEffect(() => {
    const stored = sessionStorage.getItem("imported_package");
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        if (parsed && parsed.questions && parsed.questions.length > 0) {
          setImportedData({
            ...parsed,
            questions: parsed.questions.map(
              (q: { prompt?: string; short_answer?: string; alasan?: string; model_answer?: string }) => ({
                prompt: q.prompt ?? "",
                short_answer: q.short_answer ?? q.model_answer ?? "",
                alasan: q.alasan ?? q.model_answer ?? "",
              })
            ),
          });
        }
      } catch {}
    }
    setReady(true);
  }, []);

  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center font-body">
        <p className="text-sm text-on-surface-variant">Menyiapkan lembar soal...</p>
      </div>
    );
  }

  const topicId = searchParams.get("topic_id") ?? undefined;
  const subjectId = searchParams.get("subject_id") ?? undefined;
  const topicPrefill = subjectId ? { code: "", title: "", description: "", subject_id: subjectId, topic_id: topicId, questions: [] } : undefined;
  return <QuestionForm isEditing={false} initialData={importedData ?? topicPrefill} />;
}
