import { Cable, ShieldCheck, Usb } from "lucide-react";
import RemoteSerialStatusPanel from "@/components/RemoteSerialStatusPanel";
import SerialConnectionPanel from "@/components/SerialConnectionPanel";
import { getDeviceList } from "@/lib/queries";
import { formatDateTime, formatNumber } from "@/lib/utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function DevicePage() {
  const devices = (await getDeviceList()).filter((device) => String(device.protocol || "") === "DIRECT_SERIAL");
  const bridgeMode = (process.env.SERIAL_BRIDGE_MODE || "").trim().toLowerCase();
  const isVercel = Boolean((process.env.VERCEL || "").trim());
  const localBridgeMode = !isVercel && bridgeMode !== "remote";

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Koneksi Timbangan</h1>
          <p>Indikator terhubung langsung ke komputer melalui adapter USB–RS232 atau USB–RS485.</p>
        </div>
        <span className="badge green"><Usb size={14} /> Tanpa ESP32</span>
      </div>

      {localBridgeMode ? <SerialConnectionPanel /> : <RemoteSerialStatusPanel />}

      <div style={{ height: 18 }} />
      <article className="card">
        <div className="card-head">
          <div><h2>Riwayat koneksi aplikasi</h2><p>Pembacaan terakhir yang berhasil masuk ke database.</p></div>
        </div>
        <div className="table-wrap" style={{ marginTop: 14 }}>
          <table>
            <thead><tr><th>Connection ID</th><th>Lokasi</th><th>Port</th><th>Protokol</th><th className="num">Berat terakhir</th><th>Terakhir menerima</th></tr></thead>
            <tbody>
              {devices.map((device) => (
                <tr key={String(device.id)}>
                  <td><strong>{String(device.device_code)}</strong></td>
                  <td>{String(device.location_name)}</td>
                  <td>{device.port_name ? String(device.port_name) : "Belum dipilih"}</td>
                  <td><span className="badge"><Cable size={12} /> {String(device.connection_type || "RS232")}</span></td>
                  <td className="num">{device.latest_weight == null ? "-" : `${formatNumber(Number(device.latest_weight))} kg`}</td>
                  <td>{formatDateTime(device.last_seen_at ? String(device.last_seen_at) : null)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </article>

      <div style={{ height: 18 }} />
      <article className="card">
        <div className="card-body serial-note">
          <ShieldCheck size={25} color="var(--primary)" />
          <div>
            <strong>Rangkaian yang benar</strong>
            <div className="muted">Indikator → kabel/pinout sesuai manual → adapter USB–RS232/RS485 terisolasi → COM port komputer → Serial Bridge lokal → API aplikasi → database.</div>
            <div className="help">Port DB9 indikator belum tentu memakai pinout PC standar. Pastikan jenis sinyal, baud rate, parity, stop bit, dan format data dari manual indikator sebelum menyambungkan kabel.</div>
          </div>
        </div>
      </article>
    </>
  );
}
