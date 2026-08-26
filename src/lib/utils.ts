const WIB_OFFSET_MS = 7 * 60 * 60 * 1000;

const MONTHS_SHORT_ID = [
  "Jan", "Feb", "Mar", "Apr", "Mei", "Jun",
  "Jul", "Agu", "Sep", "Okt", "Nov", "Des",
];

const MONTHS_LONG_ID = [
  "Januari", "Februari", "Maret", "April", "Mei", "Juni",
  "Juli", "Agustus", "September", "Oktober", "November", "Desember",
];

function pad2(value: number) {
  return String(value).padStart(2, "0");
}

function wibDateParts(date: Date) {
  const shifted = new Date(date.getTime() + WIB_OFFSET_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
    second: shifted.getUTCSeconds(),
  };
}

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

  const parts = wibDateParts(date);
  return `${parts.day} ${MONTHS_SHORT_ID[parts.month - 1]} ${parts.year}, ${pad2(parts.hour)}.${pad2(parts.minute)}`;
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
  if (!Number.isInteger(year) || !Number.isInteger(monthNumber) || monthNumber < 1 || monthNumber > 12) {
    return month;
  }
  return `${MONTHS_LONG_ID[monthNumber - 1]} ${year}`;
}

export function toInt(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed) : fallback;
}

export function jakartaIsoNow(date = new Date()) {
  const parts = wibDateParts(date);
  return `${parts.year}-${pad2(parts.month)}-${pad2(parts.day)}T${pad2(parts.hour)}:${pad2(parts.minute)}:${pad2(parts.second)}+07:00`;
}
