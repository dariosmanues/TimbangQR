import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import ExcelJS from "exceljs";

function text(value: unknown) {
  if (value == null) return "";
  if (typeof value === "object" && "text" in (value as Record<string, unknown>)) {
    return String((value as Record<string, unknown>).text || "").trim();
  }
  return String(value).trim();
}

function number(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed) : null;
}

function normalizePlate(value: string) {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function displayPlate(value: string) {
  const normalized = normalizePlate(value);
  const match = normalized.match(/^([A-Z]{1,2})(\d{1,4})([A-Z]{0,3})$/);
  return match ? [match[1], match[2], match[3]].filter(Boolean).join(" ") : value.toUpperCase().trim();
}

async function main() {
  const input = process.argv[2];
  if (!input) {
    console.error("Penggunaan: npm run import:xlsx -- /lokasi/file.xlsx");
    process.exit(1);
  }

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(input);
  const dbSheet = workbook.getWorksheet("DATABASE");
  if (!dbSheet) throw new Error("Sheet DATABASE tidak ditemukan.");

  const lpsNames = new Set<string>();
  const vehicleMap = new Map<string, Record<string, unknown>>();
  const assignments: Array<Record<string, unknown>> = [];

  dbSheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const plateRaw = text(row.getCell(1).value);
    if (!plateRaw) return;
    const normalized = normalizePlate(plateRaw);
    const lpsName = text(row.getCell(4).value) || "TIDAK DIKETAHUI";
    const tare = number(row.getCell(6).value);
    lpsNames.add(lpsName);

    if (!vehicleMap.has(normalized)) {
      vehicleMap.set(normalized, {
        code: `ARM-HJ-${String(vehicleMap.size + 1).padStart(4, "0")}`,
        plateNumber: displayPlate(plateRaw),
        plateNormalized: normalized,
        vehicleType: text(row.getCell(3).value) || "PICKUP",
        wasteType: text(row.getCell(5).value) || "SAMPAH RUMAH TANGGA",
        defaultTareKg: tare,
        qrToken: crypto.createHash("sha256").update(`HJ-QR-${normalized}`).digest("hex").slice(0, 32),
        active: true,
      });
    }

    assignments.push({
      plateNormalized: normalized,
      lpsName,
      driverName: text(row.getCell(2).value) || null,
      tareKg: tare,
      isPrimary: !assignments.some((item) => item.plateNormalized === normalized),
    });
  });

  const transactions: Array<Record<string, unknown>> = [];
  for (const sheet of workbook.worksheets) {
    const match = sheet.name.match(/^(\d{2})\s+MEI$/i);
    if (!match) continue;
    const day = Number(match[1]);

    sheet.eachRow((row) => {
      const ticket = text(row.getCell(2).value);
      if (!ticket.toUpperCase().startsWith("INV/")) return;
      const plateRaw = text(row.getCell(3).value);
      const normalized = normalizePlate(plateRaw);
      const lpsName = text(row.getCell(6).value) || "TIDAK DIKETAHUI";
      const gross = number(row.getCell(8).value);
      const tare = number(row.getCell(9).value);
      const netto1 = number(row.getCell(10).value);
      const rafaksi = number(row.getCell(11).value) ?? 0;
      const netto2 = number(row.getCell(12).value);
      if (!gross || !plateRaw) return;
      lpsNames.add(lpsName);

      transactions.push({
        ticketNumber: ticket,
        date: `2026-05-${String(day).padStart(2, "0")}T08:00:00+07:00`,
        plateNormalized: normalized,
        driverName: text(row.getCell(4).value) || null,
        vehicleType: text(row.getCell(5).value) || "PICKUP",
        lpsName,
        wasteType: text(row.getCell(7).value) || "SAMPAH",
        grossKg: gross,
        tareKg: tare ?? (netto1 == null ? 0 : gross - netto1),
        netto1Kg: netto1 ?? gross - (tare ?? 0),
        rafaksiKg: rafaksi,
        netto2Kg: netto2 ?? (netto1 ?? gross - (tare ?? 0)) - rafaksi,
        ritasi: number(row.getCell(13).value) ?? 1,
        tareSource: "DATABASE",
        status: "COMPLETED",
        source: "IMPORT_EXCEL",
      });
    });
  }

  const seed = {
    meta: {
      source: path.basename(input),
      generatedAt: new Date().toISOString(),
      vehicleCount: vehicleMap.size,
      lpsCount: lpsNames.size,
      transactionCount: transactions.length,
    },
    lps: Array.from(lpsNames).sort().map((name) => ({
      name,
      code: name.toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40),
    })),
    vehicles: Array.from(vehicleMap.values()),
    assignments,
    transactions,
  };

  const output = path.join(process.cwd(), "data", "seed.imported.json");
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify(seed, null, 2));
  console.log(`Selesai: ${output}`);
  console.log(seed.meta);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
