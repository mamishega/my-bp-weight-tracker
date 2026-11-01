import type { ISODate, WeightEntry, WeightUnit } from '../types';
import { addDays } from './time';

export const KG_PER_LB = 0.45359237;

export function toKg(value: number, unit: WeightUnit): number {
  return unit === 'kg' ? value : value * KG_PER_LB;
}
export function fromKg(kg: number, unit: WeightUnit): number {
  return unit === 'kg' ? kg : kg / KG_PER_LB;
}
export function fmtWeight(kg: number | null | undefined, unit: WeightUnit): string {
  if (kg == null || Number.isNaN(kg)) return '—';
  return `${fromKg(kg, unit).toFixed(1)} ${unit}`;
}

/** Mean weight per calendar day (multiple weigh-ins on a day are averaged). */
export function dailyWeights(entries: WeightEntry[]): { date: ISODate; kg: number; n: number }[] {
  const by = new Map<ISODate, number[]>();
  for (const e of entries) by.set(e.date, [...(by.get(e.date) ?? []), e.kg]);
  return [...by.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, xs]) => ({ date, kg: xs.reduce((a, b) => a + b, 0) / xs.length, n: xs.length }));
}

export interface MovingAveragePoint {
  date: ISODate;
  kg: number;
  avgKg: number;
  /** Number of days with a measurement contributing to the average. */
  daysContributing: number;
}

/**
 * Seven-day moving average over the calendar window [date-6, date], using only
 * days that have a measurement. Missing days are skipped, never treated as zero.
 */
export function movingAverage7(entries: WeightEntry[]): MovingAveragePoint[] {
  const daily = dailyWeights(entries);
  return daily.map((d) => {
    const from = addDays(d.date, -6);
    const win = daily.filter((x) => x.date >= from && x.date <= d.date);
    return { date: d.date, kg: d.kg, avgKg: win.reduce((a, x) => a + x.kg, 0) / win.length, daysContributing: win.length };
  });
}

export interface WeightProgress {
  startKg: number | null;
  currentKg: number | null;
  currentDate: ISODate | null;
  goalKg: number | null;
  changeSinceStart: number | null;
  remainingToGoal: number | null;
}

export function weightProgress(entries: WeightEntry[], startKg: number | null, goalKg: number | null): WeightProgress {
  const sorted = [...entries].sort((a, b) => (a.date + (a.measuredAt ?? '')).localeCompare(b.date + (b.measuredAt ?? '')));
  const last = sorted[sorted.length - 1];
  const currentKg = last?.kg ?? null;
  return {
    startKg,
    currentKg,
    currentDate: last?.date ?? null,
    goalKg,
    changeSinceStart: currentKg != null && startKg != null ? currentKg - startKg : null,
    remainingToGoal: currentKg != null && goalKg != null ? goalKg - currentKg : null,
  };
}

/** Neutral wording for a signed change. */
export function describeChange(deltaKg: number | null, unit: WeightUnit): string {
  if (deltaKg == null) return '—';
  const v = Math.abs(fromKg(deltaKg, unit));
  if (v < 0.05) return `No change`;
  return `${deltaKg < 0 ? 'Down' : 'Up'} ${v.toFixed(1)} ${unit}`;
}
