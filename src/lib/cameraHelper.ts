/**
 * Camera Helper dengan multi-tier fallback dan penanganan kesalahan ramah pengguna.
 * Mencegah error "Could not start video source" (NotReadableError) akibat constraint yang kaku.
 */

export async function getCameraStreamWithFallback(
  targetDeviceId?: string,
  options?: {
    facingMode?: "user" | "environment";
    preferredWidth?: number;
    preferredHeight?: number;
  }
): Promise<MediaStream> {
  const preferredWidth = options?.preferredWidth ?? 1280;
  const preferredHeight = options?.preferredHeight ?? 720;
  const facingMode = options?.facingMode ?? "environment";

  // Tier 1: Target device eksplisit dengan resolusi ideal
  if (targetDeviceId) {
    try {
      return await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          deviceId: { exact: targetDeviceId },
          width: { ideal: preferredWidth },
          height: { ideal: preferredHeight },
          facingMode: { ideal: facingMode },
        },
      });
    } catch (err: any) {
      console.warn("[CameraHelper] Tier 1 exact device gagal, mencoba Tier 2 (relaxed):", err?.message);
    }
  }

  // Tier 2: Relaxed device ID (ideal tanpa 'exact') dengan resolusi ideal
  try {
    return await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        deviceId: targetDeviceId ? { ideal: targetDeviceId } : undefined,
        width: { ideal: preferredWidth },
        height: { ideal: preferredHeight },
        facingMode: { ideal: facingMode },
      },
    });
  } catch (err: any) {
    console.warn("[CameraHelper] Tier 2 relaxed device gagal, mencoba Tier 3 (standar VGA):", err?.message);
  }

  // Tier 3: Resolusi standar VGA (640x480) jika webcam jadul tidak support HD 720p
  try {
    return await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: targetDeviceId
        ? { deviceId: { ideal: targetDeviceId } }
        : { width: { ideal: 640 }, height: { ideal: 480 } },
    });
  } catch (err: any) {
    console.warn("[CameraHelper] Tier 3 standard VGA gagal, mencoba Tier 4 (paling longgar):", err?.message);
  }

  // Tier 4: Constraint paling longgar yang diizinkan browser
  return await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: true,
  });
}

/**
 * Menerjemahkan pesan error teknis DOMException dari browser
 * menjadi instruksi solutif dalam Bahasa Indonesia untuk operator timbangan.
 */
export function formatCameraErrorMessage(error: unknown, scannerName: string = "kamera"): string {
  if (!error) return `Gagal mengaktifkan ${scannerName}.`;

  const msg = error instanceof Error ? error.message : String(error);
  const name = error instanceof DOMException ? error.name : "";
  const lowerMsg = msg.toLowerCase();

  // 1. NotReadableError: Could not start video source
  if (
    name === "NotReadableError" ||
    lowerMsg.includes("could not start video source") ||
    lowerMsg.includes("starting videoinput failed") ||
    lowerMsg.includes("in use")
  ) {
    return `⚠️ Kamera sedang digunakan oleh aplikasi lain (Zoom, software timbangan lama, Windows Camera, atau tab browser lain). Atau kamera sedang dipakai oleh scanner sebelah. Tutup aplikasi tersebut atau coba cabut-colok USB webcam.`;
  }

  // 2. NotAllowedError: Izin ditolak
  if (
    name === "NotAllowedError" ||
    lowerMsg.includes("permission denied") ||
    lowerMsg.includes("dismissed")
  ) {
    return `🔒 Izin kamera ditolak oleh browser atau Windows. Klik ikon gembok di sebelah URL (address bar) lalu ubah Kamera ke 'Izinkan'. Pastikan juga Windows Settings > Privacy & security > Camera dalam posisi 'ON'.`;
  }

  // 3. NotFoundError: Kamera tidak terdeteksi
  if (
    name === "NotFoundError" ||
    name === "DevicesNotFoundError" ||
    lowerMsg.includes("device not found")
  ) {
    return `🔌 Webcam tidak terdeteksi. Pastikan kabel USB webcam tercolok kencang ke port PC (gunakan port USB belakang jika di PC desktop).`;
  }

  // 4. OverconstrainedError: Format tidak sesuai
  if (name === "OverconstrainedError" || lowerMsg.includes("overconstrained")) {
    return `⚙️ Format/resolusi kamera tidak didukung driver webcam. Coba pilih opsi kamera lain di menu dropdown.`;
  }

  // 5. Insecure context (Akses via HTTP non-localhost)
  if (
    typeof window !== "undefined" &&
    window.location.protocol !== "https:" &&
    window.location.hostname !== "localhost" &&
    window.location.hostname !== "127.0.0.1"
  ) {
    return `🔒 Browser Chrome memblokir kamera pada HTTP biasa. Buka aplikasi via HTTPS (Vercel) atau localhost.`;
  }

  return `Gagal mengaktifkan ${scannerName}: ${msg}`;
}
