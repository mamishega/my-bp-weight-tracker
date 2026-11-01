import { describe, it, expect } from 'vitest';
import { sessionAverage, validateReading, statsFor, prePostComparison, fmt } from '../lib/bp';
import type { BPSession } from '../types';

export function mkSession(p: Omit<Partial<BPSession>, 'readings'> & { readings: [number, number, number?][] }): BPSession {
  const at = p.measuredAt ?? '2026-11-01T20:00:00.000Z';
  return {
    id: p.id ?? Math.random().toString(36).slice(2), sessionType: p.sessionType ?? 'morning_pre', date: p.date ?? '2026-11-02', measuredAt: at,
    timeZone: 'Australia/Sydney', utcOffsetMinutes: 660,
    readings: p.readings.map(([s, d, pu], i) => ({ systolic: s, diastolic: d, pulse: pu ?? null, measuredAt: new Date(new Date(at).getTime() + i * 60000).toISOString() })),
    arm: null, monitorId: null, monitorLabel: null, conditionFlags: p.conditionFlags ?? [], symptoms: '', notes: '', linkedDoseIds: p.linkedDoseIds ?? [], unusualConfirmed: false,
    createdAt: at, updatedAt: at,
  } as BPSession;
}

describe('session averages', () => {
  it('averages two readings and keeps originals', () => {
    const s = mkSession({ readings: [[141, 90, 70], [136, 87, 66]] });
    const a = sessionAverage(s);
    expect(a.systolic).toBe(138.5);
    expect(a.diastolic).toBe(88.5);
    expect(a.pulse).toBe(68);
    expect(a.n).toBe(2);
    expect(s.readings[0].systolic).toBe(141);
    expect(fmt(a.systolic)).toBe('138.5');
  });
  it('single reading average equals the reading; pulse optional', () => {
    const a = sessionAverage(mkSession({ readings: [[130, 80]] }));
    expect(a).toMatchObject({ systolic: 130, diastolic: 80, pulse: null, n: 1 });
  });
  it('averages pulse only over readings that have one', () => {
    expect(sessionAverage(mkSession({ readings: [[130, 80, 60], [130, 80]] })).pulse).toBe(60);
  });
  it('recomputes after an edit', () => {
    const s = mkSession({ readings: [[150, 95], [140, 90]] });
    expect(sessionAverage(s).systolic).toBe(145);
    s.readings[1] = { ...s.readings[1], systolic: 130 };
    expect(sessionAverage(s).systolic).toBe(140);
  });
});

describe('validation never changes or rejects high values', () => {
  it('requires numbers', () => {
    const r = validateReading({ systolic: '', diastolic: 'abc', pulse: '' }, 'r0');
    expect(r.value).toBeNull();
    expect(r.issues.filter((i) => i.level === 'error')).toHaveLength(2);
  });
  it('asks to check very high values but allows them', () => {
    const r = validateReading({ systolic: '245', diastolic: '145', pulse: '' }, 'r0');
    expect(r.value).toEqual({ systolic: 245, diastolic: 145, pulse: null });
    expect(r.issues.every((i) => i.level === 'check')).toBe(true);
    expect(r.issues.length).toBeGreaterThan(0);
  });
  it('flags swapped values for checking without swapping them', () => {
    const r = validateReading({ systolic: '80', diastolic: '120', pulse: '' }, 'r0');
    expect(r.value).toEqual({ systolic: 80, diastolic: 120, pulse: null });
    expect(r.issues.some((i) => i.message.includes('swapped'))).toBe(true);
  });
  it('normal values have no issues', () => {
    expect(validateReading({ systolic: '128', diastolic: '82', pulse: '64' }, 'r0').issues).toEqual([]);
  });
});

describe('summary statistics keep session types separate', () => {
  const sessions = [
    mkSession({ sessionType: 'morning_pre', readings: [[150, 90], [146, 88]], date: '2026-11-01' }),
    mkSession({ sessionType: 'morning_pre', readings: [[140, 80]], date: '2026-11-02' }),
    mkSession({ sessionType: 'morning_post', readings: [[120, 70], [118, 72]], date: '2026-11-01' }),
    mkSession({ sessionType: 'morning_post', readings: [[110, 70], [110, 70]], date: '2026-11-01', measuredAt: '2026-11-01T23:00:00.000Z' }),
    mkSession({ sessionType: 'evening', readings: [[135, 85], [133, 83]], date: '2026-11-01' }),
  ];
  it('averages session averages with equal weight per session', () => {
    const pre = statsFor(sessions, 'morning_pre');
    expect(pre.sessions).toBe(2);
    expect(pre.readings).toBe(3);
    expect(pre.singleReadingSessions).toBe(1);
    expect(pre.meanSystolic).toBe((148 + 140) / 2);
  });
  it('additional after-medication sessions do not leak into other types', () => {
    expect(statsFor(sessions, 'morning_post').sessions).toBe(2);
    expect(statsFor(sessions, 'evening').sessions).toBe(1);
    expect(statsFor(sessions, 'evening').meanSystolic).toBe(134);
  });
  it('empty data gives null, never zero', () => {
    expect(statsFor([], 'evening').meanSystolic).toBeNull();
  });
  it('before/after comparison uses only days with both sessions', () => {
    const c = prePostComparison(sessions);
    expect(c.days).toHaveLength(1);
    expect(c.days[0].date).toBe('2026-11-01');
    expect(c.meanDiffSys).toBe(119 - 148);
  });
});
