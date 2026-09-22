from django.db import migrations


GUIDES = {
    'STUDENT': [
        ('Memulai evaluasi', '1. Buka menu Soal.\n2. Masukkan kode paket yang diberikan dosen.\n3. Periksa judul, mata kuliah, jumlah pertanyaan, dan instruksi sebelum menekan Mulai Ujian.'),
        ('Menjawab pertanyaan', '1. Baca pertanyaan sampai selesai.\n2. Tuliskan jawaban beserta alasan konseptual, bukan hanya hasil akhir.\n3. Gunakan navigasi nomor pertanyaan untuk berpindah dan meninjau jawaban.\n4. Kirim jawaban pada setiap pertanyaan. Jawaban yang dikirim akan tercatat sebagai percobaan.'),
        ('Memahami status', 'Jawaban diterima berarti jawaban sudah tersimpan. Sedang dianalisis berarti sistem memproses jawaban. Menunggu validasi berarti hasil AI menunggu pemeriksaan dosen. Hasil evaluasi ditampilkan setelah proses validasi selesai.'),
        ('Sebelum mengirim', '1. Pastikan semua pertanyaan sudah dijawab.\n2. Periksa kembali alasan dan istilah penting.\n3. Jangan membagikan kode paket atau jawaban kepada mahasiswa lain.'),
    ],
    'LECTURER': [
        ('Membuat paket secara manual', '1. Buka menu Soal lalu pilih Buat Paket Ujian.\n2. Isi mata kuliah, kode paket, judul, dan instruksi.\n3. Tambahkan seluruh pertanyaan dalam paket.\n4. Isi jawaban referensi dan indikator konsep untuk setiap pertanyaan.\n5. Pastikan total bobot indikator pada setiap pertanyaan adalah 1.0000.\n6. Simpan sebagai draft dan terbitkan setelah semua pertanyaan siap.'),
        ('Mengunggah bank soal secara bulk', '1. Siapkan CSV menggunakan template bank soal.\n2. Pastikan setiap baris memiliki question_key, order_index, prompt, dan reference_answer.\n3. Gunakan format indikator label:bobot|label:bobot jika ingin menambahkan beberapa indikator.\n4. Buka bagian Import bank soal + bank jawaban di halaman Soal.\n5. Pilih mata kuliah, isi kode dan judul paket, lalu unggah file.\n6. Periksa jumlah baris valid dan daftar error sebelum melakukan commit.\n7. Commit file yang valid untuk membuat paket draft, kemudian terbitkan paket dari daftar paket.'),
        ('Referensi analisis AI', 'Kolom reference_answer menjadi jawaban referensi utama untuk question version. answer_key menjaga identitas jawaban dari file dan indikator konsep membantu AI membandingkan penalaran mahasiswa secara terstruktur.'),
        ('Meninjau jawaban', '1. Buka menu Jawaban Mahasiswa.\n2. Gunakan filter status untuk menemukan jawaban yang perlu ditinjau.\n3. Buka detail jawaban untuk membaca jawaban dan konteks pertanyaannya.\n4. Gunakan hasil analisis AI sebagai rekomendasi, lalu lakukan validasi akademik sebelum hasil dianggap final.'),
    ],
    'ADMIN': [
        ('Memantau sistem', '1. Gunakan Dashboard untuk melihat ringkasan pengguna, mata kuliah, paket, pengumpulan, analisis, dan validasi.\n2. Periksa Profile untuk memastikan role dan mata kuliah akun sesuai.\n3. Gunakan Settings untuk preferensi tampilan dan konfigurasi yang tersedia.'),
        ('Mendukung dosen', 'Pastikan dosen memiliki role pada mata kuliah yang benar sebelum membuat atau mengunggah paket. Paket yang diimpor tetap harus diperiksa dan diterbitkan oleh dosen.'),
        ('Menangani masalah', '1. Catat kode paket dan akun yang mengalami masalah.\n2. Periksa status paket dan jawaban pada Dashboard atau Jawaban Mahasiswa.\n3. Jangan menghapus data ujian tanpa memastikan dampaknya terhadap riwayat mahasiswa.'),
    ],
    'GENERAL': [
        ('Navigasi dasar', '1. Buka Dashboard untuk melihat ringkasan akun.\n2. Buka Profile untuk melihat identitas dan role.\n3. Gunakan Ganti peran jika akun Anda memiliki lebih dari satu role.'),
        ('Meminta akses', 'Jika Anda perlu mengerjakan evaluasi atau mengelola paket ujian, hubungi administrator untuk mendapatkan role pada mata kuliah yang sesuai.'),
    ],
}


def seed_help_articles(apps, schema_editor):
    HelpArticle = apps.get_model('api', 'HelpArticle')
    for role, articles in GUIDES.items():
        for order_index, (title, body) in enumerate(articles, start=1):
            HelpArticle.objects.get_or_create(role=role, title=title, defaults={'body': body, 'order_index': order_index, 'is_published': True})


class Migration(migrations.Migration):
    dependencies = [('api', '0004_help_articles')]
    operations = [migrations.RunPython(seed_help_articles, migrations.RunPython.noop)]
