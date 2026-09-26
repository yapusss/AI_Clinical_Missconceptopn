"use client";

import { useAuth } from "../../components/AuthProvider";
import AdminWebsiteManager from "../../components/AdminWebsiteManager";

export default function AdminWebsitePage() {
  const { user, token, loading } = useAuth();
  if (loading || !user || !token || !user.is_superuser) return null;
  return <AdminWebsiteManager token={token} />;
}
