import { notFound } from "next/navigation";
import { ArrowLeft, Gauge } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import PrintButton from "@/components/PrintButton";
import { getVehicle } from "@/lib/queries";
import { formatDateTime, formatNumber } from "@/lib/utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function VehicleDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await getVehicle(Number(id));
  if (!result) return notFound();
  const { vehicle, assignments, weighings } = result;

  return (
    <>
      <div className="page-head no-print">
        <div>
          <Link className="muted" href="/armada"><ArrowLeft size={15} style={{ verticalAlign: "middle" }} /> Kembali ke master armada</Link>
          <h1 style={{ marginTop: 8 }}>{vehicle.plate_number}</h1>
          <p>{vehicle.code} · {vehicle.vehicle_type}</p>
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <Link className="btn btn-secondary" href={`/scan?token=${vehicle.qr_token}`}><Gauge size={17} /> Timbang armada</Link>
          <PrintButton />
        </div>
      </div>

      <section className="grid equal">
        <article className="card qr-card">
          <Image
            src={`/api/vehicles/${vehicle.id}/qr`}
            alt={`QR ${vehicle.plate_number}`}
            width={240}
            height={240}
            unoptimized
          />
          <h2>{vehicle.plate_number}</h2>
          <p>{vehicle.code}</p>
          <span className="badge green">QR AKTIF</span>
          <div className="help" style={{ marginTop: 14 }}>
            Tempelkan QR pada kaca atau bodi armada. Jangan mengubah token secara manual.
          </div>
        </article>

        <article className="card">
          <div className="card-head"><div><h2>Data armada</h2><p>Data sumber dan penugasan LPS.</p></div></div>
          <div className="card-body">
            <div className="summary-box">
              <div className="summary-item"><span>Tare acuan</span><strong>{vehicle.default_tare_kg ? `${formatNumber(vehicle.default_tare_kg)} kg` : "-"}</strong></div>
              <div className="summary-item"><span>Jenis sampah</span><strong style={{ fontSize: 14 }}>{vehicle.waste_type}</strong></div>
              <div className="summary-item"><span>Penugasan</span><strong>{assignments.length}</strong></div>
            </div>
            <div style={{ height: 16 }} />
            <div className="table-wrap">
              <table>
                <thead><tr><th>LPS</th><th>Pengemudi</th><th className="num">Tare</th><th>Status</th></tr></thead>
                <tbody>
                  {assignments.map((a) => (
                    <tr key={a.id}>
                      <td>{a.lps_name}</td>
                      <td>{a.driver_name || "-"}</td>
                      <td className="num">{a.tare_kg ? formatNumber(a.tare_kg) : "-"}</td>
                      <td>{a.is_primary ? <span className="badge green">Utama</span> : <span className="badge">Alternatif</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </article>
      </section>

      <div style={{ height: 18 }} />

      <article className="card">
        <div className="card-head"><div><h2>Riwayat penimbangan</h2><p>20 transaksi terakhir armada ini.</p></div></div>
        <div className="table-wrap" style={{ marginTop: 14 }}>
          <table>
            <thead>
              <tr><th>Tanggal</th><th>Tiket</th><th>LPS</th><th>Pengemudi</th><th className="num">Gross</th><th className="num">Tare</th><th className="num">Netto 2</th></tr>
            </thead>
            <tbody>
              {weighings.map((w) => (
                <tr key={w.id}>
                  <td>{formatDateTime(w.weighed_at)}</td>
                  <td><strong>{w.ticket_number}</strong></td>
                  <td>{w.lps_name}</td>
                  <td>{w.driver_name || "-"}</td>
                  <td className="num">{formatNumber(w.gross_kg)}</td>
                  <td className="num">{formatNumber(w.tare_kg)}</td>
                  <td className="num"><strong>{formatNumber(w.netto_2_kg)}</strong></td>
                </tr>
              ))}
              {weighings.length === 0 && <tr><td className="empty" colSpan={7}>Belum ada transaksi.</td></tr>}
            </tbody>
          </table>
        </div>
      </article>
    </>
  );
}
