# TimbangQR PostgreSQL v3.2

- Memperbaiki kegagalan `You cannot call a method on a null-valued expression` pada `setup-postgres-windows.ps1` saat role/database belum ada.
- Pemeriksaan role dan database kini memakai `SELECT EXISTS`, sehingga hasil kosong tidak lagi dipanggil dengan `.Trim()`.
- Menambahkan penanganan output/error `psql` yang lebih jelas.
- Menambahkan validasi `.env` dan `DATABASE_URL`.
- Menambahkan pengujian koneksi menggunakan user aplikasi setelah role dan database disiapkan.
- Password superuser PostgreSQL boleh dikosongkan bila instalasi lokal memang menggunakan autentikasi tanpa password.
