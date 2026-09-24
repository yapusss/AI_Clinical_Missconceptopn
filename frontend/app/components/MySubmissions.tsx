"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowDownWideNarrow,
  ArrowUpNarrowWide,
  Eye,
  Filter,
  Layers,
  TriangleAlert,
} from "lucide-react";

import { useAuth } from "./AuthProvider";
import AppSelect from "./AppSelect";
import ListToolbar, { type SortMenuOption } from "./ListToolbar";
import { apiFetch } from "../lib/api";
import {
  summarizeSetStatus,
  type StudentSetGroup,
} from "../lib/studentSubmissions";

const errMsg = (err: unknown) => (err instanceof Error ? err.message : String(err));

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
  const [groups, setGroups] = useState<StudentSetGroup[]>([]);
  const [fetching, setFetching] = useState(true);
  const [error, setError] = useState("");

  // Filters & Sorting state
  const [search, setSearch] = useState("");
  const [subjectFilter, setSubjectFilter] = useState("ALL");
  const [sortOrder, setSortOrder] = useState<string>("LATEST");

  const load = useCallback(async () => {
    if (!user) return;
    try {
      const data = await apiFetch<StudentSetGroup[]>("/student/submission-sets");
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
        const textToMatch = `${group.code} ${group.title} ${group.subject_name}`.toLowerCase();
        if (!textToMatch.includes(q)) {
          return false;
        }
      }
      return true;
    });

    // 2. Sort
    return filtered.sort((a, b) => {
      const timeA = a.last_submitted_at ? new Date(a.last_submitted_at).getTime() : 0;
      const timeB = b.last_submitted_at ? new Date(b.last_submitted_at).getTime() : 0;

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
          <h2 className="font-display text-sm font-bold text-on-surface">Pengumpulan Saya</h2>
        </div>
      )}

      {error && (
        <div
          role="alert"
          className="mb-3 flex items-center gap-3 rounded-xl border border-error/40 bg-error-container p-3 text-xs text-on-error-container"
        >
          <TriangleAlert size={16} />
          <span>{error}</span>
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
          Menampilkan <strong className="text-on-surface">{visible.length}</strong> dari {groups.length} paket soal
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

      {/* Submissions Table */}
      {fetching ? (
        <p className="mt-6 text-center text-xs text-on-surface-variant">Memuat riwayat pengumpulan...</p>
      ) : groups.length === 0 ? (
        <div className="glass-panel mt-2 rounded-xl border border-outline-variant/40 p-6 text-center text-xs text-on-surface-variant">
          Belum ada jawaban yang dikumpulkan. Masukkan kode soal di atas untuk memulai.
        </div>
      ) : (
        <div className="glass-panel mt-2 overflow-hidden rounded-xl border border-outline-variant/40 shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm border-collapse" role="table">
              <thead className="border-b border-outline-variant/40 bg-surface-container-low text-xs font-semibold uppercase text-on-surface-variant">
                <tr>
                  <th scope="col" className="w-[38%] px-4 py-3">
                    Paket Soal
                  </th>
                  <th scope="col" className="w-[20%] px-4 py-3">
                    Mata Kuliah
                  </th>
                  <th scope="col" className="w-[18%] px-4 py-3">
                    Progres Soal
                  </th>
                  <th scope="col" className="w-[16%] px-4 py-3">
                    Status Validasi
                  </th>
                  <th scope="col" className="w-[8%] px-4 py-3 text-right">
                    Aksi
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-outline-variant/20">
                {visible.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-xs text-on-surface-variant">
                      <p className="font-medium">Tidak ada pengumpulan yang cocok dengan kriteria.</p>
                    </td>
                  </tr>
                ) : (
                  visible.map((group) => {
                    const status = summarizeSetStatus(group.status_summary, group.status_counts);
                    const allAnswered = group.answered_count === group.question_count && group.question_count > 0;

                    return (
                      <tr
                        key={group.set_id}
                        className="transition-colors hover:bg-primary-fixed/5"
                      >
                        {/* 1. Code & Title */}
                        <td className="px-4 py-3.5 align-middle">
                          <div className="flex items-center gap-2">
                            <span className="font-mono-ui font-bold text-xs text-primary bg-primary/10 px-2 py-0.5 rounded border border-primary/20">
                              {group.code}
                            </span>
                          </div>
                          <p className="mt-1 font-semibold text-sm text-on-surface leading-snug">
                            {group.title}
                          </p>
                          {group.topic_name && (
                            <span className="inline-block mt-0.5 text-[11px] text-on-surface-variant font-medium">
                              Topik: {group.topic_name}
                            </span>
                          )}
                        </td>

                        {/* 2. Subject */}
                        <td className="px-4 py-3.5 align-middle text-xs font-medium text-on-surface">
                          {group.subject_name}
                        </td>

                        {/* 3. Progress (Small text simplified to only tell Percobaan ke-x) */}
                        <td className="px-4 py-3.5 align-middle">
                          <div className="flex items-center gap-1.5">
                            <Layers size={13} className="text-primary shrink-0" />
                            <span
                              className={`text-xs font-semibold ${
                                allAnswered ? "text-emerald-400" : "text-amber-400"
                              }`}
                            >
                              {group.answered_count} / {group.question_count} Soal
                            </span>
                          </div>
                          <p className="mt-0.5 text-[11px] text-on-surface-variant">
                            Percobaan ke-{group.max_attempt_no || 1}
                          </p>
                        </td>

                        {/* 4. Status (Only badge, explanation removed) */}
                        <td className="px-4 py-3.5 align-middle">
                          <span className={`badge ${status.cls} text-[11px] whitespace-nowrap`}>
                            {status.label}
                          </span>
                        </td>

                        {/* 5. Action (Standardized Eye icon button, date removed) */}
                        <td className="px-4 py-3.5 align-middle text-right">
                          <div className="flex justify-end">
                            <Link
                              href={`/pengumpulan/${group.set_id}`}
                              className="btn-secondary table-action-button"
                              aria-label={`Lihat detail ${group.title}`}
                              title="Lihat detail"
                            >
                              <Eye size={18} stroke="#4f46e5" strokeWidth={2.5} aria-hidden="true" />
                            </Link>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}