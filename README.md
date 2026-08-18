# TimbangQR PostgreSQL v3.1 — Tanpa Docker

Aplikasi penimbangan armada sampah Transdepo Harapan Jaya dengan QR Code per armada, koneksi indikator langsung RS232/RS485, PostgreSQL, tiket timbang, audit log, dan rekap Excel.

Versi ini **tidak membutuhkan Docker maupun WSL**. PostgreSQL dipasang langsung pada Windows untuk pengembangan lokal dan langsung pada Ubuntu VPS untuk produksi.

## Arsitektur

```text
Indikator timbangan
  → adapter USB–RS232/RS485
  → Serial Agent pada komputer operator
  → HTTP/HTTPS /api/serial/ingest
  → Next.js
  → PostgreSQL native
```

Serial Agent tetap berjalan pada komputer operator karena COM port berada di sana.

## Menjalankan lokal di Windows

Persyaratan:

- Node.js LTS;
- PostgreSQL untuk Windows;
- adapter USB–RS232 atau USB–RS485 sesuai indikator.

Persiapan pertama:

```text
SIAPKAN_DATABASE_WINDOWS.bat
```

Script akan membaca `DATABASE_URL` dari `.env`, meminta password superuser PostgreSQL, lalu membuat user dan database aplikasi.

Menjalankan aplikasi:

```text
MULAI_WINDOWS.bat
```

Buka `http://localhost:3000`.

Login awal:

```text
Email    : admin@lps.local
Password : Admin123!
```

Ganti akun dan seluruh secret sebelum penggunaan resmi.

## Cara manual

```powershell
copy .env.example .env
npm install
npm run db:init
npm run dev
```

Terminal kedua:

```powershell
cd serial-agent
copy .env.example .env
npm install
npm start
```

## PostgreSQL

Koneksi menggunakan:

```env
DATABASE_URL=postgresql://timbangqr:password@localhost:5432/timbangqr
DATABASE_SSL=false
```

Schema dan data awal dibuat idempoten melalui:

```powershell
npm run db:init
npm run db:check
```

## Deployment Hostinger VPS tanpa Docker

Panduan: `docs/DEPLOY_HOSTINGER_VPS_TANPA_DOCKER.md`.

Server menjalankan Next.js melalui PM2, PostgreSQL sebagai service native, dan Nginx sebagai reverse proxy. Serial Agent tidak dipasang di VPS.

## Validasi

```powershell
npm run typecheck
npm run build
npm run db:check
npm audit
```

Jangan menggunakan `npm audit fix --force`.
