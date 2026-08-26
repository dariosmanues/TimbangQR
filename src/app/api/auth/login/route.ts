import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { dbOne } from "@/lib/db";
import { setSession } from "@/lib/auth";
import { isVercelPreview, previewDbOne } from "@/lib/preview-db";

export const runtime = "nodejs";
const schema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export async function POST(request: Request) {
  try {
    const input = schema.parse(await request.json());
    const sql = `
      SELECT id, email, name, role, password_hash
      FROM users
      WHERE lower(email) = lower($1) AND active = TRUE
    `;
    const user = isVercelPreview()
      ? await previewDbOne<{
          id: number;
          email: string;
          name: string;
          role: string;
          password_hash: string;
        }>(sql, [input.email])
      : await dbOne<{
          id: number;
          email: string;
          name: string;
          role: string;
          password_hash: string;
        }>(sql, [input.email]);

    if (!user || !bcrypt.compareSync(input.password, user.password_hash)) {
      return NextResponse.json({ error: "Email atau kata sandi tidak sesuai." }, { status: 401 });
    }

    await setSession({ id: user.id, email: user.email, name: user.name, role: user.role });
    return NextResponse.json({ ok: true, previewReadOnly: isVercelPreview() });
  } catch (error) {
    console.error("Login gagal:", error);
    return NextResponse.json({
      error: isVercelPreview()
        ? "Preview belum dapat membaca database. Pastikan DATABASE_URL/DATABASE_SSL tersedia untuk environment Preview."
        : "Data login tidak valid atau database belum siap.",
    }, { status: 400 });
  }
}
