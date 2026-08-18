import fs from "node:fs";
import path from "node:path";
import { closeDatabase, ensureDatabase, withTransaction } from "../src/lib/db";

type Row = Record<string, unknown>;
type ExportData = Record<string, Row[]> & { meta?: Record<string, unknown> };

const bool = (value: unknown) => value === true || value === 1 || value === "1";
const nullableJson = (value: unknown) => {
  if (value == null || value === "") return null;
  if (typeof value === "string") {
    try {
      return JSON.stringify(JSON.parse(value));
    } catch {
      return JSON.stringify({ legacy_value: value });
    }
  }
  return JSON.stringify(value);
};

async function main() {
  if (process.env.MIGRATION_REPLACE !== "true") {
    throw new Error(
      "Migrasi diblokir untuk mencegah data tertimpa. Set MIGRATION_REPLACE=true setelah backup PostgreSQL."
    );
  }

  const input = process.argv[2];
  if (!input) throw new Error("Penggunaan: npm run migrate:sqlite -- data/sqlite-export.json");
  const filePath = path.resolve(input);
  const data = JSON.parse(fs.readFileSync(filePath, "utf8")) as ExportData;

  await ensureDatabase();
  await withTransaction(async (client) => {
    await client.query(`
      TRUNCATE TABLE
        audit_logs, device_readings, weighings, vehicle_assignments,
        weighbridge_devices, vehicles, lps, users, settings
      RESTART IDENTITY CASCADE
    `);

    for (const row of data.users || []) {
      await client.query(`
        INSERT INTO users (id, email, name, password_hash, role, active, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7::timestamptz)
      `, [row.id, row.email, row.name, row.password_hash, row.role, bool(row.active), row.created_at]);
    }

    for (const row of data.lps || []) {
      await client.query(`
        INSERT INTO lps (id, code, name, address, active, created_at)
        VALUES ($1, $2, $3, $4, $5, $6::timestamptz)
      `, [row.id, row.code, row.name, row.address, bool(row.active), row.created_at]);
    }

    for (const row of data.vehicles || []) {
      await client.query(`
        INSERT INTO vehicles (
          id, code, plate_number, plate_normalized, vehicle_type, waste_type,
          default_tare_kg, qr_token, active, created_at, updated_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::timestamptz,$11::timestamptz)
      `, [
        row.id, row.code, row.plate_number, row.plate_normalized, row.vehicle_type,
        row.waste_type, row.default_tare_kg, row.qr_token, bool(row.active),
        row.created_at, row.updated_at || row.created_at,
      ]);
    }

    for (const row of data.vehicle_assignments || []) {
      await client.query(`
        INSERT INTO vehicle_assignments (
          id, vehicle_id, lps_id, driver_name, tare_kg, is_primary, active, created_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::timestamptz)
      `, [
        row.id, row.vehicle_id, row.lps_id, row.driver_name, row.tare_kg,
        bool(row.is_primary), bool(row.active), row.created_at,
      ]);
    }

    for (const row of data.weighbridge_devices || []) {
      await client.query(`
        INSERT INTO weighbridge_devices (
          id, device_code, location_name, api_key_hash, firmware_version,
          connection_type, port_name, baud_rate, protocol, active, last_seen_at, created_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::timestamptz,$12::timestamptz)
      `, [
        row.id, row.device_code, row.location_name, row.api_key_hash, row.firmware_version,
        row.connection_type || "RS232", row.port_name, row.baud_rate || 9600,
        row.protocol || "DIRECT_SERIAL", bool(row.active), row.last_seen_at, row.created_at,
      ]);
    }

    for (const row of data.device_readings || []) {
      await client.query(`
        INSERT INTO device_readings (
          id, device_id, weight_kg, stable, indicator_raw, recorded_at, received_at
        ) VALUES ($1,$2,$3,$4,$5,$6::timestamptz,$7::timestamptz)
      `, [
        row.id, row.device_id, row.weight_kg, bool(row.stable), row.indicator_raw,
        row.recorded_at, row.received_at || row.recorded_at,
      ]);
    }

    for (const row of data.weighings || []) {
      await client.query(`
        INSERT INTO weighings (
          id, ticket_number, weighed_at, vehicle_id, plate_number, driver_name,
          vehicle_type, lps_id, lps_name, waste_type, gross_kg, tare_kg,
          netto_1_kg, rafaksi_kg, netto_2_kg, ritasi, tare_source, device_id,
          indicator_raw, status, source, source_note, created_by, created_at, updated_at
        ) VALUES (
          $1,$2,$3::timestamptz,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,
          $16,$17,$18,$19,$20,$21,$22,$23,$24::timestamptz,$25::timestamptz
        )
      `, [
        row.id, row.ticket_number, row.weighed_at, row.vehicle_id, row.plate_number,
        row.driver_name, row.vehicle_type, row.lps_id, row.lps_name, row.waste_type,
        row.gross_kg, row.tare_kg, row.netto_1_kg, row.rafaksi_kg, row.netto_2_kg,
        row.ritasi, row.tare_source, row.device_id, row.indicator_raw, row.status,
        row.source, row.source_note, row.created_by, row.created_at,
        row.updated_at || row.created_at,
      ]);
    }

    for (const row of data.audit_logs || []) {
      await client.query(`
        INSERT INTO audit_logs (
          id, user_id, action, entity_type, entity_id, old_data, new_data, ip_address, created_at
        ) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8::inet,$9::timestamptz)
      `, [
        row.id, row.user_id, row.action, row.entity_type, row.entity_id,
        nullableJson(row.old_data), nullableJson(row.new_data), row.ip_address || null, row.created_at,
      ]);
    }

    for (const row of data.settings || []) {
      await client.query(`
        INSERT INTO settings (key, value, updated_at)
        VALUES ($1, $2, $3::timestamptz)
      `, [row.key, row.value, row.updated_at]);
    }

    for (const table of [
      "users", "lps", "vehicles", "vehicle_assignments", "weighbridge_devices",
      "device_readings", "weighings", "audit_logs",
    ]) {
      await client.query(`
        SELECT setval(
          pg_get_serial_sequence($1, 'id'),
          COALESCE((SELECT MAX(id) FROM ${table}), 1),
          EXISTS(SELECT 1 FROM ${table})
        )
      `, [table]);
    }
  });

  console.log(`Migrasi SQLite → PostgreSQL selesai dari ${filePath}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => closeDatabase());
