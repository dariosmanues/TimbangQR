import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import { Pool, type PoolClient, type QueryResultRow, types } from "pg";
import seed from "../../data/seed.json";

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

function getDatabaseUrl() {
  const value = process.env.DATABASE_URL?.trim();
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

export function getPool() {
  if (globalThis.__timbangPool) return globalThis.__timbangPool;

  const pool = new Pool({
    connectionString: getDatabaseUrl(),
    ssl: isSslEnabled() ? { rejectUnauthorized: false } : undefined,
    max: Number((process.env.DATABASE_POOL_MAX || "10").trim()),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
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
      plate_normalized TEXT NOT NULL UNIQUE,
      vehicle_type TEXT NOT NULL,
      waste_type TEXT NOT NULL,
      default_tare_kg INTEGER,
      qr_token TEXT NOT NULL UNIQUE,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

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

export async function ensureDatabase() {
  if (globalThis.__timbangInitPromise) return globalThis.__timbangInitPromise;

  globalThis.__timbangInitPromise = (async () => {
    const pool = getPool();
    const client = await pool.connect();
    try {
      await client.query("SELECT pg_advisory_lock($1)", [903202608]);
      await client.query("BEGIN");
      await createSchema(client);
      await seedDatabase(client);
      await ensureSerialDevice(client);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      globalThis.__timbangInitPromise = undefined;
      throw error;
    } finally {
      await client.query("SELECT pg_advisory_unlock($1)", [903202608]).catch(() => undefined);
      client.release();
    }
  })();

  return globalThis.__timbangInitPromise;
}

export async function dbQuery<T extends QueryResultRow = QueryResultRow>(
  sql: string,
  params: unknown[] = [],
  executor?: DbExecutor
) {
  if (!executor) await ensureDatabase();
  const target = executor || getPool();
  const result = await target.query<T>(sql, params);
  return result.rows;
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
  await ensureDatabase();
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
