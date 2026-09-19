"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { TriangleAlert } from "lucide-react";

import { useAuth } from "./AuthProvider";
import { apiFetch } from "../lib/api";
import {
  fmtDate,
  summarizeSetStatus,
  type StudentSetGroup,
} from "../lib/studentSubmissions";

const errMsg = (err: unknown) => (err instanceof Error ? err.message : String(err));

type Props = {
  /** Hide the section heading when the parent page already provides one. */
  compactHeading?: boolean;
};

export default function MySubmissions({ compactHeading = false }: Props) {
  const { user } = useAuth();
  const [groups, setGroups] = useState<StudentSetGroup[]>([]);
  const [fetching, setFetching] = useState(true);
  const [error, setError] = useState("");
  const [subjectFilter, setSubjectFilter] = useState("ALL");

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

  const subjects = useMemo(() => {
    const map = new Map<string, string>();
    groups.forEach((group) => {
      if (group.subject_id && group.subject_name) map.set(group.subject_id, group.subject_name);
    });
    return [...map.entries()].map(([id, name]) => ({ id, name }));
  }, [groups]);

  const visible = useMemo(
    () =>
      subjectFilter === "ALL"
        ? groups
        : groups.filter((group) => group.subject_id === subjectFilter),
    [groups, subjectFilter],
  );

  return (
    <div>
      {!compactHeading && (
        <div className="flex items-center gap-2">
          <h2 className="font-display text-lg font-bold text-on-surface">Pengumpulan Saya</h2>
        </div>
      )}

      {error && (
        <div
          role="alert"
          className="mt-4 flex items-center gap-3 rounded-lg border border-error/40 bg-error-container p-4 text-sm text-on-error-container"
        >
          <TriangleAlert size={20} />
          <span>{error}</span>
        </div>
      )}

      {fetching ? (
        <p className="mt-4 text-sm text-on-surface-variant">Memuat riwayat pengumpulan...</p>
      ) : groups.length === 0 ? (
        <div className="glass-panel mt-4 rounded-xl border border-outline-variant/40 p-8 text-center text-sm text-on-surface-variant">
          Belum ada jawaban yang dikumpulkan. Masukkan kode soal dari dosen untuk memulai.
        </div>
      ) : (
        <>
          <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2">
              <label
                htmlFor="subject-filter"
                className="text-xs font-semibold uppercase text-on-surface-variant"
              >
                Mata Kuliah
              </label>
              <select
                id="subject-filter"
                value={subjectFilter}
                onChange={(e) => setSubjectFilter(e.target.value)}
                className="rounded-lg border border-outline-variant/60 bg-surface-container-lowest px-3 py-2 text-sm text-on-surface focus:border-primary focus:outline-none"
              >
                <option value="ALL">Semua mata kuliah</option>
                {subjects.map((subject) => (
                  <option key={subject.id} value={subject.id}>
                    {subject.name}
                  </option>
                ))}
              </select>
            </div>
            <span className="text-[11px] text-on-surface-variant">
              Menampilkan {visible.length} dari {groups.length} bank soal
            </span>
          </div>

          <div className="glass-panel mt-4 overflow-hidden rounded-xl border border-outline-variant/40 shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-outline-variant/40 bg-surface-container-low text-xs font-semibold uppercase text-on-surface-variant">
                  <tr>
                    <th className="px-6 py-4">Kode Soal</th>
                    <th className="px-6 py-4">Mata Kuliah</th>
                    <th className="px-6 py-4">Percobaan</th>
                    <th className="px-6 py-4">Status</th>
                    <th className="px-6 py-4">Dikirim</th>
                    <th className="px-6 py-4 text-right">Detail</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-outline-variant/30">
                  {visible.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-6 py-10 text-center text-on-surface-variant">
                        Tidak ada pengumpulan pada mata kuliah ini.
                      </td>
                    </tr>
                  ) : (
                    visible.map((group) => {
                      const status = summarizeSetStatus(group.status_summary, group.status_counts);
                      return (
                        <tr
                          key={group.set_id}
                          className="transition-colors hover:bg-primary-fixed/10"
                        >
                          <td className="px-6 py-4">
                            <p className="font-mono-ui font-bold text-primary">{group.code}</p>
                            <p className="mt-0.5 text-xs text-on-surface-variant">{group.title}</p>
                          </td>
                          <td className="px-6 py-4 text-on-surface-variant">{group.subject_name}</td>
                          <td className="px-6 py-4">
                            <p className="font-semibold text-on-surface">
                              Terjawab {group.answered_count}/{group.question_count} soal
                            </p>
                            <p className="mt-0.5 text-[11px] text-on-surface-variant">
                              {group.total_attempts} pengumpulan
                              {group.max_attempt_no > 0 ? ` · maks percobaan ke-${group.max_attempt_no}` : ""}
                            </p>
                          </td>
                          <td className="px-6 py-4">
                            <span className={`badge ${status.cls}`}>{status.label}</span>
                            {status.detail && (
                              <p className="mt-1 text-[11px] text-on-surface-variant">{status.detail}</p>
                            )}
                          </td>
                          <td className="px-6 py-4 text-xs text-on-surface-variant">
                            {group.last_submitted_at ? `Terakhir ${fmtDate(group.last_submitted_at)}` : "-"}
                          </td>
                          <td className="px-6 py-4 text-right">
                            <Link
                              href={`/pengumpulan/${group.set_id}`}
                              className="inline-flex items-center gap-1 rounded border border-outline-variant/50 bg-surface-container-lowest px-2.5 py-1 text-xs font-semibold text-primary hover:bg-primary-fixed/40"
                            >
                              Lihat detail
                            </Link>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}