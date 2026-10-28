"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Cable, CheckCircle2, Cloud, RefreshCw, Save, Truck } from "lucide-react";
import QrScanner from "./QrScanner";
import LedWeightScanner, { type LedWeightReading } from "./LedWeightScanner";

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
  source?: "LPS" | "ARMADA";
  lpsVerified?: boolean;
  masterCreated?: boolean;
};

type SerialBridgeReading = {
  id: number;
  device_id: number;
  device_code: string;
  weight_kg: number;
  stable: boolean;
  indicator_raw: string | null;
  recorded_at: string;
};

type SerialBridgeDevice = {
  id: number;
  device_code: string;
  location_name: string;
  port_name: string | null;
  connection_type: string;
  baud_rate: number;
  last_seen_at: string | null;
  active: boolean;
};

function formatTimeId(value?: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("id-ID", {
    dateStyle: "short",
    timeStyle: "medium",
  }).format(date);
}

export default function WeighingWorkspace({ initialToken = "" }: { initialToken?: string }) {
  const [token, setToken] = useState(initialToken);
  const [payload, setPayload] = useState<VehiclePayload | null>(null);
  const [loadingVehicle, setLoadingVehicle] = useState(false);
  const [armadaChoices, setArmadaChoices] = useState<Array<{ no: number; plate: string; lps: string }>>([]);
  const [message, setMessage] = useState("");
  const [ocrReading, setOcrReading] = useState<LedWeightReading | null>(null);

  // TimbangQR Bridge (RS232/RS485) live state
  const [serialReading, setSerialReading] = useState<SerialBridgeReading | null>(null);
  const [serialDevice, setSerialDevice] = useState<SerialBridgeDevice | null>(null);
  const [bridgeLastSeen, setBridgeLastSeen] = useState<string | null>(null);
  const [bridgeOnline, setBridgeOnline] = useState(false);
  const [loadingBridge, setLoadingBridge] = useState(false);
  const [activeSource, setActiveSource] = useState<"SERIAL_BRIDGE" | "OCR_LED">("SERIAL_BRIDGE");
  const lastAppliedReadingIdRef = useRef<number | null>(null);

  const [lpsId, setLpsId] = useState("");
  const [driverName, setDriverName] = useState("");
  const [grossKg, setGrossKg] = useState("");
  const [tareKg, setTareKg] = useState("");
  const [rafaksiKg, setRafaksiKg] = useState("0");
  const [tareSource, setTareSource] = useState("DATABASE");
  const [scannedQrToken, setScannedQrToken] = useState("");
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<{ ticketNumber: string; netto2Kg: number } | null>(null);

  const refreshBridge = useCallback(async (silent = false) => {
    if (!silent) setLoadingBridge(true);
    try {
      const response = await fetch("/api/serial/latest", { cache: "no-store" });
      if (!response.ok) return;
      const data = await response.json();
      const nextReading = (data.reading || null) as SerialBridgeReading | null;
      const nextDevice = (data.device || null) as SerialBridgeDevice | null;
      const lastSeen = data.lastSeenAt || nextDevice?.last_seen_at || nextReading?.recorded_at || null;
      const isOnline = Boolean(
        data.bridgeOnline ||
          (lastSeen && !Number.isNaN(Date.parse(lastSeen)) && Date.now() - Date.parse(lastSeen) <= 15 * 60 * 1000)
      );

      setSerialReading(nextReading);
      setSerialDevice(nextDevice);
      setBridgeLastSeen(lastSeen);
      setBridgeOnline(isOnline);

      if (nextReading && nextReading.weight_kg > 0) {
        const isRecentReading =
          !nextReading.recorded_at ||
          Date.now() - Date.parse(nextReading.recorded_at) <= 10 * 60 * 1000;
        const isNewReading = lastAppliedReadingIdRef.current !== nextReading.id;

        if (isRecentReading && isNewReading) {
          lastAppliedReadingIdRef.current = nextReading.id;
          setGrossKg((prev) => {
            if (!prev || nextReading.stable || isNewReading) {
              setActiveSource("SERIAL_BRIDGE");
              return String(nextReading.weight_kg);
            }
            return prev;
          });
        }
      }
    } catch {
      // Ignore transient polling error
    } finally {
      if (!silent) setLoadingBridge(false);
    }
  }, []);

  useEffect(() => {
    const initial = window.setTimeout(() => void refreshBridge(false), 0);
    const interval = window.setInterval(() => void refreshBridge(true), 1500);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(interval);
    };
  }, [refreshBridge]);

  const loadVehicle = useCallback(async (nextToken: string, selectedMasterNo?: number) => {
    if (!nextToken) return;
    setLoadingVehicle(true);
    setArmadaChoices([]);
    setToken(nextToken);
    setMessage("");
    setResult(null);
    try {
      const url = `/api/qr/${encodeURIComponent(nextToken)}${selectedMasterNo ? `?masterNo=${selectedMasterNo}` : ""}`;
      const response = await fetch(url, { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "QR tidak valid");
      if (data.requiresSelection && Array.isArray(data.choices)) {
        setPayload(null);
        setArmadaChoices(data.choices);
        setMessage("QR dikenali. Nomor polisi tercatat untuk lebih dari satu LPS; pilih LPS yang sedang mengirim sampah.");
        return;
      }
      const parsed = data as VehiclePayload;
      setToken(nextToken);
      setScannedQrToken(data.qrToken || nextToken);
      setPayload(parsed);
      const primary = parsed.assignments[0];
      setLpsId(primary ? String(primary.lps_id) : "");
      setDriverName(primary?.driver_name || "");
      setTareKg(String(primary?.tare_kg ?? parsed.vehicle.default_tare_kg ?? ""));
      setMessage(parsed.source === "LPS"
        ? (parsed.masterCreated
          ? "QR LPS berhasil diverifikasi. Master armada baru terdaftar; pastikan jenis armada dan isi tare sebelum menyimpan."
          : "QR LPS berhasil diverifikasi. Armada, LPS dan pengemudi tersambung.")
        : parsed.source === "ARMADA"
          ? "QR Armada Harapan Jaya dikenali. Nomor polisi dan LPS terhubung; lengkapi pengemudi serta tare jika belum tersedia."
          : "✓ Data armada ditemukan & valid.");
    } catch (error) {
      setPayload(null);
      setScannedQrToken("");
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

  const handleOcrReading = useCallback((reading: LedWeightReading | null) => {
    setOcrReading(reading);
    if (reading && reading.weightKg > 0) {
      if (reading.stable || !grossKg) {
        setActiveSource("OCR_LED");
        setGrossKg(String(reading.weightKg));
      }
    }
  }, [grossKg]);

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

  async function performSave(overrideGross?: number, overrideSource?: "SERIAL_BRIDGE" | "OCR_LED") {
    if (!payload) {
      setMessage("Silakan pindai QR armada terlebih dahulu.");
      return;
    }
    const currentGross = overrideGross ?? Number(grossKg);
    const currentTare = Number(tareKg || 0);
    const currentRafaksi = Number(rafaksiKg || 0);
    const netto1 = currentGross - currentTare;
    const netto2 = netto1 - currentRafaksi;

    if (!currentGross || currentGross <= 0) {
      setMessage("Nilai gross timbangan belum tersedia.");
      return;
    }
    if (!lpsId) {
      setMessage("Silakan pilih LPS / Pengirim terlebih dahulu.");
      return;
    }
    if (currentGross <= currentTare) {
      setMessage("Gross harus lebih besar daripada tare.");
      return;
    }
    if (netto2 <= 0) {
      setMessage("Netto 2 harus lebih besar daripada nol.");
      return;
    }

    setSaving(true);
    setMessage("");
    setResult(null);

    const usedSource = overrideSource || (
      activeSource === "OCR_LED" && ocrReading?.weightKg === currentGross
        ? "OCR_LED"
        : "SERIAL_BRIDGE"
    );
    const indicatorRawValue = usedSource === "OCR_LED"
      ? (ocrReading?.raw || `OCR_LED:CONFIRMED:${currentGross}`)
      : (serialReading?.indicator_raw || `SERIAL_BRIDGE:${currentGross}`);

    try {
      const response = await fetch("/api/weighings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          vehicleId: payload.vehicle.id,
          lpsId: Number(lpsId),
          driverName,
          grossKg: currentGross,
          tareKg: currentTare,
          rafaksiKg: currentRafaksi,
          tareSource,
          measurementSource: usedSource,
          deviceId: serialDevice?.id || serialReading?.device_id || null,
          ocrStable: usedSource === "OCR_LED" ? Boolean(ocrReading?.stable ?? true) : Boolean(serialReading?.stable ?? true),
          indicatorRaw: indicatorRawValue,
          qrToken: scannedQrToken || token,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Transaksi gagal disimpan");
      }
      const tokenUsed = scannedQrToken || token;
      const isMaster = /^ARMADA-/i.test(tokenUsed) || !tokenUsed.toUpperCase().startsWith("LPS-");
      setResult({ ticketNumber: data.ticketNumber, netto2Kg: data.netto2Kg });
      setMessage(
        isMaster
          ? `✓ Transaksi berhasil disimpan (Tiket #${data.ticketNumber}). QR Code LPS armada ${payload.vehicle.plate_number} telah dihanguskan pada dashboard LPS.`
          : `✓ Transaksi berhasil disimpan (Tiket #${data.ticketNumber}). QR Code LPS sekali pakai telah hangus.`
      );
      setScannedQrToken("");
      setToken("");
      setPayload(null);
      setGrossKg("");
      setRafaksiKg("0");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Transaksi gagal disimpan");
    } finally {
      setSaving(false);
    }
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    await performSave();
  }

  const displayedGross = Number(grossKg) || serialReading?.weight_kg || ocrReading?.weightKg || 0;
  const deviceCode = serialDevice?.device_code || serialReading?.device_code || "TIMBANG-HJ-SERIAL-01";
  const portLabel = serialDevice?.port_name
    ? `${serialDevice.port_name} · ${serialDevice.connection_type || "RS232"}`
    : `RS232 / RS485`;

  return (
    <div className="scan-layout">
      {/* PANEL STATUS TIMBANGQR BRIDGE (RS232/RS485) */}
      <div className="card weighing-data-card">
        <div className="card-head">
          <div>
            <h2>Koneksi TimbangQR Bridge (Indikator RS232 / RS485)</h2>
            <p>Terhubung otomatis dengan aplikasi TimbangQR Bridge di PC Operator untuk menerima berat indikator secara langsung.</p>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span className={`badge ${bridgeOnline ? "green" : "orange"}`}>
              <span className="dot" />
              {bridgeOnline ? "TimbangQR Bridge Online" : "Menunggu Sinyal Bridge"}
            </span>
            <button
              type="button"
              className="btn btn-secondary"
              style={{ padding: "6px 12px", minHeight: 34, fontSize: 12 }}
              onClick={() => void refreshBridge(false)}
              disabled={loadingBridge}
            >
              <RefreshCw size={14} /> {loadingBridge ? "Memuat..." : "Segarkan Bridge"}
            </button>
          </div>
        </div>
        <div className="card-body">
          <div className="summary-box">
            <div className="summary-item">
              <span>Perangkat & Port</span>
              <strong style={{ fontSize: 15 }}>
                <Cable size={14} style={{ verticalAlign: "middle", marginRight: 5 }} />
                {deviceCode} ({portLabel})
              </strong>
            </div>
            <div className="summary-item">
              <span>Berat dari Bridge</span>
              <strong style={{ color: bridgeOnline ? "var(--primary)" : undefined }}>
                {serialReading?.weight_kg != null
                  ? `${new Intl.NumberFormat("id-ID").format(serialReading.weight_kg)} kg`
                  : "0 kg"}{" "}
                <small style={{ fontSize: 11, fontWeight: 700, opacity: 0.8 }}>
                  ({serialReading?.stable ? "STABIL" : bridgeOnline ? "SIAP / AKTIF" : "BELUM ADA DATA"})
                </small>
              </strong>
            </div>
            <div className="summary-item">
              <span>Sinyal Terakhir Diterima</span>
              <strong style={{ fontSize: 14 }}>
                <Cloud size={14} style={{ verticalAlign: "middle", marginRight: 5 }} />
                {formatTimeId(bridgeLastSeen)}
              </strong>
            </div>
          </div>

          {serialReading && serialReading.weight_kg > 0 && (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginTop: 12, flexWrap: "wrap" }}>
              <span className="help">
                String indikator terakhir: <code>{serialReading.indicator_raw || "-"}</code>
              </span>
              <button
                type="button"
                className="btn btn-primary"
                style={{ padding: "7px 14px", minHeight: 34, fontSize: 12 }}
                onClick={() => {
                  setActiveSource("SERIAL_BRIDGE");
                  setGrossKg(String(serialReading.weight_kg));
                  setMessage(`✓ Berat ${serialReading.weight_kg} kg diambil dari TimbangQR Bridge.`);
                }}
              >
                Gunakan Berat Bridge ({new Intl.NumberFormat("id-ID").format(serialReading.weight_kg)} kg)
              </button>
            </div>
          )}
        </div>
      </div>

      <QrScanner onToken={loadVehicle} />

      <LedWeightScanner
        onReading={handleOcrReading}
        onLockWeight={(weightKg) => {
          setActiveSource("OCR_LED");
          setGrossKg(String(weightKg));
          setMessage(`✓ Angka gross ${weightKg} KG dikunci dari OCR.`);
        }}
        onSaveWeight={
          payload && lpsId
            ? (weightKg) => {
                setActiveSource("OCR_LED");
                setGrossKg(String(weightKg));
                void performSave(weightKg, "OCR_LED");
              }
            : undefined
        }
        isVehicleReady={Boolean(payload && lpsId)}
      />

      <div className="card weighing-data-card">
        <div className="card-head">
          <div>
            <h2>3. Data dan berat armada</h2>
            <p>Nilai Gross otomatis terisi dari TimbangQR Bridge (RS232/RS485) atau pembacaan Kamera OCR LED timbangan.</p>
          </div>
          {payload && <span className="badge green"><CheckCircle2 size={13} /> QR valid</span>}
        </div>
        <div className="card-body">
          <div className="weight-display">
            <div>
              <strong>{new Intl.NumberFormat("id-ID").format(displayedGross)}</strong>
              <span>
                {displayedGross > 0
                  ? activeSource === "SERIAL_BRIDGE" && serialReading?.weight_kg === displayedGross
                    ? (serialReading.stable ? "TIMBANGQR BRIDGE STABIL · KG" : "TIMBANGQR BRIDGE · KG")
                    : (ocrReading?.stable ? "OCR LED STABIL · KG" : "GROSS TERKONFIRMASI · KG")
                  : bridgeOnline
                    ? "TIMBANGQR BRIDGE TERHUBUNG (0 KG) · MENUNGGU BEBAN TIMBANGAN"
                    : "MENUNGGU BEBAN DARI TIMBANGQR BRIDGE / OCR LED · KG"}
              </span>
            </div>
          </div>

          <div style={{ height: 16 }} />

          {!payload ? (
            <div className="empty">
              <Truck size={38} style={{ opacity: .35 }} />
              {message && (message.includes("hangus") || message.includes("gagal") || message.includes("tidak") || message.includes("Error")) ? (
                <div style={{
                  background: "rgba(239, 68, 68, 0.12)",
                  border: "1px solid rgba(239, 68, 68, 0.4)",
                  color: "#ef4444",
                  padding: "12px 16px",
                  borderRadius: 8,
                  marginTop: 12,
                  maxWidth: 500,
                  fontSize: 14,
                  lineHeight: 1.5,
                  fontWeight: 500,
                  textAlign: "center"
                }}>
                  ⚠️ {message}
                </div>
              ) : (
                <p>{loadingVehicle ? "Memuat data armada..." : message || "Pindai QR untuk membuka data armada."}</p>
              )}
              {armadaChoices.length > 0 && (
                <div style={{ display: "grid", gap: 8, marginTop: 16, width: "100%", maxWidth: 480 }}>
                  {armadaChoices.map(choice => (
                    <button key={choice.no} className="btn btn-secondary" type="button"
                      onClick={() => void loadVehicle(token, choice.no)}>
                      {choice.plate} — {choice.lps} (Izin #{choice.no})
                    </button>
                  ))}
                </div>
              )}
              {!loadingVehicle && token && (
                <p style={{ marginTop: 8, fontSize: 12, overflowWrap: "anywhere", opacity: .75 }}>
                  Kode yang dikirim untuk validasi: <code>{token}</code>
                </p>
              )}
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
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                    <label>Gross (kg)</label>
                    <div style={{ display: "flex", gap: 6 }}>
                      {serialReading && serialReading.weight_kg > 0 && String(serialReading.weight_kg) !== grossKg && (
                        <button
                          type="button"
                          className="btn btn-sm btn-secondary"
                          onClick={() => {
                            setActiveSource("SERIAL_BRIDGE");
                            setGrossKg(String(serialReading.weight_kg));
                          }}
                          style={{ fontSize: 11, padding: "2px 8px", minHeight: 24 }}
                        >
                          Pakai Bridge: {serialReading.weight_kg} kg
                        </button>
                      )}
                      {ocrReading && ocrReading.weightKg > 0 && String(ocrReading.weightKg) !== grossKg && (
                        <button
                          type="button"
                          className="btn btn-sm btn-secondary"
                          onClick={() => {
                            setActiveSource("OCR_LED");
                            setGrossKg(String(ocrReading.weightKg));
                          }}
                          style={{ fontSize: 11, padding: "2px 8px", minHeight: 24 }}
                        >
                          Pakai OCR: {ocrReading.weightKg} kg
                        </button>
                      )}
                    </div>
                  </div>
                  <input
                    className="input"
                    type="number"
                    min="1"
                    value={grossKg}
                    onChange={(e) => setGrossKg(e.target.value)}
                    required
                  />
                  <span className="help">Diisi otomatis dari TimbangQR Bridge atau OCR LED (dapat disesuaikan).</span>
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

              {message && <p className={message.includes("berhasil") || message.startsWith("✓") ? "success" : "error"}>{message}</p>}
              {result && (
                <div className="badge green" style={{ padding: 12, borderRadius: 12 }}>
                  Tiket {result.ticketNumber} tersimpan · Netto 2 {new Intl.NumberFormat("id-ID").format(result.netto2Kg)} kg
                </div>
              )}

              <div className="sticky-actions">
                <button className="btn btn-secondary" type="button" onClick={() => loadVehicle(token)}>
                  <RefreshCw size={17} /> Muat ulang
                </button>
                <button
                  className="btn btn-primary"
                  disabled={saving || !payload || !lpsId || Number(grossKg || 0) <= 0 || calculated.netto2 <= 0}
                  type="submit"
                >
                  <Save size={17} /> {saving ? "Menyimpan..." : "Simpan transaksi"}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
