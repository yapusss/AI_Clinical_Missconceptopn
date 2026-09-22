"use client";

import { useParams } from "next/navigation";
import { useAuth } from "../../../components/AuthProvider";
import SubjectDetailManagement from "../../../components/SubjectDetailManagement";

export default function AdminSubjectDetailPage() {
  const { user, token, loading } = useAuth();
  const params = useParams<{ id: string }>();
  if (loading || !user || !token || !params.id) return null;
  return <SubjectDetailManagement token={token} subjectId={params.id} />;
}
