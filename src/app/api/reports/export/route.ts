import { NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { getSession } from "@/lib/auth";
import { dbQuery } from "@/lib/db";
import { getMonthlyReport } from "@/lib/queries";
import { monthLabel } from "@/lib/utils";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const month = url.searchParams.get("month") || "2026-05";
  if (!/^\d{4}-\d{2}$/.test(month)) {
    return NextResponse.json({ error: "Format bulan tidak valid." }, { status: 400 });
  }

  const appTimeZone = process.env.APP_TIMEZONE || "Asia/Jakarta";
  const report = await getMonthlyReport(month);
  const transactions = await dbQuery<Record<string, string | number | null>>(`
    SELECT ticket_number, weighed_at, plate_number, driver_name, vehicle_type, lps_name,
      waste_type, gross_kg, tare_kg, netto_1_kg, rafaksi_kg, netto_2_kg, ritasi, tare_source,
      status, source_note
    FROM weighings
    WHERE to_char(timezone($1, weighed_at), 'YYYY-MM') = $2
    ORDER BY weighed_at, id
  `, [appTimeZone, month]);

  const vehicles = await dbQuery<Record<string, string | number | null>>(`
    SELECT v.plate_number, va.driver_name, v.vehicle_type, l.name AS lps_name,
      v.waste_type, COALESCE(va.tare_kg, v.default_tare_kg) AS tare_kg, v.code
    FROM vehicles v
    LEFT JOIN vehicle_assignments va ON va.vehicle_id = v.id AND va.is_primary = TRUE AND va.active = TRUE
    LEFT JOIN lps l ON l.id = va.lps_id
    WHERE v.active = TRUE
    ORDER BY v.plate_normalized
  `);

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "TimbangQR Harapan Jaya";
  workbook.created = new Date();

  const green = "0B7A50";
  const dark = "173B2D";
  const light = "E7F7EF";
  const border = { style: "thin" as const, color: { argb: "D4E1D9" } };

  const rekap = workbook.addWorksheet("REKAP TONASE", { views: [{ state: "frozen", xSplit: 2, ySplit: 2 }] });
  rekap.mergeCells("C1:AG1");
  rekap.getCell("A1").value = "NO.";
  rekap.getCell("B1").value = "NAMA LPS";
  rekap.getCell("C1").value = `REKAP TONASE ${monthLabel(month).toUpperCase()}`;
  rekap.getCell("AH1").value = "TOTAL TONASE (Kg)";
  rekap.getCell("AI1").value = "RITASI";
  rekap.getRow(2).values = ["", "", ...Array.from({ length: 31 }, (_, i) => String(i + 1).padStart(2, "0")), "", ""];

  for (let index = 0; index < report.length; index++) {
    const row = report[index];
    rekap.addRow([index + 1, row.name, ...row.days, row.total, row.ritasi]);
  }

  const totalDays = Array.from({ length: 31 }, (_, day) => report.reduce((sum, row) => sum + row.days[day], 0));
  rekap.addRow(["", "TOTAL", ...totalDays, report.reduce((s, r) => s + r.total, 0), report.reduce((s, r) => s + r.ritasi, 0)]);

  rekap.columns = [
    { width: 6 }, { width: 30 },
    ...Array.from({ length: 31 }, () => ({ width: 12 })),
    { width: 18 }, { width: 12 },
  ];
  rekap.eachRow((row, rowNumber) => {
    row.height = rowNumber <= 2 ? 26 : 20;
    row.eachCell((cell, colNumber) => {
      cell.border = { top: border, left: border, bottom: border, right: border };
      cell.alignment = { vertical: "middle", horizontal: colNumber <= 2 ? "left" : "right" };
      if (rowNumber <= 2) {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: green } };
        cell.font = { bold: true, color: { argb: "FFFFFF" } };
        cell.alignment = { vertical: "middle", horizontal: "center" };
      }
      if (rowNumber === report.length + 3) {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: light } };
        cell.font = { bold: true, color: { argb: dark } };
      }
      if (colNumber >= 3) cell.numFmt = "#,##0";
    });
  });

  const txSheet = workbook.addWorksheet("TRANSAKSI", { views: [{ state: "frozen", ySplit: 1 }] });
  txSheet.addRow([
    "NO", "NO TIKET", "TANGGAL", "NO POLISI", "NAMA SUPIR", "JENIS MOBIL",
    "PENGIRIM", "JENIS SAMPAH", "GROSS (KG)", "TARE (KG)", "NETTO 1 (KG)",
    "RAFAKSI", "NETTO 2 (KG)", "RITASI", "SUMBER TARE", "STATUS", "CATATAN SUMBER",
  ]);
  transactions.forEach((tx, index) => txSheet.addRow([
    index + 1,
    tx.ticket_number,
    new Date(String(tx.weighed_at)),
    tx.plate_number,
    tx.driver_name,
    tx.vehicle_type,
    tx.lps_name,
    tx.waste_type,
    tx.gross_kg,
    tx.tare_kg,
    tx.netto_1_kg,
    tx.rafaksi_kg,
    tx.netto_2_kg,
    tx.ritasi,
    tx.tare_source,
    tx.status,
    tx.source_note,
  ]));
  txSheet.columns = [
    { width: 7 }, { width: 18 }, { width: 21 }, { width: 16 }, { width: 20 },
    { width: 15 }, { width: 30 }, { width: 25 }, { width: 14 }, { width: 14 },
    { width: 15 }, { width: 12 }, { width: 15 }, { width: 10 }, { width: 20 },
    { width: 16 }, { width: 55 },
  ];
  txSheet.getRow(1).eachCell((cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: green } };
    cell.font = { bold: true, color: { argb: "FFFFFF" } };
    cell.alignment = { horizontal: "center", vertical: "middle" };
  });
  txSheet.getColumn(3).numFmt = "dd-mm-yyyy hh:mm";
  for (let col = 9; col <= 14; col++) txSheet.getColumn(col).numFmt = "#,##0";
  txSheet.autoFilter = { from: "A1", to: "Q1" };

  const dbSheet = workbook.addWorksheet("DATABASE ARMADA", { views: [{ state: "frozen", ySplit: 1 }] });
  dbSheet.addRow(["KODE ARMADA", "NO POLISI", "NAMA SUPIR", "JENIS MOBIL", "PENGIRIM", "JENIS SAMPAH", "TARE (KG)"]);
  vehicles.forEach((v) => dbSheet.addRow([
    v.code, v.plate_number, v.driver_name, v.vehicle_type, v.lps_name, v.waste_type, v.tare_kg,
  ]));
  dbSheet.columns = [
    { width: 17 }, { width: 16 }, { width: 22 }, { width: 15 },
    { width: 32 }, { width: 28 }, { width: 14 },
  ];
  dbSheet.getRow(1).eachCell((cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: green } };
    cell.font = { bold: true, color: { argb: "FFFFFF" } };
    cell.alignment = { horizontal: "center", vertical: "middle" };
  });
  dbSheet.getColumn(7).numFmt = "#,##0";
  dbSheet.autoFilter = { from: "A1", to: "G1" };

  const buffer = await workbook.xlsx.writeBuffer();
  const filename = `REKAP_TONASE_${month.replace("-", "_")}_HARAPAN_JAYA.xlsx`;
  return new NextResponse(Buffer.from(buffer), {
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "no-store",
    },
  });
}
