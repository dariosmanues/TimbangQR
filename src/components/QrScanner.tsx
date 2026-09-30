"use client";

import { useEffect, useRef, useState } from "react";
import { Camera, Keyboard, ScanLine } from "lucide-react";

type DetectedBarcode = { rawValue?: string };

type NativeBarcodeDetector = {
  detect(source: CanvasImageSource): Promise<DetectedBarcode[]>;
};

type NativeBarcodeDetectorConstructor = {
  new (options?: { formats?: string[] }): NativeBarcodeDetector;
  getSupportedFormats?: () => Promise<string[]>;
};

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
  const streamRef = useRef<MediaStream | null>(null);
  const animationRef = useRef<number | null>(null);
  const stoppedRef = useRef(true);
  const detectingRef = useRef(false);
  const foundRef = useRef(false);

  const [message, setMessage] = useState("Tekan aktifkan kamera untuk memindai QR.");
  const [manual, setManual] = useState("");
  const [active, setActive] = useState(false);

  function releaseCamera() {
    stoppedRef.current = true;

    if (animationRef.current !== null) {
      window.cancelAnimationFrame(animationRef.current);
      animationRef.current = null;
    }

    controlsRef.current?.stop();
    controlsRef.current = null;

    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;

    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  }

  useEffect(() => () => releaseCamera(), []);

  function acceptQr(value: string) {
    if (foundRef.current) return;

    const token = tokenFromValue(value);
    if (!token) return;

    foundRef.current = true;
    setMessage("QR terbaca. Memuat data armada...");
    releaseCamera();
    setActive(false);
    onToken(token);
  }

  async function startNativeDetector(video: HTMLVideoElement) {
    const Detector = (
      window as typeof window & { BarcodeDetector?: NativeBarcodeDetectorConstructor }
    ).BarcodeDetector;

    if (!Detector) return false;

    try {
      const supported = Detector.getSupportedFormats
        ? await Detector.getSupportedFormats()
        : ["qr_code"];

      if (!supported.includes("qr_code")) return false;

      const detector = new Detector({ formats: ["qr_code"] });
      setMessage("Scanner cepat aktif. Arahkan QR ke dalam kotak.");

      const scanFrame = async () => {
        if (stoppedRef.current || foundRef.current) return;

        if (!detectingRef.current && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
          detectingRef.current = true;
          try {
            const barcodes = await detector.detect(video);
            const value = barcodes.find((item) => item.rawValue)?.rawValue;
            if (value) {
              acceptQr(value);
              return;
            }
          } catch {
            // Jika satu frame gagal dibaca, langsung lanjut ke frame berikutnya.
          } finally {
            detectingRef.current = false;
          }
        }

        if (!stoppedRef.current && !foundRef.current) {
          animationRef.current = window.requestAnimationFrame(scanFrame);
        }
      };

      animationRef.current = window.requestAnimationFrame(scanFrame);
      return true;
    } catch {
      return false;
    }
  }

  async function startZxingFallback(
    stream: MediaStream,
    video: HTMLVideoElement
  ) {
    const { BrowserQRCodeReader } = await import("@zxing/browser");
    const reader = new BrowserQRCodeReader(undefined, {
      delayBetweenScanAttempts: 50,
      delayBetweenScanSuccess: 150,
      tryPlayVideoTimeout: 3000,
    });

    setMessage("Scanner QR aktif. Arahkan QR ke dalam kotak.");

    controlsRef.current = await reader.decodeFromStream(
      stream,
      video,
      (result, error, controls) => {
        controlsRef.current = controls;

        if (result) {
          acceptQr(result.getText());
          return;
        }

        if (error && error.name !== "NotFoundException") {
          setMessage("Scanner QR aktif. Arahkan QR ke dalam kotak.");
        }
      }
    );
  }

  async function start() {
    if (active) return;

    releaseCamera();
    foundRef.current = false;
    detectingRef.current = false;
    stoppedRef.current = false;
    setMessage("Meminta izin kamera...");
    setActive(true);

    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("Browser tidak mendukung akses kamera.");
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 30, max: 60 },
        },
      });

      streamRef.current = stream;

      const video = videoRef.current;
      if (!video) throw new Error("Elemen kamera tidak tersedia.");

      video.srcObject = stream;
      await video.play();

      const track = stream.getVideoTracks()[0];
      if (track?.getCapabilities) {
        try {
          const capabilities = track.getCapabilities() as MediaTrackCapabilities & {
            focusMode?: string[];
          };

          if (capabilities.focusMode?.includes("continuous")) {
            await track.applyConstraints({
              advanced: [{ focusMode: "continuous" } as MediaTrackConstraintSet],
            });
          }
        } catch {
          // Autofocus tidak didukung semua browser/kamera.
        }
      }

      const nativeStarted = await startNativeDetector(video);
      if (!nativeStarted) {
        await startZxingFallback(stream, video);
      }
    } catch (error) {
      releaseCamera();
      setActive(false);
      setMessage(
        error instanceof Error
          ? error.message
          : "Kamera tidak dapat diaktifkan."
      );
    }
  }

  function stop() {
    releaseCamera();
    foundRef.current = false;
    detectingRef.current = false;
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
          <video ref={videoRef} muted playsInline autoPlay />
          <div className="scanner-frame">
            <ScanLine
              size={30}
              style={{ position: "absolute", inset: "calc(50% - 15px)" }}
            />
          </div>
          <div className="scanner-copy">{message}</div>
        </div>

        <div style={{ display: "flex", gap: 9, marginTop: 12 }}>
          {!active ? (
            <button className="btn btn-primary" type="button" onClick={start}>
              <Camera size={17} /> Aktifkan kamera
            </button>
          ) : (
            <button className="btn btn-danger" type="button" onClick={stop}>
              Hentikan kamera
            </button>
          )}
        </div>

        <div style={{ height: 16 }} />

        <div className="field">
          <label>
            <Keyboard size={14} style={{ verticalAlign: "middle" }} /> Input token manual
          </label>
          <div style={{ display: "flex", gap: 9 }}>
            <input
              className="input"
              value={manual}
              onChange={(e) => setManual(e.target.value)}
              placeholder="Tempel URL QR atau token..."
            />
            <button
              className="btn btn-secondary"
              type="button"
              onClick={() => manual.trim() && onToken(tokenFromValue(manual))}
            >
              Buka
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
