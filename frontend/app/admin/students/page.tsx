"use client";
import { useAuth } from "../../components/AuthProvider";
import AdminUserManagement from "../../components/AdminUserManagement";
export default function AdminStudentsPage() { const { user, token, loading } = useAuth(); if (loading || !user || !token) return null; return <AdminUserManagement role="students" title="Kelola Akun Mahasiswa" description="Buat, ubah, dan nonaktifkan akun mahasiswa." token={token} />; }
