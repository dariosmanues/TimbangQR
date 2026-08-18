# Panduan Koneksi Langsung Indikator

## Rangkaian

### Untuk indikator RS232

```text
DB9 indikator → kabel dengan pinout sesuai manual → adapter USB–RS232 terisolasi → komputer
```

### Untuk indikator RS485

```text
Terminal/DB9 indikator A-B-(GND sesuai manual) → adapter USB–RS485 terisolasi → komputer
```

Jangan menganggap konektor DB9 selalu RS232 atau selalu memakai pin 2, 3, dan 5 seperti port PC. Periksa manual indikator atau uji menggunakan teknisi karena DB9 hanya bentuk konektor; sinyal dan pinout dapat berbeda.

## Parameter yang wajib diketahui

- RS232 atau RS485.
- Mode output kontinu atau hanya saat tombol PRINT.
- Baud rate.
- Data bit.
- Parity.
- Stop bit.
- Pemisah data: CR, LF, CRLF, atau jeda transmisi.
- Contoh string keluaran ketika stabil dan tidak stabil.
- Satuan keluaran: kg, gram, atau ton.

## Langkah Windows

1. Pasang driver adapter USB serial.
2. Sambungkan adapter ke komputer.
3. Buka **Device Manager → Ports (COM & LPT)**.
4. Catat port, misalnya `COM3`.
5. Jalankan aplikasi dengan `npm run dev`.
6. Login dan buka **Koneksi Timbangan**.
7. Klik **Deteksi port**.
8. Pilih COM port dan parameter sesuai manual indikator.
9. Masukkan contoh string pada bagian **Parser indikator** lalu klik **Simpan parser & uji**.
10. Setelah hasil berat benar, klik **Simpan & hubungkan**.

## Catatan RS485

- Pastikan polaritas A/B sesuai manual. Bila tidak ada data, periksa apakah label vendor menggunakan A+/B- atau kebalikannya.
- Terminasi 120 ohm tidak otomatis diperlukan untuk kabel pendek satu perangkat; ikuti manual dan kondisi instalasi.
- Gunakan kabel twisted pair shielded untuk lingkungan dengan motor, panel daya, atau gangguan listrik.

## Gangguan umum

- **Port tidak muncul:** driver adapter belum terpasang atau kabel USB bermasalah.
- **Access denied:** COM port sedang dibuka aplikasi lain. Tutup terminal serial atau software indikator.
- **Teks acak:** baud rate, parity, data bit, atau stop bit salah.
- **Tidak ada data:** indikator hanya mengirim saat PRINT atau TX/RX/pin A-B salah.
- **Berat salah 1.000 kali:** sesuaikan `Pengali berat`, misalnya `0.001` untuk gram menjadi kg.
- **Status tidak pernah stabil:** sesuaikan regex stabil atau gunakan sampel stabil tanpa flag.
