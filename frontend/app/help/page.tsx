"use client";

import { useEffect, useState } from "react";
import { BookOpen, CircleHelp, GraduationCap, LayoutDashboard, Lightbulb, ShieldCheck } from "lucide-react";
import { useAuth } from "../components/AuthProvider";

type AppRole = "ADMIN" | "LECTURER" | "STUDENT" | "GENERAL";

type HelpSection = {
  title: string;
  body?: string;
  steps?: string[];
};

type HelpContent = {
  label: string;
  icon: typeof GraduationCap;
  intro: string;
  sections: HelpSection[];
};

const CONTENT: Record<AppRole, HelpContent> = {
  STUDENT: {
    label: "Panduan Mahasiswa",
    icon: GraduationCap,
    intro: "Gunakan panduan ini untuk membuka paket ujian, mengerjakan pertanyaan, dan memantau status jawaban Anda.",
    sections: [
      { title: "Memulai evaluasi", steps: ["Buka menu Soal.", "Masukkan kode paket yang diberikan dosen.", "Periksa judul, mata kuliah, jumlah pertanyaan, dan instruksi sebelum menekan Mulai Ujian."] },
      { title: "Menjawab pertanyaan", steps: ["Baca pertanyaan sampai selesai.", "Tuliskan jawaban beserta alasan konseptual, bukan hanya hasil akhir.", "Gunakan navigasi nomor pertanyaan untuk berpindah dan meninjau jawaban.", "Kirim jawaban pada setiap pertanyaan. Jawaban yang dikirim akan tercatat sebagai percobaan."] },
      { title: "Memahami status", body: "Jawaban diterima berarti jawaban sudah tersimpan. Sedang dianalisis berarti sistem memproses jawaban. Menunggu validasi berarti hasil AI menunggu pemeriksaan dosen. Hasil evaluasi ditampilkan setelah proses validasi selesai." },
      { title: "Sebelum mengirim", steps: ["Pastikan semua pertanyaan sudah dijawab.", "Periksa kembali alasan dan istilah penting.", "Jangan membagikan kode paket atau jawaban kepada mahasiswa lain."] },
    ],
  },
  LECTURER: {
    label: "Panduan Dosen",
    icon: BookOpen,
    intro: "Gunakan panduan ini untuk membuat paket ujian, mengunggah bank soal, menyiapkan referensi AI, dan meninjau jawaban mahasiswa.",
    sections: [
      { title: "Membuat paket secara manual", steps: ["Buka menu Soal lalu pilih Buat Paket Ujian.", "Isi mata kuliah, kode paket, judul, dan instruksi.", "Tambahkan seluruh pertanyaan dalam paket.", "Isi jawaban referensi dan indikator konsep untuk setiap pertanyaan.", "Pastikan total bobot indikator pada setiap pertanyaan adalah 1.0000.", "Simpan sebagai draft dan terbitkan setelah semua pertanyaan siap."] },
      { title: "Mengunggah bank soal secara bulk", steps: ["Siapkan CSV menggunakan template bank soal.", "Pastikan setiap baris memiliki question_key, order_index, prompt, dan reference_answer.", "Gunakan format indikator label:bobot|label:bobot jika ingin menambahkan beberapa indikator.", "Buka bagian Import bank soal + bank jawaban di halaman Soal.", "Pilih mata kuliah, isi kode dan judul paket, lalu unggah file.", "Periksa jumlah baris valid dan daftar error sebelum melakukan commit.", "Commit file yang valid untuk membuat paket draft, kemudian terbitkan paket dari daftar paket."] },
      { title: "Referensi analisis AI", body: "Kolom reference_answer menjadi jawaban referensi utama untuk question version. answer_key menjaga identitas jawaban dari file dan indikator konsep membantu AI membandingkan penalaran mahasiswa secara terstruktur." },
      { title: "Meninjau jawaban", steps: ["Buka menu Jawaban Mahasiswa.", "Gunakan filter status untuk menemukan jawaban yang perlu ditinjau.", "Buka detail jawaban untuk membaca jawaban dan konteks pertanyaannya.", "Gunakan hasil analisis AI sebagai rekomendasi, lalu lakukan validasi akademik sebelum hasil dianggap final."] },
    ],
  },
  ADMIN: {
    label: "Panduan Administrator",
    icon: ShieldCheck,
    intro: "Administrator dapat memantau kondisi sistem, akses pengguna, mata kuliah, paket ujian, dan aktivitas pengumpulan.",
    sections: [
      { title: "Memantau sistem", steps: ["Gunakan Dashboard untuk melihat ringkasan pengguna, mata kuliah, paket, pengumpulan, analisis, dan validasi.", "Periksa Profile untuk memastikan role dan mata kuliah akun sesuai.", "Gunakan Settings untuk preferensi tampilan dan konfigurasi yang tersedia."] },
      { title: "Mendukung dosen", body: "Pastikan dosen memiliki role pada mata kuliah yang benar sebelum membuat atau mengunggah paket. Paket yang diimpor tetap harus diperiksa dan diterbitkan oleh dosen." },
      { title: "Menangani masalah", steps: ["Catat kode paket dan akun yang mengalami masalah.", "Periksa status paket dan jawaban pada Dashboard atau Jawaban Mahasiswa.", "Jangan menghapus data ujian tanpa memastikan dampaknya terhadap riwayat mahasiswa."] },
    ],
  },
  GENERAL: {
    label: "Panduan Akun Umum",
    icon: LayoutDashboard,
    intro: "Akun umum dapat melihat informasi profil dan halaman dashboard sesuai akses yang diberikan.",
    sections: [
      { title: "Navigasi dasar", steps: ["Buka Dashboard untuk melihat ringkasan akun.", "Buka Profile untuk melihat identitas dan role.", "Gunakan Ganti peran jika akun Anda memiliki lebih dari satu role."] },
      { title: "Meminta akses", body: "Jika Anda perlu mengerjakan evaluasi atau mengelola paket ujian, hubungi administrator untuk mendapatkan role pada mata kuliah yang sesuai." },
    ],
  },
};

