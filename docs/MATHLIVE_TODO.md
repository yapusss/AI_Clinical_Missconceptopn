# TODO — Native MathLive in TipTap (Dosen & Mahasiswa)

Scope: embed MathLive's native `<math-field>` (and its built-in virtual keyboard)
into the TipTap rich text editor, and use that editor for both the lecturer and
the student answer workflows. **No custom math keyboard UI.**

## Direction change

The earlier custom Symbolab-style HTML keypad was **cancelled** and its
components were deleted. MathLive owns the virtual keyboard now.

## Locked decisions

1. **Tier 1 cap** — raised 120 -> 1000 in `serializers.py` and the `[:120]`
   truncations in `views.py`. No DB migrations.
2. **Tier 1 & Tier 3** — both use `RichTextEditor`; `tier1_answer` therefore
   stores rich HTML.
3. **Serialization** — the node serialises to a real
   `<math-field data-latex="..." read-only>LATEX</math-field>` element.
4. **Legacy fallback** — `StaticMath` / `MathContent` retained so answers saved
   before this change still render.
5. **Old components deleted** — `MathSymbolToolbar.tsx`,
   `InteractiveMathInput.tsx`, `mathFieldContext.ts`, `MathInlineNode.ts`,
   `MathInlineNodeView.tsx`.

## Checklist

- [x] `mathlive` installed
- [x] Backend cap 1000 (`serializers.py`, `views.py`) — no migrations
- [x] `MathExtension.tsx` — TipTap node + `<math-field>` NodeView + `insertMathField`
- [x] `RichTextEditor.tsx` — register extension, `[fx]` inserts a formula
- [x] `RichTextContent.tsx` — allow `math-field`, load MathLive, set value from `data-latex`
- [x] `sets/[id]/page.tsx` — Tier 1 + Tier 3 both rich editors
- [x] `globals.css` — `.rte-editor { resize: vertical; overflow: auto; min-height: 120px; max-height: 800px }` + math-field styles
- [x] Delete cancelled components
- [x] `npm run lint` (0 errors)
- [x] `npm run build` (success)
- [x] Docker compose build + restart frontend, smoke request 200

## Known risk flagged to user

`submissions.tier1_answer` and `sp_submit_conceptual_answer(p_tier1_answer ...)`
are **VARCHAR(255)** (migrations `0011`, `0022`). The app cap is 1000, but values
longer than 255 will only persist after a DB-side widening, which is out of scope
by the "no migrations" rule.
