"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, Crop, Eye, EyeOff, RefreshCw, RotateCcw, Cpu, CheckCircle2, Save, Settings, Link2, Copy, Check, X } from "lucide-react";
import type { Worker } from "tesseract.js";
import { getCameraStreamWithFallback, formatCameraErrorMessage } from "@/lib/cameraHelper";

export type LedWeightReading = {
  weightKg: number;
  raw: string;
  stable: boolean;
  confidence: number;
};

export type OcrEngine = "yolo" | "sevenseg" | "ssocr" | "tesseract";
export type ColorMode = "red" | "green" | "auto";
export type SensitivityMode = "auto" | "high" | "anti_glare";

type Detection = {
  digits: string;
  weightKg: number;
  confidence: number;
  digitCount: number;
  boxes?: Array<{ x: number; y: number; w: number; h: number; digit?: string }>;
  band?: { y: number; h: number };
  diagnosticInfo?: string;
  engine: OcrEngine;
};

type CropArea = { x: number; y: number; width: number; height: number };

// Area fokus standar: strip horizontal di tengah layar display timbangan
const DEFAULT_CROP: CropArea = { x: 0.16, y: 0.28, width: 0.68, height: 0.44 };

const DIGIT_MAP = {
  "0": { on: ["a", "b", "c", "d", "e", "f"], off: ["g"] },
  "1": { on: ["b", "c"], off: ["a", "d", "e", "f", "g"] },
  "2": { on: ["a", "b", "g", "e", "d"], off: ["c", "f"] },
  "3": { on: ["a", "b", "g", "c", "d"], off: ["e", "f"] },
  "4": { on: ["f", "g", "b", "c"], off: ["a", "d", "e"] },
  "5": { on: ["a", "f", "g", "c", "d"], off: ["b", "e"] },
  "6": { on: ["a", "f", "g", "e", "c", "d"], off: ["b"] },
  "7": { on: ["a", "b", "c"], off: ["d", "e", "f", "g"] },
  "8": { on: ["a", "b", "c", "d", "e", "f", "g"], off: [] },
  "9": { on: ["a", "b", "c", "d", "f", "g"], off: ["e"] },
};

function sampleZone(
  mask: Uint8Array,
  width: number,
  x0: number,
  y0: number,
  sw: number,
  sh: number,
  [l, t, r, b]: [number, number, number, number]
): number {
  const fx = Math.max(0, Math.min(width - 1, Math.floor(x0 + sw * l)));
  const tx = Math.max(0, Math.min(width - 1, Math.ceil(x0 + sw * r)));
  const fy = Math.max(0, Math.floor(y0 + sh * t));
  const ty = Math.max(0, Math.ceil(y0 + sh * b));

  let lit = 0;
  let tot = 0;
  for (let y = fy; y <= ty; y += 1) {
    const rowOff = y * width;
    for (let x = fx; x <= tx; x += 1) {
      lit += mask[rowOff + x];
      tot += 1;
    }
  }
  return tot > 0 ? lit / tot : 0;
}

/**
 * Mesin Vision SSOCR 7-Segment Spesialis Timbangan Digital:
 * 1. Filter spektrum fisik LED: membedakan cahaya LED merah murni vs warna kulit wajah & lampu ruangan
 * 2. Adaptasi kecerahan LED aktif: memisahkan digit menyala terang vs segmen 88 mati / bayangan redup
 * 3. Valley-splitting otomatis: memisahkan digit berdempetan (misal '1' dan '6')
 * 4. Verifikasi segmen & rongga: angka '0' memiliki rongga tengah (g mati), '1' batang vertikal ramping
 */
