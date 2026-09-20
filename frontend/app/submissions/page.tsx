"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Calendar,
  ChevronDown,
  ChevronUp,
  ClipboardList,
  Search,
  TriangleAlert,
} from "lucide-react";

import { useAuth } from "../components/AuthProvider";
import { apiFetch } from "../lib/api";

type SubmissionRow = {
  id: string;
  student_name: string;
  student_email: string;
  subject_slug: string;
  subject_name: string;
  question_code: string | null;
  question_title: string | null;
  version_number: number | null;
  prompt_preview: string;
  answer: string;
  status: string;
  submitted_at: string | null;
  score: number | null;
  tier_label: string | null;
  validation_status: string | null;
};

const STATUS_META: Record<string, { label: string; badge: string }> = {
  SUBMITTED: { label: "Dikirim", badge: "badge-draft" },
  ANALYZING: { label: "Menganalisis", badge: "badge-review" },
  ANALYSIS_FAILED: { label: "Gagal analisis", badge: "badge-revoked" },
  PENDING_VALIDATION: { label: "Menunggu validasi", badge: "badge-active" },
  VALIDATED: { label: "Tervalidasi", badge: "badge-active" },
  REJECTED: { label: "Ditolak", badge: "badge-revoked" },
};

const VALIDATION_LABEL: Record<string, string> = {
  ACCEPTED: "Diterima",
  EDITED: "Diedit",
  REJECTED: "Ditolak",
};

function initials(name: string): string {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("");
}

