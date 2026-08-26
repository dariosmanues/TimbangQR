import { dbOne, dbQuery } from "./db";
import type { AssignmentRow, VehicleRow, WeighingRow } from "./types";

const appTimeZone = (process.env.APP_TIMEZONE || "Asia/Jakarta").trim();

export async function getDashboardData() {
  const latestMonthRow = await dbOne<{ month: string }>(`
    SELECT COALESCE(
      MAX(to_char(timezone($1, weighed_at), 'YYYY-MM')),
      to_char(timezone($1, NOW()), 'YYYY-MM')
    ) AS month
    FROM weighings
  `, [appTimeZone]);
  const latestMonth = latestMonthRow?.month || new Date().toISOString().slice(0, 7);

  const totals = await dbOne<{ transactions: number; tonnage: number; ritasi: number }>(`
    SELECT
      COUNT(*)::int AS transactions,
      COALESCE(SUM(netto_2_kg), 0)::bigint AS tonnage,
      COALESCE(SUM(ritasi), 0)::bigint AS ritasi
    FROM weighings
    WHERE status = 'COMPLETED'
      AND to_char(timezone($1, weighed_at), 'YYYY-MM') = $2
  `, [appTimeZone, latestMonth]) || { transactions: 0, tonnage: 0, ritasi: 0 };

  const vehicleRow = await dbOne<{ count: number }>(
    "SELECT COUNT(*)::int AS count FROM vehicles WHERE active = TRUE"
  );
  const lpsRow = await dbOne<{ count: number }>(
    "SELECT COUNT(*)::int AS count FROM lps WHERE active = TRUE"
  );

  const topLps = await dbQuery<{ lps_name: string; total_kg: number; ritasi: number }>(`
    SELECT
      lps_name,
      SUM(netto_2_kg)::bigint AS total_kg,
      SUM(ritasi)::bigint AS ritasi
    FROM weighings
    WHERE status = 'COMPLETED'
      AND to_char(timezone($1, weighed_at), 'YYYY-MM') = $2
    GROUP BY lps_name
    ORDER BY total_kg DESC
    LIMIT 8
  `, [appTimeZone, latestMonth]);

  const daily = await dbQuery<{ day: string; total_kg: number }>(`
    SELECT
      to_char(timezone($1, weighed_at), 'DD') AS day,
      SUM(netto_2_kg)::bigint AS total_kg
    FROM weighings
    WHERE status = 'COMPLETED'
      AND to_char(timezone($1, weighed_at), 'YYYY-MM') = $2
    GROUP BY day
    ORDER BY day
  `, [appTimeZone, latestMonth]);

  const latest = await dbQuery<WeighingRow>(`
    SELECT id, ticket_number, weighed_at, plate_number, driver_name, lps_name,
      gross_kg, tare_kg, netto_1_kg, rafaksi_kg, netto_2_kg, ritasi, tare_source, status
    FROM weighings
    ORDER BY weighed_at DESC, id DESC
    LIMIT 10
  `);

  const reconciliationRow = await dbOne<{ value: string }>(
    "SELECT value FROM settings WHERE key = 'source_reconciliation'"
  );
  const reconciliation = reconciliationRow ? JSON.parse(reconciliationRow.value) as {
    summarySheetTotalKg: number;
    transactionSheetsTotalKg: number;
    differenceKg: number;
    differenceDetail: Array<{
      date: string;
      lps: string;
      transactionSheetsKg: number;
      summarySheetKg: number;
      note: string;
    }>;
    sourceErrorTickets: string[];
  } : null;

  return {
    latestMonth,
    totals,
    vehicles: vehicleRow?.count || 0,
    lps: lpsRow?.count || 0,
    topLps,
    daily,
    latest,
    reconciliation,
  };
}

export async function listVehicles(search = "") {
  const term = `%${search.trim()}%`;
  return dbQuery<VehicleRow>(`
    SELECT
      v.*,
      STRING_AGG(DISTINCT l.name, ', ' ORDER BY l.name) AS lps_names,
      COUNT(DISTINCT va.id)::int AS assignment_count
    FROM vehicles v
    LEFT JOIN vehicle_assignments va ON va.vehicle_id = v.id AND va.active = TRUE
    LEFT JOIN lps l ON l.id = va.lps_id
    WHERE ($1 = '%%'
      OR v.plate_number ILIKE $1
      OR v.code ILIKE $1
      OR l.name ILIKE $1
      OR va.driver_name ILIKE $1)
    GROUP BY v.id
    ORDER BY v.plate_normalized
  `, [term]);
}

