"use client";

import Link from "next/link";
import { ChevronRight, Home } from "lucide-react";
import { usePathname } from "next/navigation";

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
  "/pengumpulan": "/code",
  "/sets": "/code",
};

export default function Breadcrumb() {
  const pathname = usePathname();
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
        const label = labels[part] ?? (last ? "Detail" : part);
        const targetHref = PATH_TARGETS[path] ?? path;

        return (
          <span key={path} className="flex items-center gap-1.5">
            <ChevronRight size={14} aria-hidden="true" />
            {last ? (
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