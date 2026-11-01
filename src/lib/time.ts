// Time-zone aware helpers built on Intl (no external date library).
// Calendar dates (YYYY-MM-DD) are handled as pure calendar values; instants are
// converted to/from wall-clock time in an explicit IANA time zone so daylight
// saving transitions are handled correctly.

import type { ISODate, ISOInstant } from '../types';

const dtfCache = new Map<string, Intl.DateTimeFormat>();
function partsFormatter(timeZone: string): Intl.DateTimeFormat {
  let f = dtfCache.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    dtfCache.set(timeZone, f);
  }
  return f;
}

export function deviceTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

interface WallParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function wallParts(ms: number, timeZone: string): WallParts {
  const out: Record<string, number> = {};
  for (const p of partsFormatter(timeZone).formatToParts(new Date(ms))) {
    if (p.type !== 'literal') out[p.type] = Number(p.value);
  }
  return {
    year: out.year,
    month: out.month,
    day: out.day,
    hour: out.hour === 24 ? 0 : out.hour,
    minute: out.minute,
    second: out.second,
  };
}

/** UTC offset in minutes (e.g. +600 for AEST) at the given instant. */
export function offsetMinutesAt(instant: Date | number | string, timeZone: string): number {
  const ms = typeof instant === 'number' ? instant : new Date(instant).getTime();
  const p = wallParts(ms, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  const msFloor = Math.floor(ms / 1000) * 1000;
  return Math.round((asUtc - msFloor) / 60000);
}

export interface ZonedResult {
  iso: ISOInstant;
  offsetMinutes: number;
  /** ok = unique; ambiguous = repeated hour when clocks go back (earlier
   * instant chosen); gap = time skipped when clocks go forward. */
  status: 'ok' | 'ambiguous' | 'gap';
}

function pad(n: number, w = 2): string {
  return String(n).padStart(w, '0');
}

export function parseDate(d: ISODate): [number, number, number] {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d);
  if (!m) throw new Error(`Invalid date: ${d}`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

export function isValidDate(d: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return false;
  const [y, m, day] = parseDate(d);
  const t = new Date(Date.UTC(y, m - 1, day));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === day;
}

export function isValidTime(t: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(t);
}

/** Convert a wall-clock date + time in a time zone to a UTC instant. */
export function zonedToInstant(date: ISODate, time: string, timeZone: string): ZonedResult {
  const [y, mo, d] = parseDate(date);
  const [hh, mm] = time.split(':').map(Number);
  const naive = Date.UTC(y, mo - 1, d, hh, mm);
  const offsets = new Set<number>([
    offsetMinutesAt(naive - 36 * 3600_000, timeZone),
    offsetMinutesAt(naive, timeZone),
    offsetMinutesAt(naive + 36 * 3600_000, timeZone),
  ]);
  const matches: number[] = [];
  for (const off of offsets) {
    const candidate = naive - off * 60000;
    const p = wallParts(candidate, timeZone);
    if (p.year === y && p.month === mo && p.day === d && p.hour === hh && p.minute === mm) {
      if (!matches.includes(candidate)) matches.push(candidate);
    }
  }
  matches.sort((a, b) => a - b);
  if (matches.length >= 1) {
    const ms = matches[0];
    return {
      iso: new Date(ms).toISOString(),
      offsetMinutes: offsetMinutesAt(ms, timeZone),
      status: matches.length > 1 ? 'ambiguous' : 'ok',
    };
  }
  // Gap: interpret using the offset before the transition (moves time forward).
  const before = offsetMinutesAt(naive - 36 * 3600_000, timeZone);
  const ms = naive - before * 60000;
  return { iso: new Date(ms).toISOString(), offsetMinutes: offsetMinutesAt(ms, timeZone), status: 'gap' };
}

/** Wall-clock date and time of an instant in a time zone. */
export function instantToZoned(iso: ISOInstant, timeZone: string): { date: ISODate; time: string } {
  const p = wallParts(new Date(iso).getTime(), timeZone);
  return { date: `${p.year}-${pad(p.month)}-${pad(p.day)}`, time: `${pad(p.hour)}:${pad(p.minute)}` };
}

export function localDateOf(iso: ISOInstant, timeZone: string): ISODate {
  return instantToZoned(iso, timeZone).date;
}

export function todayIn(timeZone: string, now: Date = new Date()): ISODate {
  return localDateOf(now.toISOString(), timeZone);
}

export function nowTimeIn(timeZone: string, now: Date = new Date()): string {
  return instantToZoned(now.toISOString(), timeZone).time;
}

/** Pure calendar arithmetic (unaffected by DST). */
export function addDays(date: ISODate, n: number): ISODate {
  const [y, m, d] = parseDate(date);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

export function daysBetween(from: ISODate, to: ISODate): number {
  const [y1, m1, d1] = parseDate(from);
  const [y2, m2, d2] = parseDate(to);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400_000);
}

export function dateRange(from: ISODate, to: ISODate): ISODate[] {
  const out: ISODate[] = [];
  const n = daysBetween(from, to);
  for (let i = 0; i <= n; i++) out.push(addDays(from, i));
  return out;
}

/** 0 = Sunday. */
export function weekday(date: ISODate): number {
  const [y, m, d] = parseDate(date);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** Monday of the week containing date. */
export function weekStart(date: ISODate): ISODate {
  const wd = weekday(date);
  return addDays(date, wd === 0 ? -6 : 1 - wd);
}

export function dateToDayNumber(date: ISODate): number {
  const [y, m, d] = parseDate(date);
  return Date.UTC(y, m - 1, d) / 86400_000;
}

export function dayNumberToDate(n: number): ISODate {
  const t = new Date(n * 86400_000);
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

const longDate = new Intl.DateTimeFormat('en-AU', {
  timeZone: 'UTC',
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});
const shortDate = new Intl.DateTimeFormat('en-AU', {
  timeZone: 'UTC',
  weekday: 'short',
  day: 'numeric',
  month: 'short',
});
const tinyDate = new Intl.DateTimeFormat('en-AU', { timeZone: 'UTC', day: 'numeric', month: 'short' });

function dateObj(date: ISODate): Date {
  const [y, m, d] = parseDate(date);
  return new Date(Date.UTC(y, m - 1, d, 12));
}

export function formatDateLong(date: ISODate): string {
  return longDate.format(dateObj(date));
}
export function formatDateShort(date: ISODate): string {
  return shortDate.format(dateObj(date));
}
export function formatDateTiny(date: ISODate): string {
  return tinyDate.format(dateObj(date));
}

export function formatOffset(minutes: number): string {
  const sign = minutes >= 0 ? '+' : '-';
  const a = Math.abs(minutes);
  return `UTC${sign}${pad(Math.floor(a / 60))}:${pad(a % 60)}`;
}

/** e.g. "7:32 am". Adds the zone if it differs from the display zone. */
export function formatTime(iso: ISOInstant, timeZone: string, displayZone?: string): string {
  const { time } = instantToZoned(iso, timeZone);
  const [h, m] = time.split(':').map(Number);
  const h12 = h % 12 === 0 ? 12 : h % 12;
  const s = `${h12}:${pad(m)} ${h < 12 ? 'am' : 'pm'}`;
  if (displayZone && displayZone !== timeZone) return `${s} (${timeZone})`;
  return s;
}

export function formatClock(time: string | null): string {
  if (!time) return '—';
  const [h, m] = time.split(':').map(Number);
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${pad(m)} ${h < 12 ? 'am' : 'pm'}`;
}

export function minutesBetween(a: ISOInstant, b: ISOInstant): number {
  return Math.round((new Date(b).getTime() - new Date(a).getTime()) / 60000);
}

export function formatDuration(minutes: number): string {
  const neg = minutes < 0;
  const a = Math.abs(minutes);
  const h = Math.floor(a / 60);
  const m = a % 60;
  const s = h > 0 ? `${h} h ${m} min` : `${m} min`;
  return neg ? `−${s}` : s;
}

export function nowIso(): ISOInstant {
  return new Date().toISOString();
}

export function listTimeZones(): string[] {
  const anyIntl = Intl as unknown as { supportedValuesOf?: (k: string) => string[] };
  try {
    if (anyIntl.supportedValuesOf) return anyIntl.supportedValuesOf('timeZone');
  } catch {
    /* ignore */
  }
  return ['Australia/Sydney', 'Australia/Melbourne', 'Australia/Brisbane', 'Australia/Adelaide',
    'Australia/Darwin', 'Australia/Perth', 'Australia/Hobart', 'UTC'];
}