function detectSsocrLed(
  image: ImageData,
  width: number,
  height: number,
  configuredDigits: number,
  colorMode: ColorMode,
  sensitivity: SensitivityMode
): { detection: Detection | null; binaryMask: Uint8Array } {
  const data = image.data;
  const totalPixels = width * height;
  const binaryMask = new Uint8Array(totalPixels);

  // 1. Analisis spektrum warna dan penemuan puncak kecerahan LED
  let maxR = 0;
  let maxG = 0;
  let maxExcess = 0;

  for (let i = 0; i < totalPixels; i += 1) {
    const off = i * 4;
    const r = data[off];
    const g = data[off + 1];
    const b = data[off + 2];
    if (r > maxR) maxR = r;
    if (g > maxG) maxG = g;

    const ex = colorMode === "green" ? g - Math.max(r, b) : r - Math.max(g, b);
    if (ex > maxExcess) maxExcess = ex;
  }

  // Validasi spektrum fisik LED:
  // LED Merah aktif memiliki R tinggi (>150) dan saturasi merah dominan (excess > 45).
  // Wajah manusia, baju, atau laptop sticker memiliki bRatio tinggi (> 0.40) atau saturasi merah rendah
  if (colorMode === "red" && (maxR < 155 || maxExcess < 45)) {
    return { detection: null, binaryMask };
  }
  if (colorMode === "green" && (maxG < 155 || maxExcess < 45)) {
    return { detection: null, binaryMask };
  }

  // 2. Ambang batas adaptif: hanya menangkap segmen LED yang MENYALA AKTIF
  let threshMain = Math.max(175, Math.round(maxR * 0.80));
  let threshExcess = Math.max(65, Math.round(maxExcess * 0.65));

  if (sensitivity === "high") {
    threshMain = Math.max(150, threshMain - 15);
    threshExcess = Math.max(40, threshExcess - 15);
  } else if (sensitivity === "anti_glare") {
    threshMain = Math.min(240, threshMain + 10);
    threshExcess = Math.min(130, threshExcess + 10);
  }

  let litTotal = 0;
  for (let i = 0; i < totalPixels; i += 1) {
    const off = i * 4;
    const r = data[off];
    const g = data[off + 1];
    const b = data[off + 2];

    let isLit = false;
    if (colorMode === "red") {
      const ex = r - Math.max(g, b);
      const bRatio = b / (r + 1);
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;
      // 1. Timbangan fisik: LED merah murni (excess tinggi, blue rendah)
      const isPhysicalLit = r >= threshMain && ex >= threshExcess && bRatio <= 0.35;
      // 2. Display smartphone / simulator: inti LED sangat terang (backlit core, green/lum tinggi)
      const isPhoneLit = r >= 185 && ex >= 40 && bRatio <= 0.35 && (g >= 70 || lum >= 125);
      if (isPhysicalLit || isPhoneLit) {
        isLit = true;
      }
    } else if (colorMode === "green") {
      const ex = g - Math.max(r, b);
      const rRatio = r / (g + 1);
      const bRatio = b / (g + 1);
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;
      const isPhysicalLit = g >= threshMain && ex >= threshExcess && bRatio <= 0.40 && rRatio <= 0.45;
      const isPhoneLit = g >= 185 && ex >= 40 && bRatio <= 0.40 && (r >= 70 || lum >= 125);
      if (isPhysicalLit || isPhoneLit) {
        isLit = true;
      }
    } else {
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;
      if (lum >= 180) {
        isLit = true;
      }
    }

    if (isLit) {
      binaryMask[i] = 1;
      litTotal += 1;
    }
  }

  // Jika jumlah piksel terlalu sedikit atau terlalu masif (>45% layar = silau total)
  if (litTotal < 35 || litTotal / totalPixels > 0.45) {
    return { detection: null, binaryMask };
  }

  // 3. Proyeksi vertikal (Y-Histogram) untuk mendeteksi baris utama digit LED
  const ySum = new Int32Array(height);
  for (let y = 0; y < height; y += 1) {
    let s = 0;
    const rowOff = y * width;
    for (let x = 0; x < width; x += 1) s += binaryMask[rowOff + x];
    ySum[y] = s;
  }

  let maxYSum = 0;
  for (let y = 0; y < height; y += 1) {
    if (ySum[y] > maxYSum) maxYSum = ySum[y];
  }
  if (maxYSum < 10) return { detection: null, binaryMask };

  let y0 = -1;
  let y1 = -1;
  const threshRow = Math.max(3, Math.round(maxYSum * 0.18));
  for (let y = 0; y < height; y += 1) {
    if (ySum[y] >= threshRow) {
      if (y0 === -1) y0 = y;
      y1 = y;
    }
  }
  const bh = y1 - y0 + 1;
  // Tinggi digit LED timbangan minimal 18 piksel
  if (bh < 18 || bh > height * 0.92) {
    return { detection: null, binaryMask };
  }

  // 4. Proyeksi horisontal (X-Histogram) pada baris angka
  const colSum = new Int32Array(width);
  for (let x = 0; x < width; x += 1) {
    let s = 0;
    for (let y = y0; y <= y1; y += 1) s += binaryMask[y * width + x];
    colSum[x] = s;
  }

  // Kumpulkan span kolom aktif
  const rawSpans: Array<{ x0: number; x1: number; w: number }> = [];
  let sStart = -1;
  for (let x = 0; x < width; x += 1) {
    if (colSum[x] >= 3) {
      if (sStart === -1) sStart = x;
    } else {
      if (sStart !== -1) {
        if (x - sStart >= 3) rawSpans.push({ x0: sStart, x1: x - 1, w: x - sStart });
        sStart = -1;
      }
    }
  }
  if (sStart !== -1 && width - sStart >= 3) {
    rawSpans.push({ x0: sStart, x1: width - 1, w: width - sStart });
  }

  // 5. Valley Splitting: memisahkan digit berdempetan
  const segmentedSpans: Array<{ x0: number; x1: number; w: number }> = [];
  function splitSpan(span: { x0: number; x1: number; w: number }) {
    const sw = span.w;
    // Lebar normal digit tunggal adalah 0.20 s/d 0.48 * bh.
    // Hanya periksa splitting jika lebar melebihi satu digit (> 0.52 * bh)
    if (sw > bh * 0.52) {
      let minVal = 99999;
      let minX = -1;
      let maxVal = 0;
      for (let x = span.x0; x <= span.x1; x += 1) {
        if (colSum[x] > maxVal) maxVal = colSum[x];
      }
      const xStart = span.x0 + Math.floor(sw * 0.20);
      const xEnd = span.x1 - Math.floor(sw * 0.20);
      for (let x = xStart; x <= xEnd; x += 1) {
        if (colSum[x] < minVal) {
          minVal = colSum[x];
          minX = x;
        }
      }
      // Lembah harus benar-benar celah antar-digit (<= 35% dari tinggi kolom maksimum)
      // Mencegah digit 0 dan 6 (yang berlubang tengah dengan colSum ~50%) terpotong menjadi dua
      if (minX !== -1 && minVal <= maxVal * 0.35) {
        splitSpan({ x0: span.x0, x1: minX - 1, w: minX - span.x0 });
        splitSpan({ x0: minX + 1, x1: span.x1, w: span.x1 - minX });
        return;
      }
    }
    segmentedSpans.push(span);
  }

  for (const s of rawSpans) splitSpan(s);

  // 6. Pengenalan Karakter 7-Segmen
  const digitCandidates: Array<{
    digit: string;
    box: { x: number; y: number; w: number; h: number };
    confidence: number;
  }> = [];

  for (const s of segmentedSpans) {
    const sw = s.w;
    const ratio = sw / bh;

    // Abaikan titik noise kecil
    if (sw < 5 || ratio < 0.10) continue;

    // Batang vertikal ramping tunggal = angka 1 (lebar 1 biasanya <= 0.30 * bh)
    if (ratio <= 0.30) {
      digitCandidates.push({
        digit: "1",
        box: { x: s.x0, y: y0, w: sw, h: bh },
        confidence: 0.95,
      });
      continue;
    }

    // Sampling segmen g atas dan bawah untuk menangani sedikit distorsi/kemiringan vertikal
    const gUpper = sampleZone(binaryMask, width, s.x0, y0, sw, bh, [0.35, 0.30, 0.65, 0.45]);
    const gLower = sampleZone(binaryMask, width, s.x0, y0, sw, bh, [0.35, 0.45, 0.65, 0.58]);
    const acts = {
      a: sampleZone(binaryMask, width, s.x0, y0, sw, bh, [0.20, 0.00, 0.80, 0.22]),
      b: sampleZone(binaryMask, width, s.x0, y0, sw, bh, [0.65, 0.10, 1.00, 0.48]),
      c: sampleZone(binaryMask, width, s.x0, y0, sw, bh, [0.65, 0.52, 1.00, 0.90]),
      d: sampleZone(binaryMask, width, s.x0, y0, sw, bh, [0.20, 0.75, 0.80, 1.00]),
      e: sampleZone(binaryMask, width, s.x0, y0, sw, bh, [0.00, 0.52, 0.35, 0.90]),
      f: sampleZone(binaryMask, width, s.x0, y0, sw, bh, [0.00, 0.10, 0.35, 0.48]),
      g: Math.max(gUpper, gLower),
    };

    let bestD: string | null = null;
    let bestScore = -999;
    for (const [d, rule] of Object.entries(DIGIT_MAP)) {
      if (d === "1") continue;
      let score = 0;
      for (const onSeg of rule.on) score += acts[onSeg as keyof typeof acts];
      for (const offSeg of rule.off) score += (1 - acts[offSeg as keyof typeof acts]);
      const norm = score / 7;
      if (norm > bestScore) {
        bestScore = norm;
        bestD = d;
      }
    }

    if (bestD && bestScore >= 0.50) {
      digitCandidates.push({
        digit: bestD,
        box: { x: s.x0, y: y0, w: sw, h: bh },
        confidence: bestScore,
      });
    }
  }

  if (!digitCandidates.length) {
    return { detection: null, binaryMask };
  }

  // 7. Pengelompokan deret digit display (menghilangkan dot status terisolasi)
  digitCandidates.sort((a, b) => a.box.x - b.box.x);

  const clusters: Array<typeof digitCandidates> = [];
  let curCluster: typeof digitCandidates = [];

  for (let i = 0; i < digitCandidates.length; i += 1) {
    const item = digitCandidates[i];
    if (!curCluster.length) {
      curCluster.push(item);
    } else {
      const prev = curCluster[curCluster.length - 1];
      const gap = item.box.x - (prev.box.x + prev.box.w);
      // Jarak antar-digit pada display timbangan biasanya <= 0.85 * bh
      if (gap <= bh * 0.85) {
        curCluster.push(item);
      } else {
        clusters.push(curCluster);
        curCluster = [item];
      }
    }
  }
  if (curCluster.length) clusters.push(curCluster);

  clusters.sort((a, b) => b.length - a.length);
  const mainDigits = clusters[0] || [];

  if (!mainDigits.length) {
    return { detection: null, binaryMask };
  }

  if (configuredDigits > 0 && mainDigits.length !== configuredDigits) {
    return { detection: null, binaryMask };
  }

  const digitsStr = mainDigits.map((v) => v.digit).join("");
  const value = Number(digitsStr);
  if (!Number.isFinite(value)) return { detection: null, binaryMask };

  const avgConfidence = mainDigits.reduce((acc, curr) => acc + curr.confidence, 0) / mainDigits.length;

  return {
    detection: {
      digits: digitsStr,
      weightKg: value,
      confidence: avgConfidence,
      digitCount: mainDigits.length,
      boxes: mainDigits.map((v) => v.box),
      band: { y: y0, h: bh },
      diagnosticInfo: `SSOCR Vision: Terbaca ${mainDigits.length} digit "${digitsStr}" (Keyakinan: ${Math.round(avgConfidence * 100)}%)`,
      engine: "ssocr",
    },
    binaryMask,
  };
}

