"use client";

import { useRef, useState } from "react";
import { ImagePlus, X } from "lucide-react";
import { uploadFile } from "../lib/upload";

type Props = {
  value: string;
  onChange: (url: string) => void;
  label?: string;
  hint?: string;
  disabled?: boolean;
};

export default function ImageUploadField({ value, onChange, label = "Gambar", hint, disabled }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setError("");
    setBusy(true);
    try {
      onChange(await uploadFile(file));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Gagal mengunggah gambar.");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  return (
    <div>
      <label className="mb-1.5 block text-sm font-medium text-on-surface-variant">{label}</label>
      <div className="flex items-start gap-3">
        <div className="grid h-20 w-32 shrink-0 place-items-center overflow-hidden rounded-lg border border-outline-variant/50 bg-surface-container">
          {value ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={value} alt="Pratinjau" className="h-full w-full object-cover" />
          ) : (
            <ImagePlus size={22} className="text-on-surface-variant" />
          )}
        </div>
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={disabled || busy}
              onClick={() => inputRef.current?.click()}
              className="btn-secondary text-xs disabled:opacity-50"
            >
              {busy ? "Mengunggah..." : value ? "Ganti gambar" : "Unggah gambar"}
            </button>
            {value && (
              <button
                type="button"
                disabled={disabled || busy}
                onClick={() => onChange("")}
                className="inline-flex items-center gap-1 text-xs font-semibold text-error disabled:opacity-50"
              >
                <X size={13} /> Hapus
              </button>
            )}
          </div>
          {hint && <p className="text-[11px] text-on-surface-variant">{hint}</p>}
          <p className="text-[11px] text-on-surface-variant">PNG, JPG, GIF, atau WEBP. Maksimal 5MB.</p>
          {error && <p className="text-[11px] text-error">{error}</p>}
        </div>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp"
        className="hidden"
        onChange={(event) => void pick(event.target.files?.[0])}
      />
    </div>
  );
}
