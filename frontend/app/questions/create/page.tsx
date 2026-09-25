"use client";

import { useEffect, useState } from "react";
import QuestionForm, { ExamQuestion } from "../../components/QuestionForm";

export default function CreateQuestionPage() {
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
          setImportedData(parsed);
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

  return <QuestionForm isEditing={false} initialData={importedData ?? undefined} />;
}