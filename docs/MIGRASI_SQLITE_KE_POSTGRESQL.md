# Migrasi database SQLite versi 2 ke PostgreSQL versi 3

Migrasi hanya diperlukan apabila database v2 sudah memiliki transaksi baru yang tidak terdapat di `data/seed.json`.

## 1. Backup file lama

Salin seluruh folder `data` versi lama, terutama:

```text
data/timbang.db
data/timbang.db-wal
data/timbang.db-shm
```

Matikan aplikasi v2 sebelum menyalin agar isi konsisten.

## 2. Ekspor SQLite ke JSON

Dari folder v3:

```powershell
python scripts/export-sqlite.py "C:\lokasi-v2\data\timbang.db" "data\sqlite-export.json"
```

Script ini hanya membaca SQLite dan menggunakan modul bawaan Python.

## 3. Siapkan PostgreSQL

```powershell
docker compose up -d postgres
npm install
npm run db:init
```

## 4. Impor ke PostgreSQL

Perintah ini menghapus isi PostgreSQL tujuan dan menggantinya dengan data ekspor. Pastikan database tujuan sudah dibackup.

PowerShell:

```powershell
$env:MIGRATION_REPLACE="true"
npm run migrate:sqlite -- data/sqlite-export.json
Remove-Item Env:MIGRATION_REPLACE
npm run db:check
```

## 5. Rekonsiliasi

Bandingkan minimal:

- jumlah `vehicles`;
- jumlah `lps`;
- jumlah `weighings`;
- total `netto_2_kg`;
- tiket terakhir;
- login administrator;
- QR armada;
- data pembacaan perangkat terakhir.

Jangan hapus database SQLite sebelum hasil PostgreSQL diverifikasi.