export async function getVehicle(id: number) {
  const vehicle = await dbOne<VehicleRow>("SELECT * FROM vehicles WHERE id = $1", [id]);
  if (!vehicle) return null;

  const assignments = await dbQuery<AssignmentRow>(`
    SELECT va.id, va.lps_id, l.name AS lps_name, va.driver_name, va.tare_kg, va.is_primary
    FROM vehicle_assignments va
    JOIN lps l ON l.id = va.lps_id
    WHERE va.vehicle_id = $1 AND va.active = TRUE
    ORDER BY va.is_primary DESC, l.name
  `, [id]);

  const weighings = await dbQuery<WeighingRow>(`
    SELECT id, ticket_number, weighed_at, plate_number, driver_name, lps_name,
      gross_kg, tare_kg, netto_1_kg, rafaksi_kg, netto_2_kg, ritasi, tare_source, status
    FROM weighings
    WHERE vehicle_id = $1
    ORDER BY weighed_at DESC, id DESC
    LIMIT 20
  `, [id]);

  return { vehicle, assignments, weighings };
}

export async function listWeighings(filters: {
  search?: string;
  month?: string;
  lps?: string;
  limit?: number;
}) {
  const search = `%${filters.search?.trim() || ""}%`;
  const month = filters.month?.trim() || "";
  const lps = filters.lps?.trim() || "";
  const limit = Math.min(Math.max(filters.limit || 100, 1), 500);

  return dbQuery<WeighingRow>(`
    SELECT id, ticket_number, weighed_at, plate_number, driver_name, lps_name,
      gross_kg, tare_kg, netto_1_kg, rafaksi_kg, netto_2_kg, ritasi, tare_source, status
    FROM weighings
    WHERE ($1 = '%%'
      OR ticket_number ILIKE $1
      OR plate_number ILIKE $1
      OR driver_name ILIKE $1
      OR lps_name ILIKE $1)
      AND ($2 = '' OR to_char(timezone($3, weighed_at), 'YYYY-MM') = $2)
      AND ($4 = '' OR lps_name = $4)
    ORDER BY weighed_at DESC, id DESC
    LIMIT $5
  `, [search, month, appTimeZone, lps, limit]);
}

export async function getLpsList() {
  return dbQuery<{ id: number; name: string }>(
    "SELECT id, name FROM lps WHERE active = TRUE ORDER BY name"
  );
}

export async function getDeviceList() {
  return dbQuery<Record<string, string | number | boolean | null>>(`
    SELECT d.*,
      latest.weight_kg AS latest_weight,
      latest.stable AS latest_stable,
      latest.recorded_at AS latest_recorded_at
    FROM weighbridge_devices d
    LEFT JOIN LATERAL (
      SELECT r.weight_kg, r.stable, r.recorded_at
      FROM device_readings r
      WHERE r.device_id = d.id
      ORDER BY r.id DESC
      LIMIT 1
    ) latest ON TRUE
    ORDER BY d.device_code
  `);
}

export async function getMonthlyReport(month: string) {
  const rows = await dbQuery<{ lps_name: string; day: number; total_kg: number; ritasi: number }>(`
    SELECT
      lps_name,
      EXTRACT(DAY FROM timezone($1, weighed_at))::int AS day,
      SUM(netto_2_kg)::bigint AS total_kg,
      SUM(ritasi)::bigint AS ritasi
    FROM weighings
    WHERE status = 'COMPLETED'
      AND to_char(timezone($1, weighed_at), 'YYYY-MM') = $2
    GROUP BY lps_name, day
    ORDER BY lps_name, day
  `, [appTimeZone, month]);

  const map = new Map<string, { name: string; days: number[]; total: number; ritasi: number }>();
  for (const row of rows) {
    const current = map.get(row.lps_name) || {
      name: row.lps_name,
      days: Array(31).fill(0),
      total: 0,
      ritasi: 0,
    };
    current.days[row.day - 1] = row.total_kg;
    current.total += row.total_kg;
    current.ritasi += row.ritasi;
    map.set(row.lps_name, current);
  }

  return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name, "id"));
}
