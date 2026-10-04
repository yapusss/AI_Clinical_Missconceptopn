"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ChevronRight, Home } from "lucide-react";
import { usePathname, useSearchParams } from "next/navigation";

type Crumb = { label: string; href?: string };

const subjectIndex: Crumb = { label: "Kelola Mata Kuliah", href: "/admin/subjects" };
const questionIndex: Crumb = { label: "Bank Soal", href: "/questions" };

function subjectTrail(subjectId: string | null): Crumb[] {
  if (!subjectId) return [subjectIndex];
  return [subjectIndex, { label: "Detail Mata Kuliah", href: `/admin/subjects/${subjectId}` }];
}

function crumbsFor(pathname: string, subjectId: string | null): Crumb[] {
  if (["/", "/dashboard", "/login", "/select-role"].includes(pathname)) return [];

  if (pathname === "/admin/subjects") return [{ label: "Kelola Mata Kuliah" }];
  if (/^\/admin\/subjects\/[^/]+$/.test(pathname)) return [subjectIndex, { label: "Detail Mata Kuliah" }];
  if (pathname === "/admin/lecturers") return [{ label: "Administrasi", href: "/dashboard" }, { label: "Dosen" }];
  if (pathname === "/admin/students") return [{ label: "Administrasi", href: "/dashboard" }, { label: "Mahasiswa" }];
  if (pathname === "/admin/website") return [{ label: "Administrasi", href: "/dashboard" }, { label: "Website" }];

  const bankTrail = subjectId
    ? [...subjectTrail(subjectId), { label: "Bank Soal", href: `/admin/subjects/${subjectId}` }]
    : [questionIndex];
  const packageTrail = subjectId
    ? [...subjectTrail(subjectId), { label: "Paket Ujian", href: `/admin/subjects/${subjectId}` }]
    : [{ label: "Paket Ujian", href: "/admin/subjects" }];

  if (pathname === "/questions") return [{ label: "Bank Soal" }];
  if (pathname === "/questions/create") return [...bankTrail, { label: "Buat Bank Soal" }];
  if (/^\/questions\/subject\/[^/]+$/.test(pathname)) return [...subjectTrail(subjectId), { label: "Bank Soal" }];
  if (/^\/questions\/[^/]+\/students\/[^/]+$/.test(pathname)) return [...bankTrail, { label: "Progres Mahasiswa", href: "/questions" }, { label: "Review Mahasiswa" }];
  if (/^\/questions\/[^/]+\/edit$/.test(pathname)) return [...bankTrail, { label: "Edit Bank Soal" }];
  if (/^\/questions\/[^/]+\/view$/.test(pathname)) return [...bankTrail, { label: "Pratinjau Bank Soal" }];
  if (/^\/questions\/[^/]+$/.test(pathname)) return [...bankTrail, { label: "Progres Mahasiswa" }];

  if (pathname === "/exam-packages/create") return [...packageTrail, { label: "Buat Paket Ujian" }];
  if (/^\/exam-packages\/[^/]+\/students\/[^/]+$/.test(pathname)) return [...packageTrail, { label: "Progres Mahasiswa", href: "/admin/subjects" }, { label: "Review Mahasiswa" }];
  if (/^\/exam-packages\/[^/]+\/edit$/.test(pathname)) return [...packageTrail, { label: "Edit Paket Ujian" }];
  if (/^\/exam-packages\/[^/]+$/.test(pathname)) return [...packageTrail, { label: "Progres Mahasiswa" }];

  if (pathname === "/submissions") return [{ label: "Jawaban Mahasiswa" }];
  if (/^\/submissions\/[^/]+$/.test(pathname)) return [{ label: "Jawaban Mahasiswa", href: "/submissions" }, { label: "Detail Jawaban" }];
  if (pathname === "/validation") return [{ label: "Validasi" }];
  if (/^\/validation\/[^/]+$/.test(pathname)) return [{ label: "Validasi", href: "/validation" }, { label: "Detail Validasi" }];
  if (pathname === "/code") return [{ label: "Masukkan Kode Ujian" }];
  if (/^\/sets\/[^/]+$/.test(pathname)) return [{ label: "Mengerjakan Ujian" }];
  if (/^\/pengumpulan\/[^/]+$/.test(pathname)) return [{ label: "Pengumpulan" }, { label: "Detail Pengumpulan" }];
  if (pathname === "/help") return [{ label: "Pusat Bantuan" }];
  if (pathname === "/profile") return [{ label: "Profil" }];
  if (pathname === "/settings") return [{ label: "Pengaturan" }];
  return [];
}

function contextRequest(pathname: string): string | null {
  const question = pathname.match(/^\/questions\/([^/]+)(?:\/|$)/);
  if (question && !["create", "subject"].includes(question[1])) return `/api/questions/${question[1]}`;
  const examPackage = pathname.match(/^\/exam-packages\/([^/]+)(?:\/|$)/);
  if (examPackage && examPackage[1] !== "create") return `/api/exam-packages/${examPackage[1]}`;
  return null;
}

export default function Breadcrumb() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const pathSubjectId = pathname.match(/^\/questions\/subject\/([^/]+)$/)?.[1] ?? null;
  const directSubjectId = searchParams.get("subject_id") ?? pathSubjectId;
  const [loadedSubjectId, setLoadedSubjectId] = useState<string | null>(null);

  useEffect(() => {
    if (directSubjectId) {
      setLoadedSubjectId(directSubjectId);
      return;
    }
    const endpoint = contextRequest(pathname);
    if (!endpoint) {
      setLoadedSubjectId(null);
      return;
    }
    const token = localStorage.getItem("token") ?? sessionStorage.getItem("token");
    if (!token) return;
    let cancelled = false;
    void fetch(endpoint, { headers: { Authorization: `Bearer ${token}` } })
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (!cancelled) setLoadedSubjectId(data?.subject_id ?? null);
      })
      .catch(() => {
        if (!cancelled) setLoadedSubjectId(null);
      });
    return () => {
      cancelled = true;
    };
  }, [pathname, directSubjectId]);

  const crumbs = crumbsFor(pathname, directSubjectId ?? loadedSubjectId);
  if (!crumbs.length) return null;

  return (
    <nav aria-label="Breadcrumb" className="mb-5 flex flex-wrap items-center gap-1.5 text-xs text-on-surface-variant">
      <Link href="/dashboard" aria-label="Dashboard" className="inline-flex items-center text-primary"><Home size={14} /></Link>
      {crumbs.map((crumb, index) => (
        <span key={`${crumb.label}-${index}`} className="flex items-center gap-1.5">
          <ChevronRight size={14} aria-hidden="true" />
          {index === crumbs.length - 1 || !crumb.href ? <span className="font-semibold text-on-surface">{crumb.label}</span> : <Link href={crumb.href} className="text-primary hover:underline">{crumb.label}</Link>}
        </span>
      ))}
    </nav>
  );
}
