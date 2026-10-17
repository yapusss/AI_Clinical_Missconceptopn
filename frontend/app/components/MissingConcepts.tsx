import type { MissingConcept } from "../lib/studentSubmissions";

/**
 * "Konsep yang belum dikuasai" (Phase 6, plan D2/D4).
 *
 * The concepts the student did not address, surfaced above "Materi Bacaan"
 * beside the evidence block. Same visual family as `EvidenceQuote`: a
 * micro-label plus one sentence per concept. Deliberately carries **no**
 * catalogue misconception label, no candidates and no similarity score — the
 * backend already strips them from the payload (D2), and this component has no
 * field to render them into.
 */
export default function MissingConcepts({
  concepts,
  className,
}: {
  concepts?: MissingConcept[] | null;
  className?: string;
}) {
  const list = concepts ?? [];
  if (!list.length) return null;

  return (
    <div className={className}>
      <p className="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant">
        Konsep yang belum dikuasai
      </p>
      <ul className="mt-1.5 space-y-1.5">
        {list.map((concept, index) => (
          <li
            key={`${concept.name}-${index}`}
            className="text-sm leading-relaxed text-on-surface"
          >
            <span className="font-semibold">{concept.name}</span>
            {concept.correct_conception ? (
              <span className="text-on-surface-variant">
                {" — "}
                {concept.correct_conception}
              </span>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
