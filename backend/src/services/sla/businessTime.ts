/**
 * Time-zone aware business-hours arithmetic for SLA clocks. Uses only Intl, so it
 * handles DST and every IANA zone without a date library.
 */
export interface Calendar {
  enabled: boolean;
  timezone: string;
  workDays: number[]; // 0 = Sunday … 6 = Saturday
  startMin: number; // minutes from local midnight
  endMin: number;
  holidays: string[]; // YYYY-MM-DD, local to `timezone`
}

export const DEFAULT_CALENDAR: Calendar = { enabled: true, timezone: "UTC", workDays: [1, 2, 3, 4, 5], startMin: 540, endMin: 1080, holidays: [] };

const WD: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
const fmtCache = new Map<string, Intl.DateTimeFormat>();

export function zonedParts(date: Date, tz: string) {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "short" });
    fmtCache.set(tz, f);
  }
  const p = Object.fromEntries(f.formatToParts(date).map((x) => [x.type, x.value]));
  return { y: +p.year, m: +p.month, d: +p.day, min: +p.hour * 60 + +p.minute, wd: WD[p.weekday] };
}

/** UTC instant for a local wall-clock time in `tz`. */
export function zonedToUtc(y: number, m: number, d: number, minOfDay: number, tz: string): Date {
  const guess = Date.UTC(y, m - 1, d, 0, minOfDay);
  const off = (t: number) => {
    const z = zonedParts(new Date(t), tz);
    return Date.UTC(z.y, z.m - 1, z.d, 0, z.min) - t;
  };
  let t = guess - off(guess);
  t = guess - off(t); // second pass settles DST transitions
  return new Date(t);
}

const pad = (n: number) => String(n).padStart(2, "0");
const isoDay = (p: { y: number; m: number; d: number }) => `${p.y}-${pad(p.m)}-${pad(p.d)}`;
const isWorkDay = (p: ReturnType<typeof zonedParts>, c: Calendar) => c.workDays.includes(p.wd) && !c.holidays.includes(isoDay(p));

function nextDayStart(p: { y: number; m: number; d: number }, tz: string) {
  const n = new Date(Date.UTC(p.y, p.m - 1, p.d + 1));
  return zonedToUtc(n.getUTCFullYear(), n.getUTCMonth() + 1, n.getUTCDate(), 0, tz);
}

export function addBusinessMinutes(start: Date, minutes: number, cal: Calendar): Date {
  if (!cal.enabled) return new Date(start.getTime() + minutes * 60_000);
  let cursor = start;
  let remaining = minutes;
  for (let i = 0; i < 4000; i++) {
    const p = zonedParts(cursor, cal.timezone);
    if (isWorkDay(p, cal)) {
      const from = Math.max(p.min, cal.startMin);
      const avail = Math.max(0, cal.endMin - from);
      if (remaining <= avail) return zonedToUtc(p.y, p.m, p.d, from + remaining, cal.timezone);
      remaining -= avail;
    }
    cursor = nextDayStart(p, cal.timezone);
  }
  return new Date(start.getTime() + minutes * 60_000);
}

export function businessMinutesBetween(a: Date, b: Date, cal: Calendar): number {
  if (b <= a) return 0;
  if (!cal.enabled) return Math.round((b.getTime() - a.getTime()) / 60_000);
  let cursor = a;
  let total = 0;
  for (let i = 0; i < 4000 && cursor < b; i++) {
    const p = zonedParts(cursor, cal.timezone);
    const dayEnd = nextDayStart(p, cal.timezone);
    if (isWorkDay(p, cal)) {
      const from = Math.max(p.min, cal.startMin);
      const to = b < dayEnd ? Math.min(zonedParts(b, cal.timezone).min, cal.endMin) : cal.endMin;
      total += Math.max(0, to - from);
    }
    cursor = dayEnd;
  }
  return total;
}

/** Is `now` inside a person's working shift? */
export function onShift(now: Date, tz: string, workDays: number[], startMin: number, endMin: number): boolean {
  const p = zonedParts(now, tz);
  return workDays.includes(p.wd) && p.min >= startMin && p.min < endMin;
}
