import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getSession, isSuperAdmin } from "@/lib/auth";
import { dbOne, withTransaction } from "@/lib/db";
import { jakartaIsoNow } from "@/lib/utils";
import { syncCompletedWeighingToLps } from "@/lib/lps-sync";
import type { PoolClient } from "pg";

export const runtime = "nodejs";
const schema = z.object({
  vehicleId: z.coerce.number().int().positive(),
  lpsId: z.coerce.number().int().positive(),
  driverName: z.string().max(100).optional().default(""),
  grossKg: z.coerce.number().int().positive(),
  tareKg: z.coerce.number().int().nonnegative(),
  rafaksiKg: z.coerce.number().int().nonnegative().default(0),
  tareSource: z.enum(["DATABASE", "ACTUAL_WEIGHING", "MANUAL"]).default("DATABASE"),
  measurementSource: z.enum(["SERIAL_BRIDGE", "DIRECT_SERIAL", "APPLICATION", "OCR_LED", "MANUAL"]).default("SERIAL_BRIDGE"),
  deviceId: z.coerce.number().int().positive().nullable().optional(),
  ocrStable: z.boolean().optional(),
  indicatorRaw: z.string().max(2000).optional().default(""),
  qrToken: z.string().max(255).optional().default(""),
  weighedAt: z.string().optional(),
  sourceNote: z.string().max(500).optional().default(""),
});

async function nextTicket(client: PoolClient) {
  const result = await client.query<{ value: string }>(`
    SELECT value FROM settings WHERE key = 'next_ticket_no' FOR UPDATE
  `);
  const current = Number(result.rows[0]?.value || 9000);
  const next = current + 1;

  await client.query(`
    INSERT INTO settings (key, value, updated_at)
    VALUES ('next_ticket_no', $1, NOW())
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
  `, [String(next)]);

  // Gunakan helper WIB deterministik agar tidak bergantung pada dukungan IANA
  // timezone di runtime deployment.
  const year = jakartaIsoNow().slice(2, 4);
  return `INV/${year}/${current}`;
}

