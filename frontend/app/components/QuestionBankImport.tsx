"use client";

import { useEffect, useState } from "react";
import { Download, FileSpreadsheet, FileUp, TriangleAlert } from "lucide-react";
import AppSelect from "./AppSelect";

type Subject = {
  id: string;
  name: string;
};

export default function QuestionBankImport({
  token,
}: {
  token: string;
}) {
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [selectedSubjectId, setSelectedSubjectId] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/dashboard/summary", {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((res) => res.json())
      .then((data) => {
        setSubjects(data?.summary?.my_subjects ?? []);
      })
      .catch(() => {});
  }, [token]);

  async function downloadTemplate() {
    setError("");
    if (!selectedSubjectId) {
      setError("Tolong pilih mata kuliah terlebih dahulu.");
      return;
    }

    try {
      const response = await fetch(`/api/question-import-template?subject_id=${selectedSubjectId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) throw new Error();
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `template-bank-soal.xlsx`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch {
      setError("Terjadi error saat mengunduh template Excel.");
    }
  }

  async function upload(event: React.FormEvent) {
    event.preventDefault();
    if (!file) {
      setError("Silakan pilih atau tarik file Excel terlebih dahulu.");
      return;
    }
    setBusy(true);
    setError("");

    const body = new FormData();
    body.append("file", file);
    if (selectedSubjectId) {
      body.append("subject_id", selectedSubjectId);
    }

    try {
      const response = await fetch("/api/question-imports", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body,
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.detail || "Terjadi error saat memproses file.");
      }

      if (data.package && data.package.questions?.length > 0) {
        sessionStorage.setItem("imported_package", JSON.stringify(data.package));
        window.location.href = "/questions/create";
      } else {
        throw new Error("Tidak ada soal yang dapat dibaca dari file ini.");
      }
    } catch (caught) {
      const msg = caught instanceof Error ? caught.message : "Terjadi error saat memproses file.";
      setError(msg.startsWith("Terjadi error") ? msg : `Terjadi error: ${msg}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 border-b border-outline-variant/30 pb-3">
        <div className="flex items-center gap-2 text-on-surface">
          <FileSpreadsheet size={20} className="text-primary shrink-0" />
          <h3 className="font-semibold text-sm">Impor Bank Soal Excel</h3>
        </div>

        <div className="flex items-center gap-2">
          <AppSelect
            value={selectedSubjectId}
            onValueChange={(val) => {
              setSelectedSubjectId(val);
              setError("");
            }}
            className="w-48 text-xs"
            ariaLabel="Pilih Mata Kuliah"
            placeholder="Pilih Mata Kuliah"
            options={[
              { value: "", label: "Pilih Mata Kuliah" },
              ...subjects.map((s) => ({ value: s.id, label: s.name })),
            ]}
          />

          <button
            type="button"
            onClick={downloadTemplate}
            className="btn-secondary text-xs flex items-center gap-1.5 shrink-0"
          >
            <Download size={14} /> Unduh Template Excel
          </button>
        </div>
      </div>

      <form onSubmit={upload} className="space-y-4">
        <label
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setIsDragging(false);
            if (e.dataTransfer.files?.[0]) {
              setFile(e.dataTransfer.files[0]);
              setError("");
            }
          }}
          className={`relative flex flex-col items-center justify-center min-h-[220px] w-full rounded-2xl border-2 border-dashed p-6 text-center cursor-pointer transition-colors ${
            isDragging
              ? "border-primary bg-primary-fixed/20"
              : "border-outline-variant/60 bg-surface-container-low hover:border-primary/60 hover:bg-surface-container-high"
          }`}
        >
          <input
            type="file"
            accept=".xlsx,.xlsm,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            onChange={(e) => {
              if (e.target.files?.[0]) {
                setFile(e.target.files[0]);
                setError("");
              }
            }}
            className="hidden"
          />

          <div className="p-3 rounded-full bg-primary-fixed text-primary mb-3">
            <FileUp size={28} />
          </div>

          {file ? (
            <div className="space-y-1">
              <p className="font-semibold text-sm text-on-surface">{file.name}</p>
              <p className="text-xs text-on-surface-variant font-mono-ui">
                {(file.size / 1024).toFixed(1)} KB
              </p>
              <p className="text-xs text-primary font-medium mt-2">
                Klik atau tarik file lain untuk mengganti
              </p>
            </div>
          ) : (
            <div className="space-y-1">
              <p className="font-semibold text-sm text-on-surface">
                Tarik & lepas file Excel (.xlsx) di sini
              </p>
              <p className="text-xs text-on-surface-variant">
                atau klik untuk memilih file dari perangkat Anda
              </p>
            </div>
          )}
        </label>

        {error && (
          <div role="alert" className="flex items-center gap-2 rounded-lg border border-error/40 bg-error-container p-3 text-xs text-on-error-container">
            <TriangleAlert size={16} className="shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <button
          type="submit"
          disabled={!file || busy}
          className="btn-primary w-full py-2.5 text-sm font-semibold justify-center disabled:opacity-50"
        >
          {busy ? "Memvalidasi file..." : "Validasi File"}
        </button>
      </form>
    </div>
  );
}