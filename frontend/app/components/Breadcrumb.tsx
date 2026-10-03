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
  "/pengumpulan": "/code#pengumpulan",
  "/sets": "/code",
  "/questions/subject": "/questions",
};

type Crumb = { label: string; href?: string };

function questionLeafLabel(path: string): string {
  if (/^\/questions\/[^/]+\/students\/[^/]+$/.test(path)) return "Review Mahasiswa";
  if (/^\/questions\/[^/]+\/view$/.test(path)) return "Pratinjau Bank Soal";
  if (/^\/questions\/[^/]+\/edit$/.test(path)) return "Edit Bank Soal";
  if (/^\/questions\/create$/.test(path)) return "Buat Bank Soal";
  return "Detail";
}

function buildCrumbs(pathname: string, subjectId: string | null): Crumb[] {
  const parts = pathname.split("/").filter(Boolean);
  if (!parts.length) return [];

  // The lecturer "Mata Kuliah" section lives under /questions, but the current
  // subject page is /admin/subjects/[id]. Link the crumb back there (or to the
  // Kelola Mata Kuliah list) instead of the legacy /questions listing.
  if (parts[0] === "questions") {
    const subjectHref = subjectId ? `/admin/subjects/${subjectId}` : "/admin/subjects";
    const crumbs: Crumb[] = [{ label: "Mata Kuliah", href: subjectHref }];
    if (parts.length > 1) {
      crumbs.push({ label: questionLeafLabel(`/${parts.join("/")}`) });
    }
    return crumbs;
  }

  return parts.map((part, index) => {
    const path = `/${parts.slice(0, index + 1).join("/")}`;
    const last = index === parts.length - 1;
    const label =
      path === "/exam-packages/create"
        ? "Buat Paket Ujian"
        : labels[part] ?? (last ? "Detail" : part);
    const targetHref =
      path === "/exam-packages" && subjectId
        ? `/admin/subjects/${subjectId}`
        : PATH_TARGETS[path] ?? path;
    const clickable = !last && path !== "/admin";
    return { label, href: clickable ? targetHref : undefined };
  });
}

export default function Breadcrumb() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const subjectId = searchParams.get("subject_id");
  const crumbs = buildCrumbs(pathname, subjectId);
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
