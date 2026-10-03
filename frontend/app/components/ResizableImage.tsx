"use client";

import { useCallback, useRef, useState } from "react";
import Image from "@tiptap/extension-image";
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from "@tiptap/react";

const MIN_WIDTH_PERCENT = 10;
const MAX_WIDTH_PERCENT = 100;

function ImageNodeView({ node, selected, updateAttributes, editor }: NodeViewProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [resizing, setResizing] = useState(false);

  const startResize = useCallback(
    (event: React.MouseEvent) => {
      event.preventDefault();
      const wrapper = wrapperRef.current;
      if (!wrapper) return;
      const editorWidth = (editor.view.dom as HTMLElement).offsetWidth || 1;
      const startX = event.clientX;
      const startWidth = wrapper.offsetWidth;
      setResizing(true);

      const handleMove = (moveEvent: MouseEvent) => {
        const delta = moveEvent.clientX - startX;
        const nextPx = Math.min(editorWidth, Math.max(40, startWidth + delta));
        const percent = Math.round((nextPx / editorWidth) * 100);
        const clamped = Math.min(MAX_WIDTH_PERCENT, Math.max(MIN_WIDTH_PERCENT, percent));
        updateAttributes({ width: `${clamped}%` });
      };
      const handleUp = () => {
        document.removeEventListener("mousemove", handleMove);
        document.removeEventListener("mouseup", handleUp);
        setResizing(false);
      };
      document.addEventListener("mousemove", handleMove);
      document.addEventListener("mouseup", handleUp);
    },
    [editor, updateAttributes]
  );

  const width = (node.attrs.width as string | null) ?? null;

  return (
    <NodeViewWrapper
      className="rte-image-node"
      data-selected={selected ? "true" : undefined}
      data-resizing={resizing ? "true" : undefined}
    >
      <div ref={wrapperRef} className="rte-image-wrap" style={width ? { width } : undefined}>
        <img
          src={node.attrs.src as string}
          alt={(node.attrs.alt as string) ?? ""}
          title={(node.attrs.title as string) ?? undefined}
          draggable={false}
        />
        {selected && (
          <span
            role="presentation"
            className="rte-image-handle"
            onMouseDown={startResize}
            title="Tarik untuk mengubah ukuran gambar"
          />
        )}
      </div>
    </NodeViewWrapper>
  );
}

const ResizableImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      width: {
        default: null,
        parseHTML: (element: HTMLElement) => element.style.width || element.getAttribute("width") || null,
        renderHTML: (attributes: Record<string, unknown>) =>
          attributes.width ? { style: `width: ${attributes.width}; height: auto;` } : {},
      },
    };
  },
  addNodeView() {
    return ReactNodeViewRenderer(ImageNodeView);
  },
});

export default ResizableImage;
