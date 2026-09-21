"use client";
import { useAuth } from "../../components/AuthProvider";
import AdminUserManagement from "../../components/AdminUserManagement";
export default function AdminLecturersPage() { const { user, token, loading } = useAuth(); if (loading || !user || !token) return null; return <AdminUserManagement role="lecturers" title="Kelola Akun Dosen" description="Buat, ubah, dan nonaktifkan akun dosen serta atur mata kuliahnya." token={token} />; }