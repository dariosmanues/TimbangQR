import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { callSerialBridge } from "@/lib/serialBridge";

const schema = z.object({ raw: z.string().min(1).max(2000) });

export async function POST(request: Request) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const input = schema.parse(await request.json());
    const result = await callSerialBridge("/test-input", {
      method: "POST",
      body: JSON.stringify(input),
    });
    return NextResponse.json(result.data, { status: result.status });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Data uji tidak valid." }, { status: 400 });
  }
}
