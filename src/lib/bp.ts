import type { BPReading, BPSession, ConditionFlag, SessionType, Settings } from '../types';

export const SESSION_LABEL: Record<SessionType, string> = {
  morning_pre: 'Morning — before medication',
  morning_post: 'Morning — after medication',
  evening: 'Evening',
};

export const SESSION_SHORT: Record<SessionType, string> = {
  morning_pre: 'Before meds',
  morning_post: 'After meds',
  evening: 'Evening',
};

/** Categorical colours (validated reference palette slots 1–3) plus a symbol
 * so session identity never relies on colour alone. */
export const SESSION_STYLE: Record<SessionType, { color: string; shape: 'circle' | 'triangle' | 'square'; symbol: string }> = {
  morning_pre: { color: '#2a78d6', shape: 'circle', symbol: '●' },
  morning_post: { color: '#eb6834', shape: 'triangle', symbol: '▲' },
  evening: { color: '#1baf7a', shape: 'square', symbol: '■' },
};

export const CONDITION_LABEL: Record<ConditionFlag, string> = {
  insufficient_rest: 'Less than 5 minutes rest',
  recent_caffeine: 'Caffeine in previous 30 min',
  recent_smoking: 'Smoking in previous 30 min',
  recent_exercise: 'Recent exercise',
  talking: 'Talking during measurement',
  different_device: 'Different device than usual',
  different_arm: 'Different arm than usual',
  cuff_issue: 'Cuff fit or placement issue',
  pain_or_stress: 'In pain, uncomfortable or stressed',
  full_bladder: 'Full bladder',
};

export interface SessionAverage {
  systolic: number;
  diastolic: number;
  pulse: number | null;
  /** Number of readings averaged. */
  n: number;
  /** Number of readings with a pulse value. */
  pulseN: number;
}

/** Arithmetic mean of the original readings in a session. Originals are not modified. */
export function sessionAverage(s: Pick<BPSession, 'readings'>): SessionAverage {
  const n = s.readings.length;
  if (n === 0) return { systolic: NaN, diastolic: NaN, pulse: null, n: 0, pulseN: 0 };
  const sys = s.readings.reduce((a, r) => a + r.systolic, 0) / n;
  const dia = s.readings.reduce((a, r) => a + r.diastolic, 0) / n;
  const pulses = s.readings.map((r) => r.pulse).filter((p): p is number => p != null);
  return {
    systolic: sys,
    diastolic: dia,
    pulse: pulses.length ? pulses.reduce((a, b) => a + b, 0) / pulses.length : null,
    n,
    pulseN: pulses.length,
  };
}

/** Display a number with at most one decimal place, never hiding .5 values. */
export function fmt(n: number | null | undefined, digits = 1): string {
  if (n == null || Number.isNaN(n)) return '—';
  const r = Math.round(n * 10 ** digits) / 10 ** digits;
  return Number.isInteger(r) ? String(r) : r.toFixed(digits);
}

export function fmtBP(sys: number, dia: number): string {
  return `${fmt(sys)}/${fmt(dia)}`;
}

export function readingKindLabel(s: Pick<BPSession, 'readings'>): string {
  return s.readings.length >= 2 ? 'Two-reading session' : 'Single-reading session';
}

export type IssueLevel = 'error' | 'check';
export interface FieldIssue {
  field: string;
  level: IssueLevel;
  message: string;
}

export interface RawReadingInput {
  systolic: string;
  diastolic: string;
  pulse: string;
}

function parseNum(s: string): number | null {
  const t = s.trim();
  if (t === '') return null;
  if (!/^-?\d+(\.\d+)?$/.test(t)) return NaN;
  return Number(t);
}

/**
 * Validate a reading as typed. Values are never changed. "error" issues must be
 * corrected; "check" issues ask the user to confirm, and may then be saved.
 * High readings are never rejected.
 */
