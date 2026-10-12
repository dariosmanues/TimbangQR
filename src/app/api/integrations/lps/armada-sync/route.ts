import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { withTransaction } from "@/lib/db";
import { displayPlate, normalizePlate } from "@/lib/utils";

export const runtime = "nodejs";

function getExpectedSecret(): string {
  return (
    process.env.LPS_INTEGRATION_SECRET?.trim() ||
    process.env.TIMBANGQR_INTEGRATION_SECRET?.trim() ||
    "a8f9c4e2b7d013589ef671234abcd567890ef123456789abcdef0123456789ab"
  );
}

function isAuthorized(request: Request): boolean {
  const expectedSecret = getExpectedSecret();
  const authHeader = request.headers.get("authorization") || "";
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  const token = match ? match[1].trim() : "";
  const apiKey = request.headers.get("x-integration-secret")?.trim() || request.headers.get("x-api-key")?.trim();
  const candidate = token || apiKey || "";

  if (!candidate || !expectedSecret) return false;
  try {
    const left = Buffer.from(candidate);
    const right = Buffer.from(expectedSecret);
    return left.length === right.length && crypto.timingSafeEqual(left, right);
  } catch {
    return false;
  }
}

interface IncomingArmada {
  id?: string;
  platNomor: string;
  namaLps: string;
  namaSupir?: string | null;
  namaKetuaLps?: string | null;
  noTlpKetuaLps?: string | null;
  alamatLps?: string | null;
  wilayahKerja?: string | null;
  lokasiTransdepo?: string | null;
  jenisArmada?: string | null;
  noIzinOperasi?: string | null;
  nomorSkLps?: string | null;
  tanggalSkLps?: string | Date | null;
  tanggalTerbitIzin?: string | Date | null;
  qrCode?: string | null;
  isActive?: boolean;
  kelurahan?: string | { nama?: string; kecamatan?: { nama?: string } } | null;
  kecamatan?: string | null;
}

function formatDateString(val: string | Date | null | undefined): string | null {
  if (!val) return null;
  if (typeof val === "string") return val.split("T")[0];
  try {
    return val.toISOString().split("T")[0];
  } catch {
    return String(val);
  }
}

