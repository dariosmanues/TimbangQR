import { NextResponse } from "next/server";
import QRCode from "qrcode";
import { dbOne } from "@/lib/db";
import { getSession } from "@/lib/auth";

export const runtime = "nodejs";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSession();
  if (!user) return new NextResponse("Unauthorized", { status: 401 });

  const { id } = await params;
  const vehicle = await dbOne<{ plate_number: string; qr_token: string }>(
    "SELECT plate_number, qr_token FROM vehicles WHERE id = $1 AND active = TRUE",
    [Number(id)]
  );

  if (!vehicle) return new NextResponse("Armada tidak ditemukan", { status: 404 });

  // Scanner hanya membutuhkan token. Menyimpan URL Vercel penuh di QR membuat
  // modul QR jauh lebih padat dan lebih lambat dibaca kamera, terutama dari layar HP.
  // Token 32 karakter menghasilkan QR yang jauh lebih sederhana dan cepat dipindai.
  const payload = vehicle.qr_token.trim();

  const svg = await QRCode.toString(payload, {
    type: "svg",
    errorCorrectionLevel: "M",
    margin: 4,
    width: 640,
  });

  return new NextResponse(svg, {
    headers: {
      "content-type": "image/svg+xml; charset=utf-8",
      "cache-control": "private, no-store, max-age=0",
    },
  });
}
