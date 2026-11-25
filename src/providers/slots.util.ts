// Pure date/time helpers for slot generation. No framework or database code here,
// so everything is unit-testable and easy to reason about.

export interface AvailabilityWindow {
  dayOfWeek: number; // 0 = Sunday ... 6 = Saturday
  startMinute: number; // minutes since local midnight
  endMinute: number;
}

export interface Interval {
  start: Date;
  end: Date;
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

// Parses YYYY-MM-DD and rejects impossible dates such as 2026-02-31.
export function parseDate(date: string): { y: number; m: number; d: number } | null {
  const match = DATE_RE.exec(date);
  if (!match) return null;
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  const check = new Date(Date.UTC(y, m - 1, d));
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== m - 1 || check.getUTCDate() !== d) {
    return null;
  }
  return { y, m, d };
}

export function isValidTimezone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

// Offset (in minutes) of `timeZone` from UTC at the given instant.
function offsetMinutes(utcMs: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(utcMs));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const asUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour'),
    get('minute'),
    get('second'),
  );
  return Math.round((asUtc - utcMs) / 60_000);
}

// Converts a wall-clock time in `timeZone` (date + minutes since midnight) to a UTC instant.
// Two passes handle days where the offset changes (daylight saving).
export function zonedToUtc(
  y: number,
  m: number,
  d: number,
  minuteOfDay: number,
  timeZone: string,
): Date {
  const wall = Date.UTC(y, m - 1, d, 0, minuteOfDay);
  const first = wall - offsetMinutes(wall, timeZone) * 60_000;
  const second = wall - offsetMinutes(first, timeZone) * 60_000;
  return new Date(second);
}

export interface GenerateSlotsOptions {
  date: string; // YYYY-MM-DD, local date in the provider's time zone
  timezone: string;
  durationMin: number;
  rules: AvailabilityWindow[];
  busy: Interval[]; // existing bookings that block time
  now: Date; // slots starting at or before this instant are dropped
}

// Back-to-back slots of `durationMin` inside each availability window of that weekday.
export function generateSlots(opts: GenerateSlotsOptions): Interval[] {
  const parsed = parseDate(opts.date);
  if (!parsed) throw new Error('Invalid date');
  const { y, m, d } = parsed;

  const dayOfWeek = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  const windows = opts.rules
    .filter((r) => r.dayOfWeek === dayOfWeek)
    .sort((a, b) => a.startMinute - b.startMinute);

  const slots: Interval[] = [];
  for (const w of windows) {
    for (let t = w.startMinute; t + opts.durationMin <= w.endMinute; t += opts.durationMin) {
      const start = zonedToUtc(y, m, d, t, opts.timezone);
      const end = zonedToUtc(y, m, d, t + opts.durationMin, opts.timezone);
      if (start.getTime() <= opts.now.getTime()) continue;
      const overlaps = opts.busy.some(
        (b) => b.start.getTime() < end.getTime() && b.end.getTime() > start.getTime(),
      );
      if (overlaps) continue;
      slots.push({ start, end });
    }
  }
  return slots;
}

// The local calendar date (YYYY-MM-DD) of an instant in `timeZone`.
export function localDateOf(instant: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}