export default function HelpPage() {
  const { user, loading } = useAuth();
  const [role, setRole] = useState<AppRole>("GENERAL");

  useEffect(() => {
    if (!user) return;
    const stored = window.localStorage.getItem("selected_role");
    if (user.is_superuser) setRole("ADMIN");
    else if (stored === "LECTURER" || stored === "STUDENT") setRole(stored);
    else setRole(user.roles?.[0]?.role === "LECTURER" ? "LECTURER" : user.roles?.[0]?.role === "STUDENT" ? "STUDENT" : "GENERAL");
  }, [user]);

  if (loading || !user) return null;
  const content = CONTENT[role];
  const Icon = content.icon;

  return (
    <div style={{ maxWidth: "960px", margin: "0 auto" }}>
      <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-primary-fixed-dim bg-primary-fixed/60 px-3 py-1 text-xs font-bold uppercase tracking-wider text-primary"><CircleHelp size={14} /> Pusat Bantuan</div>
          <h1 className="mt-2 font-display text-2xl font-bold text-on-surface">{content.label}</h1>
          <p className="mt-1 max-w-2xl text-sm text-on-surface-variant">{content.intro}</p>
        </div>
        <div className="flex items-center gap-2 rounded-lg border border-outline-variant/40 bg-surface-container-low px-3 py-2 text-xs font-semibold text-on-surface-variant"><Icon size={16} color="var(--primary)" /> Role aktif: {content.label.replace("Panduan ", "")}</div>
      </header>

      <div className="mt-8 grid gap-4 md:grid-cols-2">
        {content.sections.map((section, index) => <section key={section.title} className="glass-card p-5"><div className="flex items-start gap-3"><span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary-fixed text-sm font-bold text-primary">{index + 1}</span><div className="min-w-0"><h2 className="font-display text-base font-bold text-on-surface">{section.title}</h2>{section.body && <p className="mt-2 text-sm leading-6 text-on-surface-variant">{section.body}</p>}{section.steps && <ol className="mt-2 space-y-2 text-sm leading-6 text-on-surface-variant">{section.steps.map((step) => <li key={step}>{step}</li>)}</ol>}</div></div></section>)}
      </div>

      <section className="mt-6 rounded-xl border border-primary-fixed-dim bg-primary-fixed/40 p-5"><div className="flex items-start gap-3"><Lightbulb size={19} color="var(--primary)" /><div><h2 className="font-display text-base font-bold text-on-surface">Butuh bantuan lebih lanjut?</h2><p className="mt-1 text-sm text-on-surface-variant">Sertakan email akun, mata kuliah, kode paket, dan langkah terakhir yang dilakukan saat melaporkan kendala kepada administrator.</p></div></div></section>
    </div>
  );
}