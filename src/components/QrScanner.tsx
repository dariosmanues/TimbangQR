"use client";

import { useEffect, useRef, useState } from "react";
import { Camera, Keyboard, ScanLine } from "lucide-react";

function tokenFromValue(value: string) {
  const trimmed = value.trim();
  try {
    const url = new URL(trimmed);
    return url.searchParams.get("token") || trimmed;
  } catch {
    return trimmed;
  }
}

export default function QrScanner({ onToken }: { onToken: (token: string) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const controlsRef = useRef<{ stop: () => void } | null>(null);
  const [message, setMessage] = useState("Tekan aktifkan kamera untuk memindai QR.");
  const [manual, setManual] = useState("");
  const [active, setActive] = useState(false);

  useEffect(() => () => controlsRef.current?.stop(), []);

  async function start() {
    setMessage("Meminta izin kamera...");
    setActive(true);
    try {
      const { BrowserQRCodeReader } = await import("@zxing/browser");
      const reader = new BrowserQRCodeReader();
      controlsRef.current = await reader.decodeFromVideoDevice(
        undefined,
        videoRef.current!,
        (result, error, controls) => {
          controlsRef.current = controls;
          if (result) {
            const token = tokenFromValue(result.getText());
            setMessage("QR terbaca. Memuat data armada...");
            controls.stop();
            setActive(false);
            onToken(token);
          } else if (error && error.name !== "NotFoundException") {
            setMessage("Kamera aktif. Arahkan QR ke dalam kotak.");
          }
        }
      );
      setMessage("Kamera aktif. Arahkan QR ke dalam kotak.");
    } catch (error) {
      setActive(false);
      setMessage(error instanceof Error ? error.message : "Kamera tidak dapat diaktifkan.");
    }
  }

  function stop() {
    controlsRef.current?.stop();
    controlsRef.current = null;
    setActive(false);
    setMessage("Kamera dihentikan.");
  }

  return (
    <div className="card">
      <div className="card-head">
        <div>
          <h2>1. Pindai QR armada</h2>
          <p>Gunakan kamera HP, tablet, atau webcam komputer.</p>
        </div>
      </div>
      <div className="card-body">
        <div className="scanner">
          <video ref={videoRef} muted playsInline />
          <div className="scanner-frame"><ScanLine size={30} style={{ position: "absolute", inset: "calc(50% - 15px)" }} /></div>
          <div className="scanner-copy">{message}</div>
        </div>
        <div style={{ display: "flex", gap: 9, marginTop: 12 }}>
          {!active ? (
            <button className="btn btn-primary" type="button" onClick={start}><Camera size={17} /> Aktifkan kamera</button>
          ) : (
            <button className="btn btn-danger" type="button" onClick={stop}>Hentikan kamera</button>
          )}
        </div>
        <div style={{ height: 16 }} />
        <div className="field">
          <label><Keyboard size={14} style={{ verticalAlign: "middle" }} /> Input token manual</label>
          <div style={{ display: "flex", gap: 9 }}>
            <input className="input" value={manual} onChange={(e) => setManual(e.target.value)} placeholder="Tempel URL QR atau token..." />
            <button className="btn btn-secondary" type="button" onClick={() => manual.trim() && onToken(tokenFromValue(manual))}>Buka</button>
          </div>
        </div>
      </div>
    </div>
  );
}
