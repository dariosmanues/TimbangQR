import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Pool, type PoolClient, type QueryResultRow, types } from "pg";
import seed from "../../data/seed.json";
import octArmada from "../../data/master_armada_harapan_jaya_okt2026.json";
import { loadEnvIfNeeded } from "./env";

// PostgreSQL mengembalikan BIGINT sebagai string secara default. Nilai aplikasi
// ini masih berada pada rentang aman Number JavaScript, jadi dikonversi ke number.
types.setTypeParser(20, (value) => Number(value));
types.setTypeParser(1114, (value) => value);
types.setTypeParser(1184, (value) => new Date(value).toISOString());

type DbExecutor = Pool | PoolClient;

declare global {
  var __timbangPool: Pool | undefined;
  var __timbangInitPromise: Promise<void> | undefined;
}

function readEnvFileVar(varName: string): string | undefined {
  try {
    const candidatePaths = [
      path.resolve(process.cwd(), ".env"),
      path.resolve(process.cwd(), ".env.local"),
      path.resolve(__dirname, "../../.env"),
      path.resolve(__dirname, "../../../.env"),
    ];
    for (const envPath of candidatePaths) {
      if (fs.existsSync(/*turbopackIgnore: true*/ envPath)) {
        const content = fs.readFileSync(/*turbopackIgnore: true*/ envPath, "utf-8");
        const regex = new RegExp(`^${varName}\\s*=\\s*(.+)$`, "m");
        const match = content.match(regex);
        if (match) {
          return match[1].trim().replace(/^['"](.*)['"]$/, "$1");
        }
      }
    }
  } catch {}
  return undefined;
}

function getDatabaseUrl() {
  loadEnvIfNeeded();
  const value = process.env.DATABASE_URL?.trim() || readEnvFileVar("DATABASE_URL");
  if (!value) {
    throw new Error(
      "DATABASE_URL belum diisi. Salin .env.example menjadi .env lalu isi koneksi PostgreSQL."
    );
  }
  return value;
}

function isSslEnabled() {
  const value = (process.env.DATABASE_SSL || "false").trim().toLowerCase();
  return ["1", "true", "yes", "require"].includes(value);
}

function shouldAutoInitializeDatabase() {
  const configured = process.env.DATABASE_AUTO_INIT?.trim().toLowerCase();
  if (configured) return ["1", "true", "yes", "on"].includes(configured);

  // Vercel menjalankan banyak instance serverless. Menjalankan CREATE TABLE,
  // seed, dan UPSERT perangkat serial pada setiap instance membuat navigasi
  // halaman lambat dan tidak diperlukan setelah db:init selesai.
  return !process.env.VERCEL;
}

export function getPool() {
  if (globalThis.__timbangPool) return globalThis.__timbangPool;

  const pool = new Pool({
    connectionString: getDatabaseUrl(),
    ssl: isSslEnabled() ? { rejectUnauthorized: false } : undefined,
    // Satu instance Vercel cukup memakai satu koneksi ke URL Neon pooled.
    // Batas lokal tetap 10 agar pengembangan lokal tidak berubah.
    max: Number((process.env.DATABASE_POOL_MAX || (process.env.VERCEL ? "1" : "10")).trim()),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 20_000,
    application_name: "timbangqr-postgresql",
  });

  pool.on("error", (error) => {
    console.error("[PostgreSQL] Koneksi pool bermasalah:", error);
  });

  globalThis.__timbangPool = pool;
  return pool;
}

export function hashDeviceKey(value: string) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

async function createSchema(client: PoolClient) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'ADMIN',
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS lps (
      id SERIAL PRIMARY KEY,
      code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL UNIQUE,
      address TEXT,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS vehicles (
      id SERIAL PRIMARY KEY,
      code TEXT NOT NULL UNIQUE,
      plate_number TEXT NOT NULL,
      plate_normalized TEXT NOT NULL,
      vehicle_type TEXT NOT NULL,
      waste_type TEXT NOT NULL,
      default_tare_kg INTEGER,
      qr_token TEXT NOT NULL UNIQUE,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      no_urut INTEGER,
      nomor_izin TEXT,
      nomor_sk_lps TEXT,
      tanggal_sk_lps TEXT,
      kecamatan TEXT,
      nama_lps TEXT,
      nomor_surat_permohonan TEXT,
      tanggal_permohonan TEXT,
      nama_lps_2 TEXT,
      nama_ketua_lps TEXT,
      alamat_lps TEXT,
      kelurahan_lps TEXT,
      kecamatan_lps TEXT,
      wilayah_kerja TEXT,
      lokasi_tps TEXT DEFAULT 'HARAPAN JAYA',
      tanggal_terbit_izin TEXT,
      lampiran_camat TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    ALTER TABLE vehicles 
      ADD COLUMN IF NOT EXISTS no_urut INTEGER,
      ADD COLUMN IF NOT EXISTS nomor_izin TEXT,
      ADD COLUMN IF NOT EXISTS nomor_sk_lps TEXT,
      ADD COLUMN IF NOT EXISTS tanggal_sk_lps TEXT,
      ADD COLUMN IF NOT EXISTS kecamatan TEXT,
      ADD COLUMN IF NOT EXISTS nama_lps TEXT,
      ADD COLUMN IF NOT EXISTS nomor_surat_permohonan TEXT,
      ADD COLUMN IF NOT EXISTS tanggal_permohonan TEXT,
      ADD COLUMN IF NOT EXISTS nama_lps_2 TEXT,
      ADD COLUMN IF NOT EXISTS nama_ketua_lps TEXT,
      ADD COLUMN IF NOT EXISTS alamat_lps TEXT,
      ADD COLUMN IF NOT EXISTS kelurahan_lps TEXT,
      ADD COLUMN IF NOT EXISTS kecamatan_lps TEXT,
      ADD COLUMN IF NOT EXISTS wilayah_kerja TEXT,
      ADD COLUMN IF NOT EXISTS lokasi_tps TEXT DEFAULT 'HARAPAN JAYA',
      ADD COLUMN IF NOT EXISTS tanggal_terbit_izin TEXT,
      ADD COLUMN IF NOT EXISTS lampiran_camat TEXT;

    ALTER TABLE vehicles DROP CONSTRAINT IF EXISTS vehicles_plate_normalized_key;
    CREATE INDEX IF NOT EXISTS idx_vehicles_plate_normalized ON vehicles(plate_normalized);
    CREATE INDEX IF NOT EXISTS idx_vehicles_nomor_izin ON vehicles(nomor_izin);

    CREATE TABLE IF NOT EXISTS vehicle_assignments (
      id SERIAL PRIMARY KEY,
      vehicle_id INTEGER NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
      lps_id INTEGER NOT NULL REFERENCES lps(id),
      driver_name TEXT,
      tare_kg INTEGER,
      is_primary BOOLEAN NOT NULL DEFAULT FALSE,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS weighbridge_devices (
      id SERIAL PRIMARY KEY,
      device_code TEXT NOT NULL UNIQUE,
      location_name TEXT NOT NULL,
      api_key_hash TEXT NOT NULL,
      firmware_version TEXT,
      connection_type TEXT NOT NULL DEFAULT 'RS232',
      port_name TEXT,
      baud_rate INTEGER NOT NULL DEFAULT 9600,
      protocol TEXT NOT NULL DEFAULT 'DIRECT_SERIAL',
      active BOOLEAN NOT NULL DEFAULT TRUE,
      last_seen_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS device_readings (
      id BIGSERIAL PRIMARY KEY,
      device_id INTEGER NOT NULL REFERENCES weighbridge_devices(id),
      weight_kg INTEGER NOT NULL CHECK (weight_kg >= 0),
      stable BOOLEAN NOT NULL DEFAULT FALSE,
      indicator_raw TEXT,
      recorded_at TIMESTAMPTZ NOT NULL,
      received_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS weighings (
      id BIGSERIAL PRIMARY KEY,
      ticket_number TEXT NOT NULL,
      weighed_at TIMESTAMPTZ NOT NULL,
      vehicle_id INTEGER REFERENCES vehicles(id),
      plate_number TEXT NOT NULL,
      driver_name TEXT,
      vehicle_type TEXT NOT NULL,
      lps_id INTEGER REFERENCES lps(id),
      lps_name TEXT NOT NULL,
      waste_type TEXT NOT NULL,
      gross_kg INTEGER NOT NULL CHECK (gross_kg >= 0),
      tare_kg INTEGER NOT NULL CHECK (tare_kg >= 0),
      netto_1_kg INTEGER NOT NULL,
      rafaksi_kg INTEGER NOT NULL DEFAULT 0 CHECK (rafaksi_kg >= 0),
      netto_2_kg INTEGER NOT NULL,
      ritasi INTEGER NOT NULL DEFAULT 1 CHECK (ritasi > 0),
      tare_source TEXT NOT NULL DEFAULT 'DATABASE',
      device_id INTEGER REFERENCES weighbridge_devices(id),
      indicator_raw TEXT,
      status TEXT NOT NULL DEFAULT 'COMPLETED',
      source TEXT NOT NULL DEFAULT 'APPLICATION',
      source_note TEXT,
      created_by INTEGER REFERENCES users(id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id BIGSERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id),
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id BIGINT,
      old_data JSONB,
      new_data JSONB,
      ip_address INET,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_weighings_date ON weighings(weighed_at DESC);
    CREATE INDEX IF NOT EXISTS idx_weighings_ticket ON weighings(ticket_number);
    CREATE INDEX IF NOT EXISTS idx_weighings_lps ON weighings(lps_id);
    CREATE INDEX IF NOT EXISTS idx_weighings_vehicle ON weighings(vehicle_id);
    CREATE INDEX IF NOT EXISTS idx_readings_device_date ON device_readings(device_id, recorded_at DESC);
    CREATE INDEX IF NOT EXISTS idx_assignments_vehicle ON vehicle_assignments(vehicle_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_primary_assignment_per_vehicle
      ON vehicle_assignments(vehicle_id) WHERE is_primary = TRUE AND active = TRUE;
  `);
}

type SeedVehicle = (typeof seed.vehicles)[number];

async function seedDatabase(client: PoolClient) {
  const userCount = await client.query<{ count: number }>("SELECT COUNT(*)::int AS count FROM users");
  if (userCount.rows[0]?.count > 0) return;

  const adminEmail = process.env.ADMIN_EMAIL || "admin@lps.local";
  const adminPassword = process.env.ADMIN_PASSWORD || "Admin123!";
  const deviceKey = process.env.SERIAL_API_KEY || "serial-local-key-ganti-sebelum-produksi";

  const adminResult = await client.query<{ id: number }>(`
    INSERT INTO users (email, name, password_hash, role)
    VALUES ($1, $2, $3, 'ADMIN')
    ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name
    RETURNING id
  `, [adminEmail, "Administrator LPS", bcrypt.hashSync(adminPassword, 12)]);
  const adminId = adminResult.rows[0].id;

  for (const item of seed.lps) {
    await client.query(`
      INSERT INTO lps (code, name)
      VALUES ($1, $2)
      ON CONFLICT (code) DO NOTHING
    `, [item.code, item.name]);
  }

  const lpsRows = await client.query<{ id: number; name: string }>("SELECT id, name FROM lps");
  const lpsMap = new Map(lpsRows.rows.map((row) => [row.name, row.id]));

  for (const vehicle of seed.vehicles) {
    await client.query(`
      INSERT INTO vehicles
        (code, plate_number, plate_normalized, vehicle_type, waste_type, default_tare_kg, qr_token, active)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      ON CONFLICT (plate_normalized) DO NOTHING
    `, [
      vehicle.code,
      vehicle.plateNumber,
      vehicle.plateNormalized,
      vehicle.vehicleType,
      vehicle.wasteType,
      vehicle.defaultTareKg,
      vehicle.qrToken,
      vehicle.active,
    ]);
  }

  const vehicleRows = await client.query<{ id: number; plate_normalized: string }>(
    "SELECT id, plate_normalized FROM vehicles"
  );
  const vehicleMap = new Map(vehicleRows.rows.map((row) => [row.plate_normalized, row.id]));

  for (const assignment of seed.assignments) {
    const vehicleId = vehicleMap.get(assignment.plateNormalized);
    const lpsId = lpsMap.get(assignment.lpsName);
    if (!vehicleId || !lpsId) continue;
    await client.query(`
      INSERT INTO vehicle_assignments
        (vehicle_id, lps_id, driver_name, tare_kg, is_primary)
      SELECT $1, $2, $3, $4, $5
      WHERE NOT EXISTS (
        SELECT 1 FROM vehicle_assignments
        WHERE vehicle_id = $1 AND lps_id = $2
          AND COALESCE(driver_name, '') = COALESCE($3, '')
          AND COALESCE(tare_kg, -1) = COALESCE($4, -1)
      )
    `, [vehicleId, lpsId, assignment.driverName, assignment.tareKg, assignment.isPrimary]);
  }

  const deviceResult = await client.query<{ id: number }>(`
    INSERT INTO weighbridge_devices
      (device_code, location_name, api_key_hash, firmware_version, connection_type, port_name, baud_rate, protocol)
    VALUES ($1, $2, $3, 'PC-SERIAL-BRIDGE', $4, $5, $6, 'DIRECT_SERIAL')
    ON CONFLICT (device_code) DO UPDATE SET
      api_key_hash = EXCLUDED.api_key_hash,
      protocol = 'DIRECT_SERIAL'
    RETURNING id
  `, [
    process.env.SERIAL_DEVICE_ID || "TIMBANG-HJ-SERIAL-01",
    "Transdepo Harapan Jaya",
    hashDeviceKey(deviceKey),
    process.env.SERIAL_INTERFACE || "RS232",
    process.env.SERIAL_PORT || null,
    Number(process.env.SERIAL_BAUD_RATE || 9600),
  ]);
  const deviceId = deviceResult.rows[0].id;

  const vehicleByPlate = new Map<string, SeedVehicle>(
    seed.vehicles.map((vehicle) => [vehicle.plateNormalized, vehicle])
  );

  for (const tx of seed.transactions) {
    const vehicleId = vehicleMap.get(tx.plateNormalized) ?? null;
    const vehicle = vehicleByPlate.get(tx.plateNormalized);
    const lpsId = lpsMap.get(tx.lpsName) ?? null;
    await client.query(`
      INSERT INTO weighings (
        ticket_number, weighed_at, vehicle_id, plate_number, driver_name, vehicle_type,
        lps_id, lps_name, waste_type, gross_kg, tare_kg, netto_1_kg, rafaksi_kg,
        netto_2_kg, ritasi, tare_source, device_id, status, source, source_note, created_by
      ) VALUES (
        $1, $2::timestamptz, $3, $4, $5, $6, $7, $8, $9, $10, $11,
        $12, $13, $14, $15, $16, $17, $18, $19, $20, $21
      )
    `, [
      tx.ticketNumber,
      tx.date,
      vehicleId,
      vehicle?.plateNumber || tx.plateNormalized,
      tx.driverName,
      tx.vehicleType,
      lpsId,
      tx.lpsName,
      tx.wasteType,
      tx.grossKg,
      tx.tareKg,
      tx.netto1Kg,
      tx.rafaksiKg,
      tx.netto2Kg,
      tx.ritasi,
      tx.tareSource,
      deviceId,
      tx.status,
      tx.source,
      tx.sourceNote,
      adminId,
    ]);
  }

  const nextTicketNumber = seed.transactions.reduce((max, tx) => {
    const match = tx.ticketNumber.match(/\/(\d+)$/);
    return match ? Math.max(max, Number(match[1])) : max;
  }, 8999) + 1;

  const settings: Array<[string, string]> = [
    ["next_ticket_no", String(nextTicketNumber)],
    ["site_name", "Transdepo Harapan Jaya"],
    ["source_reconciliation", JSON.stringify(seed.meta.reconciliation)],
  ];
  for (const [key, value] of settings) {
    await client.query(`
      INSERT INTO settings (key, value)
      VALUES ($1, $2)
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
    `, [key, value]);
  }
}

async function ensureSerialDevice(client: PoolClient) {
  const deviceKey = process.env.SERIAL_API_KEY || "serial-local-key-ganti-sebelum-produksi";
  await client.query(`
    INSERT INTO weighbridge_devices
      (device_code, location_name, api_key_hash, firmware_version, connection_type, port_name, baud_rate, protocol)
    VALUES ($1, $2, $3, 'PC-SERIAL-BRIDGE', $4, $5, $6, 'DIRECT_SERIAL')
    ON CONFLICT (device_code) DO UPDATE SET
      api_key_hash = EXCLUDED.api_key_hash,
      protocol = 'DIRECT_SERIAL'
  `, [
    process.env.SERIAL_DEVICE_ID || "TIMBANG-HJ-SERIAL-01",
    "Transdepo Harapan Jaya",
    hashDeviceKey(deviceKey),
    process.env.SERIAL_INTERFACE || "RS232",
    process.env.SERIAL_PORT || null,
    Number(process.env.SERIAL_BAUD_RATE || 9600),
  ]);
}

async function syncOct2026MasterArmada(client: PoolClient) {
  // Pastikan sinkronisasi awal master Oktober 2026 hanya dieksekusi sekali.
  // Jangan menimpa status armada yang telah diaktifkan/dinonaktifkan secara manual oleh pengguna.
  const syncCheck = await client.query<{ value: string }>(
    "SELECT value FROM settings WHERE key = 'oct_2026_master_synced'"
  );
  if (syncCheck.rows[0]?.value === "true") {
    return;
  }

  const lpsRows = await client.query<{ id: number; code: string; name: string }>("SELECT id, code, name FROM lps");
  const lpsMap = new Map<string, number>();
  for (const l of lpsRows.rows) {
    lpsMap.set(l.name.toUpperCase().trim(), l.id);
    lpsMap.set(l.name.toUpperCase().replace(/^LPS\s+/, "").trim(), l.id);
    lpsMap.set(l.code.toUpperCase().trim(), l.id);
  }
  lpsMap.set("SUKAMULIA", lpsMap.get("LPS SUKA MULIA") || 24);
  lpsMap.set("SUKA MULIA", lpsMap.get("LPS SUKA MULIA") || 24);

  const octPlateSet = new Set(octArmada.map((a: any) => a.plate_normalized));

  // Nonaktifkan armada lama di luar Harapan Jaya Oktober 2026 hanya jika belum ditandai
  await client.query(
    "UPDATE vehicles SET active = FALSE, code = 'ARM-HIST-' || LPAD(id::text, 4, '0') WHERE code NOT LIKE 'ARM-HIST-%' AND plate_normalized NOT IN (" +
      Array.from(octPlateSet).map((_, i) => `$${i + 1}`).join(", ") +
      ")",
    Array.from(octPlateSet)
  );

  // Prefix sementara untuk armada aktif agar aman saat penomoran ulang ARM-HJ-XXXX
  await client.query("UPDATE vehicles SET code = 'OLD-' || id WHERE active = TRUE");

  for (let i = 0; i < octArmada.length; i++) {
    const item = octArmada[i];
    const code = `ARM-HJ-${String(i + 1).padStart(4, "0")}`;
    const plateNormalized = item.plate_normalized;
    const plateNumber = item.nomor_polisi.trim().toUpperCase();
    const vehicleType = item.jenis_armada || "PICKUP";
    const wasteType = "SAMPAH RUMAH TANGGA";

    const kel = (item.kelurahan_lps || "").toUpperCase().trim();
    const nama = (item.nama_lps || "").toUpperCase().trim();
    const lpsId =
      lpsMap.get(nama) ||
      lpsMap.get(`LPS ${nama}`) ||
      lpsMap.get(kel) ||
      lpsMap.get(`LPS ${kel}`);

    const existingByIzin = await client.query<{ id: number; default_tare_kg: number | null }>(
      "SELECT id, default_tare_kg FROM vehicles WHERE nomor_izin = $1",
      [item.nomor_izin]
    );

    let vehicleId: number;

    if (existingByIzin.rows[0]) {
      vehicleId = existingByIzin.rows[0].id;
      await client.query(
        `UPDATE vehicles SET
          code = $1, plate_number = $2, plate_normalized = $3, vehicle_type = $4,
          waste_type = $5, active = TRUE, no_urut = $6, nomor_sk_lps = $7,
          tanggal_sk_lps = $8, kecamatan = $9, nama_lps = $10,
          nomor_surat_permohonan = $11, tanggal_permohonan = $12, nama_lps_2 = $13,
          nama_ketua_lps = $14, alamat_lps = $15, kelurahan_lps = $16,
          kecamatan_lps = $17, wilayah_kerja = $18, lokasi_tps = $19,
          tanggal_terbit_izin = $20, lampiran_camat = $21, updated_at = NOW()
        WHERE id = $22`,
        [
          code, plateNumber, plateNormalized, vehicleType, wasteType,
          item.no, item.nomor_sk_lps, item.tanggal_sk_lps, item.kecamatan,
          item.nama_lps, item.nomor_surat_permohonan, item.tanggal_permohonan,
          item.nama_lps_2, item.nama_ketua_lps, item.alamat_lps,
          item.kelurahan_lps, item.kecamatan_lps, item.wilayah_kerja,
          item.lokasi_tps || "HARAPAN JAYA", item.tanggal_terbit_izin,
          item.lampiran_camat, vehicleId
        ]
      );
    } else {
      const existingByPlate = await client.query<{ id: number; default_tare_kg: number | null }>(
        "SELECT id, default_tare_kg FROM vehicles WHERE plate_normalized = $1 AND nomor_izin IS NULL LIMIT 1",
        [plateNormalized]
      );

      if (existingByPlate.rows[0]) {
        vehicleId = existingByPlate.rows[0].id;
        await client.query(
          `UPDATE vehicles SET
            code = $1, plate_number = $2, plate_normalized = $3, vehicle_type = $4,
            waste_type = $5, active = TRUE, no_urut = $6, nomor_izin = $7,
            nomor_sk_lps = $8, tanggal_sk_lps = $9, kecamatan = $10,
            nama_lps = $11, nomor_surat_permohonan = $12, tanggal_permohonan = $13,
            nama_lps_2 = $14, nama_ketua_lps = $15, alamat_lps = $16,
            kelurahan_lps = $17, kecamatan_lps = $18, wilayah_kerja = $19,
            lokasi_tps = $20, tanggal_terbit_izin = $21, lampiran_camat = $22, updated_at = NOW()
          WHERE id = $23`,
          [
            code, plateNumber, plateNormalized, vehicleType, wasteType,
            item.no, item.nomor_izin, item.nomor_sk_lps, item.tanggal_sk_lps, item.kecamatan,
            item.nama_lps, item.nomor_surat_permohonan, item.tanggal_permohonan,
            item.nama_lps_2, item.nama_ketua_lps, item.alamat_lps,
            item.kelurahan_lps, item.kecamatan_lps, item.wilayah_kerja,
            item.lokasi_tps || "HARAPAN JAYA", item.tanggal_terbit_izin,
            item.lampiran_camat, vehicleId
          ]
        );
      } else {
        const qrToken = crypto.createHash("sha256")
          .update(`HJ-QR-${plateNormalized}-${item.nomor_izin}`)
          .digest("hex")
          .slice(0, 32);

        const ins = await client.query<{ id: number }>(
          `INSERT INTO vehicles (
            code, plate_number, plate_normalized, vehicle_type, waste_type,
            default_tare_kg, qr_token, active, no_urut, nomor_izin,
            nomor_sk_lps, tanggal_sk_lps, kecamatan, nama_lps,
            nomor_surat_permohonan, tanggal_permohonan, nama_lps_2,
            nama_ketua_lps, alamat_lps, kelurahan_lps, kecamatan_lps,
            wilayah_kerja, lokasi_tps, tanggal_terbit_izin, lampiran_camat
          ) VALUES (
            $1, $2, $3, $4, $5, NULL, $6, TRUE, $7, $8,
            $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19,
            $20, $21, $22, $23
          ) RETURNING id`,
          [
            code, plateNumber, plateNormalized, vehicleType, wasteType,
            qrToken, item.no, item.nomor_izin,
            item.nomor_sk_lps, item.tanggal_sk_lps, item.kecamatan,
            item.nama_lps, item.nomor_surat_permohonan, item.tanggal_permohonan,
            item.nama_lps_2, item.nama_ketua_lps, item.alamat_lps,
            item.kelurahan_lps, item.kecamatan_lps, item.wilayah_kerja,
            item.lokasi_tps || "HARAPAN JAYA", item.tanggal_terbit_izin,
            item.lampiran_camat
          ]
        );
        vehicleId = ins.rows[0].id;
      }
    }

    if (lpsId) {
      await client.query(
        `INSERT INTO vehicle_assignments (vehicle_id, lps_id, driver_name, tare_kg, is_primary, active)
         VALUES ($1, $2, $3, NULL, TRUE, TRUE)
         ON CONFLICT DO NOTHING`,
        [vehicleId, lpsId, item.nama_ketua_lps || null]
      );
    }
  }

  await client.query(`
    INSERT INTO settings (key, value)
    VALUES ('oct_2026_master_synced', 'true')
    ON CONFLICT (key) DO UPDATE SET value = 'true', updated_at = NOW()
  `);
}

// Reset promise jika modul di-compile ulang oleh Next.js
globalThis.__timbangInitPromise = undefined;
globalThis.__timbangPool = undefined;

export async function ensureDatabase() {
  if (globalThis.__timbangInitPromise) return globalThis.__timbangInitPromise;

  globalThis.__timbangInitPromise = (async () => {
    let client: PoolClient | undefined;
    try {
      const pool = getPool();
      client = await pool.connect();
      await client.query("SELECT pg_advisory_lock($1)", [903202608]);
      await client.query("BEGIN");
      await createSchema(client);
      await seedDatabase(client);
      await syncOct2026MasterArmada(client);
      await ensureSerialDevice(client);
      await client.query("COMMIT");
    } catch (error) {
      if (client) {
        await client.query("ROLLBACK").catch(() => undefined);
      }
      globalThis.__timbangInitPromise = undefined;
      throw error;
    } finally {
      if (client) {
        await client.query("SELECT pg_advisory_unlock($1)", [903202608]).catch(() => undefined);
        client.release();
      }
    }
  })();

  return globalThis.__timbangInitPromise;
}

export async function dbQuery<T extends QueryResultRow = QueryResultRow>(
  sql: string,
  params: unknown[] = [],
  executor?: DbExecutor
) {
  if (!executor && shouldAutoInitializeDatabase()) await ensureDatabase();
  const target = executor || getPool();
  try {
    const result = await target.query<T>(sql, params);
    return result.rows;
  } catch (err: any) {
    const isTransient =
      err?.code === "57P01" ||
      err?.message?.includes("Connection terminated") ||
      err?.message?.includes("timeout") ||
      err?.message?.includes("Connection ended");
    if (isTransient && !executor) {
      console.warn("[PostgreSQL] Melakukan query ulang karena koneksi sementara:", err.message);
      // Buat koneksi pool baru bila pool lama terputus
      if (globalThis.__timbangPool) {
        globalThis.__timbangPool = undefined;
      }
      const retryTarget = getPool();
      const retryResult = await retryTarget.query<T>(sql, params);
      return retryResult.rows;
    }
    throw err;
  }
}

export async function dbOne<T extends QueryResultRow = QueryResultRow>(
  sql: string,
  params: unknown[] = [],
  executor?: DbExecutor
) {
  const rows = await dbQuery<T>(sql, params, executor);
  return rows[0] ?? null;
}

export async function withTransaction<T>(callback: (client: PoolClient) => Promise<T>) {
  if (shouldAutoInitializeDatabase()) await ensureDatabase();
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const value = await callback(client);
    await client.query("COMMIT");
    return value;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function closeDatabase() {
  if (globalThis.__timbangPool) {
    await globalThis.__timbangPool.end();
    globalThis.__timbangPool = undefined;
    globalThis.__timbangInitPromise = undefined;
  }
}
