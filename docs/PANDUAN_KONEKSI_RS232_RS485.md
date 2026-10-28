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

## Parameter Koneksi ke Bridge & Cloud (`https://timbangqr-ocr-led-rose.vercel.app/`)

| Parameter | Nilai Standar / Contoh | Keterangan |
| :--- | :--- | :--- |
| **URL API Ingest (`SERIAL_INGEST_URL`)** | `https://timbangqr-ocr-led-rose.vercel.app/api/serial/ingest` | Otomatis dinormalisasi bila diisi `https://timbangqr-ocr-led-rose.vercel.app/` |
| **ID Perangkat (`SERIAL_DEVICE_ID`)** | `TIMBANG-HJ-SERIAL-01` | Harus sama dengan `device_code` pada tabel `weighbridge_devices` di PostgreSQL |
| **Serial API Key (`SERIAL_API_KEY`)** | Sesuai nilai `SERIAL_API_KEY` di server / database (default: `serial-local-key-ganti-sebelum-produksi`) | Dikirim melalui header `x-serial-key` |
| **Bridge Lokal (`SERIAL_BRIDGE_HOST:PORT`)** | `127.0.0.1:8787` | Hanya diakses lokal di PC operator |
| **Bridge Admin Key (`SERIAL_BRIDGE_ADMIN_KEY`)** | `bridge-admin-key-ganti-sebelum-produksi` | Header `x-bridge-key` antara aplikasi desktop & Serial Agent lokal |
| **COM Port (`SERIAL_PORT`)** | `COM1` / `COM3` (sesuai Device Manager) | Port adapter USB–RS232 / USB–RS485 |
| **Antarmuka (`SERIAL_INTERFACE`)** | `RS232` (atau `RS485`) | Jenis koneksi fisik indikator |
| **Parameter Serial** | Baud `9600`, Data `8` bit, Parity `none`, Stop `1` bit | Standar indikator Sonic A28E (sesuaikan manual bila berbeda) |
| **Mode Frame & Delimiter** | `line` dengan delimiter `\r\n` (atau `idle` `120` ms) | Pemisah antar paket data indikator |
| **Parser Berat & Stabilitas** | Weight regex `[-+]?\d+(?:[.,]\d+)?`, Pengali `1`, Stable regex `\b(ST\|STAB\|STABLE)\b`, Unstable regex `\b(US\|UNST\|UNSTABLE)\b`, Sampel `3`, Toleransi `1` kg | Filter angka berat dan status stabil |

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
