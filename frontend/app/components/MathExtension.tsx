"use client";

import { useEffect, useRef, useState } from "react";
import { Node, mergeAttributes } from "@tiptap/core";
import {
  NodeViewWrapper,
  ReactNodeViewRenderer,
  type NodeViewProps,
} from "@tiptap/react";
import type { MathfieldElement } from "mathlive";
import {
  hideMathKeyboard,
  loadMathLive,
  showMathKeyboard,
} from "./mathLiveLoader";
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
 * Set right before inserting a node so the freshly mounted field opens the
 * virtual keyboard. Module-level on purpose: the request originates from the
 * toolbar click and is consumed by the node view that the insert creates.
 */
let openKeyboardOnNextField = false;

export function requestMathKeyboardOnNextField() {
  openKeyboardOnNextField = true;
}

function consumeKeyboardRequest(): boolean {
  const requested = openKeyboardOnNextField;
  openKeyboardOnNextField = false;
  return requested;
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
  autoOpenKeyboard = false,
}: {
  value: string;
  onChange: (latex: string) => void;
  autoOpenKeyboard?: boolean;
}) {
  const hostRef = useRef<HTMLSpanElement | null>(null);
  const fieldRef = useRef<MathfieldElement | null>(null);
  const onChangeRef = useRef(onChange);
  // Read once on mount: the keyboard request applies to the insertion that
  // created this field, not to later re-renders.
  const autoOpenRef = useRef(autoOpenKeyboard);

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

      if (autoOpenRef.current) {
        // Focus after the element is connected, then ask MathLive to show its
        // on-screen keyboard. The keyboard is a DOM panel, so this does not
        // need to stay inside the original click gesture.
        requestAnimationFrame(() => {
          if (!field.isConnected) return;
          field.focus();
          void showMathKeyboard();
          field.scrollIntoView({ block: "center", behavior: "smooth" });
        });
      }

      dispose = () => {
        field.removeEventListener("input", handleInput);
        field.remove();
        fieldRef.current = null;
        // Only dismiss when no other formula field took over the keyboard.
        if (!document.querySelector("math-field:focus-within")) {
          hideMathKeyboard();
        }
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

  return (
    <span
      ref={hostRef}
      className="math-field-host"
      // ProseMirror can select the atom before the inner field receives the
      // pointer event; focusing here keeps taps (and the keyboard) working.
      onPointerDown={() => fieldRef.current?.focus()}
    />
  );
}

function MathNodeView({ node, updateAttributes, editor }: NodeViewProps) {
  const latex = (node.attrs.latex as string) ?? "";
  // Consumed once per node view instance: the request belongs to the insertion
  // that created this node, not to subsequent re-renders.
  const [autoOpenKeyboard] = useState(
    () => editor.isEditable && consumeKeyboardRequest(),
  );

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
        autoOpenKeyboard={autoOpenKeyboard}
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
    return ReactNodeViewRenderer(MathNodeView, {
      // Let pointer/click events reach the MathLive field. Without this,
      // ProseMirror treats the tap as "select this atom" and the field never
      // gets focus, so the on-screen keyboard never opens.
      stopEvent: ({ event }) =>
        event.target instanceof Element &&
        event.target.closest("math-field") !== null,
    });
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
