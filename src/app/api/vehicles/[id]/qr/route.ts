import { NextResponse } from "next/server";
import QRCode from "qrcode";
import { dbOne } from "@/lib/db";
import { getSession } from "@/lib/auth";

export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSession();
  if (!user) return new NextResponse("Unauthorized", { status: 401 });

  const { id } = await params;
  const vehicle = await dbOne<{ plate_number: string; qr_token: string }>(
    "SELECT plate_number, qr_token FROM vehicles WHERE id = $1 AND active = TRUE",
    [Number(id)]
  );

  if (!vehicle) return new NextResponse("Armada tidak ditemukan", { status: 404 });

  const appUrl = process.env.APP_URL || new URL(request.url).origin;
  const target = `${appUrl}/scan?token=${vehicle.qr_token}`;
  const svg = await QRCode.toString(target, {
    type: "svg",
    errorCorrectionLevel: "H",
    margin: 2,
    width: 640,
  });

  return new NextResponse(svg, {
    headers: {
      "content-type": "image/svg+xml; charset=utf-8",
      "cache-control": "private, max-age=3600",
    },
  });
}
