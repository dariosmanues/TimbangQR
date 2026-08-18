import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { callSerialBridge } from "@/lib/serialBridge";

const schema = z.object({ action: z.enum(["connect", "disconnect"]) });

export async function POST(request: Request) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const input = schema.parse(await request.json());
    const result = await callSerialBridge(`/${input.action}`, { method: "POST", body: "{}" });
    return NextResponse.json(result.data, { status: result.status });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Aksi tidak valid." }, { status: 400 });
  }
}
