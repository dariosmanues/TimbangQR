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
};

export async function syncCompletedWeighingToLps(payload: LpsWeighingPayload) {
  const url = process.env.LPS_INTEGRATION_URL?.trim();
  const secret = process.env.LPS_INTEGRATION_SECRET?.trim();
  if (!url || !secret) return { attempted: false, ok: false, reason: 'not_configured' as const };

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${secret}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10_000),
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      console.error('[LPS Sync] Ditolak:', response.status, body);
      return { attempted: true, ok: false, reason: `http_${response.status}` };
    }
    return { attempted: true, ok: true, duplicate: Boolean(body?.duplicate) };
  } catch (error) {
    console.error('[LPS Sync] Gagal mengirim transaksi:', error);
    return { attempted: true, ok: false, reason: 'network_error' as const };
  }
}
