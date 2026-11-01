import type { BPSession, DoseRecord, Medication, MedicationVersion, MedFrequency, StockEvent, ISODate } from '../types';
import { formatClock, minutesBetween } from './time';

export const MAX_TIMES_PER_DAY = 6;
type SchedSource = Pick<Medication, 'usualTime' | 'timesPerDay' | 'doseTimes' | 'frequency' | 'endDate'>;
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** A valid frequency (anything damaged or missing = every day). */
export function medFrequency(m: Pick<Medication, 'frequency'>): MedFrequency {
  const f = m.frequency as MedFrequency | undefined;
  if (!f || typeof f !== 'object') return { kind: 'daily' };
  if (f.kind === 'as_needed') return f;
  if (f.kind === 'weekly' && Array.isArray(f.days)) {
    const days = [...new Set(f.days.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort();
    return days.length ? { kind: 'weekly', days } : { kind: 'daily' };
  }
  if (f.kind === 'interval' && Number.isInteger(f.everyDays) && f.everyDays >= 2 && f.everyDays <= 90 && /^\d{4}-\d{2}-\d{2}$/.test(f.startDate ?? '')) return f;
  return { kind: 'daily' };
}

function dayNumber(date: ISODate): number {
  const [y, m, d] = date.split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / 86_400_000);
}

/** Is a dose scheduled on this day? (As-needed medicines never have scheduled doses.) */
export function isDoseDay(m: Pick<Medication, 'frequency' | 'endDate'>, date: ISODate): boolean {
  if (m.endDate && date > m.endDate) return false;
  const f = medFrequency(m);
  if (f.kind === 'daily') return true;
  if (f.kind === 'as_needed') return false;
  if (f.kind === 'weekly') return f.days.includes(new Date(`${date}T12:00:00Z`).getUTCDay());
  const diff = dayNumber(date) - dayNumber(f.startDate);
  return diff >= 0 && diff % f.everyDays === 0;
}

/** Average share of days with doses (for the supply estimate). Null = can't tell (as needed). */
export function doseDayFraction(m: Pick<Medication, 'frequency'>): number | null {
  const f = medFrequency(m);
  return f.kind === 'daily' ? 1 : f.kind === 'weekly' ? f.days.length / 7 : f.kind === 'interval' ? 1 / f.everyDays : null;
}

/** A medication's daily schedule: how many doses and each dose's usual time. Older data = once a day. */
export function medSchedule(m: Pick<Medication, 'usualTime' | 'timesPerDay' | 'doseTimes'>): { perDay: number; times: (string | null)[] } {
  // (Doses on a dose day. Which days are dose days: see isDoseDay.)
  // Tolerate damaged or hand-edited data: anything invalid means once a day.
  const raw = typeof m.timesPerDay === 'number' && Number.isFinite(m.timesPerDay) ? Math.round(m.timesPerDay) : 1;
  const perDay = Math.min(MAX_TIMES_PER_DAY, Math.max(1, raw));
  const valid = (t: unknown): string | null => (typeof t === 'string' && /^\d{2}:\d{2}$/.test(t) ? t : null);
  const src = Array.isArray(m.doseTimes) && m.doseTimes.length ? m.doseTimes : [m.usualTime ?? null];
  const times = Array.from({ length: perDay }, (_, i) => valid(src[i]));
  return { perDay, times };
}

/**
 * The schedule that applied on a given day, from the prescription history, so
 * changing how often a medicine is taken never rewrites earlier days.
 */
export function scheduleOn(med: Medication, date: ISODate): { perDay: number; times: (string | null)[]; doseDay: boolean } {
  const versions = [...(med.history ?? [])].sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
  let src: SchedSource = med;
  if (versions.length) {
    let v: MedicationVersion = versions[0];
    for (const x of versions) if ((x.effectiveDate ?? x.effectiveFrom.slice(0, 10)) <= date) v = x;
    // The newest version is the medicine's current schedule.
    if (v !== versions[versions.length - 1]) src = v;
  }
  return { ...medSchedule(src), doseDay: isDoseDay(src, date) };
}

/** "Mon, Wed, Fri", "Every 3 days", "Only when needed" ("" for every day). */
export function describeFrequency(m: Pick<Medication, 'frequency' | 'endDate'>): string {
  const f = medFrequency(m);
  const base = f.kind === 'weekly' ? f.days.map((d) => DAY_NAMES[d]).join(', ') : f.kind === 'interval' ? `Every ${f.everyDays} days` : f.kind === 'as_needed' ? 'Only when needed' : '';
  const end = m.endDate ? `until ${new Date(`${m.endDate}T12:00:00Z`).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })}` : '';
  return [base, end].filter(Boolean).join(' · ');
}

/** "Once a day at 7:30 am" / "2 times a day: 8:00 am, 8:00 pm". */
export function describeSchedule(m: Partial<SchedSource> & Pick<Medication, 'usualTime'>): string {
  const f = medFrequency(m);
  const freq = describeFrequency(m);
  if (f.kind === 'as_needed') return freq;
  const { perDay, times } = medSchedule(m);
  const set = times.filter(Boolean) as string[];
  const doses = perDay === 1 ? (times[0] ? `${f.kind === 'daily' ? 'Once a day' : 'Once'}, usually ${formatClock(times[0])}` : f.kind === 'daily' ? 'Once a day' : 'Once')
    : `${perDay} times${f.kind === 'daily' ? ' a day' : ''}${set.length ? `: ${times.map((t) => (t ? formatClock(t) : 'no set time')).join(', ')}` : ''}`;
  return freq ? `${freq} · ${doses.charAt(0).toLowerCase()}${doses.slice(1)}` : doses;
}

/** Label for one scheduled dose, e.g. "Dose 2 (8:00 pm)". */
export function doseLabel(m: Pick<Medication, 'usualTime' | 'timesPerDay' | 'doseTimes'>, index: number): string {
  const { perDay, times } = medSchedule(m);
  if (perDay === 1) return times[0] ? `Usual dose (${formatClock(times[0])})` : 'Usual dose';
  return `Dose ${index + 1}${times[index] ? ` (${formatClock(times[index])})` : ''}`;
}

export interface DoseSlot {
  index: number;
  time: string | null;
  record: DoseRecord | null;
}

/**
 * Each scheduled dose of a day with the record that covers it. Records tagged
 * with a dose number fill that slot; untagged records (older data) fill the
 * remaining slots in time order. Extra records are returned separately.
 */
export function daySlots(doses: DoseRecord[], med: Medication, date: ISODate): { slots: DoseSlot[]; extra: DoseRecord[] } {
  const { times, doseDay } = scheduleOn(med, date);
  // No scheduled doses on non-dose days or for "only when needed": any records are extras.
  const slots: DoseSlot[] = doseDay ? times.map((time, index) => ({ index, time, record: null })) : [];
  const list = dosesForDay(doses, med.id, date).sort((a, b) => (a.takenAt ?? a.createdAt).localeCompare(b.takenAt ?? b.createdAt));
  const extra: DoseRecord[] = [];
  const untagged: DoseRecord[] = [];
  for (const d of list) {
    const i = d.doseIndex;
    if (i != null && i >= 0 && i < slots.length && !slots[i].record) slots[i].record = d;
    else if (i != null && i >= 0 && i < slots.length) extra.push(d);
    else untagged.push(d);
  }
  for (const d of untagged) {
    const free = slots.find((s) => !s.record);
    if (free) free.record = d;
    else extra.push(d);
  }
  return { slots, extra };
}

/** The first scheduled dose of the day that has no record yet (or null if all are recorded). */
export function nextOpenSlot(doses: DoseRecord[], med: Medication, date: ISODate): number | null {
  return daySlots(doses, med, date).slots.find((s) => !s.record)?.index ?? null;
}

export interface DoseCounts { expected: number; taken: number; skipped: number; notRecorded: number; /** Taken outside the schedule, e.g. "as needed". */ extraTaken: number }

/** Counts over a set of days. Unrecorded doses are "not recorded", never "missed". */
export function doseCounts(doses: DoseRecord[], med: Medication, days: ISODate[]): DoseCounts {
  const out: DoseCounts = { expected: 0, taken: 0, skipped: 0, notRecorded: 0, extraTaken: 0 };
  for (const day of days) {
    const { slots, extra } = daySlots(doses, med, day);
    if (slots.length === 0) out.extraTaken += extra.filter((d) => d.status === 'taken').length;
    out.expected += slots.length;
    for (const s of slots) {
      if (!s.record) out.notRecorded++;
      else if (s.record.status === 'taken') out.taken++;
      else out.skipped++;
    }
  }
  return out;
}

/** Returns the medication version that applied at an instant (history preserved). */
export function versionAt(med: Medication, at: string): MedicationVersion {
  const sorted = [...med.history].sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
  let current = sorted[0];
  for (const v of sorted) if (v.effectiveFrom <= at) current = v;
  return current ?? { effectiveFrom: med.createdAt, name: med.name, dose: med.dose, usualTime: med.usualTime, instructions: med.instructions };
}

/** Applies edits to a medication, appending a history version when prescription details change. */
export function updateMedication(
  med: Medication,
  changes: Partial<Pick<Medication, 'name' | 'dose' | 'usualTime' | 'timesPerDay' | 'doseTimes' | 'frequency' | 'endDate' | 'instructions' | 'active' | 'postDoseReminderMinutes' | 'supply'>>,
  now: string,
  /** The patient's local date, so a schedule change applies from that day. */
  today?: ISODate,
): Medication {
  const next: Medication = { ...med, ...changes, updatedAt: now };
  const a = medSchedule(med);
  const b = medSchedule(next);
  const scheduleChanged = a.perDay !== b.perDay || a.times.join() !== b.times.join() || JSON.stringify(medFrequency(med)) !== JSON.stringify(medFrequency(next)) || (med.endDate ?? null) !== (next.endDate ?? null);
  const prescriptionChanged =
    next.name !== med.name || next.dose !== med.dose || next.usualTime !== med.usualTime || next.instructions !== med.instructions || scheduleChanged;
  if (prescriptionChanged) {
    next.history = [
      ...med.history,
      { effectiveFrom: now, ...(today ? { effectiveDate: today } : {}), name: next.name, dose: next.dose, usualTime: next.usualTime, timesPerDay: b.perDay, doseTimes: b.times, frequency: medFrequency(next), endDate: next.endDate ?? null, instructions: next.instructions },
    ];
  }
  return next;
}

export type DoseTiming =
  | { kind: 'none' }
  | { kind: 'unknown_time'; dose: DoseRecord }
  | { kind: 'not_taken'; dose: DoseRecord }
  | { kind: 'ok'; dose: DoseRecord; minutes: number }
  | { kind: 'before_dose'; dose: DoseRecord; minutes: number };

/** Actual elapsed time between a linked dose and a session's first reading. */
export function doseTiming(session: BPSession, dose: DoseRecord | undefined): DoseTiming {
  if (!dose) return { kind: 'none' };
  if (dose.status !== 'taken') return { kind: 'not_taken', dose };
  if (!dose.takenAt) return { kind: 'unknown_time', dose };
  const minutes = minutesBetween(dose.takenAt, session.measuredAt);
  if (minutes < 0) return { kind: 'before_dose', dose, minutes };
  return { kind: 'ok', dose, minutes };
}

/**
 * Suggested dose links for an after-medication (morning) session: for each
 * medicine, its first dose recorded as taken that day, so a later dose of a
 * medicine taken several times a day is never linked to the morning reading.
 */
export function suggestDoseLinks(date: ISODate, doses: DoseRecord[]): string[] {
  const first = new Map<string, DoseRecord>();
  const at = (d: DoseRecord) => d.takenAt ?? d.createdAt;
  for (const d of doses) {
    if (d.date !== date || d.status !== 'taken') continue;
    const cur = first.get(d.medicationId);
    const better = !cur || (d.doseIndex ?? 99) < (cur.doseIndex ?? 99) || ((d.doseIndex ?? 99) === (cur.doseIndex ?? 99) && at(d) < at(cur));
    if (better) first.set(d.medicationId, d);
  }
  return [...first.values()].map((d) => d.id);
}

export function dosesForDay(doses: DoseRecord[], medId: string, date: ISODate): DoseRecord[] {
  return doses.filter((d) => d.medicationId === medId && d.date === date);
}

export type DayDoseStatus = 'taken' | 'skipped' | 'partial' | 'not_recorded' | 'not_scheduled';

/**
 * Medication status for a day. Absence of a record is "not recorded", never
 * "missed". With several doses a day: "taken" when every dose is recorded as
 * taken, "skipped" when every recorded dose was skipped and all are recorded,
 * otherwise "partial" (some recorded).
 */
export function dayDoseStatus(doses: DoseRecord[], med: Medication | string, date: ISODate): DayDoseStatus {
  if (typeof med === 'string') {
    const list = dosesForDay(doses, med, date);
    if (list.some((d) => d.status === 'taken')) return 'taken';
    if (list.some((d) => d.status === 'skipped')) return 'skipped';
    return 'not_recorded';
  }
  const { slots, extra } = daySlots(doses, med, date);
  if (slots.length === 0) {
    // Nothing scheduled (not a dose day, or only when needed): show only what was recorded.
    if (extra.some((d) => d.status === 'taken')) return 'taken';
    return extra.length ? 'skipped' : 'not_scheduled';
  }
  const recorded = slots.filter((s) => s.record);
  if (recorded.length === 0) return 'not_recorded';
  const taken = recorded.filter((s) => s.record!.status === 'taken').length;
  if (taken === slots.length) return 'taken';
  if (recorded.length === slots.length && taken === 0) return 'skipped';
  if (slots.length === 1) return taken ? 'taken' : 'skipped';
  return 'partial';
}

/** "1 of 2 taken" style text for a day (empty for once-a-day medicines). */
export function dayDoseSummary(doses: DoseRecord[], med: Medication, date: ISODate): string {
  const { slots, extra } = daySlots(doses, med, date);
  if (slots.length === 0) {
    const n = extra.filter((d) => d.status === 'taken').length;
    return medFrequency(med).kind === 'as_needed' ? (n ? `taken ${n} time${n === 1 ? '' : 's'}` : 'none recorded') : n ? `taken ${n} time${n === 1 ? '' : 's'} (no dose scheduled)` : 'no dose scheduled';
  }
  if (slots.length === 1) return '';
  const taken = slots.filter((s) => s.record?.status === 'taken').length;
  const skipped = slots.filter((s) => s.record?.status === 'skipped').length;
  return `${taken} of ${slots.length} taken${skipped ? `, ${skipped} skipped` : ''}`;
}

export interface SupplyEstimate {
  known: boolean;
  remaining: number | null;
  countedAt: string | null;
  countedUnits: number | null;
  addedSince: number;
  usedSince: number;
  dosesCounted: number;
  daysLeft: number | null;
  belowThreshold: boolean;
  renewalSoon: boolean;
}

/** The instant a dose is treated as having happened for supply purposes. */
function doseEffectiveAt(d: DoseRecord): string {
  return d.takenAt ?? d.createdAt;
}

/**
 * ESTIMATED supply, derived fresh from the latest manual count, later refills,
 * and doses CONFIRMED as taken after that count. Because it is recomputed from
 * the current records every time, editing or deleting a dose can never cause
 * double counting.
 */
export function estimateSupply(med: Medication, doses: DoseRecord[], stock: StockEvent[], today: ISODate): SupplyEstimate {
  const events = stock.filter((e) => e.medicationId === med.id).sort((a, b) => a.at.localeCompare(b.at) || a.createdAt.localeCompare(b.createdAt));
  const counts = events.filter((e) => e.kind === 'count');
  const latest = counts[counts.length - 1];
  const renewalSoon = !!med.supply?.renewalDate && med.supply.renewalDate <= addDaysSimple(today, 14);
  if (!med.supply?.enabled || !latest) {
    return { known: false, remaining: null, countedAt: null, countedUnits: null, addedSince: 0, usedSince: 0, dosesCounted: 0, daysLeft: null, belowThreshold: false, renewalSoon };
  }
  const addedSince = events.filter((e) => e.kind === 'add' && e.at > latest.at).reduce((a, e) => a + e.units, 0);
  const counted = doses.filter((d) => d.medicationId === med.id && d.status === 'taken' && doseEffectiveAt(d) > latest.at);
  const usedSince = counted.reduce((a, d) => a + (d.units ?? med.supply!.unitsPerDay ?? 0), 0);
  const remaining = latest.units + addedSince - usedSince;
  // unitsPerDay = units on a dose day; spread over the days it's actually taken.
  const frac = doseDayFraction(med);
  const perDay = frac == null ? 0 : med.supply.unitsPerDay * frac;
  const daysLeft = perDay > 0 ? Math.max(0, Math.floor(remaining / perDay)) : null;
  const belowThreshold = med.supply.refillThresholdUnits != null && remaining <= med.supply.refillThresholdUnits;
  return { known: true, remaining, countedAt: latest.at, countedUnits: latest.units, addedSince, usedSince, dosesCounted: counted.length, daysLeft, belowThreshold, renewalSoon };
}

function addDaysSimple(date: ISODate, n: number): ISODate {
  const [y, m, d] = date.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return t.toISOString().slice(0, 10);
}
