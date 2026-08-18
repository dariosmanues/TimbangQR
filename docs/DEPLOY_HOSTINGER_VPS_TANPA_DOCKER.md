# Deployment Hostinger VPS tanpa Docker

## 1. Komponen pada VPS

- Ubuntu Server;
- Node.js LTS;
- PostgreSQL;
- Nginx;
- PM2;
- aplikasi TimbangQR.

Serial Agent tetap berjalan pada komputer operator yang tersambung ke RS232/RS485.

## 2. Instal paket server

```bash
sudo apt update
sudo apt install -y postgresql postgresql-contrib nginx
```

Pasang Node.js LTS menggunakan metode resmi yang Anda pilih, lalu pasang PM2:

```bash
sudo npm install -g pm2
```

## 3. Buat database

```bash
sudo -u postgres psql
```

Di dalam psql:

```sql
CREATE ROLE timbangqr LOGIN PASSWORD 'GANTI_PASSWORD_DATABASE';
CREATE DATABASE timbangqr OWNER timbangqr;
\q
```

## 4. Siapkan aplikasi

```bash
cd /var/www
sudo mkdir -p timbangqr
sudo chown -R $USER:$USER timbangqr
cd timbangqr
# salin seluruh source aplikasi ke folder ini
cp .env.example .env
nano .env
```

Konfigurasi minimum:

```env
APP_URL=https://domain-anda
COOKIE_SECURE=true
DATABASE_URL=postgresql://timbangqr:GANTI_PASSWORD_DATABASE@127.0.0.1:5432/timbangqr
DATABASE_SSL=false
JWT_SECRET=GANTI_RANDOM_MINIMAL_32_KARAKTER
SERIAL_API_KEY=GANTI_RANDOM_PANJANG
SERIAL_BRIDGE_MODE=remote
```

## 5. Install, inisialisasi, dan build

```bash
npm ci
npm run db:init
npm run typecheck
npm run build
npm run db:check
```

## 6. Jalankan dengan PM2

```bash
pm2 start npm --name timbangqr -- start
pm2 save
pm2 startup
```

Jalankan perintah tambahan yang ditampilkan oleh `pm2 startup`.

## 7. Nginx

Buat `/etc/nginx/sites-available/timbangqr`:

```nginx
server {
    listen 80;
    server_name domain-anda;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Aktifkan:

```bash
sudo ln -s /etc/nginx/sites-available/timbangqr /etc/nginx/sites-enabled/timbangqr
sudo nginx -t
sudo systemctl reload nginx
```

Aktifkan SSL melalui fasilitas Hostinger atau Certbot.

## 8. Serial Agent komputer operator

Di `serial-agent/.env`:

```env
SERIAL_INGEST_URL=https://domain-anda/api/serial/ingest
SERIAL_DEVICE_ID=TIMBANG-HJ-SERIAL-01
SERIAL_API_KEY=<harus sama dengan server>
SERIAL_PORT=COM3
SERIAL_INTERFACE=RS232
SERIAL_BAUD_RATE=9600
```

Jalankan `serial-agent/MULAI_SERIAL_AGENT.bat`.

## 9. Backup

Contoh backup manual:

```bash
pg_dump -U timbangqr -h 127.0.0.1 timbangqr > timbangqr-$(date +%F).sql
```

Simpan backup di lokasi lain, bukan hanya di VPS yang sama.
