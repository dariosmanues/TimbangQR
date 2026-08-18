import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { callSerialBridge } from "@/lib/serialBridge";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const result = await callSerialBridge("/ports");
  return NextResponse.json(result.data, { status: result.status });
}
