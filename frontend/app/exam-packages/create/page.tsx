"use client";

import { useSearchParams } from "next/navigation";
import ExamPackageForm from "../ExamPackageForm";

export default function CreateExamPackagePage() {
  const subjectId = useSearchParams().get("subject_id") ?? "";
  return <ExamPackageForm subjectId={subjectId} />;
}