export default function LedWeightScanner({
  onReading,
  onLockWeight,
  onSaveWeight,
  isVehicleReady,
}: {
  onReading: (reading: LedWeightReading | null) => void;
  onLockWeight?: (weightKg: number) => void;
  onSaveWeight?: (weightKg: number) => void;
  isVehicleReady?: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const visionCanvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<number | null>(null);
  const samplesRef = useRef<number[]>([]);

  // Mesin OCR
  const DEFAULT_YOLO_TUNNEL_URL = "";
  const [ocrEngine, setOcrEngine] = useState<OcrEngine>("yolo");
  const yoloBusyRef = useRef(false);
  const [yoloStatus, setYoloStatus] = useState<"checking" | "online" | "offline">("checking");
  const [customYoloUrl, setCustomYoloUrl] = useState<string>("");
  const [showBridgeModal, setShowBridgeModal] = useState<boolean>(false);
  const [bridgeInputUrl, setBridgeInputUrl] = useState<string>("");
  const [yoloLatency, setYoloLatency] = useState<number | null>(null);
  const [testingBridge, setTestingBridge] = useState<boolean>(false);
  const [bridgeFeedback, setBridgeFeedback] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [copiedLink, setCopiedLink] = useState(false);
  const [tesseractReady, setTesseractReady] = useState(false);
  const tesseractWorkerRef = useRef<Worker | null>(null);
  const tesseractBusyRef = useRef(false);
  const yoloFailCountRef = useRef(0);
  const lastYoloFrameTimeRef = useRef(0);

  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
  const [cameraId, setCameraId] = useState("");
  const [configuredDigits, setConfiguredDigits] = useState(4);
  const [colorMode, setColorMode] = useState<ColorMode>("red");
  const [sensitivity, setSensitivity] = useState<SensitivityMode>("auto");
  const [message, setMessage] = useState("Pilih kamera, lalu arahkan ke angka display timbangan.");
  const [active, setActive] = useState(false);
  const [reading, setReading] = useState<Detection | null>(null);
  const [lockedReading, setLockedReading] = useState<Detection | null>(null);
  const lockedReadingRef = useRef<Detection | null>(null);
  const [stable, setStable] = useState(false);
  const [showVision, setShowVision] = useState(false);

  // Area potong crop (koordinat relatif 0..1 dari video)
  const [cropArea, setCropArea] = useState<CropArea>(DEFAULT_CROP);
  const [calibrating, setCalibrating] = useState(false);
  const selectionStartRef = useRef<{ x: number; y: number } | null>(null);

  // Status check untuk backend YOLO OCR (Direct Browser + Proxy Next.js)
  const checkYoloHealth = useCallback(async (overrideUrl?: string): Promise<{ ok: boolean; error?: string }> => {
    // Jika scanner kamera sedang aktif mengirim frame, jangan ganggu antrean Cloudflare tunnel
    if (yoloBusyRef.current && overrideUrl === undefined) {
      return { ok: true };
    }

    const isLocalHost = typeof window !== "undefined" && (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1");
    let target = overrideUrl !== undefined ? overrideUrl : customYoloUrl;
    target = target ? target.trim().replace(/\/+$/, "") : "";

    // Hanya auto-set ke local 5001 jika overrideUrl TIDAK diberikan dan target kosong pada localhost
    if (overrideUrl === undefined && isLocalHost && !target) {
      target = "http://127.0.0.1:5001";
      setCustomYoloUrl(target);
      setBridgeInputUrl(target);
      if (typeof window !== "undefined") {
        localStorage.setItem("timbangqr_yolo_url", target);
      }
    }

    try {
      const startTime = performance.now();
      const headers: Record<string, string> = {};
      if (target) headers["x-yolo-url"] = target;
      const query = target ? `?yoloUrl=${encodeURIComponent(target)}` : "";

      let online = false;
      let latency = 0;
      let errMsg = "";

      // 1. Coba lewat proxy internal /api/ocr-yolo (bebas masalah CORS browser dan Cloudflare preflight)
      try {
        const controller = new AbortController();
        const t = setTimeout(() => controller.abort(), 8000);
        const res = await fetch(`/api/ocr-yolo${query}`, { headers, signal: controller.signal });
        clearTimeout(t);
        const data = await res.json();
        if (data?.online) {
          online = true;
          latency = Math.round(performance.now() - startTime);
          if (!target && data.targetUrl) {
            setCustomYoloUrl(data.targetUrl);
            setBridgeInputUrl(data.targetUrl);
            if (typeof window !== "undefined") {
              localStorage.setItem("timbangqr_yolo_url", data.targetUrl);
            }
          }
        } else {
          errMsg = data?.error || data?.details || "Server tidak merespons";
        }
      } catch (proxyErr: any) {
        errMsg = proxyErr?.message;
      }

      // 2. Direct browser fetch fallback jika proxy gagal dan target adalah local http
      if (!online && target && (target.includes("127.0.0.1") || target.includes("localhost"))) {
        try {
          const directStart = performance.now();
          const controller = new AbortController();
          const t = setTimeout(() => controller.abort(), 3000);
          const directRes = await fetch(`${target.replace(/\/+$/, "")}/health`, {
            signal: controller.signal,
          });
          clearTimeout(t);
          if (directRes.ok) {
            const directData = await directRes.json();
            if (directData?.status === "ok") {
              online = true;
              latency = Math.round(performance.now() - directStart);
            }
          }
        } catch {}
      }

      if (online) {
        yoloFailCountRef.current = 0;
        setYoloStatus("online");
        setYoloLatency(latency);
        return { ok: true };
      } else {
        yoloFailCountRef.current += 1;
        // Debounce: Hanya set offline jika gagal minimal 4 kali berturut-turut untuk mencegah status berkedip
        if (yoloFailCountRef.current >= 4) {
          setYoloStatus("offline");
          setYoloLatency(null);
        }
        return { ok: false, error: errMsg || "Server tidak merespons" };
      }
    } catch (e: any) {
      yoloFailCountRef.current += 1;
      if (yoloFailCountRef.current >= 4) {
        setYoloStatus("offline");
        setYoloLatency(null);
      }
      return { ok: false, error: e?.message || "Gagal menghubungi server OCR" };
    }
  }, [customYoloUrl]);

  // Otomatis baca URL bridge dari query parameter ?yolo_url= atau localStorage
  useEffect(() => {
    if (typeof window !== "undefined") {
      const isLocalHost = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";
      const params = new URLSearchParams(window.location.search);
      const urlFromParam = params.get("yolo_url") || params.get("yoloUrl");
      const saved = localStorage.getItem("timbangqr_yolo_url");

      let activeUrl = "";
      if (urlFromParam && urlFromParam.trim()) {
        activeUrl = urlFromParam.trim();
        localStorage.setItem("timbangqr_yolo_url", activeUrl);
      } else if (saved && saved.trim()) {
        activeUrl = saved.trim();
      } else if (isLocalHost) {
        activeUrl = "http://127.0.0.1:5001";
        localStorage.setItem("timbangqr_yolo_url", activeUrl);
      } else {
        activeUrl = DEFAULT_YOLO_TUNNEL_URL;
      }

      setCustomYoloUrl(activeUrl);
      setBridgeInputUrl(activeUrl);
      setOcrEngine("yolo");
      void checkYoloHealth(activeUrl);
    }
  }, [checkYoloHealth]);

  useEffect(() => {
    if (ocrEngine !== "yolo" && ocrEngine !== "sevenseg") return;
    checkYoloHealth();
    const interval = setInterval(() => {
      if (active && yoloFailCountRef.current === 0) return;
      checkYoloHealth();
    }, 8000);
    return () => clearInterval(interval);
  }, [checkYoloHealth, ocrEngine, active]);

  // Inisialisasi Tesseract.js Worker jika dipilih
  useEffect(() => {
    let isMounted = true;
    if (ocrEngine === "tesseract" && !tesseractWorkerRef.current) {
      setMessage("Memuat mesin Tesseract.js WebAssembly...");
      import("tesseract.js")
        .then(async ({ createWorker }) => {
          const worker = await createWorker("eng");
          await worker.setParameters({
            tessedit_char_whitelist: "0123456789.",
            tessedit_pageseg_mode: "7" as any, // Single line
          });
          if (isMounted) {
            tesseractWorkerRef.current = worker;
            setTesseractReady(true);
            setMessage("Mesin Tesseract.js siap. Arahkan ke angka timbangan.");
          } else {
            await worker.terminate();
          }
        })
        .catch((err) => {
          console.error("Gagal memuat Tesseract.js:", err);
          if (isMounted) {
            setMessage("Tesseract.js gagal dimuat. Otomatis beralih ke SSOCR Vision.");
            setOcrEngine("ssocr");
          }
        });
    }

    return () => {
      isMounted = false;
    };
  }, [ocrEngine]);

  // Bersihkan worker saat unmount
  useEffect(() => {
    return () => {
      if (tesseractWorkerRef.current) {
        tesseractWorkerRef.current.terminate().catch(() => {});
        tesseractWorkerRef.current = null;
      }
    };
  }, []);

  // REFS untuk mencegah stale closure di dalam loop timer
  const stateRef = useRef({
    ocrEngine,
    configuredDigits,
    colorMode,
    sensitivity,
    cropArea,
    showVision,
    onReading,
    customYoloUrl,
    yoloStatus,
  });
  stateRef.current = {
    ocrEngine,
    configuredDigits,
    colorMode,
    sensitivity,
    cropArea,
    showVision,
    onReading,
    customYoloUrl,
    yoloStatus,
  };

  const pointFromPointer = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const video = videoRef.current;
    const rect = event.currentTarget.getBoundingClientRect();
    const localX = event.clientX - rect.left;
    const localY = event.clientY - rect.top;
    if (!video?.videoWidth || !video.videoHeight) {
      return {
        x: Math.min(1, Math.max(0, localX / rect.width)),
        y: Math.min(1, Math.max(0, localY / rect.height)),
      };
    }

    const videoRatio = video.videoWidth / video.videoHeight;
    const boxRatio = rect.width / rect.height;
    const renderedWidth = videoRatio > boxRatio ? rect.height * videoRatio : rect.width;
    const renderedHeight = videoRatio > boxRatio ? rect.height : rect.width / videoRatio;
    const offsetX = (rect.width - renderedWidth) / 2;
    const offsetY = (rect.height - renderedHeight) / 2;
    return {
      x: Math.min(1, Math.max(0, (localX - offsetX) / renderedWidth)),
      y: Math.min(1, Math.max(0, (localY - offsetY) / renderedHeight)),
    };
  }, []);

  const refreshCameras = useCallback(async () => {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const next = devices.filter((device) => device.kind === "videoinput");
      setCameras(next);
      setCameraId((current) => current || next[0]?.deviceId || "");
    } catch {}
  }, []);

  const stop = useCallback(() => {
    if (timerRef.current) window.clearInterval(timerRef.current);
    timerRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setActive(false);
  }, []);

  const lockCurrentReading = useCallback(
    (targetDetection?: Detection | null) => {
      const toLock = targetDetection || reading;
      if (!toLock || toLock.weightKg <= 0) return;
      setLockedReading(toLock);
      lockedReadingRef.current = toLock;
      setStable(true);
      stateRef.current.onReading({
        weightKg: toLock.weightKg,
        raw:
          toLock.engine === "yolo"
            ? `OCR_LED:YOLO:${toLock.digits}`
            : `OCR_LED:${toLock.engine.toUpperCase()}:${toLock.digits}`,
        stable: true,
        confidence: toLock.confidence,
      });
      onLockWeight?.(toLock.weightKg);
      setMessage(`✓ Angka terkunci: ${toLock.digits} KG (Siap Simpan)`);
    },
    [reading, onLockWeight]
  );

  const unlockReading = useCallback(() => {
    setLockedReading(null);
    lockedReadingRef.current = null;
    samplesRef.current = [];
    setStable(false);
    setMessage("Kunci angka dilepas. Membaca display kembali secara real-time...");
  }, []);

  const handleDetectionResult = useCallback(
    (detection: Detection | null) => {
      if (lockedReadingRef.current) return;
      const notifyReading = stateRef.current.onReading;
      if (!detection) {
        if (samplesRef.current.length > 0) {
          samplesRef.current = samplesRef.current.slice(-2);
        }
        setReading(null);
        setStable(false);
        notifyReading(null);
        setMessage("Arahkan kotak ke display LED timbangan. Wajah atau ruangan ditolak otomatis.");
        return;
      }

      const samples = [...samplesRef.current.slice(-2), detection.weightKg];
      samplesRef.current = samples;

      const isStable =
        samples.length >= 3 && Math.max(...samples) - Math.min(...samples) <= 1;

      setReading(detection);
      setStable(isStable);
      notifyReading({
        weightKg: detection.weightKg,
        raw: `OCR_LED:${detection.engine.toUpperCase()}:${detection.digits}`,
        stable: isStable,
        confidence: detection.confidence,
      });

      setMessage(
        isStable
          ? `✓ OCR STABIL: ${detection.digits} KG (Siap simpan)`
          : `Membaca: ${detection.digits} KG · Validasi kestabilan (${samples.length}/3)...`
      );
    },
    []
  );

  const analyze = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;

    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (!vw || !vh) return;

    const {
      ocrEngine: currentEngine,
      cropArea: currentCrop,
      colorMode: currentMode,
      sensitivity: currentSens,
      configuredDigits: currentDigits,
      showVision: currentShowVision,
      customYoloUrl: activeYoloUrl,
      yoloStatus: currentYoloStatus,
    } = stateRef.current;

    const sourceX = Math.max(0, Math.round(vw * currentCrop.x));
    const sourceY = Math.max(0, Math.round(vh * currentCrop.y));
    const sourceWidth = Math.min(vw - sourceX, Math.round(vw * currentCrop.width));
    const sourceHeight = Math.min(vh - sourceY, Math.round(vh * currentCrop.height));
    if (sourceWidth < 40 || sourceHeight < 30) return;

    const isCloudflare = Boolean(
      activeYoloUrl && (activeYoloUrl.includes("trycloudflare.com") || activeYoloUrl.includes("cloudflare"))
    );

    // Optimasi ukuran canvas: 320px untuk Cloudflare Tunnel (<15KB payload) agar bebas 502/lag
    const maxTargetW = isCloudflare ? 320 : 440;
    const targetW = Math.min(maxTargetW, sourceWidth);
    const targetH = Math.max(1, Math.round(targetW * (sourceHeight / sourceWidth)));
    canvas.width = targetW;
    canvas.height = targetH;

    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return;

    context.drawImage(video, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, targetW, targetH);

    // MODE 1 & 2: Deep Learning Vision AI (YOLO & Renjith Seven-Segment CRNN)
    if (currentEngine === "yolo" || currentEngine === "sevenseg") {
      const now = Date.now();
      // Jeda minimum: 450ms untuk Cloudflare Tunnel agar tunnel tidak overload, 200ms untuk lokal
      const minInterval = isCloudflare ? 450 : 200;
      if (now - lastYoloFrameTimeRef.current < minInterval) return;
      if (yoloBusyRef.current) return;
      yoloBusyRef.current = true;

      // Kompresi optimal: 0.60 untuk Cloudflare tunnel (sangat ringan ~12KB), 0.70 untuk lokal
      const jpegQuality = isCloudflare ? 0.60 : 0.70;
      const base64 = canvas.toDataURL("image/jpeg", jpegQuality);
      const postPayload = {
        image: base64,
        configuredDigits: currentDigits,
        colorMode: currentMode,
        preprocess: true,
        engine: currentEngine,
        yoloUrl: activeYoloUrl || undefined,
      };

      // Direct browser fetch HANYA jika server lokal (127.0.0.1 / localhost) dan web berjalan di HTTP
      // Semua Cloudflare Tunnel / URL remote WAJIB lewat proxy /api/ocr-yolo agar bebas batasan CORS/preflight browser
      const tryDirect = Boolean(
        activeYoloUrl &&
        (activeYoloUrl.includes("127.0.0.1") || activeYoloUrl.includes("localhost")) &&
        typeof window !== "undefined" &&
        window.location.protocol === "http:"
      );

      const postPromise = tryDirect
        ? fetch(`${activeYoloUrl.replace(/\/+$/, "")}/ocr`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(postPayload),
            signal: AbortSignal.timeout(8000),
          })
        : fetch("/api/ocr-yolo", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...(activeYoloUrl ? { "x-yolo-url": activeYoloUrl } : {}),
            },
            body: JSON.stringify(postPayload),
            signal: AbortSignal.timeout(15000),
          });

      postPromise
        .then(async (res) => {
          if (!res.ok) {
            yoloFailCountRef.current += 1;
            // Debounce: Hanya set offline jika gagal minimal 4 kali berturut-turut
            if (yoloFailCountRef.current >= 4) {
              setYoloStatus("offline");
              setMessage("Server OCR Cloud Bridge terputus. Memeriksa koneksi kembali...");
            }
            return;
          }
          yoloFailCountRef.current = 0;
          if (currentYoloStatus !== "online") {
            setYoloStatus("online");
          }
          const data = await res.json();
          if (data?.success && data.digits) {
            const engineLabel = currentEngine === "sevenseg" ? "CRNN 7-Segment" : "YOLO Vision";
            const detectionRes: Detection = {
              digits: data.digits,
              weightKg: data.weightKg,
              confidence: data.confidence,
              digitCount: data.digitCount,
              diagnosticInfo: `${engineLabel}: Terbaca ${data.digits} KG (Keyakinan: ${Math.round(data.confidence * 100)}%)`,
              engine: currentEngine,
              boxes: data.boxes?.map((b: any) => ({
                x: b.box[0],
                y: b.box[1],
                w: b.box[2] - b.box[0],
                h: b.box[3] - b.box[1],
                digit: b.digit,
              })),
            };
            handleDetectionResult(detectionRes);

            if (visionCanvasRef.current && currentShowVision) {
              const vCtx = visionCanvasRef.current.getContext("2d");
              if (vCtx) {
                visionCanvasRef.current.width = targetW;
                visionCanvasRef.current.height = targetH;
                vCtx.drawImage(canvas, 0, 0);

                if (detectionRes.boxes) {
                  vCtx.lineWidth = 2;
                  vCtx.strokeStyle = "#10b981";
                  vCtx.fillStyle = "#10b981";
                  vCtx.font = "bold 13px monospace";

                  detectionRes.boxes.forEach((box) => {
                    vCtx.strokeRect(box.x, box.y, box.w, box.h);
                    vCtx.fillText(`[${box.digit}]`, box.x + 2, Math.max(14, box.y - 4));
                  });
                }
              }
            }
          } else {
            handleDetectionResult(null);
            if (visionCanvasRef.current && currentShowVision) {
              const vCtx = visionCanvasRef.current.getContext("2d");
              if (vCtx) {
                visionCanvasRef.current.width = targetW;
                visionCanvasRef.current.height = targetH;
                vCtx.drawImage(canvas, 0, 0);
              }
            }
          }
        })
        .catch((err) => {
          console.error("YOLO OCR Error:", err);
          yoloFailCountRef.current += 1;
          if (yoloFailCountRef.current >= 4) {
            setYoloStatus("offline");
          }
        })
        .finally(() => {
          yoloBusyRef.current = false;
          lastYoloFrameTimeRef.current = Date.now();
        });

      return;
    }

    const imageData = context.getImageData(0, 0, targetW, targetH);

    // Jalankan deteksi SSOCR Vision
    const { detection, binaryMask } = detectSsocrLed(
      imageData,
      targetW,
      targetH,
      currentDigits,
      currentMode,
      currentSens
    );

    // Update canvas vision overlay jika aktif
    if (visionCanvasRef.current && currentShowVision) {
      const vCtx = visionCanvasRef.current.getContext("2d");
      if (vCtx) {
        visionCanvasRef.current.width = targetW;
        visionCanvasRef.current.height = targetH;

        const maskImg = vCtx.createImageData(targetW, targetH);
        const mData = maskImg.data;
        for (let i = 0; i < targetW * targetH; i += 1) {
          const off = i * 4;
          if (binaryMask[i] === 1) {
            mData[off] = currentMode === "green" ? 16 : 244;
            mData[off + 1] = currentMode === "green" ? 220 : 63;
            mData[off + 2] = currentMode === "green" ? 60 : 63;
            mData[off + 3] = 255;
          } else {
            mData[off] = 11;
            mData[off + 1] = 15;
            mData[off + 2] = 20;
            mData[off + 3] = 255;
          }
        }
        vCtx.putImageData(maskImg, 0, 0);

        if (detection?.boxes) {
          vCtx.lineWidth = 2;
          vCtx.strokeStyle = "#10b981";
          vCtx.fillStyle = "#10b981";
          vCtx.font = "bold 13px monospace";

          detection.boxes.forEach((box, i) => {
            vCtx.strokeRect(box.x, box.y, box.w, box.h);
            const digitChar = detection.digits[i] || "";
            vCtx.fillText(`[${digitChar}]`, box.x + 2, Math.max(14, box.y - 4));
          });
        }
      }
    }

    // Jika mode Tesseract.js dipilih dan terinisialisasi
    if (currentEngine === "tesseract" && tesseractWorkerRef.current && !tesseractBusyRef.current) {
      tesseractBusyRef.current = true;
      // Berikan binarized canvas bersih ke Tesseract
      const tessCanvas = document.createElement("canvas");
      tessCanvas.width = targetW;
      tessCanvas.height = targetH;
      const tCtx = tessCanvas.getContext("2d");
      if (tCtx) {
        // Tesseract mengharapkan karakter hitam di atas latar putih
        const tImg = tCtx.createImageData(targetW, targetH);
        for (let i = 0; i < targetW * targetH; i += 1) {
          const off = i * 4;
          const isDark = binaryMask[i] === 1 ? 0 : 255;
          tImg.data[off] = isDark;
          tImg.data[off + 1] = isDark;
          tImg.data[off + 2] = isDark;
          tImg.data[off + 3] = 255;
        }
        tCtx.putImageData(tImg, 0, 0);

        tesseractWorkerRef.current
          .recognize(tessCanvas)
          .then((res) => {
            const cleanText = res.data.text.replace(/[^0-9]/g, "");
            if (cleanText.length > 0) {
              const val = Number(cleanText);
              handleDetectionResult({
                digits: cleanText,
                weightKg: val,
                confidence: res.data.confidence / 100,
                digitCount: cleanText.length,
                diagnosticInfo: `Tesseract.js Wasm: "${cleanText}" (Keyakinan: ${res.data.confidence}%)`,
                engine: "tesseract",
              });
            } else if (detection) {
              // Fallback ke SSOCR jika Tesseract kosong pada 7-segment font
              handleDetectionResult(detection);
            } else {
              handleDetectionResult(null);
            }
          })
          .catch((err) => {
            console.error("Tesseract recognition error:", err);
            handleDetectionResult(detection);
          })
          .finally(() => {
            tesseractBusyRef.current = false;
          });
      }
      return;
    }

    // Mode default SSOCR Vision
    handleDetectionResult(detection);
  }, [handleDetectionResult]);

  const analyzeRef = useRef(analyze);
  analyzeRef.current = analyze;

  async function start(targetCamId?: string) {
    stop();
    setMessage("Meminta izin kamera LED...");
    setReading(null);
    setStable(false);
    samplesRef.current = [];
    yoloFailCountRef.current = 0;
    try {
      const activeCamId = targetCamId !== undefined ? targetCamId : cameraId;
      const stream = await getCameraStreamWithFallback(activeCamId || undefined, {
        facingMode: "environment",
        preferredWidth: 1280,
        preferredHeight: 720,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      await refreshCameras();
      setActive(true);
      setMessage("Kamera aktif. Arahkan kotak ke display angka timbangan.");
      if (timerRef.current) window.clearInterval(timerRef.current);
      timerRef.current = window.setInterval(() => {
        analyzeRef.current();
      }, 120);
    } catch (error) {
      stop();
      setMessage(formatCameraErrorMessage(error, "Kamera LED"));
    }
  }

  // Otomatis aktifkan kamera dan langsung jalankan OCR services saat aplikasi dibuka
  useEffect(() => {
    let mounted = true;
    const runAutoStart = async () => {
      try {
        let firstCam = "";
        try {
          const devices = await navigator.mediaDevices.enumerateDevices();
          const videoDevs = devices.filter((d) => d.kind === "videoinput");
          if (mounted) {
            setCameras(videoDevs);
            if (videoDevs.length > 0) {
              firstCam = videoDevs[0].deviceId;
              setCameraId(firstCam);
            }
          }
        } catch {}

        if (mounted) {
          await start(firstCam || undefined);
        }
      } catch (err) {
        console.warn("Auto-start camera warning:", err);
      }
    };

    runAutoStart();

    return () => {
      mounted = false;
      stop();
    };
  }, []);

  function beginCalibration() {
    setCalibrating(true);
    selectionStartRef.current = null;
    setMessage("Tarik kotak tepat mengelilingi display angka timbangan, lalu lepaskan.");
  }

  function handlePointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (!calibrating) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = pointFromPointer(event);
    selectionStartRef.current = point;
    setCropArea({ x: point.x, y: point.y, width: 0.001, height: 0.001 });
  }

  function handlePointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const startPt = selectionStartRef.current;
    if (!calibrating || !startPt) return;
    const point = pointFromPointer(event);
    setCropArea({
      x: Math.min(startPt.x, point.x),
      y: Math.min(startPt.y, point.y),
      width: Math.abs(point.x - startPt.x),
      height: Math.abs(point.y - startPt.y),
    });
  }

  function handlePointerUp(event: React.PointerEvent<HTMLDivElement>) {
    const startPt = selectionStartRef.current;
    if (!calibrating || !startPt) return;
    const point = pointFromPointer(event);
    const width = Math.abs(point.x - startPt.x);
    const height = Math.abs(point.y - startPt.y);
    selectionStartRef.current = null;

    if (width < 0.06 || height < 0.06) {
      setCropArea(DEFAULT_CROP);
      setMessage("Kotak terlalu kecil. Tekan 'Atur area LED' dan tarik lebih lebar.");
    } else {
      setCropArea({
        x: Math.min(startPt.x, point.x),
        y: Math.min(startPt.y, point.y),
        width,
        height,
      });
      setMessage("Area display tersimpan. Sensor sekarang fokus pada display timbangan.");
    }
    setCalibrating(false);
    samplesRef.current = [];
  }

  const displayReading = lockedReading || reading;

  return (
    <div className="card">
      <div className="card-head">
        <div>
          <h2>2. Pindai display LED timbangan</h2>
          <p>Kamera membaca angka LED timbangan (YOLO Vision AI &amp; SSOCR).</p>
        </div>
      </div>
      <div className="card-body">
        <div
          className={`scanner led-scanner ${calibrating ? "is-calibrating" : ""}`}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
        >
          <video ref={videoRef} muted playsInline />

          {/* Kotak panduan crop adaptif */}
          <div
            className="ocr-crop-box"
            style={{
              left: `${cropArea.x * 100}%`,
              top: `${cropArea.y * 100}%`,
              width: `${cropArea.width * 100}%`,
              height: `${cropArea.height * 100}%`,
              borderColor: calibrating ? "#fff" : lockedReading ? "#059669" : stable ? "#10b981" : reading ? "#f59e0b" : "#ffd552",
              boxShadow: calibrating
                ? "0 0 0 9999px rgba(0,0,0,0.6)"
                : "0 0 0 9999px rgba(0,0,0,0.45)",
              transition: calibrating ? "none" : "border-color 0.2s ease",
            }}
          >
            {displayReading && (
              <div
                style={{
                  position: "absolute",
                  bottom: -32,
                  left: "50%",
                  transform: "translateX(-50%)",
                  padding: "3px 12px",
                  borderRadius: 6,
                  background: lockedReading ? "#059669" : stable ? "#10b981" : "#f59e0b",
                  color: "#fff",
                  fontWeight: 800,
                  fontSize: 12,
                  whiteSpace: "nowrap",
                  letterSpacing: "0.04em",
                  boxShadow: "0 2px 8px rgba(0,0,0,0.3)",
                }}
              >
                {lockedReading
                  ? `🔒 TERKUNCI: ${displayReading.digits} KG`
                  : stable
                  ? `✓ STABIL: ${displayReading.digits} KG`
                  : `MEMBACA: ${displayReading.digits} KG`}
              </div>
            )}
          </div>

          <div className="scanner-copy">{message}</div>
        </div>

        <canvas ref={canvasRef} className="sr-only" aria-hidden="true" />

        {showVision && (
          <div style={{ marginTop: 10, textAlign: "center", background: "#0b0f14", padding: 12, borderRadius: 10, border: "1px solid #1e293b" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8, fontSize: 11, color: "#94a3b8" }}>
              <span>
                <strong>Sensor Vision Binarisasi:</strong> Kotak hijau = Digit lolos verifikasi LED
              </span>
              <span style={{ color: displayReading ? "#10b981" : "#e2e8f0" }}>
                {displayReading ? `Status: Terdeteksi ${displayReading.digits} KG (${displayReading.engine.toUpperCase()})` : "Status: Menunggu display timbangan"}
              </span>
            </div>
            <canvas ref={visionCanvasRef} style={{ maxWidth: "100%", maxHeight: 120, borderRadius: 6, border: "1px solid #334155" }} />
            <div style={{ fontSize: 11, color: "#64748b", marginTop: 6 }}>
              {displayReading?.diagnosticInfo || "Wajah manusia, lampu, dan objek solid ditolak otomatis oleh spektrum filter LED."}
            </div>
          </div>
        )}

        <div
          className="ocr-reading"
          style={{
            borderColor: lockedReading ? "#059669" : stable ? "#a7f3d0" : reading ? "#fde68a" : "#f2c9c9",
            background: lockedReading ? "#ecfdf5" : stable ? "#ecfdf5" : reading ? "#fffbeb" : "#fff7f7",
            color: lockedReading ? "#065f46" : stable ? "#065f46" : reading ? "#92400e" : "#a21717",
            transition: "all 0.2s ease",
            padding: "16px 20px",
          }}
          aria-live="polite"
        >
          <strong>{displayReading ? new Intl.NumberFormat("id-ID").format(displayReading.weightKg) : "—"}</strong>
          <span>
            {lockedReading
              ? `🔒 ANGKA TERKUNCI DARI OCR · KG (${displayReading?.engine.toUpperCase()})`
              : stable
              ? `OCR LED STABIL · KG (${displayReading?.engine.toUpperCase()})`
              : reading
              ? `MEMBACA: ${reading.digits} (${samplesRef.current.length}/3 STABIL)`
              : "MENUNGGU DISPLAY TIMBANGAN"}
          </span>

          {displayReading && displayReading.weightKg > 0 && (
            <div style={{ display: "flex", gap: 10, marginTop: 14, flexWrap: "wrap", justifyContent: "center", alignItems: "center" }}>
              {!lockedReading ? (
                <>
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => lockCurrentReading(displayReading)}
                    style={{ background: "#059669", color: "white", padding: "8px 16px" }}
                    title="Kunci angka ini agar tidak berubah oleh kedipan kamera"
                  >
                    <CheckCircle2 size={16} /> Kunci Angka ({displayReading.digits} KG)
                  </button>
                  {onSaveWeight && isVehicleReady && (
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={() => {
                        lockCurrentReading(displayReading);
                        onSaveWeight(displayReading.weightKg);
                      }}
                      style={{ background: "#047857", color: "white", fontWeight: 700, padding: "8px 16px", boxShadow: "0 4px 12px rgba(4,120,87,0.3)" }}
                      title="Kunci angka ini dan simpan transaksi sekarang"
                    >
                      <Save size={16} /> Simpan Transaksi ({displayReading.digits} KG)
                    </button>
                  )}
                </>
              ) : (
                <>
                  <span className="badge green" style={{ padding: "6px 12px", fontSize: 12 }}>
                    <CheckCircle2 size={14} /> Angka Terkunci ({lockedReading.digits} KG)
                  </span>
                  {onSaveWeight && isVehicleReady && (
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={() => onSaveWeight(lockedReading.weightKg)}
                      style={{ background: "#047857", color: "white", fontWeight: 700, padding: "8px 16px" }}
                    >
                      <Save size={16} /> Simpan Transaksi Sekarang
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={unlockReading}
                    title="Buka kunci untuk memindai ulang secara live"
                  >
                    <RotateCcw size={14} /> Buka Kunci / Scan Ulang
                  </button>
                </>
              )}
            </div>
          )}
        </div>

        {/* BARIS 1: Mesin OCR & Kamera Display */}
        <div className="form-row compact-form" style={{ marginTop: 12, alignItems: "start" }}>
          <div className="field" style={{ minWidth: 0 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <Cpu size={14} /> Mesin OCR
            </label>
            <select
              className="select"
              value={ocrEngine}
              onChange={(event) => {
                setOcrEngine(event.target.value as OcrEngine);
                samplesRef.current = [];
              }}
            >
              <option value="yolo">YOLO Vision AI (Rekomendasi - Deteksi Objek)</option>
              <option value="sevenseg">Seven-Segment CRNN (Renjith Sasidharan OCR)</option>
              <option value="ssocr">SSOCR Vision (Algoritma Filter Piksel)</option>
              <option value="tesseract">Tesseract.js Wasm (3rd-Party Open Source)</option>
            </select>
          </div>

          <div className="field" style={{ minWidth: 0 }}>
            <label>Kamera display</label>
            <select
              className="select"
              value={cameraId}
              onChange={(event) => {
                const nextId = event.target.value;
                setCameraId(nextId);
                if (active) {
                  void start(nextId);
                }
              }}
            >
              {cameras.length ? (
                cameras.map((camera, index) => (
                  <option key={camera.deviceId} value={camera.deviceId}>
                    {camera.label || `Kamera ${index + 1}`}
                  </option>
                ))
              ) : (
                <option value="">Belum ada kamera terdeteksi</option>
              )}
            </select>
          </div>
        </div>

        {/* STATUS & PENGATURAN YOLO CLOUD BRIDGE (SEJAJAR PENUH / FULL WIDTH - BEBAS OVERLAP) */}
        {(ocrEngine === "yolo" || ocrEngine === "sevenseg") && (
          <div
            style={{
              marginTop: 10,
              padding: "10px 14px",
              borderRadius: 10,
              border: yoloStatus === "online" ? "1px solid #a7f3d0" : "1px solid #fee2e2",
              background: yoloStatus === "online" ? "#f0fdf4" : "#fef2f2",
              display: "flex",
              flexDirection: "column",
              gap: 8,
              boxSizing: "border-box",
              width: "100%",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0, flex: "1 1 200px" }}>
                <span
                  style={{
                    display: "inline-block",
                    width: 10,
                    height: 10,
                    borderRadius: "50%",
                    backgroundColor: yoloStatus === "online" ? "#10b981" : yoloStatus === "checking" ? "#f59e0b" : "#ef4444",
                    boxShadow: yoloStatus === "online" ? "0 0 8px rgba(16,185,129,0.5)" : undefined,
                    flexShrink: 0,
                  }}
                />
                <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                  <span style={{ color: yoloStatus === "online" ? "#047857" : yoloStatus === "checking" ? "#b45309" : "#b91c1c", fontWeight: 700, fontSize: 13 }}>
                    {yoloStatus === "online"
                      ? `Server YOLO Online (${yoloLatency !== null ? `${yoloLatency}ms` : "OK"})`
                      : yoloStatus === "checking"
                      ? "Memeriksa server OCR..."
                      : "Server YOLO: Offline"}
                  </span>
                  <span style={{ fontSize: 11, color: "#64748b", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    Bridge: <code style={{ background: "rgba(0,0,0,0.05)", padding: "1px 5px", borderRadius: 4 }}>{customYoloUrl}</code>
                  </span>
                </div>
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
                <button
                  type="button"
                  onClick={() => {
                    setBridgeInputUrl(customYoloUrl);
                    setShowBridgeModal(!showBridgeModal);
                  }}
                  className="btn outline"
                  style={{ padding: "4px 10px", fontSize: 11, height: "auto", display: "flex", alignItems: "center", gap: 4, background: "white" }}
                  title="Atur URL Tunnel / Cloud Bridge"
                >
                  <Settings size={12} />
                  {showBridgeModal ? "Tutup" : "Ubah Bridge URL"}
                </button>
                <button
                  type="button"
                  onClick={() => checkYoloHealth()}
                  className="btn outline"
                  style={{ padding: "4px 8px", fontSize: 11, height: "auto", background: "white" }}
                  title="Periksa Ulang Koneksi"
                >
                  <RefreshCw size={12} />
                </button>
              </div>
            </div>

            {/* Modal / Card Pengaturan Bridge URL */}
            {showBridgeModal && (
              <div
                style={{
                  background: "#ffffff",
                  border: "1px solid #cbd5e1",
                  borderRadius: 8,
                  padding: 12,
                  marginTop: 4,
                  boxShadow: "0 4px 12px rgba(0,0,0,0.06)",
                  display: "flex",
                  flexDirection: "column",
                  gap: 8,
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <strong style={{ fontSize: 12, display: "flex", alignItems: "center", gap: 4, color: "#1e293b" }}>
                    <Link2 size={13} /> Pengaturan YOLO Cloud Bridge
                  </strong>
                  <button
                    type="button"
                    onClick={() => setShowBridgeModal(false)}
                    style={{ border: "none", background: "transparent", cursor: "pointer", color: "#64748b" }}
                  >
                    <X size={14} />
                  </button>
                </div>

                <p style={{ fontSize: 11, color: "#475569", margin: 0 }}>
                  Masukkan URL Cloudflare Tunnel atau server Python lokal:
                </p>

                <div style={{ display: "flex", gap: 6 }}>
                  <input
                    type="text"
                    className="input"
                    placeholder="https://xxx.trycloudflare.com atau http://127.0.0.1:5001"
                    value={bridgeInputUrl}
                    onChange={(e) => setBridgeInputUrl(e.target.value)}
                    style={{ fontSize: 11, padding: "5px 8px", flex: 1 }}
                  />
                  <button
                    type="button"
                    className="btn primary"
                    disabled={testingBridge}
                    onClick={async () => {
                      setTestingBridge(true);
                      setBridgeFeedback(null);
                      const cleaned = bridgeInputUrl.trim();
                      const checkRes = await checkYoloHealth(cleaned);
                      setTestingBridge(false);
                      if (checkRes.ok) {
                        if (typeof window !== "undefined") {
                          if (cleaned) localStorage.setItem("timbangqr_yolo_url", cleaned);
                          else localStorage.removeItem("timbangqr_yolo_url");
                        }
                        setCustomYoloUrl(cleaned);
                        setYoloStatus("online");
                        setBridgeFeedback({ type: "success", text: "✓ Berhasil terhubung ke server YOLO!" });
                      } else {
                        let errMsg = checkRes.error || "Gagal terhubung. Pastikan server/tunnel aktif.";
                        if (typeof window !== "undefined" && window.location.hostname !== "localhost" && window.location.hostname !== "127.0.0.1" && cleaned.includes("127.0.0.1")) {
                          errMsg = `⚠️ Aplikasi sedang dibuka via ${window.location.hostname} (Cloud/Vercel). Vercel tidak bisa mengakses '127.0.0.1' di laptop Anda. Silakan jalankan 'MULAI_YOLO_VERCEL.bat' untuk mendapatkan URL Cloudflare Tunnel (https://xxx.trycloudflare.com)!`;
                        } else if (cleaned.includes("127.0.0.1") || cleaned.includes("localhost")) {
                          errMsg = `⚠️ Server Python YOLO belum aktif di port 5001. Silakan jalankan 'MULAI_WINDOWS.bat' atau 'python scripts/yolo_ocr_server.py' terlebih dahulu di terminal.`;
                        }
                        setBridgeFeedback({
                          type: "error",
                          text: errMsg,
                        });
                      }
                    }}
                    style={{ padding: "5px 12px", fontSize: 11, whiteSpace: "nowrap" }}
                  >
                    {testingBridge ? "Menguji..." : "Tes & Simpan"}
                  </button>
                </div>

                {bridgeFeedback && (
                  <div
                    style={{
                      fontSize: 11,
                      padding: "4px 8px",
                      borderRadius: 4,
                      background: bridgeFeedback.type === "success" ? "#ecfdf5" : "#fef2f2",
                      color: bridgeFeedback.type === "success" ? "#065f46" : "#991b1b",
                    }}
                  >
                    {bridgeFeedback.text}
                  </div>
                )}

                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 2 }}>
                  <button
                    type="button"
                    className="btn outline"
                    style={{ fontSize: 10, padding: "2px 6px", height: "auto" }}
                    onClick={() => {
                      setBridgeInputUrl(DEFAULT_YOLO_TUNNEL_URL);
                    }}
                  >
                    Reset ke Default Tunnel
                  </button>
                  <button
                    type="button"
                    className="btn outline"
                    style={{ fontSize: 10, padding: "2px 6px", height: "auto" }}
                    onClick={() => {
                      setBridgeInputUrl("http://127.0.0.1:5001");
                    }}
                  >
                    Gunakan Lokal (127.0.0.1:5001)
                  </button>
                  {customYoloUrl && (
                    <button
                      type="button"
                      className="btn outline"
                      style={{ fontSize: 10, padding: "2px 6px", height: "auto", display: "flex", alignItems: "center", gap: 3 }}
                      onClick={() => {
                        if (typeof window !== "undefined") {
                          const direct = `${window.location.origin}${window.location.pathname}?yolo_url=${encodeURIComponent(customYoloUrl)}`;
                          navigator.clipboard.writeText(direct).then(() => {
                            setCopiedLink(true);
                            setTimeout(() => setCopiedLink(false), 2000);
                          });
                        }
                      }}
                    >
                      {copiedLink ? <Check size={11} /> : <Copy size={11} />}
                      {copiedLink ? "Link Tersalin!" : "Salin Link Cepat"}
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* Pesan bantuan jika offline */}
            {yoloStatus === "offline" && !showBridgeModal && (
              <div style={{ background: "#fef2f2", border: "1px solid #fee2e2", borderRadius: 8, padding: "8px 10px", fontSize: 11, color: "#991b1b" }}>
                <div style={{ fontWeight: 600, marginBottom: 4 }}>
                  ⚠️ Server AI YOLO belum terhubung
                </div>
                <div style={{ marginBottom: 6, color: "#7f1d1d" }}>
                  1. Di PC timbangan, jalankan: <code style={{ background: "#fee2e2", padding: "1px 4px", borderRadius: 3, fontWeight: 700 }}>MULAI_WINDOWS.bat</code> (Port 5001)<br />
                  2. Untuk testing cloud Vercel, jalankan <code style={{ background: "#fee2e2", padding: "1px 4px", borderRadius: 3, fontWeight: 700 }}>MULAI_YOLO_VERCEL.bat</code>.
                </div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 4 }}>
                  <button
                    type="button"
                    onClick={() => {
                      setBridgeInputUrl("http://127.0.0.1:5001");
                      setCustomYoloUrl("http://127.0.0.1:5001");
                      if (typeof window !== "undefined") {
                        localStorage.setItem("timbangqr_yolo_url", "http://127.0.0.1:5001");
                      }
                      void checkYoloHealth("http://127.0.0.1:5001");
                    }}
                    style={{
                      background: "#2563eb",
                      color: "white",
                      border: "none",
                      borderRadius: 4,
                      padding: "3px 8px",
                      fontSize: 11,
                      fontWeight: 600,
                      cursor: "pointer",
                    }}
                  >
                    🔌 Sambungkan ke Lokal (127.0.0.1:5001)
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setBridgeInputUrl(customYoloUrl);
                      setShowBridgeModal(true);
                    }}
                    style={{
                      background: "#dc2626",
                      color: "white",
                      border: "none",
                      borderRadius: 4,
                      padding: "3px 8px",
                      fontSize: 11,
                      fontWeight: 600,
                      cursor: "pointer",
                    }}
                  >
                    ⚙️ Masukkan URL Tunnel
                  </button>
                  <button
                    type="button"
                    onClick={() => setOcrEngine("ssocr")}
                    style={{
                      background: "#08784f",
                      color: "white",
                      border: "none",
                      borderRadius: 4,
                      padding: "3px 8px",
                      fontSize: 11,
                      fontWeight: 600,
                      cursor: "pointer",
                    }}
                  >
                    Beralih ke SSOCR (Bawaan Browser)
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* BARIS 2: Pengaturan Warna, Sensitivitas, & Digit Display */}
        <div className="form-row compact-form" style={{ marginTop: 12, alignItems: "start" }}>
          <div className="field" style={{ minWidth: 0 }}>
            <label>Warna LED display</label>
            <select
              className="select"
              value={colorMode}
              onChange={(event) => {
                setColorMode(event.target.value as ColorMode);
                samplesRef.current = [];
              }}
            >
              <option value="red">LED Merah (Standar timbangan)</option>
              <option value="green">LED Hijau</option>
              <option value="auto">Semua Warna / LCD Kontras Tinggi</option>
            </select>
          </div>

          <div className="field" style={{ minWidth: 0 }}>
            <label>Sensitivitas filter</label>
            <select
              className="select"
              value={sensitivity}
              onChange={(event) => {
                setSensitivity(event.target.value as SensitivityMode);
                samplesRef.current = [];
              }}
            >
              <option value="auto">Otomatis (Adaptif)</option>
              <option value="high">Tinggi (Kamera jauh / display redup)</option>
              <option value="anti_glare">Anti-Silau (Hilangkan pantulan tebal)</option>
            </select>
          </div>

          <div className="field" style={{ minWidth: 0 }}>
            <label>Jumlah digit display</label>
            <select
              className="select"
              value={configuredDigits}
              onChange={(event) => {
                setConfiguredDigits(Number(event.target.value));
                samplesRef.current = [];
              }}
            >
              <option value={0}>Otomatis (1 s/d 8 digit)</option>
              {[1, 2, 3, 4, 5, 6, 7, 8].map((count) => (
                <option key={count} value={count}>
                  {count} digit {count === 4 ? "(Default display timbangan)" : ""}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div style={{ display: "flex", gap: 9, marginTop: 12, flexWrap: "wrap", alignItems: "center" }}>
          {!active ? (
            <button className="btn btn-primary" type="button" onClick={() => void start()} disabled={!cameraId && cameras.length > 0}>
              <Camera size={17} /> Aktifkan kamera LED
            </button>
          ) : (
            <button className="btn btn-danger" type="button" onClick={stop}>
              Hentikan kamera LED
            </button>
          )}
          <button className="btn btn-secondary" type="button" onClick={() => void refreshCameras()} disabled={active}>
            <RefreshCw size={16} /> Muat ulang kamera
          </button>
          <button
            className="btn btn-secondary"
            type="button"
            onClick={beginCalibration}
            disabled={!active}
            title="Tarik kotak manual agar sensor hanya membaca area angka display"
          >
            <Crop size={16} /> Atur area LED
          </button>
          <button
            className="btn btn-secondary"
            type="button"
            onClick={() => {
              setCropArea(DEFAULT_CROP);
              samplesRef.current = [];
              setMessage("Area LED dikembalikan ke posisi fokus tengah.");
            }}
            disabled={!active}
          >
            <RotateCcw size={16} /> Reset area
          </button>
          <button
            className="btn btn-secondary"
            type="button"
            onClick={() => setShowVision((v) => !v)}
            title="Tampilkan area sensor binarisasi kamera"
          >
            {showVision ? <EyeOff size={16} /> : <Eye size={16} />}
            {showVision ? "Tutup sensor vision" : "Pantau sensor vision"}
          </button>
        </div>
        <p className="help" style={{ marginBottom: 0 }}>
          Arahkan kotak panduan tepat ke display angka timbangan. Mode <strong>SSOCR Vision</strong> secara ketat membedakan spektrum fisik cahaya LED dengan wajah manusia dan ruangan. Anda juga dapat memilih <strong>Tesseract.js Wasm</strong> sebagai alternatif mesin OCR open source.
        </p>
      </div>
    </div>
  );
}