export async function POST(request: Request) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const input = schema.parse(await request.json());

    if (input.measurementSource === "MANUAL") {
      if (!isSuperAdmin(user)) {
        return NextResponse.json(
          { error: "Akses ditolak: Hanya Super Administrator yang diizinkan membuat transaksi manual." },
          { status: 403 }
        );
      }
    }

    if (input.grossKg <= input.tareKg) {
      return NextResponse.json({ error: "Gross harus lebih besar daripada tare." }, { status: 400 });
    }

    const vehicle = await dbOne<{
      id: number;
      plate_number: string;
      vehicle_type: string;
      waste_type: string;
    }>(`
      SELECT id, plate_number, vehicle_type, waste_type
      FROM vehicles WHERE id = $1 AND active = TRUE
    `, [input.vehicleId]);
    const lps = await dbOne<{ id: number; name: string }>(
      "SELECT id, name FROM lps WHERE id = $1 AND active = TRUE",
      [input.lpsId]
    );

    if (!vehicle || !lps) {
      return NextResponse.json({ error: "Armada atau LPS tidak ditemukan." }, { status: 404 });
    }

    const netto1 = input.grossKg - input.tareKg;
    const netto2 = netto1 - input.rafaksiKg;
    if (netto2 <= 0) {
      return NextResponse.json({ error: "Netto 2 harus lebih besar dari nol." }, { status: 400 });
    }

    const result = await withTransaction(async (client) => {
      const ticket = await nextTicket(client);
      const weighedAt = input.weighedAt && !isNaN(new Date(input.weighedAt).getTime())
        ? new Date(input.weighedAt).toISOString()
        : jakartaIsoNow();
      const source = input.measurementSource === "MANUAL"
        ? "MANUAL"
        : input.measurementSource === "OCR_LED"
          ? "OCR_LED"
          : "APPLICATION";
      const sourceNote = input.sourceNote?.trim() || (
        input.measurementSource === "MANUAL"
          ? "Input manual oleh Super Admin / Admin"
          : input.measurementSource === "SERIAL_BRIDGE" || input.measurementSource === "DIRECT_SERIAL"
            ? "TimbangQR Bridge (RS232/RS485)"
            : null
      );

      const inserted = await client.query<{ id: number }>(`
        INSERT INTO weighings (
          ticket_number, weighed_at, vehicle_id, plate_number, driver_name, vehicle_type,
          lps_id, lps_name, waste_type, gross_kg, tare_kg, netto_1_kg, rafaksi_kg,
          netto_2_kg, ritasi, tare_source, device_id, indicator_raw, status, source,
          source_note, created_by, qr_token
        ) VALUES (
          $1, $2::timestamptz, $3, $4, $5, $6, $7, $8, $9, $10, $11,
          $12, $13, $14, 1, $15, $16, $17, 'COMPLETED', $18,
          $19, $20, $21
        )
        RETURNING id
      `, [
        ticket,
        weighedAt,
        vehicle.id,
        vehicle.plate_number,
        input.driverName || null,
        vehicle.vehicle_type,
        lps.id,
        lps.name,
        vehicle.waste_type,
        input.grossKg,
        input.tareKg,
        netto1,
        input.rafaksiKg,
        netto2,
        input.tareSource,
        input.deviceId || null,
        input.indicatorRaw || null,
        source,
        sourceNote,
        user.id,
        input.qrToken?.trim() || null,
      ]);
      const id = inserted.rows[0].id;

      // Catat token QR sebagai HANGUS agar tidak bisa discan/dipakai ulang
      // PENTING: QR MASTER ARMADA bersifat PERMANEN dan TIDAK PERNAH DIHANGUSKAN!
      // Hanya token slip sekali pakai LPS (berawalan LPS-) yang dicatat ke burned_qr_tokens.
      const isMasterQr = !input.qrToken ||
        /^ARMADA-/i.test(input.qrToken.trim()) ||
        /^QR-ARMADA-/i.test(input.qrToken.trim()) ||
        !input.qrToken.trim().toUpperCase().startsWith("LPS-");

      if (input.qrToken && input.qrToken.trim() && !isMasterQr) {
        try {
          await client.query(`
            INSERT INTO burned_qr_tokens (qr_token, plate_number, ticket_number, vehicle_id, burned_at)
            VALUES ($1, $2, $3, $4, NOW())
            ON CONFLICT (qr_token) DO UPDATE SET
              ticket_number = EXCLUDED.ticket_number,
              burned_at = NOW()
          `, [input.qrToken.trim(), vehicle.plate_number, ticket, vehicle.id]);
        } catch (e) {
          console.warn("[Weighings] Gagal mencatat burned_qr_tokens:", e);
        }
      }

      await client.query(`
        INSERT INTO audit_logs (user_id, action, entity_type, entity_id, new_data)
        VALUES ($1, 'CREATE', 'WEIGHING', $2, $3::jsonb)
      `, [user.id, id, JSON.stringify({
        ticket,
        vehicleId: vehicle.id,
        lpsId: lps.id,
        grossKg: input.grossKg,
        tareKg: input.tareKg,
        netto2Kg: netto2,
        measurementSource: input.measurementSource,
        deviceId: input.deviceId || null,
        qrToken: input.qrToken || null,
      })]);

      return { id, ticket, netto2, weighedAt };
    });

    const lpsSync = await syncCompletedWeighingToLps({
      ticketNumber: result.ticket,
      plateNumber: vehicle.plate_number,
      lpsName: lps.name,
      transdepo: process.env.LPS_TRANSDEPO || "HARAPAN_JAYA",
      weighedAt: result.weighedAt,
      grossKg: input.grossKg,
      tareKg: input.tareKg,
      rafaksiKg: input.rafaksiKg,
      nettoKg: result.netto2,
      driverName: input.driverName || undefined,
      vehicleType: vehicle.vehicle_type,
      wasteType: vehicle.waste_type,
      indicatorRaw: input.indicatorRaw || undefined,
      qrCode: input.qrToken || undefined,
    });

    revalidatePath("/dashboard");
    revalidatePath("/transaksi");

    return NextResponse.json({
      ok: true,
      id: result.id,
      ticketNumber: result.ticket,
      netto2Kg: result.netto2,
      lpsSync,
    }, { status: 201 });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "Data transaksi tidak valid.",
    }, { status: 400 });
  }
}
