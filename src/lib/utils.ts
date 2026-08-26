export function formatKg(value: number | null | undefined) {
  return new Intl.NumberFormat("id-ID").format(Number(value ?? 0)) + " kg";
}

export function formatNumber(value: number | null | undefined) {
  return new Intl.NumberFormat("id-ID").format(Number(value ?? 0));
}

export function formatDateTime(value: string | null | undefined) {
  if (!value || !String(value).trim()) return "-";

  const date = new Date(String(value).trim());
  if (Number.isNaN(date.getTime())) return "-";

  try {
    return new Intl.DateTimeFormat("id-ID", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "Asia/Jakarta",
    }).format(date);
  } catch {
    return "-";
  }
}

export function normalizePlate(value: string) {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function displayPlate(value: string) {
  const normalized = normalizePlate(value);
  const match = normalized.match(/^([A-Z]{1,2})(\d{1,4})([A-Z]{0,3})$/);
  return match ? [match[1], match[2], match[3]].filter(Boolean).join(" ") : value.toUpperCase().trim();
}

export function monthLabel(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  return new Intl.DateTimeFormat("id-ID", {
    month: "long",
    year: "numeric",
    timeZone: "Asia/Jakarta",
  }).format(new Date(Date.UTC(year, monthNumber - 1, 1)));
}

export function toInt(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed) : fallback;
}

export function jakartaIsoNow(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);

  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}T${value.hour}:${value.minute}:${value.second}+07:00`;
}
