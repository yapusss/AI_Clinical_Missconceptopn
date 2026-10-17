"use client";

import { useState } from "react";
import { CheckCircle2, Lightbulb, Link2 } from "lucide-react";

import { apiFetch } from "../lib/api";
import type { CatalogMatch } from "../lib/studentSubmissions";

const fmtScore = (score: number | null | undefined) =>
  typeof score === "number" ? score.toFixed(2) : "—";

function LinkButton({
  id,
  label,
  busy,
  linked,
  onLink,
}: {
  id: string;
  label: string;
  busy: string | null;
  linked: boolean;
  onLink: (id: string) => void;
}) {
  const done = linked;
  return (
    <button
      type="button"
      onClick={() => onLink(id)}
      disabled={busy === id || done}
      className="inline-flex items-center gap-1 rounded border border-primary/40 bg-primary-fixed/40 px-2 py-0.5 text-[11px] font-semibold text-primary hover:bg-primary-fixed cursor-pointer disabled:opacity-60"
      title="Tautkan miskonsepsi ini ke soal (idempoten)"
    >
      {done ? <CheckCircle2 size={12} /> : <Link2 size={12} />}
      {done ? "Tertaut" : `Tautkan: ${label}`}
    </button>
  );
}

/**
 * The lecturer-facing catalogue result (Phase 6, plan D3/D5).
 *
 * Shows the matched misconception label with its score, or
 * `tidak cocok dengan katalog` with the top-3 candidate concepts and scores.
 * The optional authoring path (D5) is the confirm/override control: one click
 * writes `question_version_misconceptions` — idempotent, no typing required.
 * Linking a candidate's misconception is how a lecturer overrides an abstain or
 * a match.
 */
export default function CatalogResult({
  catalog,
  versionId,
  className,
}: {
  catalog?: CatalogMatch | null;
  versionId?: string | null;
  className?: string;
}) {
  const [linked, setLinked] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");

  if (!catalog) return null;

  const link = async (misconceptionId: string) => {
    if (!versionId || busy) return;
    setBusy(misconceptionId);
    setError("");
    try {
      await apiFetch(`/questions/versions/${versionId}/misconceptions`, {
        method: "POST",
        body: JSON.stringify({ misconception_id: misconceptionId }),
      });
      setLinked((prev) => ({ ...prev, [misconceptionId]: true }));
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Gagal menautkan miskonsepsi.",
      );
    } finally {
      setBusy(null);
    }
  };

  const matched = catalog.status === "matched";
  const matchedId = catalog.misconception_id;

  return (
    <div className={className}>
      <div className="mb-2 flex items-center gap-1.5">
        <Lightbulb size={14} className="text-primary" />
        <h4 className="font-bold tracking-wider text-on-surface-variant">
          Hasil Katalog Miskonsepsi
        </h4>
      </div>

      {matched ? (
        <div className="rounded-lg border border-outline-variant/30 bg-surface-container-lowest p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs font-semibold text-on-surface">
              {catalog.label ?? catalog.concept_name ?? "Miskonsepsi terdeteksi"}
            </span>
            <span className="badge badge-draft shrink-0">
              skor {fmtScore(catalog.score)}
            </span>
          </div>
          {matchedId && (
            <div className="mt-2">
              <LinkButton
                id={matchedId}
                label="miskonsepsi ini"
                busy={busy}
                linked={Boolean(linked[matchedId])}
                onLink={link}
              />
            </div>
          )}
        </div>
      ) : (
        <p className="text-xs italic text-on-surface-variant">
          tidak cocok dengan katalog
        </p>
      )}

      {catalog.candidates.length > 0 && (
        <div className="mt-2 space-y-2">
          <p className="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant">
            Kandidat katalog
          </p>
          {catalog.candidates.map((candidate) => (
            <div
              key={candidate.concept_id ?? candidate.name ?? "?"}
              className="rounded border border-outline-variant/30 bg-surface-container-lowest px-3 py-2"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-on-surface">
                  {candidate.name ?? candidate.concept_id ?? "Konsep"}
                </span>
                <span className="font-mono-ui text-[11px] text-on-surface-variant">
                  {fmtScore(candidate.score)}
                </span>
              </div>
              {candidate.misconceptions.length > 0 && (
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {candidate.misconceptions.map((m) => (
                    <LinkButton
                      key={m.id}
                      id={m.id}
                      label={m.label}
                      busy={busy}
                      linked={Boolean(linked[m.id])}
                      onLink={link}
                    />
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {error && (
        <p className="mt-1.5 text-[11px] leading-relaxed text-error">{error}</p>
      )}
    </div>
  );
}
