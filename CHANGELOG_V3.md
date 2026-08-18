# Changelog v3.0.0

- Mengganti database utama dari SQLite menjadi PostgreSQL.
- Menghapus runtime dependency `better-sqlite3`.
- Mengubah seluruh query sinkron menjadi query PostgreSQL asynchronous.
- Menambahkan transaction locking untuk nomor tiket dan kode armada.
- Mengubah kolom boolean SQLite menjadi tipe PostgreSQL `BOOLEAN`.
- Menggunakan `TIMESTAMPTZ`, `JSONB`, indeks, foreign key, dan connection pool.
- Menambahkan auto schema initialization dan seed data awal.
- Menambahkan Docker Compose berisi Next.js dan PostgreSQL.
- Memisahkan Serial Agent dari web app agar sesuai deployment Hostinger.
- Menambahkan buffer offline Serial Agent dan API ingest dengan API key hash.
- Menambahkan export/import migrasi SQLite v2 ke PostgreSQL v3.
- Memperbaiki error TypeScript ExcelJS dengan `colNumber` pada callback `eachCell`.
- Menambahkan override dependency `tmp`, `fast-csv`, dan `uuid` untuk versi yang sudah diperbaiki.
