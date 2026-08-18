import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { dbOne } from "@/lib/db";
import type { DeviceReading } from "@/lib/types";

export const runtime = "nodejs";
export async function GET(request: Request) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const code = url.searchParams.get("device") || process.env.SERIAL_DEVICE_ID || "TIMBANG-HJ-SERIAL-01";
  const reading = await dbOne<DeviceReading>(`
    SELECT r.id, r.device_id, d.device_code, r.weight_kg, r.stable, r.indicator_raw, r.recorded_at
    FROM device_readings r
    JOIN weighbridge_devices d ON d.id = r.device_id
    WHERE d.device_code = $1
    ORDER BY r.id DESC
    LIMIT 1
  `, [code]);

  return NextResponse.json({ reading });
}
