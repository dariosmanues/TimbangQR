"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Cable, CircleStop, PlugZap, RefreshCw, Save, Send, Usb } from "lucide-react";

type PortInfo = {
  path: string;
  manufacturer?: string;
  serialNumber?: string;
  vendorId?: string;
  productId?: string;
};

type SerialConfig = {
  path: string;
  interfaceType: "RS232" | "RS485";
  baudRate: number;
  dataBits: number;
  stopBits: number;
  parity: string;
  frameMode: "line" | "idle";
  delimiter: string;
  idleTimeoutMs: number;
  weightRegex: string;
  weightMultiplier: number;
  stableRegex: string;
  unstableRegex: string;
  stableSamples: number;
  stableToleranceKg: number;
  autoConnect: boolean;
};

type BridgeStatus = {
  bridge: {
    connected: boolean;
    connecting: boolean;
    lastConnectedAt: string | null;
    lastDisconnectedAt: string | null;
    lastError: string;
    queueLength: number;
  };
  config: SerialConfig;
  latest: null | {
    weight_kg?: number;
    stable?: boolean;
    indicator_raw?: string;
    raw?: string;
    receivedAt?: string;
    parseError?: string | null;
  };
};

const defaults: SerialConfig = {
  path: "",
  interfaceType: "RS232",
  baudRate: 9600,
  dataBits: 8,
  stopBits: 1,
  parity: "none",
  frameMode: "line",
  delimiter: "\\r\\n",
  idleTimeoutMs: 120,
  weightRegex: "[-+]?\\d+(?:[.,]\\d+)?",
  weightMultiplier: 1,
  stableRegex: "\\b(ST|STAB|STABLE)\\b",
  unstableRegex: "\\b(US|UNST|UNSTABLE)\\b",
  stableSamples: 3,
  stableToleranceKg: 1,
  autoConnect: false,
};

function dateTime(value?: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeStyle: "medium" }).format(date);
}

