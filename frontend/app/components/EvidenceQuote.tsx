import type { EvidenceSpan } from "../lib/studentSubmissions";
import { findQuoteRange } from "./evidence";

/**
 * The student's own statement that carries the misconception (v3.2), rendered as
 * a block above "Materi Bacaan".
 *
 * The stored span may lack `sentence` (rows written before it was added), so the
 * quote is the fallback. The quote inside the sentence is tinted with the same
 * `.evidence-mark` used by the inline highlight; a miss shows the sentence
 * untinted. The reason is rendered only together with the text it explains — a
 * claim never appears on its own.
 */
export function resolveEvidenceSentence(
  evidence?: EvidenceSpan | null,
): string {
  if (!evidence) return "";
  return (evidence.sentence ?? "").trim() || (evidence.quote ?? "").trim();
}

const FIELD_LABELS: Record<EvidenceSpan["field"], string> = {
  tier1: "Tier 1",
  tier3: "Tier 3",
};

export default function EvidenceQuote({
  evidence,
  className,
}: {
  evidence?: EvidenceSpan | null;
  className?: string;
}) {
  const sentence = resolveEvidenceSentence(evidence);
  if (!evidence || !sentence) return null;

  const range = findQuoteRange(sentence, evidence.quote);
  const reason = (evidence.reason ?? "").trim();

  return (
    <div className={className}>
      <p className="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant">
        Kutipan Jawaban Mahasiswa ({FIELD_LABELS[evidence.field]})
      </p>
      <blockquote className="mt-1.5 text-sm leading-relaxed text-on-surface">
        {range ? (
          <>
            {sentence.slice(0, range[0])}
            <mark className="evidence-mark">
              {sentence.slice(range[0], range[1])}
            </mark>
            {sentence.slice(range[1])}
          </>
        ) : (
          sentence
        )}
      </blockquote>
      {reason ? <p className="evidence-reason">Alasan: {reason}</p> : null}
    </div>
  );
}
