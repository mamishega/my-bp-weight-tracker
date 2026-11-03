import type { Habit } from '../types';

export const WALK_MIN = 5;
export const WALK_MAX = 240;
export const walkName = (m: number) => `Walk for ${m} minutes`;

/** Minutes in a walking-goal name such as “Walk for 20 minutes”, else null. */
export function walkMinutesFromName(name: string): number | null {
  const m = /^walk for (\d+) min(ute)?s?$/i.exec(name.trim());
  return m ? Number(m[1]) : null;
}

/** The walking goal's length, if this habit is one (also recognises older habits by name). */
export function walkMinutes(h: Habit): number | null {
  if (typeof h.minutes === 'number' && Number.isFinite(h.minutes) && h.minutes > 0) return h.minutes;
  return walkMinutesFromName(h.name);
}
