"use client";

import { useEffect, useReducer, useRef, useState } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import {
  Bold,
  Code,
  CodeXml,
  Italic,
  Link2,
  ImagePlus,
  List,
  ListOrdered,
  Quote,
  Redo2,
  Strikethrough,
  Undo2,
} from "lucide-react";
import RichTextContent from "./RichTextContent";
import ResizableImage from "./ResizableImage";

type Props = {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
};

async function uploadImage(file: File): Promise<string> {
  const token = localStorage.getItem("token") ?? sessionStorage.getItem("token");
  const body = new FormData();
  body.append("file", file);
  const response = await fetch("/api/uploads", {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    body,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.url) {
    throw new Error(data.detail || "Gagal mengunggah gambar.");
  }
  return data.url as string;
}

function ToolbarButton({
  label,
  active,
  disabled,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
      className={`inline-flex h-8 w-8 items-center justify-center rounded-md transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer ${
        active ? "bg-primary text-white" : "text-on-surface-variant hover:bg-surface-container-high hover:text-primary"
      }`}
    >
      {children}
    </button>
  );
}

export default function RichTextEditor({ value, onChange, placeholder, disabled = false, className }: Props) {
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const lastValue = useRef(value);

  const editor = useEditor({
    immediatelyRender: false,
    shouldRerenderOnTransaction: true,
    editable: !disabled,
    extensions: [
      StarterKit.configure({
        link: { openOnClick: false, autolink: true, HTMLAttributes: { rel: "noopener noreferrer nofollow", target: "_blank" } },
      }),
      ResizableImage.configure({ inline: false, allowBase64: false }),
      Placeholder.configure({ placeholder: placeholder ?? "" }),
    ],
    content: value || "",
    editorProps: { attributes: { class: "rte-prosemirror" } },
    onUpdate: ({ editor: instance }) => {
      const html = instance.getHTML();
      lastValue.current = html;
      onChange(html);
    },
  });

  useEffect(() => {
    if (!editor) return;
    const incoming = value || "";
    if (incoming !== lastValue.current && incoming !== editor.getHTML()) {
      editor.commands.setContent(incoming, { emitUpdate: false });
      lastValue.current = incoming;
    }
  }, [editor, value]);

  // TipTap v3 does not re-render on every transaction by default, which left the
  // toolbar's active state stale when a mark was toggled with no typing. Subscribe
  // explicitly so active states update immediately.
  const [, forceRerender] = useReducer((tick: number) => tick + 1, 0);
  useEffect(() => {
    if (!editor) return;
    const update = () => forceRerender();
    editor.on("transaction", update);
    editor.on("selectionUpdate", update);
    return () => {
      editor.off("transaction", update);
      editor.off("selectionUpdate", update);
    };
  }, [editor]);

  useEffect(() => {
    editor?.setEditable(!disabled);
  }, [editor, disabled]);

  if (disabled) {
    return <RichTextContent html={value} className={className} />;
  }

  const pickImage = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/png,image/jpeg,image/gif,image/webp";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file || !editor) return;
      setUploadError("");
      setUploading(true);
      try {
        const url = await uploadImage(file);
        editor.chain().focus().setImage({ src: url }).run();
      } catch (error) {
        setUploadError(error instanceof Error ? error.message : "Gagal mengunggah gambar.");
      } finally {
        setUploading(false);
      }
    };
    input.click();
  };

  const setLink = () => {
    if (!editor) return;
    const previous = editor.getAttributes("link").href as string | undefined;
    const url = window.prompt("Tautan URL:", previous ?? "https://");
    if (url === null) return;
    if (url === "") {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
      return;
    }
    editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
  };

  if (!editor) {
    return <div className={`rte-editor ${className ?? ""}`}><div className="rte-prosemirror min-h-28" /></div>;
  }

  return (
    <div className={`rte-editor ${className ?? ""}`}>
      <div className="rte-toolbar">
        <ToolbarButton label="Tebal" active={editor.isActive("bold")} onClick={() => editor.chain().focus().toggleBold().run()}>
          <Bold size={16} />
        </ToolbarButton>
        <ToolbarButton label="Miring" active={editor.isActive("italic")} onClick={() => editor.chain().focus().toggleItalic().run()}>
          <Italic size={16} />
        </ToolbarButton>
        <ToolbarButton label="Coret" active={editor.isActive("strike")} onClick={() => editor.chain().focus().toggleStrike().run()}>
          <Strikethrough size={16} />
        </ToolbarButton>
        <span className="mx-1 h-5 w-px self-center bg-outline-variant/50" />
        <ToolbarButton label="Daftar berbutir" active={editor.isActive("bulletList")} onClick={() => editor.chain().focus().toggleBulletList().run()}>
          <List size={16} />
        </ToolbarButton>
        <ToolbarButton label="Daftar bernomor" active={editor.isActive("orderedList")} onClick={() => editor.chain().focus().toggleOrderedList().run()}>
          <ListOrdered size={16} />
        </ToolbarButton>
        <ToolbarButton label="Blok kutipan" active={editor.isActive("blockquote")} onClick={() => editor.chain().focus().toggleBlockquote().run()}>
          <Quote size={16} />
        </ToolbarButton>
        <span className="mx-1 h-5 w-px self-center bg-outline-variant/50" />
        <ToolbarButton label="Kode sebaris" active={editor.isActive("code")} onClick={() => editor.chain().focus().toggleCode().run()}>
          <Code size={16} />
        </ToolbarButton>
        <ToolbarButton label="Blok kode" active={editor.isActive("codeBlock")} onClick={() => editor.chain().focus().toggleCodeBlock().run()}>
          <CodeXml size={16} />
        </ToolbarButton>
        <ToolbarButton label="Tautan" active={editor.isActive("link")} onClick={setLink}>
          <Link2 size={16} />
        </ToolbarButton>
        <ToolbarButton label={uploading ? "Mengunggah gambar..." : "Unggah gambar"} disabled={uploading} onClick={pickImage}>
          <ImagePlus size={16} />
        </ToolbarButton>
        <span className="mx-1 h-5 w-px self-center bg-outline-variant/50" />
        <ToolbarButton label="Urungkan" disabled={!editor.can().undo()} onClick={() => editor.chain().focus().undo().run()}>
          <Undo2 size={16} />
        </ToolbarButton>
        <ToolbarButton label="Ulangi" disabled={!editor.can().redo()} onClick={() => editor.chain().focus().redo().run()}>
          <Redo2 size={16} />
        </ToolbarButton>
      </div>
      <EditorContent editor={editor} />
      {uploadError && <p className="px-3 pb-2 text-xs text-error">{uploadError}</p>}
    </div>
  );
}
