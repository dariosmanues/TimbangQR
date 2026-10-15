# TimbangQR Bridge untuk Operator Windows

Bridge menggantikan perintah developer `npm run serial:agent`. Setelah installer dipasang, operator membuka **TimbangQR Bridge** dari Start Menu, melakukan konfigurasi awal, lalu memilih COM port dan menekan **Hubungkan timbangan**.

## Yang operator lakukan

1. Buka TimbangQR Bridge.
2. Isi URL API TimbangQR yang disediakan administrator, ID perangkat, dan credential perangkat.
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

