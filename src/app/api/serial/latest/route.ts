import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { dbOne } from "@/lib/db";
import { isVercelPreview, previewDbOne } from "@/lib/preview-db";

export const runtime = "nodejs";

const STALE_AFTER_SECONDS = 90;

type LatestReading = {
  id: number;
  device_id: number;
  device_code: string;
  weight_kg: number;
  stable: boolean;
  indicator_raw: string | null;
  recorded_at: string;
  received_at: string;
  age_seconds: number;
};

export async function GET(request: Request) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const requestedCode = url.searchParams.get("device")?.trim();
  const configuredCode = process.env.SERIAL_DEVICE_ID?.trim();
  const code = requestedCode || configuredCode || "TIMBANG-HJ-SERIAL-01";

  const sql = `
    SELECT
      r.id,
      r.device_id,
      d.device_code,
      r.weight_kg,
      r.stable,
      r.indicator_raw,
      r.recorded_at,
      r.received_at,
      GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (NOW() - r.received_at))))::int AS age_seconds
    FROM device_readings r
    JOIN weighbridge_devices d ON d.id = r.device_id
    WHERE d.device_code = $1
    ORDER BY r.id DESC
    LIMIT 1
  `;

  const reading = isVercelPreview()
    ? await previewDbOne<LatestReading>(sql, [code])
    : await dbOne<LatestReading>(sql, [code]);

  const fresh = Boolean(reading && reading.age_seconds <= STALE_AFTER_SECONDS);

  return NextResponse.json({
    reading,
    fresh,
    staleAfterSeconds: STALE_AFTER_SECONDS,
    serverNow: new Date().toISOString(),
    previewReadOnly: isVercelPreview(),
  });
}
