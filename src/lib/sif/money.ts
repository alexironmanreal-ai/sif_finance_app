/** Enteros en centavos. Ningún importe de negocio pasa por punto flotante. */

export function applyBps(amountCents: number, bps: number): number {
  const sign = amountCents < 0 ? -1 : 1;
  const amount = Math.abs(Math.trunc(amountCents));
  const rate = Math.trunc(bps);
  const value = Math.floor((amount * rate + 5000) / 10000);
  return sign * value;
}

export function formatArs(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(Math.trunc(cents));
  const pesos = Math.trunc(abs / 100);
  const dec = abs % 100;
  const formatted = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 0 }).format(pesos);
  return `${sign}$ ${formatted},${String(dec).padStart(2, "0")}`;
}

/** Importe exacto para CSV, sin pasar por punto flotante. */
export function csvMoney(cents: number | null): string {
  if (cents == null) return "";
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(Math.trunc(cents));
  return `${sign}${Math.trunc(abs / 100)},${String(abs % 100).padStart(2, "0")}`;
}

export function parseArsToCents(input: string): number | null {
  const raw = input.trim().replace(/\s/g, "").replace(/^ars/i, "").replace(/^\$/, "");
  if (!raw) return null;
  let neg = false;
  let s = raw;
  if (s.startsWith("-")) {
    neg = true;
    s = s.slice(1);
  }
  if (!/^[\d.,]+$/.test(s)) return null;
  let pesos: string;
  let dec = "00";
  if (s.includes(",")) {
    const parts = s.split(",");
    if (parts.length !== 2 || parts[1].length > 2) return null;
    pesos = parts[0].replace(/\./g, "");
    dec = (parts[1] + "00").slice(0, 2);
  } else if (/^\d{1,3}(\.\d{3})+$/.test(s)) {
    pesos = s.replace(/\./g, "");
  } else if (s.includes(".")) {
    return null;
  } else {
    pesos = s;
  }
  if (!/^\d+$/.test(pesos)) return null;
  const cents = Number(pesos) * 100 + Number(dec);
  if (!Number.isSafeInteger(cents)) return null;
  return neg ? -cents : cents;
}

export function formatBps(bps: number): string {
  const sign = bps < 0 ? "-" : "";
  const abs = Math.abs(Math.trunc(bps));
  const whole = Math.trunc(abs / 100);
  const frac = abs % 100;
  return `${sign}${whole},${String(frac).padStart(2, "0")}%`;
}

export function periodOf(date: string): string {
  return date.slice(0, 7);
}

export function isPeriod(value: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

export function isDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

const MONTHS = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
];

export function labelPeriod(period: string): string {
  const [y, m] = period.split("-");
  return `${MONTHS[Number(m) - 1] ?? period} ${y}`;
}

export function currentPeriod(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Argentina/Buenos_Aires",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(now);
  const year = parts.find((p) => p.type === "year")?.value ?? "2026";
  const month = parts.find((p) => p.type === "month")?.value ?? "01";
  return `${year}-${month}`;
}

export function shiftPeriod(period: string, delta: number): string {
  const [y, m] = period.split("-").map(Number);
  const index = y * 12 + (m - 1) + delta;
  const year = Math.floor(index / 12);
  const month = (index % 12) + 1;
  return `${year}-${String(month).padStart(2, "0")}`;
}

export function inPeriod(date: string | null | undefined, period: string): boolean {
  return !!date && date.slice(0, 7) === period;
}
