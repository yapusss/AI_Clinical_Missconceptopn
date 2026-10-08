"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowDownWideNarrow,
  ArrowUpNarrowWide,
  Eye,
  Filter,
  Layers,
} from "lucide-react";

import { useAuth } from "./AuthProvider";
import AppSelect from "./AppSelect";
import ListToolbar, { type SortMenuOption } from "./ListToolbar";
import { apiFetch } from "../lib/api";
import FeedbackModal from "./FeedbackModal";
import {
  summarizeSetStatus,
  type StudentPackageGroup,
} from "../lib/studentSubmissions";

const errMsg = (err: unknown) =>
  err instanceof Error ? err.message : String(err);

const SORT_OPTIONS: SortMenuOption[] = [
  {
    value: "LATEST",
    label: "Terbaru (Aktivitas Terakhir)",
    direction: "desc",
  },
  {
    value: "OLDEST",
    label: "Terlama (Aktivitas Pertama)",
    direction: "asc",
  },
];

type Props = {
  compactHeading?: boolean;
};

export default function MySubmissions({ compactHeading = false }: Props) {
  const { user } = useAuth();
  const [groups, setGroups] = useState<StudentPackageGroup[]>([]);
  const [fetching, setFetching] = useState(true);
  const [error, setError] = useState("");

  // Filters & Sorting state
  const [search, setSearch] = useState("");
  const [subjectFilter, setSubjectFilter] = useState("ALL");
  const [sortOrder, setSortOrder] = useState<string>("LATEST");

  const load = useCallback(async () => {
    if (!user) return;
    try {
      const data = await apiFetch<StudentPackageGroup[]>(
        "/student/submission-packages",
      );
      setGroups(data);
      setError("");
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setFetching(false);
    }
  }, [user]);

  useEffect(() => {
    void load();
  }, [load]);

  // Derived Subjects list
  const subjects = useMemo(() => {
    const map = new Map<string, string>();
    groups.forEach((group) => {
      if (group.subject_id && group.subject_name) {
        map.set(group.subject_id, group.subject_name);
      }
    });
    return [...map.entries()].map(([id, name]) => ({ id, name }));
  }, [groups]);

  // Filter & Sort
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();

    // 1. Filter
    const filtered = groups.filter((group) => {
      if (subjectFilter !== "ALL" && group.subject_id !== subjectFilter) {
        return false;
      }
      if (q) {
        const textToMatch =
          `${group.code} ${group.title} ${group.subject_name}`.toLowerCase();
        if (!textToMatch.includes(q)) {
          return false;
        }
      }
      return true;
    });

    // 2. Sort
    return filtered.sort((a, b) => {
      const timeA = a.last_submitted_at
        ? new Date(a.last_submitted_at).getTime()
        : 0;
      const timeB = b.last_submitted_at
        ? new Date(b.last_submitted_at).getTime()
        : 0;

      if (sortOrder === "LATEST") {
        return timeB - timeA;
      } else {
        return timeA - timeB;
      }
    });
  }, [groups, search, subjectFilter, sortOrder]);

  return (
    <div>
      {!compactHeading && (
        <div className="flex items-center gap-2 mb-2">
          <h2 className="font-display text-sm font-bold text-on-surface">
            Pengumpulan Saya
          </h2>
        </div>
      )}

      {/* Toolbar with Search, Mata Kuliah Filter & Sort Menu Popover */}
      <div className={compactHeading ? "mt-1.5" : "mt-3"}>
        <ListToolbar
          searchValue={search}
          onSearchChange={setSearch}
          searchPlaceholder="Cari kode soal atau judul..."
          filters={
            <div className="flex items-center gap-2">
              <AppSelect
                value={subjectFilter}
                onValueChange={setSubjectFilter}
                ariaLabel="Filter Mata Kuliah"
                className="min-w-48"
                trailingIcon={<Filter size={14} />}
                options={[
                  { value: "ALL", label: "Semua Mata Kuliah" },
                  ...subjects.map((s) => ({ value: s.id, label: s.name })),
                ]}
              />
            </div>
          }
          sortOptions={SORT_OPTIONS}
          currentSort={sortOrder}
          onSortChange={setSortOrder}
        />
      </div>

      {/* Real-time Status Feedback Bar */}
      <div className="mt-2 flex items-center justify-between px-1 text-xs text-on-surface-variant">
        <span>
          Menampilkan{" "}
          <strong className="text-on-surface">{visible.length}</strong> dari{" "}
          {groups.length} paket soal
        </span>
        <span className="inline-flex items-center gap-1.5 text-[11px]">
          <span className="text-on-surface-variant/70">Urutan:</span>
          <span className="inline-flex items-center gap-1 font-semibold text-primary">
            {sortOrder === "LATEST" ? (
              <>
                <ArrowDownWideNarrow size={13} /> Terbaru
              </>
            ) : (
              <>
                <ArrowUpNarrowWide size={13} /> Terlama
              </>
            )}
          </span>
        </span>
      </div>

      {/* Submission list */}
      {fetching ? (
        <p className="mt-6 text-center text-xs text-on-surface-variant">
          Memuat riwayat pengumpulan...
        </p>
      ) : groups.length === 0 ? (
        <div className="glass-panel mt-2 rounded-xl border border-outline-variant/40 p-6 text-center text-xs text-on-surface-variant">
          Belum ada jawaban yang dikumpulkan. Masukkan kode soal di atas untuk
          memulai.
        </div>
      ) : (
        <div className="mt-2">
          {visible.length === 0 ? (
            <div className="glass-panel rounded-xl border border-outline-variant/40 px-4 py-8 text-center text-xs text-on-surface-variant">
              <p className="font-medium">
                Tidak ada pengumpulan yang cocok dengan kriteria.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {visible.map((group) => {
                const status = summarizeSetStatus(
                  group.status_summary,
                  group.status_counts,
                );
                const allAnswered =
                  group.answered_count === group.question_count &&
                  group.question_count > 0;

                return (
                  <article
                    key={group.package_id}
                    className="glass-card flex min-w-0 flex-col gap-3 rounded-xl p-3.5 transition-colors hover:border-primary/40 sm:flex-row sm:items-center sm:gap-4"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start gap-2">
                        <span className="mt-0.5 inline-block shrink-0 rounded border border-primary/20 bg-primary/10 px-2 py-0.5 font-mono-ui text-xs font-bold text-primary">
                          {group.code}
                        </span>
                        <h3 className="min-w-0 text-sm font-semibold leading-snug text-on-surface">
                          {group.title}
                        </h3>
                      </div>
                      <p className="mt-1 truncate text-[11px] text-on-surface-variant">
                        {group.subject_name}
                      </p>
                    </div>

                    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[11px] text-on-surface-variant">
                      <div className="flex items-center gap-1.5">
                        <Layers size={13} className="shrink-0 text-primary" />
                        <span
                          className={`text-xs font-semibold ${
                            allAnswered ? "text-emerald-400" : "text-amber-400"
                          }`}
                        >
                          {group.answered_count} / {group.question_count} Soal
                        </span>
                        <span>Percobaan ke-{group.max_attempt_no || 1}</span>
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span
                          className={`badge ${status.cls} whitespace-nowrap text-[11px]`}
                        >
                          {status.label}
                        </span>
                        {group.overall_score !== null &&
                          group.overall_score !== undefined && (
                            <span className="whitespace-nowrap rounded border border-primary/20 bg-primary/10 px-2 py-0.5 font-mono-ui text-[11px] font-extrabold text-primary">
                              Nilai: {group.overall_score.toFixed(0)}%
                            </span>
                          )}
                      </div>
                    </div>

                    <Link
                      href={`/pengumpulan/${group.package_id}`}
                      className="btn-secondary inline-flex h-8 shrink-0 items-center gap-1.5 self-end px-2.5 text-xs sm:self-auto"
                      aria-label={`Lihat detail ${group.title}`}
                      title="Lihat detail pengumpulan"
                    >
                      <Eye size={15} aria-hidden="true" />
                      Detail
                    </Link>
                  </article>
                );
              })}
            </div>
          )}
        </div>
      )}
      <FeedbackModal
        open={!!error}
        message={error}
        onClose={() => setError("")}
      />
    </div>
  );
}