function fmtDate(value: string | null): string {
  if (!value) return "-";
  return new Date(value).toLocaleDateString("id-ID", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function SubmissionsPage() {
  const { user, token, loading } = useAuth();
  const router = useRouter();
  const [rows, setRows] = useState<SubmissionRow[]>([]);
  const [statusFilter, setStatusFilter] = useState("");
  const [fetching, setFetching] = useState(true);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (loading) return;
    if (!user || !token) {
      router.replace("/login");
      return;
    }
    let cancelled = false;
    apiFetch<{ submissions: SubmissionRow[] }>("/lecturer/submissions")
      .then((d) => {
        if (!cancelled) setRows(d.submissions);
      })
      .catch(() => {
        if (!cancelled) setError("Gagal memuat jawaban mahasiswa.");
      })
      .finally(() => {
        if (!cancelled) setFetching(false);
      });
    return () => {
      cancelled = true;
    };
  }, [user, token, loading, router]);

  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const visible = statusFilter ? rows.filter((r) => r.status === statusFilter) : rows;

  return (
    <div style={{ maxWidth: "1080px", margin: "0 auto" }}>
      <header style={{ display: "flex", alignItems: "center", gap: "14px", marginBottom: "1.5rem" }}>
        <div
          style={{
            width: "48px",
            height: "48px",
            borderRadius: "var(--radius-md)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "rgba(99, 102, 241, 0.15)",
            color: "var(--primary)",
          }}
        >
          <ClipboardList size={26} />
        </div>
        <div>
          <h1 style={{ fontSize: "1.6rem", fontWeight: 800, margin: 0 }}>Jawaban Mahasiswa</h1>
          <p style={{ fontSize: "0.9rem", color: "var(--text-muted)", margin: "0.2rem 0 0" }}>
            Daftar jawaban yang dikumpulkan mahasiswa untuk ditinjau.
          </p>
        </div>
      </header>

      {error && (
        <div role="alert" style={{ borderRadius: "var(--radius-sm)", border: "1px solid rgba(239, 68, 68, 0.3)", background: "rgba(239, 68, 68, 0.12)", color: "#f87171", fontSize: "0.85rem", padding: "0.7rem 1rem", marginBottom: "1.25rem" }}>
          {error}
        </div>
      )}

      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "12px",
          flexWrap: "wrap",
          marginBottom: "1.25rem",
        }}
      >
        <div style={{ display: "inline-flex", alignItems: "center", gap: "8px" }}>
          <Search size={16} color="var(--text-dim)" />
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="form-select"
            style={{ minWidth: "220px", padding: "0.55rem 0.9rem" }}
          >
            <option value="">Semua status</option>
            {Object.entries(STATUS_META).map(([key, meta]) => (
              <option key={key} value={key}>
                {meta.label}
              </option>
            ))}
          </select>
        </div>
        <span style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>
          {fetching ? "Memproses..." : `${visible.length} pengumpulan`}
        </span>
      </div>

      {!fetching && visible.length === 0 && (
        <div
          className="glass-card"
          style={{ padding: "2.5rem", borderRadius: "var(--radius-lg)", textAlign: "center" }}
        >
          <TriangleAlert size={28} color="var(--text-dim)" style={{ margin: "0 auto" }} />
          <p style={{ fontSize: "0.9rem", color: "var(--text-muted)", marginTop: "0.6rem" }}>
            Belum ada jawaban mahasiswa{statusFilter ? " dengan filter ini" : ""}.
          </p>
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
        {visible.map((row) => {
          const statusMeta = STATUS_META[row.status] ?? { label: row.status, badge: "badge-draft" };
          const isOpen = expanded.has(row.id);
          return (
            <article key={row.id} className="glass-card" style={{ padding: "1.1rem 1.25rem", borderRadius: "var(--radius-lg)" }}>
              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "12px", flexWrap: "wrap" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "10px", minWidth: 0 }}>
                  <div
                    style={{
                      width: "40px",
                      height: "40px",
                      borderRadius: "9999px",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      background: "var(--gradient-primary)",
                      color: "#ffffff",
                      fontWeight: 700,
                      fontSize: "0.85rem",
                      flexShrink: 0,
                    }}
                  >
                    {initials(row.student_name)}
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <p style={{ fontSize: "0.9rem", fontWeight: 700, color: "var(--text-main)", margin: 0 }}>{row.student_name}</p>
                    <p style={{ fontSize: "0.78rem", color: "var(--text-muted)", margin: "0.15rem 0 0" }}>{row.student_email}</p>
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                  <span className={`badge ${statusMeta.badge}`}>{statusMeta.label}</span>
                  {row.validation_status && (
                    <span className="badge badge-draft">
                      ({(VALIDATION_LABEL[row.validation_status] ?? row.validation_status)})
                    </span>
                  )}
                </div>
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap", marginTop: "0.8rem" }}>
                <span className="badge badge-role">{row.subject_name}</span>
                {row.question_code && (
                  <span style={{ fontSize: "0.72rem", color: "var(--text-dim)", fontWeight: 600 }}>{row.question_code}</span>
                )}
                {row.question_title && (
                  <span style={{ fontSize: "0.78rem", color: "var(--text-muted)" }}>{row.question_title}</span>
                )}
                {row.score != null && (
                  <span style={{ fontSize: "0.78rem", fontWeight: 700, color: "var(--primary)" }}>
                    Skor {row.score.toFixed(2)}%
                  </span>
                )}
                {row.tier_label && (
                  <span style={{ fontSize: "0.78rem", color: "var(--text-muted)" }}>· {row.tier_label}</span>
                )}
                <span style={{ display: "inline-flex", alignItems: "center", gap: "4px", fontSize: "0.72rem", color: "var(--text-dim)", marginLeft: "auto" }}>
                  <Calendar size={13} />
                  {fmtDate(row.submitted_at)}
                </span>
              </div>

              {row.prompt_preview && (
                <p style={{ fontSize: "0.8rem", color: "var(--text-muted)", margin: "0.6rem 0 0" }}>
                  <strong style={{ color: "var(--text-main)" }}>Soal: </strong>
                  {row.prompt_preview}
                </p>
              )}

              <div style={{ marginTop: "0.7rem" }}>
                <button type="button" onClick={() => toggle(row.id)} className="btn-secondary" style={{ padding: "0.4rem 0.8rem", fontSize: "0.78rem" }}>
                  {isOpen ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
                  {isOpen ? "Sembunyikan jawaban" : "Lihat jawaban"}
                </button>
                {isOpen && (
                  <div
                    style={{
                      marginTop: "0.6rem",
                      padding: "0.9rem 1rem",
                      borderRadius: "var(--radius-sm)",
                      background: "var(--input-bg)",
                      border: "1px solid var(--border-color)",
                      fontSize: "0.85rem",
                      color: "var(--text-main)",
                      whiteSpace: "pre-wrap",
                      overflowWrap: "anywhere",
                    }}
                  >
                    {row.answer || "Tidak ada teks jawaban."}
                  </div>
                )}
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}