import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { dbOne } from "@/lib/db";
import type { DeviceReading } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type WeighbridgeDeviceStatus = {
  id: number;
  device_code: string;
  location_name: string;
  port_name: string | null;
  connection_type: string;
  baud_rate: number;
  last_seen_at: string | null;
  active: boolean;
};

export async function GET(request: Request) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const code = url.searchParams.get("device") || process.env.SERIAL_DEVICE_ID || "TIMBANG-HJ-SERIAL-01";

  let device = await dbOne<WeighbridgeDeviceStatus>(`
    SELECT id, device_code, location_name, port_name, connection_type, baud_rate, last_seen_at, active
    FROM weighbridge_devices
    WHERE device_code = $1
    LIMIT 1
  `, [code]);

  if (!device) {
    device = await dbOne<WeighbridgeDeviceStatus>(`
      SELECT id, device_code, location_name, port_name, connection_type, baud_rate, last_seen_at, active
      FROM weighbridge_devices
      WHERE active = TRUE
      ORDER BY last_seen_at DESC NULLS LAST, id ASC
      LIMIT 1
    `);
  }

  const targetCode = device?.device_code || code;
  const reading = await dbOne<DeviceReading>(`
    SELECT r.id, r.device_id, d.device_code, r.weight_kg, r.stable, r.indicator_raw, r.recorded_at
    FROM device_readings r
    JOIN weighbridge_devices d ON d.id = r.device_id
    WHERE d.device_code = $1
    ORDER BY r.recorded_at DESC, r.id DESC
    LIMIT 1
  `, [targetCode]);

  const deviceSeenMs = device?.last_seen_at ? Date.parse(String(device.last_seen_at)) : 0;
  const readingSeenMs = reading?.recorded_at ? Date.parse(String(reading.recorded_at)) : 0;
  const latestSeenMs = Math.max(
    Number.isFinite(deviceSeenMs) ? deviceSeenMs : 0,
    Number.isFinite(readingSeenMs) ? readingSeenMs : 0
  );
  const lastSeenAt = latestSeenMs > 0 ? new Date(latestSeenMs).toISOString() : null;
  const bridgeOnline = Boolean(latestSeenMs > 0 && Date.now() - latestSeenMs <= 15 * 60 * 1000);

  return NextResponse.json(
    {
      reading,
      device,
      lastSeenAt,
      bridgeOnline,
    },
    { headers: { "Cache-Control": "no-store, max-age=0" } }
  );
}
