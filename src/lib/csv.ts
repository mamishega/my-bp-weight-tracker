import type { AppData } from '../types';
import { SESSION_LABEL, CONDITION_LABEL, sessionAverage } from './bp';
import { instantToZoned, formatOffset } from './time';
import { findDuplicateSessions, sessionFlags, QUALITY_LABEL } from './quality';

/** Escape a CSV cell and neutralise spreadsheet formula injection. */
export function csvCell(v: unknown): string {
  if (v == null) return '';
  let s = String(v);
  if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  if (/[",\n\r]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function toCsv(header: string[], rows: unknown[][]): string {
  return [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

function local(iso: string | null, tz: string) {
  if (!iso) return { date: '', time: '' };
  return instantToZoned(iso, tz);
}

/** One row per ORIGINAL reading; session average repeated for reference. */
export function readingsCsv(d: AppData): string {
  const dupes = findDuplicateSessions(d.sessions);
  const rows: unknown[][] = [];
  const sorted = [...d.sessions].sort((a, b) => a.measuredAt.localeCompare(b.measuredAt));
  for (const s of sorted) {
    const avg = sessionAverage(s);
    const flags = sessionFlags(s, d.sessions, d.doses, dupes).map((f) => QUALITY_LABEL[f]).join('; ');
    s.readings.forEach((r, i) => {
      const lt = local(r.measuredAt, s.timeZone);
      rows.push([
        s.id, s.date, SESSION_LABEL[s.sessionType], i + 1, s.readings.length, lt.date, lt.time, s.timeZone, formatOffset(s.utcOffsetMinutes), r.measuredAt,
        r.systolic, r.diastolic, r.pulse ?? '', avg.systolic, avg.diastolic, avg.pulse ?? '', s.arm ?? '', s.monitorLabel ?? '',
        s.conditionFlags.map((f) => CONDITION_LABEL[f]).join('; '), flags, s.linkedDoseIds.join(' '), s.symptoms, s.notes,
      ]);
    });
  }
  return toCsv(
    ['session_id', 'session_day', 'session_type', 'reading_number', 'readings_in_session', 'local_date', 'local_time', 'time_zone', 'utc_offset', 'utc_instant',
      'systolic_mmHg', 'diastolic_mmHg', 'pulse_bpm', 'session_avg_systolic', 'session_avg_diastolic', 'session_avg_pulse', 'arm', 'monitor',
      'measurement_conditions', 'data_quality', 'linked_dose_ids', 'symptoms', 'notes'],
    rows,
  );
}

export function dosesCsv(d: AppData): string {
  const rows = [...d.doses].sort((a, b) => a.date.localeCompare(b.date)).map((x) => {
    const lt = local(x.takenAt, x.timeZone);
    return [x.id, x.date, x.medicationId, x.nameSnapshot, x.doseSnapshot, x.status, x.takenAt ? lt.time : 'Medication time unknown', x.timeZone, x.takenAt ?? '', x.units ?? '', x.notes, x.doseIndex != null ? x.doseIndex + 1 : '', x.scheduledTime ?? ''];
  });
  return toCsv(['dose_id', 'date', 'medication_id', 'medication_name', 'dose', 'status', 'local_time_taken', 'time_zone', 'utc_instant', 'units', 'notes', 'dose_number', 'scheduled_time'], rows);
}

export function weightsCsv(d: AppData): string {
  const rows = [...d.weights].sort((a, b) => a.date.localeCompare(b.date)).map((w) => {
    const lt = local(w.measuredAt, w.timeZone);
    return [w.id, w.date, lt.time, w.timeZone, w.measuredAt ?? '', w.kg.toFixed(2), w.enteredValue, w.enteredUnit, w.notes];
  });
  return toCsv(['weight_id', 'date', 'local_time', 'time_zone', 'utc_instant', 'weight_kg', 'entered_value', 'entered_unit', 'notes'], rows);
}

export function symptomsCsv(d: AppData): string {
  const rows = [...d.symptoms].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt)).map((s) => {
    const lt = local(s.occurredAt, s.timeZone);
    return [s.id, s.date, lt.time, s.timeZone, s.occurredAt, s.description, s.severity ?? '', s.duration, s.relatedSessionId ?? '', s.relatedDoseId ?? '', s.actionsTaken, s.notes];
  });
  return toCsv(['symptom_id', 'date', 'local_time', 'time_zone', 'utc_instant', 'description', 'severity', 'duration', 'related_session_id', 'related_dose_id', 'actions_taken', 'notes'], rows);
}