export async function POST(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const items: IncomingArmada[] = Array.isArray(body)
      ? body
      : Array.isArray(body.armadas)
      ? body.armadas
      : body.armada
      ? [body.armada]
      : [body];

    if (!items.length || !items[0]?.platNomor) {
      return NextResponse.json(
        { error: "Payload armada tidak valid. Diperlukan platNomor." },
        { status: 400 }
      );
    }

    const results = await withTransaction(async (client) => {
      // 1. Ekstrak seluruh nomor plat, no izin, dan nama LPS secara massal
      const plates = Array.from(new Set(items.map((i) => normalizePlate(i.platNomor)).filter(Boolean)));
      const izins = Array.from(new Set(items.map((i) => i.noIzinOperasi?.trim()).filter(Boolean))) as string[];
      const lpsNames = Array.from(new Set(items.map((i) => i.namaLps?.trim()).filter(Boolean))) as string[];

      // 2. Ambil master armada yang sudah ada dalam 1 query tunggal
      const existingVehicles = await client.query<{
        id: number;
        code: string;
        plate_number: string;
        plate_normalized: string;
        active: boolean;
        nomor_izin: string | null;
        qr_token: string;
        nama_lps: string | null;
        kelurahan_lps: string | null;
      }>(
        `SELECT id, code, plate_number, plate_normalized, active, nomor_izin, qr_token, nama_lps, kelurahan_lps
         FROM vehicles
         WHERE plate_normalized = ANY($1::text[])
            OR (nomor_izin IS NOT NULL AND nomor_izin = ANY($2::text[]))`,
        [plates, izins.length ? izins : ["__NO_IZIN__"]]
      );

      const vehicleByPlate = new Map<string, typeof existingVehicles.rows[0]>();
      const vehicleByIzin = new Map<string, typeof existingVehicles.rows[0]>();
      for (const row of existingVehicles.rows) {
        if (!vehicleByPlate.has(row.plate_normalized)) {
          vehicleByPlate.set(row.plate_normalized, row);
        }
        if (row.nomor_izin && !vehicleByIzin.has(row.nomor_izin)) {
          vehicleByIzin.set(row.nomor_izin, row);
        }
      }

      // 3. Ambil data master LPS dalam 1 query tunggal
      const existingLps = await client.query<{ id: number; name: string }>(
        `SELECT id, name FROM lps WHERE UPPER(TRIM(name)) = ANY($1::text[])`,
        [lpsNames.map((n) => n.toUpperCase())]
      );
      const lpsMap = new Map<string, number>();
      for (const row of existingLps.rows) {
        lpsMap.set(row.name.toUpperCase().trim(), row.id);
      }

      // Insert LPS baru yang belum ada di master
      for (const name of lpsNames) {
        const key = name.toUpperCase().trim();
        if (!lpsMap.has(key)) {
          const lpsCode = `LPS-${name.slice(0, 10).replace(/[^A-Za-z0-9]/g, "").toUpperCase()}-${Date.now().toString().slice(-4)}`;
          const insLps = await client.query<{ id: number }>(
            "INSERT INTO lps (code, name, active) VALUES ($1, $2, TRUE) ON CONFLICT (code) DO NOTHING RETURNING id",
            [lpsCode, name]
          );
          if (insLps.rows[0]) {
            lpsMap.set(key, insLps.rows[0].id);
          }
        }
      }

      // 4. Hitung awalan kode ARM-HJ sekali saja
      const countResult = await client.query<{ count: number }>(
        "SELECT COUNT(*)::int AS count FROM vehicles WHERE code LIKE 'ARM-HJ-%'"
      );
      let nextCodeNum = (countResult.rows[0]?.count || 0) + 1;

      // 5. Proses setiap armada
      const innerResults = [];

      for (const item of items) {
        if (!item.platNomor) continue;

        const plateNormalized = normalizePlate(item.platNomor);
        const plateNumber = displayPlate(item.platNomor);

        const lokasiClean = (item.lokasiTransdepo || "").toUpperCase().replace(/\s+/g, "");
        const wilayahClean = (item.wilayahKerja || "").toUpperCase().replace(/\s+/g, "");
        const isHarapanJaya =
          lokasiClean.includes("HARAPANJAYA") || wilayahClean.includes("HARAPANJAYA");

        let kelurahanNama: string | null = null;
        let kecamatanNama: string | null = item.kecamatan || null;

        if (typeof item.kelurahan === "string") {
          kelurahanNama = item.kelurahan;
        } else if (item.kelurahan && typeof item.kelurahan === "object") {
          kelurahanNama = item.kelurahan.nama || null;
          if (!kecamatanNama && item.kelurahan.kecamatan?.nama) {
            kecamatanNama = item.kelurahan.kecamatan.nama;
          }
        }

        const tglSk = formatDateString(item.tanggalSkLps);
        const tglIzin = formatDateString(item.tanggalTerbitIzin);

        // Cari record yang cocok di cache map:
        // 1. Nomor izin
        // 2. Jika nomor plat dipakai oleh multi-LPS (misal BM 9601 TZ di LPS Pesisir & LPS Rintis), cocokkan nama LPS / kelurahan
        // 3. Fallback ke nomor plat
        let vehicleRow = item.noIzinOperasi ? vehicleByIzin.get(item.noIzinOperasi) : null;
        if (!vehicleRow && (item.namaLps || kelurahanNama)) {
          const cleanItemLps = (item.namaLps || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
          const cleanItemKel = (kelurahanNama || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
          const matchingByPlate = existingVehicles.rows.filter((r) => r.plate_normalized === plateNormalized);
          if (matchingByPlate.length > 0) {
            vehicleRow = matchingByPlate.find((r) => {
              const rLps = (r.nama_lps || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
              const rKel = (r.kelurahan_lps || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
              return (
                (cleanItemLps && (cleanItemLps.includes(rLps) || rLps.includes(cleanItemLps))) ||
                (cleanItemKel && (cleanItemKel.includes(rKel) || rKel.includes(cleanItemKel)))
              );
            }) || null;
          }
        }
        if (!vehicleRow) {
          vehicleRow = vehicleByPlate.get(plateNormalized) || null;
        }

        if (isHarapanJaya) {
          let vehicleId: number;
          let action: "updated" | "created";

          let qrToken =
            item.qrCode ||
            vehicleRow?.qr_token ||
            `HJ-LPS-${plateNormalized}-${Date.now()}`;

          // Pastikan qr_token unik dan tidak bentrok dengan baris kendaraan lain
          const qrConflict = await client.query<{ id: number }>(
            "SELECT id FROM vehicles WHERE qr_token = $1 AND id <> $2 LIMIT 1",
            [qrToken, vehicleRow?.id || -1]
          );
          if (qrConflict.rows[0]) {
            qrToken = `${qrToken}-${plateNormalized}`;
          }

          if (vehicleRow) {
            vehicleId = vehicleRow.id;
            action = "updated";

            await client.query(
              `UPDATE vehicles SET
                plate_number = $1,
                plate_normalized = $2,
                vehicle_type = COALESCE($3, vehicle_type, 'PICKUP'),
                nama_lps = COALESCE($4, nama_lps),
                nama_ketua_lps = COALESCE($5, nama_ketua_lps),
                alamat_lps = COALESCE($6, alamat_lps),
                kelurahan_lps = COALESCE($7, kelurahan_lps),
                kecamatan_lps = COALESCE($8, kecamatan_lps),
                kecamatan = COALESCE($8, kecamatan),
                wilayah_kerja = COALESCE($9, wilayah_kerja),
                nomor_izin = COALESCE($10, nomor_izin),
                nomor_sk_lps = COALESCE($11, nomor_sk_lps),
                tanggal_sk_lps = COALESCE($12, tanggal_sk_lps),
                tanggal_terbit_izin = COALESCE($13, tanggal_terbit_izin),
                qr_token = COALESCE($14, qr_token),
                lokasi_tps = 'HARAPAN JAYA',
                active = TRUE,
                updated_at = NOW()
              WHERE id = $15`,
              [
                plateNumber,
                plateNormalized,
                item.jenisArmada || null,
                item.namaLps || null,
                item.namaKetuaLps || null,
                item.alamatLps || null,
                kelurahanNama,
                kecamatanNama,
                item.wilayahKerja || null,
                item.noIzinOperasi || null,
                item.nomorSkLps || null,
                tglSk,
                tglIzin,
                qrToken,
                vehicleId,
              ]
            );
          } else {
            action = "created";
            const code = `ARM-HJ-${String(nextCodeNum++).padStart(4, "0")}`;

            const insertResult = await client.query<{ id: number }>(
              `INSERT INTO vehicles (
                code, plate_number, plate_normalized, vehicle_type, waste_type,
                default_tare_kg, qr_token, active, nomor_izin,
                nomor_sk_lps, tanggal_sk_lps, nama_lps,
                nama_ketua_lps, alamat_lps, kelurahan_lps, kecamatan_lps,
                kecamatan, wilayah_kerja, lokasi_tps, tanggal_terbit_izin
              ) VALUES (
                $1, $2, $3, $4, 'SAMPAH RUMAH TANGGA',
                NULL, $5, TRUE, $6,
                $7, $8, $9,
                $10, $11, $12, $13,
                $13, $14, 'HARAPAN JAYA', $15
              ) RETURNING id`,
              [
                code,
                plateNumber,
                plateNormalized,
                item.jenisArmada || "PICKUP",
                qrToken,
                item.noIzinOperasi || null,
                item.nomorSkLps || null,
                tglSk,
                item.namaLps,
                item.namaKetuaLps || null,
                item.alamatLps || null,
                kelurahanNama,
                kecamatanNama,
                item.wilayahKerja || null,
                tglIzin,
              ]
            );
            vehicleId = insertResult.rows[0].id;

            // Simpan di map lokal agar iterasi berikutnya mengetahui baris baru ini
            const newRow = {
              id: vehicleId,
              code,
              plate_number: plateNumber,
              plate_normalized: plateNormalized,
              active: true,
              nomor_izin: item.noIzinOperasi || null,
              qr_token: qrToken,
            };
            vehicleByPlate.set(plateNormalized, newRow);
            if (item.noIzinOperasi) vehicleByIzin.set(item.noIzinOperasi, newRow);
          }

          // Sinkronisasi tabel vehicle_assignments
          const lpsId = item.namaLps ? lpsMap.get(item.namaLps.toUpperCase().trim()) : null;
          if (lpsId) {
            const existingPrimary = await client.query<{ id: number; lps_id: number }>(
              "SELECT id, lps_id FROM vehicle_assignments WHERE vehicle_id = $1 AND is_primary = TRUE AND active = TRUE LIMIT 1",
              [vehicleId]
            );

            const assignCheck = await client.query<{ id: number }>(
              "SELECT id FROM vehicle_assignments WHERE vehicle_id = $1 AND lps_id = $2 LIMIT 1",
              [vehicleId, lpsId]
            );

            if (assignCheck.rows[0]) {
              if (existingPrimary.rows[0] && existingPrimary.rows[0].id !== assignCheck.rows[0].id) {
                await client.query("UPDATE vehicle_assignments SET is_primary = FALSE WHERE id = $1", [
                  existingPrimary.rows[0].id,
                ]);
              }
              await client.query(
                "UPDATE vehicle_assignments SET active = TRUE, is_primary = TRUE, driver_name = COALESCE($1, driver_name) WHERE id = $2",
                [item.namaSupir || item.namaKetuaLps || null, assignCheck.rows[0].id]
              );
            } else {
              if (existingPrimary.rows[0]) {
                await client.query("UPDATE vehicle_assignments SET is_primary = FALSE WHERE id = $1", [
                  existingPrimary.rows[0].id,
                ]);
              }
              await client.query(
                `INSERT INTO vehicle_assignments (vehicle_id, lps_id, driver_name, tare_kg, is_primary, active)
                 VALUES ($1, $2, $3, NULL, TRUE, TRUE)`,
                [vehicleId, lpsId, item.namaSupir || item.namaKetuaLps || null]
              );
            }
          }

          innerResults.push({
            plate: plateNumber,
            vehicleId,
            action,
            active: true,
            status: "HARAPAN_JAYA_ACTIVE",
          });
        } else {
          // Bila di-update bukan Harapan Jaya (misal dipindahkan ke AIR HITAM)
          if (vehicleRow) {
            await client.query(
              `UPDATE vehicles SET
                active = FALSE,
                lokasi_tps = $1,
                updated_at = NOW()
              WHERE id = $2`,
              [item.lokasiTransdepo || "AIRHITAM", vehicleRow.id]
            );

            await client.query(
              "UPDATE vehicle_assignments SET active = FALSE WHERE vehicle_id = $1",
              [vehicleRow.id]
            );

            innerResults.push({
              plate: plateNumber,
              vehicleId: vehicleRow.id,
              action: "deactivated",
              active: false,
              status: "NON_HARAPAN_JAYA_DEACTIVATED",
            });
          } else {
            innerResults.push({
              plate: plateNumber,
              action: "ignored",
              active: false,
              status: "SKIPPED_NOT_HARAPAN_JAYA",
            });
          }
        }
      }

      return innerResults;
    });

    return NextResponse.json({
      success: true,
      syncedCount: results.length,
      results,
    });
  } catch (error: any) {
    console.error("[LPS Sync Error]:", error);
    return NextResponse.json(
      {
        error: "Gagal menyinkronkan data armada.",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
