import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { dbOne, hashDeviceKey, withTransaction } from "@/lib/db";

export const runtime = "nodejs";
const schema = z.object({
  device_id: z.string().min(1),
  weight_kg: z.coerce.number().int().nonnegative(),
  stable: z.boolean(),
  indicator_raw: z.string().max(2000).optional().default(""),
  timestamp: z.string().optional(),
  serial_port: z.string().max(100).optional(),
  interface_type: z.enum(["RS232", "RS485"]).optional(),
});

function secureEqual(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export async function POST(request: Request) {
  const apiKey = request.headers.get("x-serial-key")
    || request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!apiKey) {
    return NextResponse.json({ error: "Serial API key tidak ditemukan." }, { status: 401 });
  }

  try {
    const input = schema.parse(await request.json());
    const device = await dbOne<{
      id: number;
      device_code: string;
      api_key_hash: string;
      active: boolean;
    }>(`
      SELECT id, device_code, api_key_hash, active
      FROM weighbridge_devices
      WHERE device_code = $1
    `, [input.device_id]);

    if (!device || !device.active || !secureEqual(device.api_key_hash, hashDeviceKey(apiKey))) {
      return NextResponse.json({ error: "Koneksi serial atau API key tidak valid." }, { status: 401 });
    }

    const recordedAt = input.timestamp && !Number.isNaN(Date.parse(input.timestamp))
      ? new Date(input.timestamp).toISOString()
      : new Date().toISOString();

    const latest = await dbOne<{
      weight_kg: number;
      stable: boolean;
      indicator_raw: string | null;
      recorded_at: string;
    }>(`
      SELECT weight_kg, stable, indicator_raw, recorded_at
      FROM device_readings
      WHERE device_id = $1
      ORDER BY id DESC
      LIMIT 1
    `, [device.id]);

    if (
      latest
      && latest.weight_kg === input.weight_kg
      && latest.stable === input.stable
      && latest.indicator_raw === (input.indicator_raw || null)
      && Math.abs(Date.parse(recordedAt) - Date.parse(latest.recorded_at)) < 500
    ) {
      return NextResponse.json({ ok: true, duplicate: true });
    }

    const readingId = await withTransaction(async (client) => {
      const inserted = await client.query<{ id: number }>(`
        INSERT INTO device_readings (device_id, weight_kg, stable, indicator_raw, recorded_at)
        VALUES ($1, $2, $3, $4, $5::timestamptz)
        RETURNING id
      `, [device.id, input.weight_kg, input.stable, input.indicator_raw || null, recordedAt]);

      await client.query(`
        UPDATE weighbridge_devices
        SET last_seen_at = $1::timestamptz,
            firmware_version = 'PC-SERIAL-BRIDGE',
            port_name = COALESCE($2, port_name),
            connection_type = COALESCE($3, connection_type)
        WHERE id = $4
      `, [recordedAt, input.serial_port || null, input.interface_type || null, device.id]);

      return inserted.rows[0].id;
    });

    return NextResponse.json({ ok: true, reading_id: readingId });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "Payload serial tidak valid.",
    }, { status: 400 });
  }
}
