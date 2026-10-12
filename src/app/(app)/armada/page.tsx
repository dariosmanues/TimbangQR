import Link from "next/link";
import { QrCode, Search, ShieldCheck, Truck, MapPin, Building2, User } from "lucide-react";
import VehicleCreateForm from "@/components/VehicleCreateForm";
import VehicleStatusToggle from "@/components/VehicleStatusToggle";
import { getLpsList, listVehicles, getVehicleCounts } from "@/lib/queries";
import { formatNumber } from "@/lib/utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function ArmadaPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: "active" | "all" | "inactive" }>;
}) {
  const params = await searchParams;
  const q = params.q || "";
  const filter = params.status || "active";
  const [vehicles, lps, counts] = await Promise.all([
    listVehicles(q, filter),
    getLpsList(),
    getVehicleCounts(),
  ]);

  return (
    <>
      <div className="page-head">
        <div>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
            <span className="badge green">
              <ShieldCheck size={14} /> TPS WILAYAH HARAPAN JAYA
            </span>
            <span className="badge">UPDATE OKTOBER 2026</span>
          </div>
          <h1>Master Armada</h1>
          <p>
            {formatNumber(vehicles.length)} armada terdaftar dalam database jembatan timbang.
            {filter === "active" && ` Menampilkan ${counts.active} armada resmi TPS Wilayah Harapan Jaya.`}
          </p>
        </div>
        <VehicleCreateForm lpsOptions={lps} />
      </div>

      <div className="toolbar" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 18 }}>
        <form className="search" method="get" style={{ display: "flex", gap: 9, minWidth: "min(100%, 420px)" }}>
          <input type="hidden" name="status" value={filter} />
          <input
            className="input"
            name="q"
            defaultValue={q}
            placeholder="Cari no. polisi, no. izin, LPS, ketua, kelurahan..."
          />
          <button className="btn btn-secondary" type="submit">
            <Search size={17} /> Cari
          </button>
        </form>

        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <Link
            href={`/armada?status=active${q ? `&q=${encodeURIComponent(q)}` : ""}`}
            className={`btn btn-sm ${filter === "active" ? "btn-primary" : "btn-secondary"}`}
          >
            Harapan Jaya ({counts.active} Aktif)
          </Link>
          <Link
            href={`/armada?status=all${q ? `&q=${encodeURIComponent(q)}` : ""}`}
            className={`btn btn-sm ${filter === "all" ? "btn-primary" : "btn-secondary"}`}
          >
            Semua Data ({counts.total})
          </Link>
          <Link
            href={`/armada?status=inactive${q ? `&q=${encodeURIComponent(q)}` : ""}`}
            className={`btn btn-sm ${filter === "inactive" ? "btn-primary" : "btn-secondary"}`}
          >
            Riwayat Nonaktif ({counts.inactive})
          </Link>
        </div>
      </div>

      <article className="card">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th style={{ width: 60, textAlign: "center" }}>No</th>
                <th>Kode & No. Izin</th>
                <th>No. Polisi</th>
                <th>LPS & Pengelola</th>
                <th>Kelurahan / Kecamatan</th>
                <th>Wilayah Kerja</th>
                <th className="num">Tare Acuan</th>
                <th style={{ textAlign: "center" }}>Status</th>
                <th className="num">Aksi</th>
              </tr>
            </thead>
            <tbody>
              {vehicles.map((vehicle, idx) => (
                <tr key={vehicle.id}>
                  <td style={{ textAlign: "center", fontWeight: 700, color: "var(--muted)" }}>
                    {vehicle.no_urut || idx + 1}
                  </td>
                  <td>
                    <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                      <strong>{vehicle.code}</strong>
                      {vehicle.nomor_izin ? (
                        <span style={{ fontSize: 11, color: "var(--muted)", fontFamily: "monospace" }}>
                          {vehicle.nomor_izin}
                        </span>
                      ) : (
                        <span style={{ fontSize: 11, color: "var(--muted)" }}>-</span>
                      )}
                    </div>
                  </td>
                  <td>
                    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                      <span className="plate" style={{ fontSize: 14 }}>{vehicle.plate_number}</span>
                      <span className="badge" style={{ fontSize: 10, width: "fit-content" }}>
                        <Truck size={10} style={{ marginRight: 2 }} /> {vehicle.vehicle_type}
                      </span>
                    </div>
                  </td>
                  <td>
                    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                      <strong style={{ color: "var(--text)" }}>
                        {vehicle.nama_lps || vehicle.lps_names || <span className="muted">Belum ditetapkan</span>}
                      </strong>
                      {vehicle.nama_ketua_lps && (
                        <span style={{ fontSize: 12, color: "var(--muted)", display: "flex", alignItems: "center", gap: 4 }}>
                          <User size={12} /> {vehicle.nama_ketua_lps}
                        </span>
                      )}
                    </div>
                  </td>
                  <td>
                    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                      <span style={{ fontWeight: 600 }}>{vehicle.kelurahan_lps || "-"}</span>
                      <span style={{ fontSize: 12, color: "var(--muted)" }}>{vehicle.kecamatan_lps || vehicle.kecamatan || "-"}</span>
                    </div>
                  </td>
                  <td style={{ maxWidth: 280, fontSize: 12 }}>
                    {vehicle.wilayah_kerja && vehicle.wilayah_kerja !== "-" ? (
                      <span title={vehicle.wilayah_kerja} style={{ display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                        {vehicle.wilayah_kerja}
                      </span>
                    ) : (
                      <span className="muted">-</span>
                    )}
                  </td>
                  <td className="num">
                    {vehicle.default_tare_kg ? (
                      <strong>{formatNumber(vehicle.default_tare_kg)} kg</strong>
                    ) : (
                      <span className="muted">-</span>
                    )}
                  </td>
                  <td style={{ textAlign: "center" }}>
                    <VehicleStatusToggle
                      vehicleId={vehicle.id}
                      initialActive={vehicle.active}
                      plateNumber={vehicle.plate_number}
                      code={vehicle.code}
                    />
                  </td>
                  <td className="num">
                    <Link className="btn btn-soft btn-sm" href={`/armada/${vehicle.id}`}>
                      <QrCode size={14} /> Detail & QR
                    </Link>
                  </td>
                </tr>
              ))}
              {vehicles.length === 0 && (
                <tr>
                  <td colSpan={9} className="empty" style={{ textAlign: "center", padding: "32px 16px" }}>
                    Tidak ada armada yang cocok dengan kriteria pencarian.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </article>
    </>
  );
}
