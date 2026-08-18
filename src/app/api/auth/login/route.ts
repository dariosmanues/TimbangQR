import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { dbOne } from "@/lib/db";
import { setSession } from "@/lib/auth";

export const runtime = "nodejs";
const schema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export async function POST(request: Request) {
  try {
    const input = schema.parse(await request.json());
    const user = await dbOne<{
      id: number;
      email: string;
      name: string;
      role: string;
      password_hash: string;
    }>(`
      SELECT id, email, name, role, password_hash
      FROM users
      WHERE lower(email) = lower($1) AND active = TRUE
    `, [input.email]);

    if (!user || !bcrypt.compareSync(input.password, user.password_hash)) {
      return NextResponse.json({ error: "Email atau kata sandi tidak sesuai." }, { status: 401 });
    }

    await setSession({ id: user.id, email: user.email, name: user.name, role: user.role });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Login gagal:", error);
    return NextResponse.json({ error: "Data login tidak valid atau database belum siap." }, { status: 400 });
  }
}
