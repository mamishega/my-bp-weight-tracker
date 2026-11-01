import { describe, it, expect } from 'vitest';
import { zonedToInstant, instantToZoned, offsetMinutesAt, addDays, daysBetween, localDateOf, weekStart, todayIn } from '../lib/time';

const SYD = 'Australia/Sydney';

describe('time zones and daylight saving', () => {
  it('converts wall time to UTC in standard and daylight time', () => {
    expect(zonedToInstant('2026-07-01', '07:00', SYD)).toEqual({ iso: '2026-06-30T21:00:00.000Z', offsetMinutes: 600, status: 'ok' });
    expect(zonedToInstant('2026-12-01', '07:00', SYD)).toEqual({ iso: '2026-11-30T20:00:00.000Z', offsetMinutes: 660, status: 'ok' });
  });

  it('flags a time skipped when clocks go forward (4 Oct 2026, 2:00→3:00)', () => {
    const r = zonedToInstant('2026-10-04', '02:30', SYD);
    expect(r.status).toBe('gap');
    expect(instantToZoned(r.iso, SYD)).toEqual({ date: '2026-10-04', time: '03:30' });
  });

  it('flags a repeated time when clocks go back (5 Apr 2026, 3:00→2:00) and picks the earlier', () => {
    const r = zonedToInstant('2026-04-05', '02:30', SYD);
    expect(r.status).toBe('ambiguous');
    expect(r.iso).toBe('2026-04-04T15:30:00.000Z');
    expect(r.offsetMinutes).toBe(660);
  });

  it('round-trips wall time across DST change days', () => {
    for (const d of ['2026-04-04', '2026-04-05', '2026-04-06', '2026-10-03', '2026-10-04', '2026-10-05']) {
      for (const t of ['00:00', '06:45', '12:00', '23:59']) {
        expect(instantToZoned(zonedToInstant(d, t, SYD).iso, SYD)).toEqual({ date: d, time: t });
      }
    }
  });

  it('calendar arithmetic is unaffected by DST', () => {
    expect(addDays('2026-10-03', 1)).toBe('2026-10-04');
    expect(addDays('2026-10-04', 1)).toBe('2026-10-05');
    expect(daysBetween('2026-04-01', '2026-04-10')).toBe(9);
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });

  it('groups by the selected time zone, not UTC', () => {
    // 22:30 UTC on 31 Oct is 9:30 am on 1 Nov in Sydney
    expect(localDateOf('2026-10-31T22:30:00.000Z', SYD)).toBe('2026-11-01');
    expect(localDateOf('2026-10-31T22:30:00.000Z', 'Australia/Perth')).toBe('2026-11-01');
    expect(localDateOf('2026-10-31T15:30:00.000Z', 'Australia/Perth')).toBe('2026-10-31');
    expect(todayIn(SYD, new Date('2026-10-31T13:30:00Z'))).toBe('2026-11-01');
  });

  it('reports offsets', () => {
    expect(offsetMinutesAt('2026-07-01T00:00:00Z', SYD)).toBe(600);
    expect(offsetMinutesAt('2026-01-01T00:00:00Z', SYD)).toBe(660);
    expect(offsetMinutesAt('2026-01-01T00:00:00Z', 'Australia/Brisbane')).toBe(600);
  });

  it('week starts on Monday', () => {
    expect(weekStart('2026-11-01')).toBe('2026-10-26'); // Sunday
    expect(weekStart('2026-11-02')).toBe('2026-11-02'); // Monday
  });
});
