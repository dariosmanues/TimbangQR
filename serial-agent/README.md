# TimbangQR Serial Agent

Program ini dijalankan **hanya pada komputer operator** yang terhubung ke indikator melalui adapter USB–RS232/RS485. Program membaca COM port, memfilter berat stabil, menyimpan antrean ketika internet putus, lalu mengirim data ke API TimbangQR di Hostinger.

## Penggunaan Windows

1. Salin `.env.example` menjadi `.env`.
2. Isi `SERIAL_INGEST_URL`, `SERIAL_API_KEY`, dan `SERIAL_PORT`.
3. Jalankan `MULAI_SERIAL_AGENT.bat`.
4. Biarkan jendela terminal tetap terbuka.

API lokal agent tersedia di `http://127.0.0.1:8787`. Jangan membuka port ini ke internet.
