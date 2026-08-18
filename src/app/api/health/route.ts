import { NextResponse } from "next/server";
import { dbOne } from "@/lib/db";

export const runtime = "nodejs";
export async function GET() {
  try {
    const row = await dbOne<{ count: number }>("SELECT COUNT(*)::int AS count FROM weighings");
    return NextResponse.json({
      status: "ok",
      service: "timbang-qr-postgresql",
      database: "postgresql",
      transactions: row?.count || 0,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    return NextResponse.json({
      status: "error",
      service: "timbang-qr-postgresql",
      database: "postgresql",
      error: error instanceof Error ? error.message : "Database tidak dapat diakses.",
      timestamp: new Date().toISOString(),
    }, { status: 503 });
  }
}
