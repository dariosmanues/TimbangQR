# TimbangQR Direct Serial v2.1.0

## Perbaikan Windows

- Memperbaiki `Error: spawn EINVAL` pada `npm run dev`.
- `scripts/dev.mjs` dan `scripts/start.mjs` tidak lagi menjalankan `npm.cmd` melalui `spawn()`.
- Next.js dan Serial Bridge sekarang dijalankan langsung menggunakan `node.exe`, sehingga aman untuk folder Windows yang mengandung spasi dan kompatibel dengan Node.js 22–26.
- Node.js LTS 22 atau 24 tetap direkomendasikan untuk penggunaan operasional.
