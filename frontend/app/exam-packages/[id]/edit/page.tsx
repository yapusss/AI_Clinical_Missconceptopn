"use client";

import { useParams, useSearchParams } from "next/navigation";
import ExamPackageForm from "../../ExamPackageForm";

export default function EditExamPackagePage() {
  const params = useParams<{ id: string }>();
  const subjectId = useSearchParams().get("subject_id") ?? "";
  return <ExamPackageForm subjectId={subjectId} packageId={params.id} />;
}
