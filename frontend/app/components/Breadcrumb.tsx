"use client";

import Link from "next/link";
import { ChevronRight, Home } from "lucide-react";
import { usePathname, useSearchParams } from "next/navigation";

const labels: Record<string, string> = {
  admin: "Administrasi",
  subjects: "Mata Kuliah",
  lecturers: "Dosen",
  students: "Mahasiswa",
  dashboard: "Dashboard",
  questions: "Soal",
  submissions: "Jawaban Mahasiswa",
  validation: "Validasi",
  settings: "Settings",
  profile: "Profile",
  help: "Pusat Bantuan",
  code: "Soal",
  sets: "Paket Ujian",
  pengumpulan: "Soal",
};

// Segments that do not have standalone index pages and should redirect to their parent section
const PATH_TARGETS: Record<string, string> = {
  "/pengumpulan": "/code#pengumpulan",
  "/sets": "/code",
  "/questions/subject": "/questions",
};

export default function Breadcrumb() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const subjectId = searchParams.get("subject_id");
  const parts = pathname.split("/").filter(Boolean);
  if (!parts.length) return null;

  let path = "";
  return (
    <nav
      aria-label="Breadcrumb"
      className="mb-5 flex flex-wrap items-center gap-1.5 text-xs text-on-surface-variant"
    >
      <Link href="/dashboard" aria-label="Dashboard" className="inline-flex items-center text-primary">
        <Home size={14} />
      </Link>
      {parts.map((part, index) => {
        path += `/${part}`;
        const last = index === parts.length - 1;
        const label = path === "/exam-packages/create" ? "Buat Paket Ujian" : path.match(/^\/questions\/[^/]+\/students\/[^/]+$/) ? "Review Mahasiswa" : path.match(/^\/questions\/[^/]+\/view$/) ? "Pratinjau Paket" : path.match(/^\/questions\/[^/]+\/edit$/) ? "Edit Paket" : labels[part] ?? (last ? "Detail" : part);
        const targetHref = path === "/exam-packages" && subjectId ? `/admin/subjects/${subjectId}` : path.match(/^\/questions\/[^/]+\/students$/) ? path.replace(/\/students$/, "") : PATH_TARGETS[path] ?? path;
        const clickable = !last && path !== "/admin";

        return (
          <span key={path} className="flex items-center gap-1.5">
            <ChevronRight size={14} aria-hidden="true" />
            {!clickable ? (
              <span className="font-semibold text-on-surface">{label}</span>
            ) : (
              <Link href={targetHref} className="text-primary hover:underline">
                {label}
              </Link>
            )}
          </span>
        );
      })}
    </nav>
  );
}
