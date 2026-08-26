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
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const response = await fetch("/api/serial/latest", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Gagal membaca data timbangan dari Vercel.");
      setReading(data.reading || null);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal membaca data timbangan dari Vercel.");
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const initial = window.setTimeout(() => void refresh(), 0);
    const timer = window.setInterval(() => void refresh(true), 2000);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(timer);
    };
  }, [refresh]);

  const lastSeen = reading?.recorded_at || null;
  const isFresh = useMemo(() => {
    if (!lastSeen) return false;
    const timestamp = Date.parse(lastSeen);
    if (Number.isNaN(timestamp)) return false;
    return Date.now() - timestamp <= 90_000;
  }, [lastSeen]);

  const weight = reading?.weight_kg;
  const raw = reading?.indicator_raw || "-";
  const deviceCode = reading?.device_code || "TIMBANG-HJ-SERIAL-01";

  return (
    <div className="grid equal">
      <article className="card">
        <div className="card-head">
          <div>
            <h2>Status Bridge cloud</h2>
            <p>Status berdasarkan data terbaru yang benar-benar sudah diterima Vercel dan tersimpan di PostgreSQL.</p>
          </div>
          <span className={`badge ${isFresh ? "green" : "orange"}`}>
            <span className="dot" /> {isFresh ? "Bridge online" : reading ? "Data tidak terbaru" : "Belum ada data"}
          </span>
        </div>
        <div className="card-body">
          <div className="serial-status-grid">
            <div className="summary-item"><span>Perangkat</span><strong className="small-value">{deviceCode}</strong></div>
            <div className="summary-item"><span>Mode</span><strong>REMOTE / HTTPS</strong></div>
            <div className="summary-item"><span>Terakhir diterima</span><strong className="small-value">{dateTime(lastSeen)}</strong></div>
          </div>

          <div style={{ height: 14 }} />
          <div className="serial-note">
            <Cloud size={25} color="var(--primary)" />
            <div>
              <strong>COM dikontrol dari TimbangQR Bridge Windows</strong>
              <div className="muted">Vercel tidak mencoba mengakses COM port atau 127.0.0.1 komputer operator.</div>
              <div className="help">Panel ini memantau hasil kiriman Bridge melalui API aplikasi. Jika angka berubah di sini, jalur indikator → Bridge → Vercel → PostgreSQL sudah bekerja.</div>
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
              <strong>{weight == null ? "—" : new Intl.NumberFormat("id-ID").format(weight)}</strong>
              <span>{reading?.stable ? "BERAT STABIL · KG" : weight == null ? "MENUNGGU DATA · KG" : "BERAT BELUM STABIL · KG"}</span>
            </div>
          </div>
          <div className="field">
            <label>String mentah indikator</label>
            <div className="code serial-raw">{raw}</div>
          </div>
          <div className="help">Timestamp pembacaan: {dateTime(lastSeen)}</div>
        </div>
      </article>
    </div>
  );
}
