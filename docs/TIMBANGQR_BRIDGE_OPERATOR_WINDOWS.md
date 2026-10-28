# TimbangQR Bridge untuk Operator Windows

Bridge menggantikan perintah developer `npm run serial:agent`. Setelah installer dipasang, operator membuka **TimbangQR Bridge** dari Start Menu, melakukan konfigurasi awal, lalu memilih COM port dan menekan **Hubungkan timbangan**.

## Yang operator lakukan

1. Buka TimbangQR Bridge.
2. Isi URL API TimbangQR (`https://timbangqr-ocr-led-rose.vercel.app/api/serial/ingest`), ID perangkat (`TIMBANG-HJ-SERIAL-01`), dan credential perangkat (`SERIAL_API_KEY`).
3. Klik **Deteksi port**, pilih COM port indikator, lalu **Hubungkan timbangan**.
4. Tutup jendela bila selesai. Bridge terus berjalan melalui system tray.

Credential disimpan menggunakan Windows Data Protection API. Data antrean dan konfigurasi serial berada di profil Windows operator, bukan folder source code.

## Build installer (Kompatibel Windows 7 32-bit / Windows 10 / 11)

Installer menggunakan Electron 22 (Chromium 109) dan target arsitektur `ia32` agar dapat berjalan langsung di komputer lama Windows 7 32-bit tanpa membutuhkan Node.js di komputer target.

Developer memicu workflow GitHub Actions **Build TimbangQR Bridge for Windows** atau menjalankan:

```powershell
npm install
npm run bridge:build
```

Installer hasil build berada di:
`dist/TimbangQR-Bridge-Setup-win7-32bit-*.exe`

## Smoke test tanpa perangkat fisik

Dengan Node.js 22 atau lebih baru dan dependensi dari lockfile:

```powershell
npm ci
node --test scripts/smoke-serial-agent.test.mjs
```

Enam pengujian menjalankan proses Serial Agent asli dengan folder sementara,
port lokal dinamis, dan server ingest tiruan di loopback. Pengujian mencakup
autentikasi bridge, enumerasi port melalui modul native, parser berat stabil dan
tidak stabil, `dry_run`, antrean yang bertahan saat HTTP 401/503 dan restart,
urutan pengiriman setelah pulih, serta pengosongan antrean. Pengujian tidak
mengirim data ke Vercel atau mengubah konfigurasi operator.

Workflow menjalankan suite ini sebelum packaging. Setelah packaging, workflow
memulai executable Windows ia32 dan memeriksa health, enumerasi port, serta
hasil parser `ST 1250 kg`. Proses paket dibersihkan juga bila pemeriksaan gagal.
Pemeriksaan paket harus dijalankan pada Windows; suite Node di Linux tidak
membuktikan kompatibilitas installer, Windows 7, atau perangkat RS232/RS485 asli.

