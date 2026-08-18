# Arsitektur TimbangQR PostgreSQL v3

## Produksi Hostinger

```text
QR Armada ───────────────────────────────┐
                                         ▼
Browser Operator → Next.js / Hostinger VPS → PostgreSQL → Tiket & Rekap Excel
                                         ▲
Indikator → RS232/RS485 → Serial Agent ──┘
```

## Pembagian proses

### Hostinger VPS

- Next.js web app dan API;
- autentikasi operator;
- master armada dan QR;
- transaksi timbang;
- PostgreSQL;
- dashboard, tiket, audit log, dan laporan.

### Komputer operator

- adapter USB–RS232/RS485;
- pembacaan COM port;
- parser data indikator;
- filter berat stabil;
- anti-duplikasi;
- antrean offline;
- pengiriman HTTPS ke VPS.

## Prinsip integrasi

1. Indikator tetap menjadi sumber berat resmi.
2. Aplikasi tidak terhubung langsung ke load cell dan tidak mengubah kalibrasi.
3. DB9 harus diverifikasi sebagai RS232 atau RS485, termasuk pinout dan parameter serial.
4. Serial Agent menggunakan `device_id` dan API key untuk setiap titik timbang.
5. Data mentah indikator tetap disimpan untuk audit.
6. PostgreSQL adalah database utama; file JSON pada Serial Agent hanya menjadi antrean sementara ketika jaringan putus.
