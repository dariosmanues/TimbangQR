import Link from "next/link";
import { QrCode, Search } from "lucide-react";
import VehicleCreateForm from "@/components/VehicleCreateForm";
import { getLpsList, listVehicles } from "@/lib/queries";
import { formatNumber } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function ArmadaPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const params = await searchParams;
  const q = params.q || "";
  const [vehicles, lps] = await Promise.all([listVehicles(q), getLpsList()]);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Master armada</h1>
          <p>{formatNumber(vehicles.length)} armada tampil. QR setiap kendaraan bersifat unik.</p>
        </div>
        <VehicleCreateForm lpsOptions={lps} />
      </div>

      <form className="toolbar" method="get">
        <div className="search">
          <input className="input" name="q" defaultValue={q} placeholder="Cari nomor polisi, sopir, kode, atau LPS..." />
          <button className="btn btn-secondary" type="submit"><Search size={17} /> Cari</button>
        </div>
      </form>

      <article className="card">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Kode armada</th>
                <th>No. polisi</th>
                <th>Jenis</th>
                <th>LPS / Penugasan</th>
                <th className="num">Tare acuan</th>
                <th>Status</th>
                <th className="num">Aksi</th>
              </tr>
            </thead>
            <tbody>
              {vehicles.map((vehicle) => (
                <tr key={vehicle.id}>
                  <td><strong>{vehicle.code}</strong></td>
                  <td className="plate">{vehicle.plate_number}</td>
                  <td>{vehicle.vehicle_type}</td>
                  <td>
                    <div>{vehicle.lps_names || <span className="muted">Belum ditetapkan</span>}</div>
                    {(vehicle.assignment_count || 0) > 1 && (
                      <span className="badge orange">{vehicle.assignment_count} penugasan</span>
                    )}
                  </td>
                  <td className="num">{vehicle.default_tare_kg ? formatNumber(vehicle.default_tare_kg) : "-"}</td>
                  <td>
                    <span className={`badge ${vehicle.active ? "green" : "red"}`}>
                      <span className="dot" /> {vehicle.active ? "Aktif" : "Nonaktif"}
                    </span>
                  </td>
                  <td className="num">
                    <Link className="btn btn-soft btn-sm" href={`/armada/${vehicle.id}`}>
                      <QrCode size={15} /> Detail & QR
                    </Link>
                  </td>
                </tr>
              ))}
              {vehicles.length === 0 && (
                <tr><td colSpan={7} className="empty">Tidak ada armada yang cocok.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </article>
    </>
  );
}
