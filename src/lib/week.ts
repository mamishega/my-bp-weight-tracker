// Guided home measurement week. Follows the routine in the app's verified
// guidance (healthdirect): two readings one minute apart, morning (before
// medicine) and evening, at about the same times for 7 days, at least 5.
// The summary reports what was recorded; it does not interpret the numbers.
import type { BPSession, ISODate, MeasurementWeek } from '../types';
import { addDays, dateRange } from './time';

export const WEEK_DAYS = 7;
export const MIN_COMPLETE_DAYS = 5;

export interface WeekDay {
  date: ISODate;
  morning: BPSession | null;
  evening: BPSession | null;
}

export interface WeekProgress {
  week: MeasurementWeek;
  endDate: ISODate;
  days: WeekDay[];
  /** Days with both a morning (before medication) and an evening session. */
  completeDays: number;
  /** Sessions with two readings (the recommended routine). */
  twoReadingSessions: number;
  sessions: number;
  /** 1–7 while running; 0 = not started; null = finished. */
  dayNumber: number | null;
  finished: boolean;
}

export function weekEnd(w: Pick<MeasurementWeek, 'startDate' | 'days'>): ISODate {
  return addDays(w.startDate, w.days - 1);
}

export function weekProgress(sessions: BPSession[], w: MeasurementWeek, today: ISODate): WeekProgress {
  const endDate = weekEnd(w);
  const first = (date: ISODate, type: BPSession['sessionType']) =>
    sessions.filter((s) => s.date === date && s.sessionType === type && s.readings.length > 0).sort((a, b) => a.measuredAt.localeCompare(b.measuredAt))[0] ?? null;
  const days = dateRange(w.startDate, endDate).map((date) => ({ date, morning: first(date, 'morning_pre'), evening: first(date, 'evening') }));
  const used = days.flatMap((d) => [d.morning, d.evening]).filter((s): s is BPSession => !!s);
  const dayNumber = today < w.startDate ? 0 : today > endDate ? null : dateRange(w.startDate, today).length;
  return {
    week: w,
    endDate,
    days,
    completeDays: days.filter((d) => d.morning && d.evening).length,
    twoReadingSessions: used.filter((s) => s.readings.length >= 2).length,
    sessions: used.length,
    dayNumber,
    finished: today > endDate,
  };
}

/** The week in progress (or about to start), if any. */
export function currentWeek(weeks: MeasurementWeek[] | undefined, today: ISODate): MeasurementWeek | null {
  return [...(weeks ?? [])].reverse().find((w) => weekEnd(w) >= today) ?? null;
}

/** The most recent finished week, if any. */
export function lastFinishedWeek(weeks: MeasurementWeek[] | undefined, today: ISODate): MeasurementWeek | null {
  return [...(weeks ?? [])].reverse().find((w) => weekEnd(w) < today) ?? null;
}
