import Link from "next/link";
import { FileText, Gauge, Scale, Truck, UsersRound } from "lucide-react";
import KpiCard from "@/components/KpiCard";
import { getDashboardData } from "@/lib/queries";
import { formatDateTime, formatKg, formatNumber, monthLabel } from "@/lib/utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const data = await getDashboardData();
  const maxDaily = Math.max(...data.daily.map((item) => item.total_kg), 1);
  const maxLps = Math.max(...data.topLps.map((item) => item.total_kg), 1);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Dashboard operasional</h1>
          <p>Ringkasan data terakhir pada {monthLabel(data.latestMonth)}.</p>
        </div>
        <Link className="btn btn-primary" href="/scan">
          <Gauge size={18} /> Mulai penimbangan
        </Link>
      </div>

      <section className="grid kpis">
        <KpiCard
          icon={<Scale size={20} />}
          label="Total tonase"
          value={formatKg(data.totals.tonnage)}
          note={monthLabel(data.latestMonth)}
        />
        <KpiCard
          icon={<FileText size={20} />}
          label="Jumlah transaksi"
          value={formatNumber(data.totals.transactions)}
          note={`${formatNumber(data.totals.ritasi)} ritasi`}
        />
        <KpiCard
          icon={<Truck size={20} />}
          label="Armada terdaftar"
          value={formatNumber(data.vehicles)}
          note="Setiap armada memiliki QR unik"
        />
        <KpiCard
          icon={<UsersRound size={20} />}
          label="LPS terdata"
          value={formatNumber(data.lps)}
          note="Berdasarkan database Excel"
        />
      </section>

      <div style={{ height: 18 }} />

      {data.reconciliation && data.reconciliation.differenceKg !== 0 && (
        <article className="card" style={{ borderColor: "#efc477", background: "#fffaf0" }}>
          <div className="card-body" style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
            <FileText size={22} color="#9c5c00" />
            <div>
              <strong>Temuan rekonsiliasi data sumber</strong>
              <p className="muted" style={{ margin: "5px 0 0" }}>
                Total transaksi harian adalah {formatKg(data.reconciliation.transactionSheetsTotalKg)}, sedangkan
                sheet REKAP TONASE MEI mencatat {formatKg(data.reconciliation.summarySheetTotalKg)}.
                Selisih {formatKg(data.reconciliation.differenceKg)} berasal dari LPS Sialang Sakti tanggal 26 Mei
                yang tersedia di sheet transaksi tetapi belum masuk ke sheet rekap.
              </p>
            </div>
          </div>
        </article>
      )}

      <div style={{ height: 18 }} />

      <section className="grid two">
        <article className="card">
          <div className="card-head">
            <div>
              <h2>Tonase harian</h2>
              <p>Distribusi netto 2 per tanggal pada bulan data terakhir.</p>
            </div>
          </div>
          <div className="chart">
            {data.daily.map((item) => (
              <div className="chart-col" key={item.day} title={`${item.day}: ${formatKg(item.total_kg)}`}>
                <div className="chart-bar" style={{ height: `${Math.max((item.total_kg / maxDaily) * 100, 2)}%` }} />
                <div className="chart-label">{Number(item.day)}</div>
              </div>
            ))}
          </div>
          <div className="card-body muted" style={{ fontSize: 12 }}>
            Arahkan kursor ke batang untuk melihat tonase setiap hari.
          </div>
        </article>

        <article className="card">
          <div className="card-head">
            <div>
              <h2>LPS dengan tonase tertinggi</h2>
              <p>Delapan LPS teratas pada {monthLabel(data.latestMonth)}.</p>
            </div>
          </div>
          <div className="card-body progress-list">
            {data.topLps.map((item) => (
              <div className="progress-item" key={item.lps_name}>
                <div className="progress-meta">
                  <strong>{item.lps_name}</strong>
                  <span>{formatKg(item.total_kg)}</span>
                </div>
                <div className="progress-track">
                  <div className="progress-bar" style={{ width: `${(item.total_kg / maxLps) * 100}%` }} />
                </div>
              </div>
            ))}
          </div>
        </article>
      </section>

      <div style={{ height: 18 }} />

      <article className="card">
        <div className="card-head">
          <div>
            <h2>Transaksi terakhir</h2>
            <p>Data timbang terbaru yang masuk ke sistem.</p>
          </div>
          <Link className="btn btn-secondary btn-sm" href="/transaksi">Lihat semua</Link>
        </div>
        <div className="table-wrap" style={{ marginTop: 14 }}>
          <table>
            <thead>
              <tr>
                <th>Tanggal</th>
                <th>No. tiket</th>
                <th>No. polisi</th>
                <th>LPS</th>
                <th className="num">Gross</th>
                <th className="num">Tare</th>
                <th className="num">Netto 2</th>
              </tr>
            </thead>
            <tbody>
              {data.latest.map((row) => (
                <tr key={row.id}>
                  <td>{formatDateTime(row.weighed_at)}</td>
                  <td><strong>{row.ticket_number}</strong></td>
                  <td className="plate">{row.plate_number}</td>
                  <td>{row.lps_name}</td>
                  <td className="num">{formatNumber(row.gross_kg)}</td>
                  <td className="num">{formatNumber(row.tare_kg)}</td>
                  <td className="num"><strong>{formatNumber(row.netto_2_kg)}</strong></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </article>
    </>
  );
}
