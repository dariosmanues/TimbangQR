# Perubahan versi 2.0 — Direct Serial

- Menghapus ketergantungan ESP32 dari alur pembacaan timbangan.
- Menambahkan Serial Bridge Node.js untuk membuka COM port langsung.
- Menambahkan dukungan adapter USB–RS232 dan USB–RS485.
- Menambahkan deteksi COM port dari UI.
- Menambahkan konfigurasi baud rate, data bit, parity, stop bit, delimiter, dan mode idle.
- Menambahkan parser berat/status stabil yang dapat diuji dari UI.
- Menambahkan reconnect otomatis, throttle pembacaan identik, dan buffer kirim ulang.
- Mengubah endpoint perangkat menjadi `/api/serial/*`.
- Mempertahankan master armada, QR, transaksi, tiket, rekap, dan data seed Mei 2026.
- Menambahkan migrasi otomatis untuk database versi sebelumnya.
