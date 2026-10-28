const DEFAULT_LPS_URL = "https://lps-app-five.vercel.app/api/integrations/timbangqr/weighings";
const DEFAULT_LPS_SECRET = "a8f9c4e2b7d013589ef671234abcd567890ef123456789abcdef0123456789ab";

export type LpsWeighingPayload = {
  ticketNumber: string;
  plateNumber: string;
  lpsName: string;
  transdepo: string;
  weighedAt: string;
  grossKg: number;
  tareKg: number;
  rafaksiKg: number;
  nettoKg: number;
  driverName?: string;
  vehicleType?: string;
  wasteType?: string;
  indicatorRaw?: string;
  qrCode?: string;
};

function getTargetLpsUrl(): string {
  const configured = process.env.LPS_INTEGRATION_URL?.trim();
  if (!configured) return DEFAULT_LPS_URL;
  if (configured.includes("lps-app-iota.vercel.app") || configured.includes("lps-app-fikris-projects")) {
    return DEFAULT_LPS_URL;
  }
  return configured;
}

export async function syncCompletedWeighingToLps(payload: LpsWeighingPayload) {
  const url = getTargetLpsUrl();
  const secret = process.env.LPS_INTEGRATION_SECRET?.trim() || DEFAULT_LPS_SECRET;

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${secret}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10_000),
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      console.error("[LPS Sync] Ditolak:", response.status, body);
      return { attempted: true, ok: false, reason: `http_${response.status}` };
    }
    return { attempted: true, ok: true, duplicate: Boolean(body?.duplicate) };
  } catch (error) {
    console.error("[LPS Sync] Gagal mengirim transaksi:", error);
    return { attempted: true, ok: false, reason: "network_error" as const };
  }
}

export async function deleteWeighingFromLps(ticketNumber: string) {
  const baseUrl = getTargetLpsUrl();
  const secret = process.env.LPS_INTEGRATION_SECRET?.trim() || DEFAULT_LPS_SECRET;
  const url = new URL(baseUrl);
  url.searchParams.set("ticketNumber", ticketNumber);

  try {
    const response = await fetch(url.toString(), {
      method: "DELETE",
      headers: {
        authorization: `Bearer ${secret}`,
      },
      signal: AbortSignal.timeout(10_000),
    });
    const body = await response.json().catch(() => null);
    return { attempted: true, ok: response.ok, body };
  } catch (error) {
    console.error("[LPS Sync Delete] Gagal menghapus transaksi di LPS:", error);
    return { attempted: true, ok: false, reason: "network_error" as const };
  }
}
