# TimbangQR PostgreSQL v3.2

- Memperbaiki kegagalan `You cannot call a method on a null-valued expression` pada `setup-postgres-windows.ps1` saat role/database belum ada.
- Pemeriksaan role dan database kini memakai `SELECT EXISTS`, sehingga hasil kosong tidak lagi dipanggil dengan `.Trim()`.
- Menambahkan penanganan output/error `psql` yang lebih jelas.
- Menambahkan validasi `.env` dan `DATABASE_URL`.
- Menambahkan pengujian koneksi menggunakan user aplikasi setelah role dan database disiapkan.
- Password superuser PostgreSQL boleh dikosongkan bila instalasi lokal memang menggunakan autentikasi tanpa password.

## v3.2.7 (Fix Windows 7 / 32-bit: Eliminasi Total Fetch & Conflict Port)
- Menghapus ketergantungan `fetch` secara menyeluruh dari seluruh komponen Bridge (`bridge-desktop/main.cjs` dan `serial-agent/server.mjs`), sehingga 100% kompatibel dengan Node 16 / Electron 22 di Windows 7 32-bit.
- Pengiriman data ingest ke server cloud kini menggunakan native `node:https` dan `node:http` dengan dukungan otomatis pengalihan HTTP (301/302/307/308) ke Vercel.
- Menambahkan **Single Instance Lock** (`app.requestSingleInstanceLock`) pada Electron agar aplikasi tidak berjalan ganda secara bersamaan di system tray.
- Menambahkan pembersihan otomatis proses orphan (`killOrphanOnPort(8787)`) sebelum menjalankan Serial Agent baru untuk mencegah error `EADDRINUSE`.
- Mencegah penghapusan antrean data timbangan (`flushQueue`) saat terjadi error permanen/autentikasi (seperti HTTP 401); data antrean tetap aman di disk hingga kunci/server dibetulkan.
- Menjamin seluruh data pembacaan fisik baru tetap otomatis masuk antrean offline saat terjadi error (termasuk HTTP 401) sehingga riwayat penimbangan di lapangan tidak hilang.
- Mengurutkan pengiriman frame serial secara sekuensial (FIFO promise chain) untuk mencegah race condition / pengiriman frame secara paralel ke Vercel.
- Memperbesar kapasitas antrean offline lokal dari 100 menjadi 5.000 data timbangan (~1 MB JSON buffer).
- Mengamankan `killOrphanOnPort` agar hanya mematikan proses turunan Node/Electron/TimbangQR pada port 8787 dan tidak mengganggu proses Windows lainnya.
- Mode `dry_run` verifikasi koneksi tidak memperbarui `last_seen_at` sehingga kolom "Terakhir menerima" murni mencatat pembacaan timbangan riil.
- Memperbaiki path executable smoke test pada CI workflow GitHub Actions (`dist\win-ia32-unpacked`).

