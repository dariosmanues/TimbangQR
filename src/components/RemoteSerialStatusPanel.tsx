"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Cloud, RefreshCw, Usb } from "lucide-react";

type RemoteReading = {
  id?: number | string;
  device_id?: number | string;
  device_code?: string;
  weight_kg?: number;
  stable?: boolean;
  indicator_raw?: string | null;
  recorded_at?: string | null;
};

type RemoteDevice = {
  id?: number | string;
  device_code?: string;
  location_name?: string;
  port_name?: string | null;
  connection_type?: string;
  baud_rate?: number;
  last_seen_at?: string | null;
  active?: boolean;
};

function dateTime(value?: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("id-ID", {
    dateStyle: "medium",
    timeStyle: "medium",
  }).format(date);
}

export default function RemoteSerialStatusPanel() {
  const [reading, setReading] = useState<RemoteReading | null>(null);
  const [device, setDevice] = useState<RemoteDevice | null>(null);
  const [serverLastSeen, setServerLastSeen] = useState<string | null>(null);
  const [serverBridgeOnline, setServerBridgeOnline] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [now, setNow] = useState(0);

  const refresh = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const response = await fetch("/api/serial/latest", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Gagal membaca data timbangan dari Vercel.");
      setReading(data.reading || null);
      setDevice(data.device || null);
      setServerLastSeen(data.lastSeenAt || data.device?.last_seen_at || data.reading?.recorded_at || null);
      setServerBridgeOnline(Boolean(data.bridgeOnline));
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal membaca data timbangan dari Vercel.");
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const initial = window.setTimeout(() => {
      setNow(Date.now());
      void refresh();
    }, 0);
    const timer = window.setInterval(() => void refresh(true), 2000);
    const clock = window.setInterval(() => setNow(Date.now()), 5000);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(timer);
      window.clearInterval(clock);
    };
  }, [refresh]);

  const lastSeen = serverLastSeen || device?.last_seen_at || reading?.recorded_at || null;
  const isFresh = useMemo(() => {
    if (serverBridgeOnline) return true;
    if (!lastSeen) return false;
    const timestamp = Date.parse(lastSeen);
    if (Number.isNaN(timestamp)) return false;
    return now - timestamp <= 15 * 60 * 1000;
  }, [serverBridgeOnline, lastSeen, now]);

  const weight = reading?.weight_kg;
  const raw = reading?.indicator_raw || (isFresh ? "PING_TEST (Bridge Terhubung)" : "-");
  const deviceCode = device?.device_code || reading?.device_code || "TIMBANG-HJ-SERIAL-01";
  const portInfo = device?.port_name
    ? `${device.port_name} (${device.connection_type || "RS232"})`
    : `REMOTE / ${device?.connection_type || "RS232"}`;

  return (
    <div className="grid equal">
      <article className="card">
        <div className="card-head">
          <div>
            <h2>Status Bridge cloud</h2>
            <p>Status berdasarkan data terbaru yang benar-benar sudah diterima Vercel dan tersimpan di PostgreSQL.</p>
          </div>
          <span className={`badge ${isFresh ? "green" : "orange"}`}>
            <span className="dot" /> {isFresh ? "Bridge online" : (reading || device?.last_seen_at) ? "Menunggu sinyal baru" : "Belum ada data"}
          </span>
        </div>
        <div className="card-body">
          <div className="serial-status-grid">
            <div className="summary-item"><span>Perangkat</span><strong className="small-value">{deviceCode}</strong></div>
            <div className="summary-item"><span>Port / Mode</span><strong>{portInfo}</strong></div>
            <div className="summary-item"><span>Terakhir diterima</span><strong className="small-value">{dateTime(lastSeen)}</strong></div>
          </div>

          <div style={{ height: 14 }} />
          <div className="serial-note">
            <Cloud size={25} color="var(--primary)" />
            <div>
              <strong>COM dikontrol dari TimbangQR Bridge Windows</strong>
              <div className="muted">Vercel menerima pembacaan indikator & sinyal koneksi dari TimbangQR Bridge.</div>
              <div className="help">Panel ini memantau hasil kiriman Bridge melalui API aplikasi. Jika status Bridge online, jalur indikator → Bridge → Vercel → PostgreSQL sudah terhubung.</div>
            </div>
          </div>

          <div className="serial-actions">
            <button className="btn btn-secondary" type="button" onClick={() => void refresh()} disabled={loading}>
              <RefreshCw size={16} /> Perbarui sekarang
            </button>
          </div>
          {error && <p className="error">{error}</p>}
        </div>
      </article>

      <article className="card">
        <div className="card-head">
          <div><h2>Pembacaan dari Vercel</h2><p>Nilai terbaru dari tabel device_readings.</p></div>
          <Usb size={21} />
        </div>
        <div className="card-body">
          <div className="weight-display compact-weight">
            <div>
              <strong>{weight == null ? "0" : new Intl.NumberFormat("id-ID").format(weight)}</strong>
              <span>
                {reading?.stable
                  ? "BERAT STABIL · KG"
                  : weight == null
                    ? (isFresh ? "BRIDGE ONLINE · MENUNGGU BEBAN (KG)" : "MENUNGGU DATA · KG")
                    : "BERAT BELUM STABIL · KG"}
              </span>
            </div>
          </div>
          <div className="field">
            <label>String mentah indikator</label>
            <div className="code serial-raw">{raw}</div>
          </div>
          <div className="help">Timestamp pembacaan: {dateTime(reading?.recorded_at || lastSeen)}</div>
        </div>
      </article>
    </div>
  );
}
