import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import PrintButton from "@/components/PrintButton";
import { dbOne } from "@/lib/db";
import { formatDateTime, formatNumber } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function TicketPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const row = await dbOne<Record<string, string | number | null>>(`
    SELECT w.*, d.device_code
    FROM weighings w
    LEFT JOIN weighbridge_devices d ON d.id = w.device_id
    WHERE w.id = $1
  `, [Number(id)]);
  if (!row) return notFound();

  return (
    <>
      <div className="page-head no-print">
        <div>
          <Link className="muted" href="/transaksi"><ArrowLeft size={15} style={{ verticalAlign: "middle" }} /> Kembali</Link>
          <h1 style={{ marginTop: 8 }}>Tiket timbang</h1>
          <p>{String(row.ticket_number)}</p>
        </div>
        <PrintButton />
      </div>

      <article className="card" style={{ maxWidth: 780, margin: "0 auto" }}>
        <div className="card-body" style={{ padding: 34 }}>
          <div style={{ textAlign: "center", borderBottom: "2px solid var(--text)", paddingBottom: 18, marginBottom: 22 }}>
            <h2 style={{ margin: 0 }}>TRANSDEPO HARAPAN JAYA</h2>
            <div className="muted">TIKET PENIMBANGAN ARMADA SAMPAH</div>
          </div>

          <div className="summary-box">
            <div className="summary-item"><span>No. tiket</span><strong>{String(row.ticket_number)}</strong></div>
            <div className="summary-item"><span>Tanggal</span><strong style={{ fontSize: 14 }}>{formatDateTime(String(row.weighed_at))}</strong></div>
            <div className="summary-item"><span>No. polisi</span><strong className="plate">{String(row.plate_number)}</strong></div>
          </div>

          <div style={{ height: 18 }} />
          <table>
            <tbody>
              <tr><td>Nama pengemudi</td><td><strong>{String(row.driver_name || "-")}</strong></td></tr>
              <tr><td>Jenis kendaraan</td><td><strong>{String(row.vehicle_type)}</strong></td></tr>
              <tr><td>Pengirim / LPS</td><td><strong>{String(row.lps_name)}</strong></td></tr>
              <tr><td>Jenis sampah</td><td><strong>{String(row.waste_type)}</strong></td></tr>
              <tr><td>Perangkat</td><td><strong>{String(row.device_code || "INPUT MANUAL")}</strong></td></tr>
            </tbody>
          </table>

          <div style={{ height: 18 }} />
          <div className="summary-box">
            <div className="summary-item"><span>Gross</span><strong>{formatNumber(Number(row.gross_kg))} kg</strong></div>
            <div className="summary-item"><span>Tare</span><strong>{formatNumber(Number(row.tare_kg))} kg</strong></div>
            <div className="summary-item"><span>Netto 1</span><strong>{formatNumber(Number(row.netto_1_kg))} kg</strong></div>
            <div className="summary-item"><span>Rafaksi</span><strong>{formatNumber(Number(row.rafaksi_kg))} kg</strong></div>
            <div className="summary-item" style={{ gridColumn: "span 2", background: "var(--primary-soft)" }}>
              <span>Netto 2</span><strong style={{ color: "var(--primary)", fontSize: 28 }}>{formatNumber(Number(row.netto_2_kg))} kg</strong>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 70, marginTop: 70, textAlign: "center" }}>
            <div><div>Pengemudi</div><div style={{ marginTop: 70, borderTop: "1px solid #777", paddingTop: 6 }}>{String(row.driver_name || "(........................)")}</div></div>
            <div><div>Operator Timbang</div><div style={{ marginTop: 70, borderTop: "1px solid #777", paddingTop: 6 }}>(........................)</div></div>
          </div>
        </div>
      </article>
    </>
  );
}
