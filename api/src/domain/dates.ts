/** All dates are ISO yyyy-mm-dd and treated as UTC calendar days. */
const DAY_MS = 86_400_000;

export const toIsoDate = (d: Date): string => d.toISOString().slice(0, 10);
const parse = (iso: string): number => Date.parse(`${iso}T00:00:00Z`);

export function addDays(iso: string, days: number): string {
  return toIsoDate(new Date(parse(iso) + days * DAY_MS));
}

/** Monday of the week containing `iso`. */
export function weekStartOf(iso: string): string {
  const dow = new Date(parse(iso)).getUTCDay(); // 0 = Sunday
  return addDays(iso, -((dow + 6) % 7));
}

/** Inclusive list of days from `from` to `to`. Empty when to < from. */
export function eachDay(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

/** Whole days from `from` to `to` (negative when `to` is earlier). */
export function daysBetween(from: string, to: string): number {
  return Math.round((parse(to) - parse(from)) / DAY_MS);
}
