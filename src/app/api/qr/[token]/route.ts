import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { dbOne, dbQuery } from "@/lib/db";
import { isVercelPreview, previewDbOne, previewDbQuery } from "@/lib/preview-db";
import type { AssignmentRow, VehicleRow } from "@/lib/types";

export const runtime = "nodejs";
export async function GET(_: Request, { params }: { params: Promise<{ token: string }> }) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { token } = await params;

  const vehicleSql = `
    SELECT id, code, plate_number, plate_normalized, vehicle_type, waste_type,
      default_tare_kg, qr_token, active
    FROM vehicles
    WHERE qr_token = $1 AND active = TRUE
  `;
  const vehicle = isVercelPreview()
    ? await previewDbOne<VehicleRow>(vehicleSql, [token])
    : await dbOne<VehicleRow>(vehicleSql, [token]);

  if (!vehicle) {
    return NextResponse.json({ error: "QR armada tidak valid atau sudah dinonaktifkan." }, { status: 404 });
  }

  const assignmentSql = `
    SELECT va.id, va.lps_id, l.name AS lps_name, va.driver_name, va.tare_kg, va.is_primary
    FROM vehicle_assignments va
    JOIN lps l ON l.id = va.lps_id
    WHERE va.vehicle_id = $1 AND va.active = TRUE
    ORDER BY va.is_primary DESC, l.name
  `;
  const assignments = isVercelPreview()
    ? await previewDbQuery<AssignmentRow>(assignmentSql, [vehicle.id])
    : await dbQuery<AssignmentRow>(assignmentSql, [vehicle.id]);

  const lpsSql = "SELECT id, name FROM lps WHERE active = TRUE ORDER BY name";
  const lpsOptions = isVercelPreview()
    ? await previewDbQuery<{ id: number; name: string }>(lpsSql)
    : await dbQuery<{ id: number; name: string }>(lpsSql);

  return NextResponse.json({ vehicle, assignments, lpsOptions, previewReadOnly: isVercelPreview() });
}
