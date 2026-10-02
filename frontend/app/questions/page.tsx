"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BookOpen, MoreVertical, TriangleAlert } from "lucide-react";
import { useAuth } from "../components/AuthProvider";
import PageContainer from "../components/PageContainer";
import PageHeader from "../components/PageHeader";

type SubjectOption = {
  id: string;
  slug: string;
  name: string;
};

type QuestionSet = {
  id: string;
  subject_id: string;
  subject_name: string;
};

const COURSE_BANNERS = [
  "repeating-linear-gradient(90deg, rgba(255,255,255,0.10) 0 2px, transparent 2px 44px), repeating-linear-gradient(0deg, rgba(255,255,255,0.10) 0 2px, transparent 2px 44px), linear-gradient(135deg, #2563eb 0%, #1e3a8a 100%)",
  "radial-gradient(circle at 22% 32%, rgba(255,255,255,0.18) 0 12%, transparent 13%), radial-gradient(circle at 72% 64%, rgba(255,255,255,0.14) 0 16%, transparent 17%), linear-gradient(135deg, #1d4ed8, #0ea5e9)",
  "repeating-radial-gradient(circle at 50% 130%, rgba(255,255,255,0.12) 0 18px, transparent 18px 36px), linear-gradient(135deg, #1e40af, #3b82f6)",
  "conic-gradient(from 45deg at 50% 50%, rgba(255,255,255,0.12) 0 25%, transparent 0 50%, rgba(255,255,255,0.12) 0 75%, transparent 0), linear-gradient(135deg, #1e3a8a, #2563eb)",
  "repeating-linear-gradient(45deg, rgba(255,255,255,0.08) 0 14px, transparent 14px 28px), linear-gradient(135deg, #0284c7, #1e40af)",
  "radial-gradient(circle at 80% 20%, rgba(255,255,255,0.20) 0 10%, transparent 11%), linear-gradient(135deg, #1e40af, #0ea5e9)",
];

function derivedSubjects(sets: QuestionSet[]): SubjectOption[] {
  const seen = new Map<string, SubjectOption>();
  sets.forEach((item) => {
    if (item.subject_id && !seen.has(item.subject_id)) {
      seen.set(item.subject_id, { id: item.subject_id, slug: item.subject_id, name: item.subject_name });
    }
  });
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export default function QuestionsPage() {
  const { user, token, loading } = useAuth();
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [courses, setCourses] = useState<SubjectOption[]>([]);
  const [sets, setSets] = useState<QuestionSet[]>([]);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleOutsideClick = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) setOpenMenuId(null);
    };
    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, []);

  const load = useCallback(async () => {
    if (!token) return;
    const headers = { Authorization: `Bearer ${token}` };
    const [questionsResponse, summaryResponse] = await Promise.all([
      fetch("/api/questions", { headers }),
      fetch("/api/dashboard/summary", { headers }),
    ]);

    const nextSets: QuestionSet[] = questionsResponse.ok ? await questionsResponse.json() : [];
    if (questionsResponse.ok) setSets(nextSets);

    if (summaryResponse.ok) {
      const summary = await summaryResponse.json();
      const nextSubjects: SubjectOption[] = summary.my_subjects ?? [];
      setCourses(nextSubjects.length ? nextSubjects : derivedSubjects(nextSets));
    } else {
      setCourses(derivedSubjects(nextSets));
    }
  }, [token]);

  useEffect(() => {
    setMounted(true);
    if (loading) return;
    if (!user || !token) {
      router.replace("/login");
      return;
    }
    void load().catch(() => setError("Gagal memuat mata kuliah."));
  }, [loading, user, token, router, load]);

  if (!mounted || loading) return null;
  if (!user) return null;

  return (
    <PageContainer>
      <PageHeader
        title="Mata Kuliah"
        description="Pilih mata kuliah untuk mengelola paket soal, memantau pengumpulan, dan memverifikasi diagnosis miskonsepsi."
        icon={BookOpen}
      />

      {error && (
        <div role="alert" className="mt-5 flex gap-2 rounded-lg border border-error/40 bg-error-container p-4 text-sm text-on-error-container">
          <TriangleAlert size={18} />
          {error}
        </div>
      )}

      {courses.length === 0 ? (
        <div className="glass-panel mt-8 rounded-xl border border-outline-variant/40 p-8 text-center text-sm text-on-surface-variant">
          Belum ada mata kuliah yang dapat Anda kelola.
        </div>
      ) : (
        <div ref={menuRef} className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {courses.map((course, index) => {
            const count = sets.filter((item) => item.subject_id === course.id).length;
            const menuOpen = openMenuId === course.id;
            return (
              <article
                key={course.id}
                className="group relative overflow-hidden rounded-xl border border-outline-variant/40 bg-surface-container-lowest shadow-sm transition-colors hover:border-primary/50"
              >
                <Link href={`/questions/subject/${course.id}`} className="block no-underline">
                  <div className="h-24 w-full" style={{ backgroundImage: COURSE_BANNERS[index % COURSE_BANNERS.length] }} aria-hidden="true" />
                  <div className="p-4">
                    <h2 className="font-semibold leading-snug text-on-surface transition-colors group-hover:text-primary">
                      {course.name}
                    </h2>
                    <p className="mt-1 text-xs text-on-surface-variant">{count} paket soal</p>
                  </div>
                </Link>

                <button
                  type="button"
                  onClick={() => setOpenMenuId(menuOpen ? null : course.id)}
                  className="absolute right-2 top-[104px] inline-flex size-8 cursor-pointer items-center justify-center rounded-lg border border-outline-variant/40 bg-surface-container-lowest text-on-surface-variant hover:border-primary hover:text-primary"
                  title="Opsi mata kuliah"
                  aria-label={`Opsi ${course.name}`}
                  aria-haspopup="menu"
                  aria-expanded={menuOpen}
                >
                  <MoreVertical size={16} />
                </button>

                {menuOpen && (
                  <div role="menu" className="absolute right-2 top-[140px] z-30 w-44 overflow-hidden rounded-lg border border-outline-variant/50 bg-surface-container-lowest py-1 shadow-2xl">
                    <Link
                      href={`/questions/subject/${course.id}`}
                      role="menuitem"
                      className="block px-3 py-2 text-sm text-on-surface no-underline hover:bg-surface-container"
                    >
                      Kelola paket soal
                    </Link>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
    </PageContainer>
  );
}
