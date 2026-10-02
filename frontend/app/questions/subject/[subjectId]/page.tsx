"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useAuth } from "../../../components/AuthProvider";
import SubjectDetailManagement from "../../../components/SubjectDetailManagement";

export default function QuestionSetSubjectPage() {
  const { user, token, loading } = useAuth();
  const router = useRouter();
  const params = useParams<{ subjectId: string }>();
  const subjectId = params?.subjectId ?? "";
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    if (loading) return;
    if (!user || !token) {
      router.replace("/login");
    }
  }, [loading, user, token, router]);

  if (!mounted || loading || !user || !token || !subjectId) return null;

  return (
    <SubjectDetailManagement
      token={token}
      subjectId={subjectId}
      lecturerView
      backHref="/questions"
      backLabel="Kembali ke daftar mata kuliah"
    />
  );
}
