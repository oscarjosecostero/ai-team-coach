/** Presentation only: every value formatted here was computed by the backend. */
const DAY = 86_400_000;
const parse = (iso: string) => new Date(`${iso.slice(0, 10)}T00:00:00Z`);

export const fmtDate = (iso: string, opts: Intl.DateTimeFormatOptions = { weekday: "short", day: "numeric", month: "short" }) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", ...opts }).format(parse(iso));

export const fmtWeek = (weekStart: string) => fmtDate(weekStart, { day: "numeric", month: "short" });

export function fmtDuration(seconds: number): string {
  const m = Math.round(seconds / 60);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}`;
}

export const fmtMinutes = (min: number) => fmtDuration(min * 60);

export function fmtPace(sPerKm: number | null): string | null {
  if (!sPerKm) return null;
  const m = Math.floor(sPerKm / 60);
  const s = Math.round(sPerKm - m * 60);
  return s === 60 ? `${m + 1}:00 /km` : `${m}:${String(s).padStart(2, "0")} /km`;
}

export const fmtKm = (m: number | null) => (m ? `${(m / 1000).toFixed(m >= 10_000 ? 1 : 2)} km` : null);
export const fmtNum = (n: number | null | undefined, digits = 0) =>
  n === null || n === undefined ? "–" : new Intl.NumberFormat("en-GB", { maximumFractionDigits: digits, minimumFractionDigits: digits }).format(n);
export const fmtSigned = (n: number, digits = 0, unit = "") => `${n > 0 ? "+" : n < 0 ? "−" : "±"}${fmtNum(Math.abs(n), digits)}${unit}`;

export const fmtFactValue = (f: { value: number | string | null; unit?: string }) =>
  f.value === null
    ? "n/a"
    : `${typeof f.value === "number" ? new Intl.NumberFormat("en-GB", { maximumFractionDigits: 2 }).format(f.value) : f.value}${f.unit ? ` ${f.unit}` : ""}`;

export const isSameDay = (a: string, b: string) => a.slice(0, 10) === b.slice(0, 10);
export const addDays = (iso: string, days: number) => new Date(parse(iso).getTime() + days * DAY).toISOString().slice(0, 10);
export const weekStartOf = (iso: string) => addDays(iso, -((parse(iso).getUTCDay() + 6) % 7));

export const SPORT_LABEL: Record<string, string> = { run: "Run", bike: "Bike", swim: "Swim", strength: "Strength", other: "Other" };
export const TYPE_LABEL: Record<string, string> = {
  easy: "Easy",
  long: "Long",
  tempo: "Tempo",
  intervals: "Intervals",
  recovery: "Recovery",
  strength: "Strength",
  brick: "Brick",
  rest: "Rest",
};
