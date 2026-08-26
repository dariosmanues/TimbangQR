"use client";

import { useCallback, useEffect, useState } from "react";
import { Cloud, RefreshCw, Usb } from "lucide-react";
import { formatDateTime } from "@/lib/utils";

type RemoteReading = {
  id?: number | string;
  device_id?: number | string;
  device_code?: string;
  weight_kg?: number;
  stable?: boolean;
  indicator_raw?: string | null;
  recorded_at?: string | null;
  received_at?: string | null;
  age_seconds?: number;
};

type LatestPayload = {
  reading?: RemoteReading | null;
  fresh?: boolean;
  staleAfterSeconds?: number;
};

export default function RemoteSerialStatusPanel() {
  const [reading, setReading] = useState<RemoteReading | null>(null);
  const [fresh, setFresh] = useState(false);
  const [staleAfterSeconds, setStaleAfterSeconds] = useState(90);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const response = await fetch("/api/serial/latest", { cache: "no-store" });
      const data = await response.json() as LatestPayload & { error?: string };
      if (!response.ok) throw new Error(data.error || "Gagal membaca data timbangan dari Vercel.");
      setReading(data.reading || null);
      setFresh(Boolean(data.fresh));
      if (Number.isFinite(Number(data.staleAfterSeconds))) {
        setStaleAfterSeconds(Number(data.staleAfterSeconds));
      }
      setError("");
    } catch (err) {
      setFresh(false);
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

  const weight = reading?.weight_kg;
  const raw = reading?.indicator_raw || "-";
  const deviceCode = reading?.device_code || "TIMBANG-HJ-SERIAL-01";
  const receivedAt = reading?.received_at || null;
  const ageSeconds = Number(reading?.age_seconds ?? 0);
  const stableNow = fresh && Boolean(reading?.stable);

  return (
    <div className="grid equal">
      <article className="card">
        <div className="card-head">
          <div>
            <h2>Status Bridge cloud</h2>
            <p>Status berdasarkan waktu data benar-benar diterima Vercel/PostgreSQL, bukan jam komputer operator.</p>
          </div>
          <span className={`badge ${fresh ? "green" : "orange"}`}>
            <span className="dot" /> {fresh ? "Bridge online" : reading ? "Bridge offline / data lama" : "Belum ada data"}
          </span>
        </div>
        <div className="card-body">
          <div className="serial-status-grid">
            <div className="summary-item"><span>Perangkat</span><strong className="small-value">{deviceCode}</strong></div>
            <div className="summary-item"><span>Mode</span><strong>REMOTE / HTTPS</strong></div>
            <div className="summary-item"><span>Terakhir diterima server</span><strong className="small-value">{formatDateTime(receivedAt)}</strong></div>
          </div>

          <div style={{ height: 14 }} />
          <div className="serial-note">
            <Cloud size={25} color="var(--primary)" />
            <div>
              <strong>COM tetap dikontrol dari TimbangQR Bridge Windows</strong>
              <div className="muted">Tidak ada perubahan pada COM port, baud rate, API key, device ID, atau konfigurasi Bridge operator.</div>
              <div className="help">
                Data dianggap online selama diterima server dalam {staleAfterSeconds} detik terakhir.
                {reading && !fresh ? ` Data terakhir sudah berumur sekitar ${Math.max(0, ageSeconds)} detik.` : ""}
              </div>
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
          <div><h2>Pembacaan dari Vercel</h2><p>Nilai terakhir yang sudah masuk ke tabel device_readings.</p></div>
          <Usb size={21} />
        </div>
        <div className="card-body">
          <div className="weight-display compact-weight">
            <div>
              <strong>{weight == null ? "—" : new Intl.NumberFormat("id-ID").format(weight)}</strong>
              <span>
                {stableNow
                  ? "BERAT STABIL · LIVE · KG"
                  : fresh
                    ? "BERAT BELUM STABIL · LIVE · KG"
                    : weight == null
                      ? "MENUNGGU DATA · KG"
                      : "DATA TERAKHIR · OFFLINE · KG"}
              </span>
            </div>
          </div>
          <div className="field">
            <label>String mentah indikator</label>
            <div className="code serial-raw">{raw}</div>
          </div>
          <div className="help">Diterima server: {formatDateTime(receivedAt)}</div>
        </div>
      </article>
    </div>
  );
}