export function validateReading(input: RawReadingInput, prefix: string): { issues: FieldIssue[]; value: Omit<BPReading, 'measuredAt'> | null } {
  const issues: FieldIssue[] = [];
  const sys = parseNum(input.systolic);
  const dia = parseNum(input.diastolic);
  const pulse = parseNum(input.pulse);

  const need = (v: number | null, field: string, name: string) => {
    if (v === null) issues.push({ field: `${prefix}.${field}`, level: 'error', message: `Enter the ${name} value.` });
    else if (Number.isNaN(v)) issues.push({ field: `${prefix}.${field}`, level: 'error', message: `${name[0].toUpperCase() + name.slice(1)} must be a number, e.g. 128.` });
    else if (v <= 0) issues.push({ field: `${prefix}.${field}`, level: 'error', message: `${name[0].toUpperCase() + name.slice(1)} must be greater than zero.` });
  };
  need(sys, 'systolic', 'systolic (top number)');
  need(dia, 'diastolic', 'diastolic (bottom number)');
  if (pulse !== null && (Number.isNaN(pulse) || pulse <= 0)) {
    issues.push({ field: `${prefix}.pulse`, level: 'error', message: 'Pulse must be a number greater than zero, or leave it blank.' });
  }
  if (issues.some((i) => i.level === 'error')) return { issues, value: null };

  const s = sys as number;
  const d = dia as number;
  if (!Number.isInteger(s) || !Number.isInteger(d)) {
    issues.push({ field: `${prefix}.systolic`, level: 'check', message: 'Monitors usually show whole numbers. Please check the decimal value is what your monitor shows.' });
  }
  if (s <= d) {
    issues.push({ field: `${prefix}.diastolic`, level: 'check', message: 'The top number is usually higher than the bottom number. Please check they have not been swapped.' });
  }
  if (s < 70 || s > 230) {
    issues.push({ field: `${prefix}.systolic`, level: 'check', message: `A systolic value of ${s} mmHg is unusual. Please check it matches your monitor.` });
  }
  if (d < 40 || d > 140) {
    issues.push({ field: `${prefix}.diastolic`, level: 'check', message: `A diastolic value of ${d} mmHg is unusual. Please check it matches your monitor.` });
  }
  if (pulse != null && (pulse < 35 || pulse > 180)) {
    issues.push({ field: `${prefix}.pulse`, level: 'check', message: `A pulse of ${pulse} beats per minute is unusual. Please check it matches your monitor.` });
  }
  return { issues, value: { systolic: s, diastolic: d, pulse: pulse ?? null } };
}

/** Compare a session against the user's own clinician-provided contact threshold. */
export function aboveContactThreshold(s: Pick<BPSession, 'readings'>, settings: Settings): boolean {
  const t = settings.targets;
  if (t.contactSystolicAbove == null && t.contactDiastolicAbove == null) return false;
  return s.readings.some(
    (r) =>
      (t.contactSystolicAbove != null && r.systolic > t.contactSystolicAbove) ||
      (t.contactDiastolicAbove != null && r.diastolic > t.contactDiastolicAbove),
  );
}

export interface SessionStats {
  sessionType: SessionType;
  sessions: number;
  readings: number;
  singleReadingSessions: number;
  meanSystolic: number | null;
  meanDiastolic: number | null;
  meanPulse: number | null;
  minSystolic: number | null;
  maxSystolic: number | null;
  minDiastolic: number | null;
  maxDiastolic: number | null;
  daysWithSession: number;
}

/**
 * Summary for ONE session type. Each session's average is computed from its
 * original readings, then sessions are averaged with equal weight. Session
 * types are never combined.
 */
export function statsFor(sessions: BPSession[], type: SessionType): SessionStats {
  const list = sessions.filter((s) => s.sessionType === type && s.readings.length > 0);
  const avgs = list.map(sessionAverage);
  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  const pulses = avgs.map((a) => a.pulse).filter((p): p is number => p != null);
  const allReadings = list.flatMap((s) => s.readings);
  return {
    sessionType: type,
    sessions: list.length,
    readings: allReadings.length,
    singleReadingSessions: list.filter((s) => s.readings.length === 1).length,
    meanSystolic: mean(avgs.map((a) => a.systolic)),
    meanDiastolic: mean(avgs.map((a) => a.diastolic)),
    meanPulse: mean(pulses),
    minSystolic: allReadings.length ? Math.min(...allReadings.map((r) => r.systolic)) : null,
    maxSystolic: allReadings.length ? Math.max(...allReadings.map((r) => r.systolic)) : null,
    minDiastolic: allReadings.length ? Math.min(...allReadings.map((r) => r.diastolic)) : null,
    maxDiastolic: allReadings.length ? Math.max(...allReadings.map((r) => r.diastolic)) : null,
    daysWithSession: new Set(list.map((s) => s.date)).size,
  };
}

export interface PrePostDay {
  date: string;
  pre: SessionAverage;
  post: SessionAverage;
  diffSystolic: number;
  diffDiastolic: number;
}

/** Days with both a before- and after-medication session. Uses the first
 * session of each type that day; additional sessions are reported separately. */
export function prePostComparison(sessions: BPSession[]): { days: PrePostDay[]; meanDiffSys: number | null; meanDiffDia: number | null } {
  const byDate = new Map<string, { pre?: BPSession; post?: BPSession }>();
  const sorted = [...sessions].sort((a, b) => a.measuredAt.localeCompare(b.measuredAt));
  for (const s of sorted) {
    if (s.sessionType === 'evening' || s.readings.length === 0) continue;
    const e = byDate.get(s.date) ?? {};
    if (s.sessionType === 'morning_pre' && !e.pre) e.pre = s;
    if (s.sessionType === 'morning_post' && !e.post) e.post = s;
    byDate.set(s.date, e);
  }
  const days: PrePostDay[] = [];
  for (const [date, e] of [...byDate.entries()].sort()) {
    if (!e.pre || !e.post) continue;
    const pre = sessionAverage(e.pre);
    const post = sessionAverage(e.post);
    days.push({ date, pre, post, diffSystolic: post.systolic - pre.systolic, diffDiastolic: post.diastolic - pre.diastolic });
  }
  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  return { days, meanDiffSys: mean(days.map((d) => d.diffSystolic)), meanDiffDia: mean(days.map((d) => d.diffDiastolic)) };
}
