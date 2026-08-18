import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { dbOne, dbQuery, withTransaction } from "@/lib/db";
import { displayPlate, normalizePlate, toInt } from "@/lib/utils";
import type { VehicleRow } from "@/lib/types";

export const runtime = "nodejs";
const createSchema = z.object({
  plateNumber: z.string().min(3),
  driverName: z.string().optional().default(""),
  vehicleType: z.string().min(1).default("PICKUP"),
  lpsId: z.preprocess(
    (value) => value === "" || value == null ? undefined : value,
    z.coerce.number().int().positive().optional()
  ),
  tareKg: z.union([z.string(), z.number()]).optional(),
  wasteType: z.string().min(1).default("SAMPAH RUMAH TANGGA"),
});

export async function GET(request: Request) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const url = new URL(request.url);
  const q = `%${url.searchParams.get("q") || ""}%`;
  const rows = await dbQuery<VehicleRow>(`
    SELECT id, code, plate_number, plate_normalized, vehicle_type, waste_type,
      default_tare_kg, qr_token, active
    FROM vehicles
    WHERE plate_number ILIKE $1 OR code ILIKE $1
    ORDER BY plate_normalized
  `, [q]);
  return NextResponse.json(rows);
}

export async function POST(request: Request) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const input = createSchema.parse(await request.json());
    const normalized = normalizePlate(input.plateNumber);
    const plateNumber = displayPlate(input.plateNumber);
    const existing = await dbOne<{ id: number }>(
      "SELECT id FROM vehicles WHERE plate_normalized = $1",
      [normalized]
    );
    if (existing) {
      return NextResponse.json({ error: "Nomor polisi sudah terdaftar." }, { status: 409 });
    }

    const qrToken = crypto.randomBytes(20).toString("hex");
    const tareKg = input.tareKg === "" || input.tareKg === undefined ? null : toInt(input.tareKg);

    const vehicleId = await withTransaction(async (client) => {
      // Menjaga pembuatan kode armada tetap unik ketika ada dua operator menambah data bersamaan.
      await client.query("SELECT pg_advisory_xact_lock($1)", [903202609]);
      const countResult = await client.query<{ count: number }>(
        "SELECT COUNT(*)::int AS count FROM vehicles"
      );
      const code = `ARM-HJ-${String((countResult.rows[0]?.count || 0) + 1).padStart(4, "0")}`;

      const inserted = await client.query<{ id: number }>(`
        INSERT INTO vehicles
          (code, plate_number, plate_normalized, vehicle_type, waste_type, default_tare_kg, qr_token)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING id
      `, [code, plateNumber, normalized, input.vehicleType, input.wasteType, tareKg, qrToken]);
      const id = inserted.rows[0].id;

      if (input.lpsId) {
        await client.query(`
          INSERT INTO vehicle_assignments (vehicle_id, lps_id, driver_name, tare_kg, is_primary)
          VALUES ($1, $2, $3, $4, TRUE)
        `, [id, input.lpsId, input.driverName || null, tareKg]);
      }

      await client.query(`
        INSERT INTO audit_logs (user_id, action, entity_type, entity_id, new_data)
        VALUES ($1, 'CREATE', 'VEHICLE', $2, $3::jsonb)
      `, [user.id, id, JSON.stringify({ code, plateNumber, normalized })]);

      return id;
    });

    return NextResponse.json({ ok: true, id: vehicleId }, { status: 201 });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "Data armada tidak valid.",
    }, { status: 400 });
  }
}
