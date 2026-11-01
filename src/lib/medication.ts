import type { BPSession, DoseRecord, Medication, MedicationVersion, StockEvent, ISODate } from '../types';
import { minutesBetween } from './time';

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
  changes: Partial<Pick<Medication, 'name' | 'dose' | 'usualTime' | 'instructions' | 'active' | 'postDoseReminderMinutes' | 'supply'>>,
  now: string,
): Medication {
  const next: Medication = { ...med, ...changes, updatedAt: now };
  const prescriptionChanged =
    next.name !== med.name || next.dose !== med.dose || next.usualTime !== med.usualTime || next.instructions !== med.instructions;
  if (prescriptionChanged) {
    next.history = [
      ...med.history,
      { effectiveFrom: now, name: next.name, dose: next.dose, usualTime: next.usualTime, instructions: next.instructions },
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

/** Suggested dose links for an after-medication session: doses recorded as taken on the same day. */
export function suggestDoseLinks(date: ISODate, doses: DoseRecord[]): string[] {
  return doses.filter((d) => d.date === date && d.status === 'taken').map((d) => d.id);
}

export function dosesForDay(doses: DoseRecord[], medId: string, date: ISODate): DoseRecord[] {
  return doses.filter((d) => d.medicationId === medId && d.date === date);
}

/** Medication status for a day. Absence of a record is "not recorded", never "missed". */
export function dayDoseStatus(doses: DoseRecord[], medId: string, date: ISODate): 'taken' | 'skipped' | 'not_recorded' {
  const list = dosesForDay(doses, medId, date);
  if (list.some((d) => d.status === 'taken')) return 'taken';
  if (list.some((d) => d.status === 'skipped')) return 'skipped';
  return 'not_recorded';
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
  const perDay = med.supply.unitsPerDay;
  const daysLeft = perDay > 0 ? Math.max(0, Math.floor(remaining / perDay)) : null;
  const belowThreshold = med.supply.refillThresholdUnits != null && remaining <= med.supply.refillThresholdUnits;
  return { known: true, remaining, countedAt: latest.at, countedUnits: latest.units, addedSince, usedSince, dosesCounted: counted.length, daysLeft, belowThreshold, renewalSoon };
}

function addDaysSimple(date: ISODate, n: number): ISODate {
  const [y, m, d] = date.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return t.toISOString().slice(0, 10);
}
