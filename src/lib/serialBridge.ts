const bridgeBaseUrl = `http://${process.env.SERIAL_BRIDGE_HOST || "127.0.0.1"}:${process.env.SERIAL_BRIDGE_PORT || "8787"}`;
const bridgeKey = process.env.SERIAL_BRIDGE_ADMIN_KEY || "bridge-admin-key-ganti-sebelum-produksi";

export async function callSerialBridge(pathname: string, init?: RequestInit) {
  if (process.env.SERIAL_BRIDGE_MODE === "remote") {
    return {
      ok: false,
      status: 409,
      data: {
        error: "Aplikasi berjalan dalam mode cloud. Konfigurasi COM dilakukan pada komputer operator, bukan dari VPS.",
      },
    };
  }

  try {
    const headers = new Headers(init?.headers);
    headers.set("content-type", "application/json");
    headers.set("x-bridge-key", bridgeKey);
    const response = await fetch(`${bridgeBaseUrl}${pathname}`, {
      ...init,
      headers,
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    });
    const text = await response.text();
    let data: unknown;
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = { error: text || "Respons bridge tidak valid." };
    }
    return { ok: response.ok, status: response.status, data };
  } catch (error) {
    return {
      ok: false,
      status: 503,
      data: {
        error: "Serial Bridge belum aktif. Jalankan npm run serial:bridge pada komputer operator.",
        detail: error instanceof Error ? error.message : "Tidak dapat menghubungi bridge.",
      },
    };
  }
}
