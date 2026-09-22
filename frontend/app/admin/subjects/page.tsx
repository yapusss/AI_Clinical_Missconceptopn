"use client";

import { useAuth } from "../../components/AuthProvider";
import AdminSubjectManagement from "../../components/AdminSubjectManagement";

export default function AdminSubjectsPage() {
  const { user, token, loading } = useAuth();
  if (loading || !user || !token) return null;
  return <AdminSubjectManagement token={token} canManageCourses={user.is_superuser} />;
}