export default function SerialConnectionPanel() {
  const [status, setStatus] = useState<BridgeStatus | null>(null);
  const [config, setConfig] = useState<SerialConfig>(defaults);
  const [ports, setPorts] = useState<PortInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [testRaw, setTestRaw] = useState("ST,GS,+002860kg");
  const [testResult, setTestResult] = useState("");

  const refreshStatus = useCallback(async (silent = false) => {
    try {
      const response = await fetch("/api/serial/status", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Serial Bridge tidak tersedia.");
      setStatus(data);
      setConfig((current) => current.path ? current : data.config);
      if (!silent) setMessage("");
    } catch (error) {
      setStatus(null);
      if (!silent) setMessage(error instanceof Error ? error.message : "Gagal membaca status bridge.");
    }
  }, []);

  const refreshPorts = useCallback(async () => {
    setLoading(true);
    setMessage("");
    try {
      const response = await fetch("/api/serial/ports", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Gagal membaca daftar COM port.");
      setPorts(data.ports || []);
      setMessage((data.ports || []).length ? "Daftar port berhasil diperbarui." : "Belum ada port serial terdeteksi.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Gagal membaca port serial.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const initTimer = setTimeout(() => {
      void refreshStatus();
      void refreshPorts();
    }, 0);
    const timer = window.setInterval(() => void refreshStatus(true), 2000);
    return () => {
      clearTimeout(initTimer);
      window.clearInterval(timer);
    };
  }, [refreshPorts, refreshStatus]);

  async function saveConfig(connectAfter = false) {
    setLoading(true);
    setMessage("");
    try {
      const payload = { ...config, autoConnect: connectAfter ? true : config.autoConnect };
      const response = await fetch("/api/serial/config", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Konfigurasi gagal disimpan.");
      setStatus(data);
      setConfig(data.config);
      if (connectAfter && !data.bridge?.connected) {
        throw new Error(data.bridge?.lastError || "Konfigurasi tersimpan, tetapi port belum terhubung.");
      }
      setMessage(connectAfter ? "Konfigurasi tersimpan dan indikator terhubung." : "Konfigurasi serial tersimpan.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Konfigurasi gagal disimpan.");
    } finally {
      setLoading(false);
    }
  }

  async function control(action: "connect" | "disconnect") {
    setLoading(true);
    setMessage("");
    try {
      const response = await fetch("/api/serial/control", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.bridge?.lastError || data.error || "Aksi koneksi gagal.");
      setStatus(data);
      setConfig(data.config);
      setMessage(action === "connect" ? "Port serial terhubung." : "Port serial diputus.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Aksi koneksi gagal.");
    } finally {
      setLoading(false);
    }
  }

  async function testParser() {
    setLoading(true);
    setTestResult("");
    try {
      const saveResponse = await fetch("/api/serial/config", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(config),
      });
      const saved = await saveResponse.json();
      if (!saveResponse.ok) throw new Error(saved.error || "Konfigurasi parser tidak valid.");

      const response = await fetch("/api/serial/test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ raw: testRaw }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.result?.error || data.error || "Parser tidak menemukan berat.");
      const result = data.result;
      setTestResult(`Berat ${new Intl.NumberFormat("id-ID").format(result.weight_kg)} kg · ${result.stable ? "STABIL" : "BELUM STABIL"}`);
      await refreshStatus(true);
    } catch (error) {
      setTestResult(error instanceof Error ? error.message : "Pengujian parser gagal.");
    } finally {
      setLoading(false);
    }
  }

  const connectionLabel = useMemo(() => {
    if (!status) return "Bridge tidak aktif";
    if (status.bridge.connected) return `Terhubung · ${status.config.path}`;
    if (status.bridge.connecting) return "Sedang menghubungkan";
    return "Belum terhubung";
  }, [status]);

  const latestRaw = status?.latest?.indicator_raw || status?.latest?.raw || "-";
  const latestWeight = status?.latest?.weight_kg;

  return (
    <div className="grid equal">
      <article className="card">
        <div className="card-head">
          <div>
            <h2>Konfigurasi port serial</h2>
            <p>Adapter USB terisolasi akan tampil sebagai COM port pada Windows.</p>
          </div>
          <span className={`badge ${status?.bridge.connected ? "green" : "orange"}`}>
            <span className="dot" /> {connectionLabel}
          </span>
        </div>
        <div className="card-body">
          <div className="form-row">
            <div className="field">
              <label>COM port / device path</label>
              <input
                className="input"
                list="serial-port-list"
                value={config.path}
                placeholder="Contoh: COM3 atau /dev/ttyUSB0"
                onChange={(event) => setConfig({ ...config, path: event.target.value })}
              />
              <datalist id="serial-port-list">
                {ports.map((port) => <option key={port.path} value={port.path}>{port.manufacturer || port.path}</option>)}
              </datalist>
            </div>
            <div className="field">
              <label>Jenis antarmuka fisik</label>
              <select className="select" value={config.interfaceType} onChange={(event) => setConfig({ ...config, interfaceType: event.target.value as "RS232" | "RS485" })}>
                <option value="RS232">RS232</option>
                <option value="RS485">RS485</option>
              </select>
            </div>
            <div className="field">
              <label>Baud rate</label>
              <select className="select" value={config.baudRate} onChange={(event) => setConfig({ ...config, baudRate: Number(event.target.value) })}>
                {[1200, 2400, 4800, 9600, 19200, 38400, 57600, 115200].map((value) => <option key={value} value={value}>{value}</option>)}
              </select>
            </div>
            <div className="field">
              <label>Format data</label>
              <div className="serial-inline">
                <select className="select" value={config.dataBits} onChange={(event) => setConfig({ ...config, dataBits: Number(event.target.value) })}>
                  {[7, 8].map((value) => <option key={value} value={value}>{value} data bit</option>)}
                </select>
                <select className="select" value={config.parity} onChange={(event) => setConfig({ ...config, parity: event.target.value })}>
                  <option value="none">No parity</option><option value="even">Even</option><option value="odd">Odd</option>
                </select>
                <select className="select" value={config.stopBits} onChange={(event) => setConfig({ ...config, stopBits: Number(event.target.value) })}>
                  <option value="1">1 stop bit</option><option value="2">2 stop bit</option>
                </select>
              </div>
            </div>
          </div>

          <div className="serial-actions">
            <button className="btn btn-secondary" type="button" onClick={refreshPorts} disabled={loading}><RefreshCw size={16} /> Deteksi port</button>
            <button className="btn btn-secondary" type="button" onClick={() => saveConfig(false)} disabled={loading}><Save size={16} /> Simpan</button>
            {status?.bridge.connected ? (
              <button className="btn btn-danger" type="button" onClick={() => control("disconnect")} disabled={loading}><CircleStop size={16} /> Putuskan</button>
            ) : (
              <button className="btn btn-primary" type="button" onClick={() => saveConfig(true)} disabled={loading || !config.path}><PlugZap size={16} /> Simpan & hubungkan</button>
            )}
          </div>
          {message && <p className={message.includes("berhasil") || message.includes("terhubung") || message.includes("tersimpan") ? "success" : "error"}>{message}</p>}
          {status?.bridge.lastError && <p className="error">Kesalahan terakhir: {status.bridge.lastError}</p>}
        </div>
      </article>

      <article className="card">
        <div className="card-head">
          <div><h2>Pembacaan langsung</h2><p>Data mentah dan hasil parser dari indikator.</p></div>
          <Usb size={21} />
        </div>
        <div className="card-body">
          <div className="weight-display compact-weight">
            <div>
              <strong>{latestWeight == null ? "—" : new Intl.NumberFormat("id-ID").format(latestWeight)}</strong>
              <span>{status?.latest?.stable ? "BERAT STABIL · KG" : "MENUNGGU DATA STABIL · KG"}</span>
            </div>
          </div>
          <div className="serial-status-grid">
            <div className="summary-item"><span>Antarmuka</span><strong>{config.interfaceType}</strong></div>
            <div className="summary-item"><span>Buffer tertunda</span><strong>{status?.bridge.queueLength ?? 0}</strong></div>
            <div className="summary-item"><span>Terakhir terhubung</span><strong className="small-value">{dateTime(status?.bridge.lastConnectedAt)}</strong></div>
          </div>
          <div className="field">
            <label>String mentah indikator</label>
            <div className="code serial-raw">{latestRaw}</div>
          </div>
        </div>
      </article>

      <article className="card serial-wide">
        <div className="card-head">
          <div><h2>Parser indikator</h2><p>Sesuaikan dengan format keluaran merek/model indikator.</p></div>
          <Cable size={21} />
        </div>
        <div className="card-body">
          <div className="form-row">
            <div className="field">
              <label>Pemisah frame</label>
              <select className="select" value={config.frameMode} onChange={(event) => setConfig({ ...config, frameMode: event.target.value as "line" | "idle" })}>
                <option value="line">Delimiter/baris</option>
                <option value="idle">Jeda data (idle)</option>
              </select>
            </div>
            {config.frameMode === "line" ? (
              <div className="field"><label>Delimiter</label><input className="input" value={config.delimiter} onChange={(event) => setConfig({ ...config, delimiter: event.target.value })} /><span className="help">Contoh: \\r\\n, \\n, atau \\r</span></div>
            ) : (
              <div className="field"><label>Jeda frame (ms)</label><input className="input" type="number" min="30" value={config.idleTimeoutMs} onChange={(event) => setConfig({ ...config, idleTimeoutMs: Number(event.target.value) })} /></div>
            )}
            <div className="field"><label>Regex berat</label><input className="input" value={config.weightRegex} onChange={(event) => setConfig({ ...config, weightRegex: event.target.value })} /></div>
            <div className="field"><label>Pengali berat</label><input className="input" type="number" step="0.001" value={config.weightMultiplier} onChange={(event) => setConfig({ ...config, weightMultiplier: Number(event.target.value) })} /><span className="help">Gunakan 0.001 bila indikator mengirim gram dan aplikasi memakai kg.</span></div>
            <div className="field"><label>Regex status stabil</label><input className="input" value={config.stableRegex} onChange={(event) => setConfig({ ...config, stableRegex: event.target.value })} /></div>
            <div className="field"><label>Regex status tidak stabil</label><input className="input" value={config.unstableRegex} onChange={(event) => setConfig({ ...config, unstableRegex: event.target.value })} /></div>
            <div className="field"><label>Sampel stabil tanpa flag</label><input className="input" type="number" min="2" max="20" value={config.stableSamples} onChange={(event) => setConfig({ ...config, stableSamples: Number(event.target.value) })} /></div>
            <div className="field"><label>Toleransi stabil (kg)</label><input className="input" type="number" min="0" value={config.stableToleranceKg} onChange={(event) => setConfig({ ...config, stableToleranceKg: Number(event.target.value) })} /></div>
          </div>
          <div style={{ height: 16 }} />
          <div className="field"><label>Uji string mentah</label><textarea className="textarea" value={testRaw} onChange={(event) => setTestRaw(event.target.value)} /></div>
          <div className="serial-actions">
            <button className="btn btn-primary" type="button" onClick={testParser} disabled={loading || !testRaw}><Send size={16} /> Simpan parser & uji</button>
            {testResult && <strong className={testResult.startsWith("Berat") ? "success" : "error"}>{testResult}</strong>}
          </div>
        </div>
      </article>
    </div>
  );
}
