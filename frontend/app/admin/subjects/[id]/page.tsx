"use client";

import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { useAuth } from "../../../components/AuthProvider";
import SubjectDetailManagement from "../../../components/SubjectDetailManagement";

export default function AdminSubjectDetailPage() {
  const { user, token, loading } = useAuth();
  const params = useParams<{ id: string }>();
  const [lecturerView, setLecturerView] = useState(false);
  useEffect(() => {
    const selectedRole = window.localStorage.getItem("selected_role");
    setLecturerView(selectedRole === "LECTURER" || (!user?.is_superuser && user?.roles?.some((role) => role.role === "LECTURER") === true));
  }, [user]);
  if (loading || !user || !token || !params.id) return null;
  return <SubjectDetailManagement token={token} subjectId={params.id} lecturerView={lecturerView} />;
}
