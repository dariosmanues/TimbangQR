# Validation v3.0.0

Pemeriksaan yang dilakukan pada source package:

- Seluruh file JSON berhasil diparse.
- `node --check` berhasil untuk Serial Agent dan process launcher.
- `python -m py_compile` berhasil untuk exporter SQLite.
- Modul database PostgreSQL dan query utama lolos pemeriksaan TypeScript strict menggunakan declaration stub lokal.
- Seluruh file TypeScript/TSX lolos pemeriksaan sintaks dan resolusi internal menggunakan TypeScript lokal dan declaration stub.
- Tidak ditemukan referensi runtime `better-sqlite3`, `DB_PATH`, atau file `timbang.db` pada web app.
- Struktur seed diperiksa: 78 armada, 32 LPS, 114 penugasan, 1.896 transaksi, dan total netto 2 sebesar 2.529.970 kg; termasuk nomor tiket sumber yang memang memiliki duplikasi; karena itu `ticket_number` dipertahankan sebagai kolom berindeks, bukan UNIQUE.
- Error ExcelJS `cell.col` dibandingkan dengan angka sudah diganti dengan parameter `colNumber`.

Keterbatasan lingkungan penyusunan:

- Instalasi npm penuh tidak dapat diselesaikan karena registry internal lingkungan tidak menyediakan seluruh package dan koneksi registry publik timeout.
- PostgreSQL dan Docker tidak tersedia pada lingkungan penyusunan, sehingga integrasi database langsung belum dijalankan di sini.

Validasi final pada komputer/VPS tujuan:

```bash
npm install
npm audit
npm run typecheck
npm run build
docker compose up -d postgres
npm run db:init
npm run db:check
```
