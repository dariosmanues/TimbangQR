"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, RefreshCw, Save, Truck } from "lucide-react";
import QrScanner from "./QrScanner";

type Assignment = {
  id: number;
  lps_id: number;
  lps_name: string;
  driver_name: string | null;
  tare_kg: number | null;
  is_primary: number;
};

type Vehicle = {
  id: number;
  code: string;
  plate_number: string;
  vehicle_type: string;
  waste_type: string;
  default_tare_kg: number | null;
  qr_token: string;
};

type VehiclePayload = {
  vehicle: Vehicle;
  assignments: Assignment[];
  lpsOptions: Array<{ id: number; name: string }>;
};

type GrossSource = "serial" | "manual" | null;

type SerialReading = {
  id?: number | string;
  device_id?: number | string;
  weight_kg?: number;
  stable?: boolean;
  indicator_raw?: string | null;
  received_at?: string | null;
  age_seconds?: number;
};

type SerialLatestPayload = {
  reading?: SerialReading | null;
  fresh?: boolean;
  staleAfterSeconds?: number;
};

export default function WeighingWorkspace({
  initialToken = "",
  previewReadOnly = false,
}: {
  initialToken?: string;
  previewReadOnly?: boolean;
}) {
  const [token, setToken] = useState(initialToken);
  const [payload, setPayload] = useState<VehiclePayload | null>(null);
  const [loadingVehicle, setLoadingVehicle] = useState(false);
  const [message, setMessage] = useState("");
  const [latestWeight, setLatestWeight] = useState(0);
  const [stable, setStable] = useState(false);
  const [serialFresh, setSerialFresh] = useState(false);
  const [serialAgeSeconds, setSerialAgeSeconds] = useState<number | null>(null);
  const [staleAfterSeconds, setStaleAfterSeconds] = useState(90);
  const [deviceId, setDeviceId] = useState<number | null>(null);
  const [indicatorRaw, setIndicatorRaw] = useState("");
  const [lpsId, setLpsId] = useState("");
  const [driverName, setDriverName] = useState("");
  const [grossKg, setGrossKg] = useState("");
  const [grossSource, setGrossSource] = useState<GrossSource>(null);
  const grossSourceRef = useRef<GrossSource>(null);
  const [tareKg, setTareKg] = useState("");
  const [rafaksiKg, setRafaksiKg] = useState("0");
  const [tareSource, setTareSource] = useState("DATABASE");
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<{ ticketNumber: string; netto2Kg: number } | null>(null);

  const setGrossOrigin = useCallback((source: GrossSource) => {
    grossSourceRef.current = source;
    setGrossSource(source);
  }, []);

  const clearSerialGross = useCallback(() => {
    if (grossSourceRef.current === "serial") {
      setGrossKg("");
      setGrossOrigin(null);
    }
    setDeviceId(null);
    setIndicatorRaw("");
  }, [setGrossOrigin]);

  const loadVehicle = useCallback(async (nextToken: string) => {
    if (!nextToken) return;
    setLoadingVehicle(true);
    setMessage("");
    setResult(null);
    try {
      const response = await fetch(`/api/qr/${encodeURIComponent(nextToken)}`, { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "QR tidak valid");
      const parsed = data as VehiclePayload;
      setToken(nextToken);
      setPayload(parsed);
      const primary = parsed.assignments[0];
      setLpsId(primary ? String(primary.lps_id) : "");
      setDriverName(primary?.driver_name || "");
      setTareKg(String(primary?.tare_kg ?? parsed.vehicle.default_tare_kg ?? ""));
      setMessage("Data armada ditemukan.");
    } catch (error) {
      setPayload(null);
      setMessage(error instanceof Error ? error.message : "Gagal membaca QR");
    } finally {
      setLoadingVehicle(false);
    }
  }, []);

  useEffect(() => {
    if (initialToken) {
      const timer = setTimeout(() => void loadVehicle(initialToken), 0);
      return () => clearTimeout(timer);
    }
  }, [initialToken, loadVehicle]);

  useEffect(() => {
    let cancelled = false;

    async function poll() {
      try {
        const response = await fetch("/api/serial/latest", { cache: "no-store" });
        if (!response.ok) {
          if (!cancelled) {
            setSerialFresh(false);
            setStable(false);
            clearSerialGross();
          }
          return;
        }

        const data = await response.json() as SerialLatestPayload;
        if (cancelled) return;

        if (Number.isFinite(Number(data.staleAfterSeconds))) {
          setStaleAfterSeconds(Number(data.staleAfterSeconds));
        }

        const reading = data.reading;
        if (!reading) {
          setSerialFresh(false);
          setSerialAgeSeconds(null);
          setStable(false);
          clearSerialGross();
          return;
        }

        const w = Number(reading.weight_kg || 0);
        const isFresh = Boolean(data.fresh);
        const isStable = isFresh && Boolean(reading.stable);
        const ageSeconds = Number(reading.age_seconds);

        setLatestWeight(w);
        setSerialFresh(isFresh);
        setSerialAgeSeconds(Number.isFinite(ageSeconds) ? ageSeconds : null);
        setStable(isStable);

        if (isFresh && isStable && w > 0) {
          if (grossSourceRef.current !== "manual") {
            setGrossKg(String(w));
            setGrossOrigin("serial");
            setDeviceId(Number(reading.device_id));
            setIndicatorRaw(reading.indicator_raw || "");
          }
        } else {
          clearSerialGross();
        }
      } catch {
        if (!cancelled) {
          setSerialFresh(false);
          setStable(false);
          clearSerialGross();
        }
      }
    }

    void poll();
    const interval = window.setInterval(() => void poll(), 1500);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [clearSerialGross, setGrossOrigin]);

  const calculated = useMemo(() => {
    const gross = Number(grossKg || 0);
    const tare = Number(tareKg || 0);
    const rafaksi = Number(rafaksiKg || 0);
    return {
      netto1: Math.max(gross - tare, 0),
      netto2: Math.max(gross - tare - rafaksi, 0),
    };
  }, [grossKg, tareKg, rafaksiKg]);

  function chooseAssignment(value: string) {
    setLpsId(value);
    const assignment = payload?.assignments.find((item) => String(item.lps_id) === value);
    if (assignment) {
      setDriverName(assignment.driver_name || "");
      if (tareSource === "DATABASE") {
        setTareKg(String(assignment.tare_kg ?? payload?.vehicle.default_tare_kg ?? ""));
      }
    } else {
      setDriverName("");
      if (tareSource === "DATABASE") {
        setTareKg(String(payload?.vehicle.default_tare_kg ?? ""));
      }
    }
  }

  function changeGross(value: string) {
    setGrossKg(value);
    setGrossOrigin(value ? "manual" : null);
    setDeviceId(null);
    setIndicatorRaw("");
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!payload) return;
    if (previewReadOnly) {
      setMessage("Vercel Preview bersifat read-only. Penyimpanan transaksi sengaja dinonaktifkan untuk melindungi database operasional.");
      return;
    }

    setSaving(true);
    setMessage("");
    setResult(null);

    try {
      const response = await fetch("/api/weighings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          vehicleId: payload.vehicle.id,
          lpsId: Number(lpsId),
          driverName,
          grossKg: Number(grossKg),
          tareKg: Number(tareKg),
          rafaksiKg: Number(rafaksiKg),
          tareSource,
          deviceId: grossSource === "serial" ? deviceId : null,
          indicatorRaw: grossSource === "serial" ? indicatorRaw : "",
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Transaksi gagal disimpan");
      setResult({ ticketNumber: data.ticketNumber, netto2Kg: data.netto2Kg });
      setMessage("Transaksi berhasil disimpan.");
      setGrossKg("");
      setGrossOrigin(null);
      setDeviceId(null);
      setIndicatorRaw("");
      setRafaksiKg("0");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Transaksi gagal disimpan");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="scan-layout">
      <QrScanner onToken={loadVehicle} />

      <div className="card">
        <div className="card-head">
          <div>
            <h2>2. Data dan berat armada</h2>
            <p>Gross otomatis hanya memakai pembacaan indikator yang stabil dan masih fresh di server.</p>
          </div>
          {payload && <span className="badge green"><CheckCircle2 size={13} /> QR valid</span>}
        </div>
        <div className="card-body">
          {previewReadOnly && (
            <p className="error">
              Preview read-only aktif: data boleh dibaca untuk pengujian, tetapi transaksi tidak dapat disimpan.
            </p>
          )}

          <div className="weight-display">
            <div>
              <strong>{new Intl.NumberFormat("id-ID").format(latestWeight)}</strong>
              <span>
                {stable
                  ? "BERAT STABIL · LIVE · KG"
                  : serialFresh
                    ? "BERAT BELUM STABIL · LIVE · KG"
                    : latestWeight > 0
                      ? "DATA SERIAL TERAKHIR · OFFLINE · KG"
                      : "MENUNGGU DATA TIMBANGAN · KG"}
              </span>
            </div>
          </div>
          {!serialFresh && latestWeight > 0 && (
            <p className="error">
              Data serial tidak fresh{serialAgeSeconds == null ? "" : ` (${serialAgeSeconds} detik)`}. Batas online {staleAfterSeconds} detik; gross otomatis tidak digunakan.
            </p>
          )}

          <div style={{ height: 16 }} />

          {!payload ? (
            <div className="empty">
              <Truck size={38} style={{ opacity: .35 }} />
              <p>{loadingVehicle ? "Memuat data armada..." : message || "Pindai QR untuk membuka data armada."}</p>
            </div>
          ) : (
            <form onSubmit={save}>
              <div className="summary-box">
                <div className="summary-item"><span>No. polisi</span><strong className="plate">{payload.vehicle.plate_number}</strong></div>
                <div className="summary-item"><span>Kode armada</span><strong>{payload.vehicle.code}</strong></div>
                <div className="summary-item"><span>Jenis</span><strong>{payload.vehicle.vehicle_type}</strong></div>
              </div>

              <div style={{ height: 16 }} />

              <div className="form-row">
                <div className="field">
                  <label>LPS / Pengirim</label>
                  <select className="select" value={lpsId} onChange={(e) => chooseAssignment(e.target.value)} required>
                    <option value="">Pilih LPS</option>
                    {payload.lpsOptions.map((item) => (
                      <option key={item.id} value={item.id}>{item.name}</option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label>Nama pengemudi</label>
                  <input className="input" value={driverName} onChange={(e) => setDriverName(e.target.value)} />
                </div>
                <div className="field">
                  <label>Gross (kg)</label>
                  <input className="input" type="number" min="1" value={grossKg} onChange={(e) => changeGross(e.target.value)} required />
                  <span className="help">
                    {grossSource === "serial"
                      ? "Otomatis dari pembacaan serial stabil yang masih fresh."
                      : grossSource === "manual"
                        ? "Mode manual. Kosongkan field untuk kembali menerima gross otomatis."
                        : "Menunggu pembacaan serial stabil atau isi manual saat diperlukan."}
                  </span>
                </div>
                <div className="field">
                  <label>Sumber tare</label>
                  <select className="select" value={tareSource} onChange={(e) => setTareSource(e.target.value)}>
                    <option value="DATABASE">Tare database armada</option>
                    <option value="ACTUAL_WEIGHING">Timbang kosong aktual</option>
                    <option value="MANUAL">Input manual</option>
                  </select>
                </div>
                <div className="field">
                  <label>Tare (kg)</label>
                  <input className="input" type="number" min="0" value={tareKg} onChange={(e) => setTareKg(e.target.value)} required />
                </div>
                <div className="field">
                  <label>Rafaksi (kg)</label>
                  <input className="input" type="number" min="0" value={rafaksiKg} onChange={(e) => setRafaksiKg(e.target.value)} />
                </div>
              </div>

              <div style={{ height: 16 }} />
              <div className="summary-box">
                <div className="summary-item"><span>Netto 1</span><strong>{new Intl.NumberFormat("id-ID").format(calculated.netto1)} kg</strong></div>
                <div className="summary-item"><span>Rafaksi</span><strong>{new Intl.NumberFormat("id-ID").format(Number(rafaksiKg || 0))} kg</strong></div>
                <div className="summary-item"><span>Netto 2</span><strong>{new Intl.NumberFormat("id-ID").format(calculated.netto2)} kg</strong></div>
              </div>

              {message && <p className={message.includes("berhasil") ? "success" : "error"}>{message}</p>}
              {result && (
                <div className="badge green" style={{ padding: 12, borderRadius: 12 }}>
                  Tiket {result.ticketNumber} tersimpan · Netto 2 {new Intl.NumberFormat("id-ID").format(result.netto2Kg)} kg
                </div>
              )}

              <div className="sticky-actions">
                <button className="btn btn-secondary" type="button" onClick={() => loadVehicle(token)}>
                  <RefreshCw size={17} /> Muat ulang
                </button>
                <button className="btn btn-primary" disabled={previewReadOnly || saving || !lpsId || calculated.netto2 <= 0} type="submit">
                  <Save size={17} /> {previewReadOnly ? "Preview read-only" : saving ? "Menyimpan..." : "Simpan transaksi"}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
