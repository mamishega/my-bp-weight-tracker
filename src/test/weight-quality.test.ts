import { describe, it, expect } from 'vitest';
import { movingAverage7, toKg, fromKg, weightProgress } from '../lib/weight';
import { findDuplicateSessions, findDuplicateWeights, sessionFlags } from '../lib/quality';
import type { WeightEntry } from '../types';
import { mkSession } from './bp.test';

const w = (date: string, kg: number, id = date + kg): WeightEntry => ({ id, date, measuredAt: null, timeZone: 'UTC', utcOffsetMinutes: null, kg, enteredValue: kg, enteredUnit: 'kg', notes: '', createdAt: '', updatedAt: '' });

describe('weight', () => {
  it('moving average skips missing days instead of using zero', () => {
    const ma = movingAverage7([w('2026-11-01', 90), w('2026-11-04', 88), w('2026-11-07', 86)]);
    expect(ma[2]).toMatchObject({ date: '2026-11-07', avgKg: 88, daysContributing: 3 });
  });
  it('window is the previous 7 calendar days', () => {
    const ma = movingAverage7([w('2026-11-01', 90), w('2026-11-08', 86)]);
    expect(ma[1]).toMatchObject({ avgKg: 86, daysContributing: 1 });
  });
  it('averages multiple weigh-ins on the same day before the window', () => {
    const ma = movingAverage7([w('2026-11-01', 90, 'a'), w('2026-11-01', 88, 'b'), w('2026-11-02', 86)]);
    expect(ma[1]).toMatchObject({ avgKg: 87.5, daysContributing: 2 });
  });
  it('converts pounds exactly', () => {
    expect(toKg(200, 'lb')).toBeCloseTo(90.718474, 5);
    expect(fromKg(toKg(171.3, 'lb'), 'lb')).toBeCloseTo(171.3, 9);
  });
  it('progress towards goal', () => {
    const p = weightProgress([w('2026-11-01', 90), w('2026-11-05', 88.5)], 92, 85);
    expect(p.changeSinceStart).toBeCloseTo(-3.5);
    expect(p.remainingToGoal).toBeCloseTo(-3.5);
  });
});

describe('duplicates and quality flags', () => {
  it('detects possible duplicate sessions without deleting', () => {
    const a = mkSession({ id: 'a', readings: [[140, 90], [138, 88]], measuredAt: '2026-11-01T20:00:00.000Z' });
    const b = mkSession({ id: 'b', readings: [[140, 90]], measuredAt: '2026-11-01T20:05:00.000Z' });
    const c = mkSession({ id: 'c', readings: [[140, 90]], measuredAt: '2026-11-01T22:00:00.000Z' });
    const all = [a, b, c];
    const d = findDuplicateSessions(all);
    expect(d.get('a')).toEqual(['b']);
    expect(d.has('c')).toBe(false);
    expect(all).toHaveLength(3);
    expect(sessionFlags(a, all, [])).toContain('possible_duplicate');
  });
  it('different session types are never duplicates', () => {
    const a = mkSession({ id: 'a', sessionType: 'morning_pre', readings: [[140, 90]] });
    const b = mkSession({ id: 'b', sessionType: 'morning_post', readings: [[140, 90]] });
    expect(findDuplicateSessions([a, b]).size).toBe(0);
  });
  it('labels single vs two reading sessions and unusual conditions', () => {
    const s1 = mkSession({ readings: [[130, 80]], conditionFlags: ['recent_caffeine'] });
    const s2 = mkSession({ readings: [[130, 80], [128, 79]], measuredAt: '2026-11-02T09:00:00.000Z' });
    expect(sessionFlags(s1, [s1], [])).toEqual(expect.arrayContaining(['single_reading', 'unusual_conditions']));
    expect(sessionFlags(s2, [s2], [])).toContain('two_readings');
  });
  it('marks additional sessions of the same type on the same day', () => {
    const a = mkSession({ id: 'a', sessionType: 'morning_post', readings: [[130, 80]], measuredAt: '2026-11-01T22:00:00.000Z' });
    const b = mkSession({ id: 'b', sessionType: 'morning_post', readings: [[125, 78]], measuredAt: '2026-11-02T00:00:00.000Z' });
    expect(sessionFlags(a, [a, b], [])).not.toContain('additional_session');
    expect(sessionFlags(b, [a, b], [])).toContain('additional_session');
  });
  it('finds duplicate weights', () => {
    expect(findDuplicateWeights([w('2026-11-01', 90, 'x'), w('2026-11-01', 90, 'y')]).size).toBe(2);
  });
});
