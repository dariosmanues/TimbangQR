import { Download, FileSpreadsheet } from "lucide-react";
import { getMonthlyReport } from "@/lib/queries";
import { formatNumber, monthLabel } from "@/lib/utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function ReportPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const params = await searchParams;
  const month = params.month || "2026-05";
  const rows = await getMonthlyReport(month);
  const grandTotal = rows.reduce((sum, row) => sum + row.total, 0);
  const grandRitasi = rows.reduce((sum, row) => sum + row.ritasi, 0);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Rekap tonase bulanan</h1>
          <p>Format matriks tanggal 1–31 mengikuti rekap Excel Harapan Jaya.</p>
        </div>
        <a className="btn btn-primary" href={`/api/reports/export?month=${month}`}>
          <Download size={17} /> Unduh Excel
        </a>
      </div>

      <form className="toolbar" method="get">
        <div className="search">
          <input className="input" type="month" name="month" defaultValue={month} />
          <button className="btn btn-secondary" type="submit"><FileSpreadsheet size={17} /> Tampilkan</button>
        </div>
        <div className="badge green">
          {monthLabel(month)} · {formatNumber(grandTotal)} kg · {formatNumber(grandRitasi)} ritasi
        </div>
      </form>

      <article className="card">
        <div className="card-head">
          <div>
            <h2>Rekap {monthLabel(month)}</h2>
            <p>{rows.length} LPS memiliki transaksi pada bulan ini.</p>
          </div>
        </div>
        <div className="table-wrap" style={{ marginTop: 14 }}>
          <table className="report-table">
            <thead>
              <tr>
                <th>No.</th>
                <th>Nama LPS</th>
                {Array.from({ length: 31 }, (_, i) => <th key={i}>{String(i + 1).padStart(2, "0")}</th>)}
                <th>Total tonase</th>
                <th>Ritasi</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={row.name}>
                  <td>{index + 1}</td>
                  <td><strong>{row.name}</strong></td>
                  {row.days.map((value, day) => <td key={day}>{value ? formatNumber(value) : "0"}</td>)}
                  <td><strong>{formatNumber(row.total)}</strong></td>
                  <td><strong>{formatNumber(row.ritasi)}</strong></td>
                </tr>
              ))}
              <tr>
                <td />
                <td><strong>TOTAL</strong></td>
                {Array.from({ length: 31 }, (_, day) => (
                  <td key={day}><strong>{formatNumber(rows.reduce((sum, row) => sum + row.days[day], 0))}</strong></td>
                ))}
                <td><strong>{formatNumber(grandTotal)}</strong></td>
                <td><strong>{formatNumber(grandRitasi)}</strong></td>
              </tr>
              {rows.length === 0 && <tr><td colSpan={35} className="empty">Belum ada transaksi pada bulan ini.</td></tr>}
            </tbody>
          </table>
        </div>
      </article>
    </>
  );
}
