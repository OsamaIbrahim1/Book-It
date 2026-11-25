import { generateSlots, isValidTimezone, localDateOf, parseDate, zonedToUtc } from './slots.util';

const iso = (d: Date) => d.toISOString();
const PAST = new Date('2020-01-01T00:00:00Z');

describe('parseDate', () => {
  it('accepts a real date', () => {
    expect(parseDate('2026-11-25')).toEqual({ y: 2026, m: 11, d: 25 });
  });

  it('rejects malformed and impossible dates', () => {
    expect(parseDate('2026-1-5')).toBeNull();
    expect(parseDate('2026-02-31')).toBeNull();
    expect(parseDate('not-a-date')).toBeNull();
  });
});

describe('isValidTimezone', () => {
  it('knows real IANA zones and rejects junk', () => {
    expect(isValidTimezone('Africa/Cairo')).toBe(true);
    expect(isValidTimezone('Mars/Olympus')).toBe(false);
  });
});

describe('zonedToUtc', () => {
  it('converts a fixed-offset zone (Riyadh is UTC+3)', () => {
    expect(iso(zonedToUtc(2026, 11, 25, 9 * 60, 'Asia/Riyadh'))).toBe('2026-11-25T06:00:00.000Z');
  });

  it('follows daylight saving (New York)', () => {
    expect(iso(zonedToUtc(2026, 1, 15, 9 * 60, 'America/New_York'))).toBe('2026-01-15T14:00:00.000Z');
    expect(iso(zonedToUtc(2026, 7, 15, 9 * 60, 'America/New_York'))).toBe('2026-07-15T13:00:00.000Z');
  });

  it('handles 1440 minutes as the next local midnight', () => {
    expect(iso(zonedToUtc(2026, 11, 25, 1440, 'Asia/Riyadh'))).toBe('2026-11-25T21:00:00.000Z');
  });
});

describe('generateSlots', () => {
  // 2026-11-22 is a Sunday (dayOfWeek 0). Riyadh is UTC+3.
  const base = {
    date: '2026-11-22',
    timezone: 'Asia/Riyadh',
    durationMin: 60,
    rules: [{ dayOfWeek: 0, startMinute: 9 * 60, endMinute: 12 * 60 }],
    busy: [],
    now: PAST,
  };

  it('creates back-to-back slots inside the window', () => {
    const slots = generateSlots(base);
    expect(slots.map((s) => iso(s.start))).toEqual([
      '2026-11-22T06:00:00.000Z',
      '2026-11-22T07:00:00.000Z',
      '2026-11-22T08:00:00.000Z',
    ]);
    expect(iso(slots[2].end)).toBe('2026-11-22T09:00:00.000Z');
  });

  it('drops a slot that does not fit before the window ends', () => {
    const slots = generateSlots({ ...base, durationMin: 90 });
    expect(slots).toHaveLength(2); // 09:00-10:30 and 10:30-12:00
  });

  it('returns nothing when the service is longer than the window', () => {
    expect(generateSlots({ ...base, durationMin: 240 })).toEqual([]);
  });

  it('returns nothing on a day without availability', () => {
    expect(generateSlots({ ...base, date: '2026-11-23' })).toEqual([]); // Monday
  });

  it('removes slots that overlap an existing booking', () => {
    const slots = generateSlots({
      ...base,
      busy: [{ start: new Date('2026-11-22T07:00:00Z'), end: new Date('2026-11-22T08:00:00Z') }],
    });
    expect(slots.map((s) => iso(s.start))).toEqual([
      '2026-11-22T06:00:00.000Z',
      '2026-11-22T08:00:00.000Z',
    ]);
  });

  it('keeps a slot that only touches a booking at its edge', () => {
    const slots = generateSlots({
      ...base,
      busy: [{ start: new Date('2026-11-22T08:00:00Z'), end: new Date('2026-11-22T09:00:00Z') }],
    });
    expect(slots).toHaveLength(2);
  });

  it('drops slots that already started', () => {
    const slots = generateSlots({ ...base, now: new Date('2026-11-22T07:30:00Z') });
    expect(slots.map((s) => iso(s.start))).toEqual(['2026-11-22T08:00:00.000Z']);
  });

  it('supports several windows in one day, in order', () => {
    const slots = generateSlots({
      ...base,
      rules: [
        { dayOfWeek: 0, startMinute: 16 * 60, endMinute: 17 * 60 },
        { dayOfWeek: 0, startMinute: 9 * 60, endMinute: 10 * 60 },
      ],
    });
    expect(slots.map((s) => iso(s.start))).toEqual([
      '2026-11-22T06:00:00.000Z',
      '2026-11-22T13:00:00.000Z',
    ]);
  });
});

describe('localDateOf', () => {
  it('uses the local calendar date of the time zone', () => {
    // 22:30 UTC is already the next day in Riyadh (UTC+3).
    expect(localDateOf(new Date('2026-11-21T22:30:00Z'), 'Asia/Riyadh')).toBe('2026-11-22');
    expect(localDateOf(new Date('2026-11-21T22:30:00Z'), 'UTC')).toBe('2026-11-21');
  });
});
