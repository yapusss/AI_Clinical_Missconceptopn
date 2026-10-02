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
  questions: "Mata Kuliah",
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

type Crumb = { label: string; href?: string };

function buildCrumbs(pathname: string): Crumb[] {
  const parts = pathname.split("/").filter(Boolean);
  if (!parts.length) return [];

  // The lecturer "Mata Kuliah" section lives under /questions. Mirror the admin
  // trail (Administrasi > Mata Kuliah > ...) and hide raw route segments.
  if (parts[0] === "questions") {
    const crumbs: Crumb[] = [
      { label: "Administrasi", href: "/questions" },
      { label: "Mata Kuliah", href: "/questions" },
    ];
    if (parts.length > 1) crumbs.push({ label: "Detail" });
    return crumbs;
  }

  return parts.map((part, index) => {
    const path = `/${parts.slice(0, index + 1).join("/")}`;
    const last = index === parts.length - 1;
    return {
      label: labels[part] ?? (last ? "Detail" : part),
      href: last ? undefined : (PATH_TARGETS[path] ?? path),
    };
  });
}

export default function Breadcrumb() {
  const pathname = usePathname();
  const crumbs = buildCrumbs(pathname);
  if (!crumbs.length) return null;

  return (
    <nav
      aria-label="Breadcrumb"
      className="mb-5 flex flex-wrap items-center gap-1.5 text-xs text-on-surface-variant"
    >
      <Link href="/dashboard" aria-label="Dashboard" className="inline-flex items-center text-primary">
        <Home size={14} />
      </Link>
      {crumbs.map((crumb, index) => {
        const last = index === crumbs.length - 1;
        return (
          <span key={`${crumb.label}-${index}`} className="flex items-center gap-1.5">
            <ChevronRight size={14} aria-hidden="true" />
            {last || !crumb.href ? (
              <span className="font-semibold text-on-surface">{crumb.label}</span>
            ) : (
              <Link href={crumb.href} className="text-primary hover:underline">
                {crumb.label}
              </Link>
            )}
          </span>
        );
      })}
    </nav>
  );
}
