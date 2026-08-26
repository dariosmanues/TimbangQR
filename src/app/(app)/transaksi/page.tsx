import Link from "next/link";
import { Filter, Search } from "lucide-react";
import { getLpsList, listWeighings } from "@/lib/queries";
import { formatDateTime, formatNumber } from "@/lib/utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function TransactionsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; month?: string; lps?: string }>;
}) {
  const params = await searchParams;
  const q = params.q || "";
  const month = params.month || "";
  const lps = params.lps || "";
  const [rows, lpsList] = await Promise.all([
    listWeighings({ search: q, month, lps, limit: 300 }),
    getLpsList(),
  ]);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Transaksi penimbangan</h1>
          <p>Menampilkan maksimal 300 data sesuai filter.</p>
        </div>
        <Link className="btn btn-primary" href="/scan">Transaksi baru</Link>
      </div>

      <form className="card card-body" method="get" style={{ marginBottom: 18 }}>
        <div className="form-row">
          <div className="field">
            <label>Pencarian</label>
            <input className="input" name="q" defaultValue={q} placeholder="No. tiket, no. polisi, pengemudi..." />
          </div>
          <div className="field">
            <label>Bulan</label>
            <input className="input" type="month" name="month" defaultValue={month} />
          </div>
          <div className="field">
            <label>LPS</label>
            <select className="select" name="lps" defaultValue={lps}>
              <option value="">Semua LPS</option>
              {lpsList.map((item) => <option key={item.id} value={item.name}>{item.name}</option>)}
            </select>
          </div>
          <div className="field" style={{ alignContent: "end" }}>
            <button className="btn btn-secondary" type="submit"><Filter size={17} /> Terapkan filter</button>
          </div>
        </div>
      </form>

      <article className="card">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Tanggal</th>
                <th>No. tiket</th>
                <th>No. polisi</th>
                <th>Pengemudi</th>
                <th>LPS</th>
                <th className="num">Gross</th>
                <th className="num">Tare</th>
                <th className="num">Netto 1</th>
                <th className="num">Rafaksi</th>
                <th className="num">Netto 2</th>
                <th className="num">Aksi</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>{formatDateTime(row.weighed_at)}</td>
                  <td><strong>{row.ticket_number}</strong></td>
                  <td className="plate">{row.plate_number}</td>
                  <td>{row.driver_name || "-"}</td>
                  <td>{row.lps_name}</td>
                  <td className="num">{formatNumber(row.gross_kg)}</td>
                  <td className="num">{formatNumber(row.tare_kg)}</td>
                  <td className="num">{formatNumber(row.netto_1_kg)}</td>
                  <td className="num">{formatNumber(row.rafaksi_kg)}</td>
                  <td className="num"><strong>{formatNumber(row.netto_2_kg)}</strong></td>
                  <td className="num"><Link className="btn btn-soft btn-sm" href={`/transaksi/${row.id}`}>Tiket</Link></td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={11} className="empty"><Search size={28} /><p>Data tidak ditemukan.</p></td></tr>}
            </tbody>
          </table>
        </div>
      </article>
    </>
  );
}
