import { closeDatabase, dbOne } from "../src/lib/db";

async function main() {
  const row = await dbOne<{
    database_name: string;
    server_version: string;
    users: number;
    vehicles: number;
    lps: number;
    assignments: number;
    weighings: number;
    total_netto_2_kg: number;
    readings: number;
    latest_weighing: string | null;
  }>(`
    SELECT
      current_database() AS database_name,
      current_setting('server_version') AS server_version,
      (SELECT COUNT(*)::int FROM users) AS users,
      (SELECT COUNT(*)::int FROM vehicles) AS vehicles,
      (SELECT COUNT(*)::int FROM lps) AS lps,
      (SELECT COUNT(*)::int FROM vehicle_assignments) AS assignments,
      (SELECT COUNT(*)::int FROM weighings) AS weighings,
      (SELECT COALESCE(SUM(netto_2_kg), 0)::bigint FROM weighings) AS total_netto_2_kg,
      (SELECT COUNT(*)::int FROM device_readings) AS readings,
      (SELECT MAX(weighed_at) FROM weighings) AS latest_weighing
  `);
  console.table(row ? [row] : []);
}

main()
  .catch((error) => {
    console.error("Pemeriksaan PostgreSQL gagal:", error);
    process.exitCode = 1;
  })
  .finally(() => closeDatabase());
