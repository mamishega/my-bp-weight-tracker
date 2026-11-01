import type { BPSession, DoseRecord, WeightEntry, SymptomEntry } from '../types';
import { minutesBetween } from './time';
import { doseTiming } from './medication';

export type QualityFlag =
  | 'single_reading'
  | 'two_readings'
  | 'possible_duplicate'
  | 'additional_session'
  | 'unusual_conditions'
  | 'medication_time_unknown'
  | 'measured_before_dose'
  | 'no_linked_dose'
  | 'unusual_values_confirmed';

export const QUALITY_LABEL: Record<QualityFlag, string> = {
  single_reading: 'Single-reading session',
  two_readings: 'Two-reading session',
  possible_duplicate: 'Possible duplicate',
  additional_session: 'Additional session of this type on this day',
  unusual_conditions: 'Unusual measurement conditions',
  medication_time_unknown: 'Medication time unknown',
  measured_before_dose: 'Timing to review: measured before linked dose',
  no_linked_dose: 'No dose linked',
  unusual_values_confirmed: 'Unusual values confirmed by you',
};

/** True if two BP sessions look like the same measurement entered twice. */
export function sessionsLookDuplicate(a: BPSession, b: BPSession): boolean {
  if (a.id === b.id || a.sessionType !== b.sessionType) return false;
  const mins = Math.abs(minutesBetween(a.measuredAt, b.measuredAt));
  const r1 = a.readings[0];
  const r2 = b.readings[0];
  const sameFirst = !!r1 && !!r2 && r1.systolic === r2.systolic && r1.diastolic === r2.diastolic;
  return (mins <= 15 && sameFirst) || mins === 0;
}

/** Map of session id → ids of sessions it may duplicate. Never deletes anything. */
export function findDuplicateSessions(sessions: BPSession[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const sorted = [...sessions].sort((a, b) => a.measuredAt.localeCompare(b.measuredAt));
  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length; j++) {
      if (minutesBetween(sorted[i].measuredAt, sorted[j].measuredAt) > 15) break;
      if (sessionsLookDuplicate(sorted[i], sorted[j])) {
        out.set(sorted[i].id, [...(out.get(sorted[i].id) ?? []), sorted[j].id]);
        out.set(sorted[j].id, [...(out.get(sorted[j].id) ?? []), sorted[i].id]);
      }
    }
  }
  return out;
}

export function findDuplicateWeights(weights: WeightEntry[]): Set<string> {
  const out = new Set<string>();
  const key = (w: WeightEntry) => `${w.date}|${w.kg}|${w.measuredAt ?? ''}`;
  const seen = new Map<string, string>();
  for (const w of weights) {
    const k = key(w);
    if (seen.has(k)) {
      out.add(w.id);
      out.add(seen.get(k)!);
    } else seen.set(k, w.id);
  }
  return out;
}

export function findDuplicateDoses(doses: DoseRecord[]): Set<string> {
  const out = new Set<string>();
  const groups = new Map<string, DoseRecord[]>();
  for (const d of doses) {
    const k = `${d.medicationId}|${d.date}`;
    groups.set(k, [...(groups.get(k) ?? []), d]);
  }
  for (const list of groups.values()) if (list.length > 1) list.forEach((d) => out.add(d.id));
  return out;
}

export function findDuplicateSymptoms(symptoms: SymptomEntry[]): Set<string> {
  const out = new Set<string>();
  const seen = new Map<string, string>();
  for (const s of symptoms) {
    const k = `${s.occurredAt}|${s.description.trim().toLowerCase()}`;
    if (seen.has(k)) {
      out.add(s.id);
      out.add(seen.get(k)!);
    } else seen.set(k, s.id);
  }
  return out;
}

/** All data-quality flags for a session, computed from current records. */
export function sessionFlags(s: BPSession, all: BPSession[], doses: DoseRecord[], dupes?: Map<string, string[]>): QualityFlag[] {
  const flags: QualityFlag[] = [s.readings.length >= 2 ? 'two_readings' : 'single_reading'];
  const d = dupes ?? findDuplicateSessions(all);
  if (d.has(s.id)) flags.push('possible_duplicate');
  const sameDay = all
    .filter((x) => x.sessionType === s.sessionType && x.date === s.date)
    .sort((a, b) => a.measuredAt.localeCompare(b.measuredAt));
  if (sameDay.length > 1 && sameDay[0].id !== s.id) flags.push('additional_session');
  if (s.conditionFlags.length > 0) flags.push('unusual_conditions');
  if (s.unusualConfirmed) flags.push('unusual_values_confirmed');
  if (s.sessionType === 'morning_post') {
    if (!s.linkedDoseIds.some((id) => doses.some((x) => x.id === id))) flags.push('no_linked_dose');
    for (const id of s.linkedDoseIds) {
      const t = doseTiming(s, doses.find((x) => x.id === id));
      if (t.kind === 'unknown_time' && !flags.includes('medication_time_unknown')) flags.push('medication_time_unknown');
      if (t.kind === 'before_dose' && !flags.includes('measured_before_dose')) flags.push('measured_before_dose');
    }
  }
  return flags;
}

export const FLAG_IS_WARNING: Record<QualityFlag, boolean> = {
  single_reading: false,
  two_readings: false,
  possible_duplicate: true,
  additional_session: false,
  unusual_conditions: true,
  medication_time_unknown: true,
  measured_before_dose: true,
  no_linked_dose: true,
  unusual_values_confirmed: false,
};
