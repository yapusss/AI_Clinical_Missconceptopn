"use client";

import { useEffect, useRef } from "react";
import { Node, mergeAttributes } from "@tiptap/core";
import {
  NodeViewWrapper,
  ReactNodeViewRenderer,
  type NodeViewProps,
} from "@tiptap/react";
import type { MathfieldElement } from "mathlive";
import { loadMathLive } from "./mathLiveLoader";
import StaticMath from "./StaticMath";
import "mathlive/static.css";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    mathField: {
      /** Insert a new, empty interactive MathLive formula at the caret. */
      insertMathField: () => ReturnType;
    };
  }
}

/**
 * Live MathLive input used inside the editor. The `<math-field>` element is
 * created imperatively (rather than through JSX) so React never treats its
 * `value` as a controlled attribute and so the custom element only ever exists
 * in the browser. MathLive wires up its own native virtual keyboard on focus.
 */
function MathFieldInput({
  value,
  onChange,
  autoFocus = false,
}: {
  value: string;
  onChange: (latex: string) => void;
  autoFocus?: boolean;
}) {
  const hostRef = useRef<HTMLSpanElement | null>(null);
  const fieldRef = useRef<MathfieldElement | null>(null);
  const onChangeRef = useRef(onChange);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    let active = true;
    let dispose: (() => void) | undefined;

    void loadMathLive().then(() => {
      const host = hostRef.current;
      if (!active || !host || fieldRef.current) return;

      const field = document.createElement("math-field") as MathfieldElement;
      field.className = "math-field-input";
      field.setAttribute("aria-label", "Formula matematika");
      field.value = value;

      const handleInput = () => onChangeRef.current(field.value);
      field.addEventListener("input", handleInput);

      host.appendChild(field);
      fieldRef.current = field;

      if (autoFocus) requestAnimationFrame(() => field.focus());

      dispose = () => {
        field.removeEventListener("input", handleInput);
        field.remove();
        fieldRef.current = null;
      };
    });

    return () => {
      active = false;
      dispose?.();
    };
    // Mount-only: live props are synced by the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Mirror external value changes without resetting the caret while typing.
  useEffect(() => {
    const field = fieldRef.current;
    if (field && field.value !== value) field.value = value;
  }, [value]);

  return <span ref={hostRef} className="math-field-host" />;
}

function MathNodeView({ node, updateAttributes, editor }: NodeViewProps) {
  const latex = (node.attrs.latex as string) ?? "";

  if (!editor.isEditable) {
    return (
      <NodeViewWrapper as="span" className="math-inline-node" contentEditable={false}>
        <StaticMath latex={latex} />
      </NodeViewWrapper>
    );
  }

  return (
    <NodeViewWrapper as="span" className="math-inline-node" contentEditable={false}>
      <MathFieldInput
        value={latex}
        // A freshly inserted node is empty: open its keyboard straight away.
        autoFocus={latex.length === 0 && editor.isFocused}
        onChange={(next) => updateAttributes({ latex: next })}
      />
    </NodeViewWrapper>
  );
}

/**
 * TipTap inline atom node backed by a native MathLive `<math-field>`.
 *
 * The LaTeX source lives on the `latex` attribute and is serialised into the
 * rich text HTML as a real `<math-field read-only>` element (with the LaTeX as
 * its text content) so read-only screens render the formula via MathLive
 * without any extra work.
 */
export const MathExtension = Node.create({
  name: "mathField",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      latex: {
        default: "",
        parseHTML: (element) =>
          element.getAttribute("data-latex") ?? element.textContent ?? "",
        renderHTML: (attributes) => ({ "data-latex": attributes.latex }),
      },
    };
  },

  parseHTML() {
    return [{ tag: "math-field" }];
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      "math-field",
      mergeAttributes(HTMLAttributes, {
        "read-only": "",
        class: "math-inline",
      }),
      (node.attrs.latex as string) ?? "",
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(MathNodeView);
  },

  addCommands() {
    return {
      insertMathField:
        () =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs: { latex: "" } }),
    };
  },
});

export default MathExtension;
