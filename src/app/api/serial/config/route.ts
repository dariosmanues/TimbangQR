import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { callSerialBridge } from "@/lib/serialBridge";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const result = await callSerialBridge("/config");
  return NextResponse.json(result.data, { status: result.status });
}

export async function POST(request: Request) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await request.text();
  const result = await callSerialBridge("/config", { method: "POST", body });
  return NextResponse.json(result.data, { status: result.status });
}
