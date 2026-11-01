import { describe, it, expect } from 'vitest';
import { currentWeek, lastFinishedWeek, weekEnd, weekProgress } from '../lib/week';
import { normaliseSettings } from '../lib/defaults';
import type { BPSession, MeasurementWeek } from '../types';

const week: MeasurementWeek = { id: 'w', startDate: '2026-11-02', days: 7, createdAt: '' };
function s(date: string, type: BPSession['sessionType'], readings = 2, at = `${date}T08:00:00.000Z`): BPSession {
  return { id: `${date}-${type}-${at}`, sessionType: type, date, measuredAt: at, timeZone: 'UTC', utcOffsetMinutes: 0,
    readings: Array.from({ length: readings }, () => ({ systolic: 130, diastolic: 80, pulse: null, measuredAt: at })),
    arm: null, monitorId: null, monitorLabel: null, conditionFlags: [], symptoms: '', notes: '', linkedDoseIds: [], unusualConfirmed: false, createdAt: at, updatedAt: at };
}

describe('measurement week', () => {
  it('counts complete days (morning before medication + evening) and two-reading sessions', () => {
    const sessions = [
      s('2026-11-02', 'morning_pre'), s('2026-11-02', 'evening'),
      s('2026-11-03', 'morning_pre', 1), s('2026-11-03', 'evening'),
      s('2026-11-04', 'morning_post'), s('2026-11-04', 'evening'), // after-medication doesn't count as the morning reading
      s('2026-11-10', 'morning_pre'), // outside the week
    ];
    const p = weekProgress(sessions, week, '2026-11-04');
    expect(weekEnd(week)).toBe('2026-11-08');
    expect(p.days).toHaveLength(7);
    expect(p.completeDays).toBe(2);
    expect(p.sessions).toBe(5);
    expect(p.twoReadingSessions).toBe(4);
    expect(p.dayNumber).toBe(3);
    expect(p.finished).toBe(false);
  });

  it('uses the first session of each type on a day', () => {
    const p = weekProgress([s('2026-11-02', 'morning_pre', 2, '2026-11-02T09:00:00.000Z'), s('2026-11-02', 'morning_pre', 1, '2026-11-02T07:00:00.000Z')], week, '2026-11-02');
    expect(p.days[0].morning?.measuredAt).toBe('2026-11-02T07:00:00.000Z');
  });

  it('knows the current, upcoming and finished weeks', () => {
    expect(weekProgress([], week, '2026-11-01').dayNumber).toBe(0);
    expect(weekProgress([], week, '2026-11-09')).toMatchObject({ dayNumber: null, finished: true });
    expect(currentWeek([week], '2026-11-08')).toBe(week);
    expect(currentWeek([week], '2026-11-09')).toBeNull();
    expect(lastFinishedWeek([week], '2026-11-09')).toBe(week);
  });

  it('older settings without weeks, and damaged entries, are handled', () => {
    expect(normaliseSettings({}).measurementWeeks).toEqual([]);
    expect(normaliseSettings({ measurementWeeks: [{ id: 'x', startDate: 'bad', days: 7, createdAt: '' }, { id: 'y', startDate: '2026-11-02', days: 99, createdAt: '' }] }).measurementWeeks).toEqual([{ id: 'y', startDate: '2026-11-02', days: 7, createdAt: '' }]);
  });
});
