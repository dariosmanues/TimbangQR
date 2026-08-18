# TimbangQR v2.2.0 — Security Dependency Fix

- Memaksa seluruh dependency transitif menggunakan `tmp@0.2.7` melalui `overrides` pada root `package.json`.
- Memperbaiki peringatan audit GHSA-52f5-9888-hmc6 dan GHSA-ph9p-34f9-6g65 tanpa menurunkan `exceljs`.
- Tidak menggunakan `npm audit fix --force` karena perintah tersebut dapat mengganti versi dependency utama di luar rentang yang ditetapkan.

## Instalasi bersih Windows

```powershell
Remove-Item -Recurse -Force node_modules -ErrorAction SilentlyContinue
Remove-Item -Force package-lock.json -ErrorAction SilentlyContinue
npm install
npm ls tmp
npm audit
npm run dev
```

Hasil `npm ls tmp` yang diharapkan adalah `tmp@0.2.7 overridden`.
