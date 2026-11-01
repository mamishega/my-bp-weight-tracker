// Calendar (.ics) export of the reminder schedule. Calendar apps alert reliably
// even when this web app is closed. Titles are deliberately generic (no
// medication names, readings or other health details) because calendars are
// often synced to cloud services.
import type { AppData } from '../types';
import { todayIn } from './time';
import { medFrequency, medSchedule } from './medication';

const DAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

function esc(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
}
function fold(line: string): string {
  const out: string[] = [];
  let l = line;
  while (l.length > 73) {
    out.push(l.slice(0, 73));
    l = ' ' + l.slice(73);
  }
  out.push(l);
  return out.join('\r\n');
}

export interface IcsEvent {
  uid: string;
  title: string;
  time: string;
  byDay?: number[];
  /** Every N days starting on startDate (instead of daily). */
  everyDays?: number;
  startDate?: string;
  /** Last day (inclusive). */
  until?: string;
  description: string;
}

export function reminderEvents(d: AppData): IcsEvent[] {
  const r = d.settings.reminders;
  const ev: IcsEvent[] = [];
  if (r.morningPre.enabled) ev.push({ uid: 'morning-pre', title: 'Morning blood pressure (before medication)', time: r.morningPre.time, description: 'Rest 5 minutes, then take two readings one minute apart. Record them in My BP & Weight.' });
  if (r.medication.enabled) {
    // One event per distinct (time, which days, end) — never per medicine name.
    const seen = new Map<string, IcsEvent>();
    for (const m of d.medications.filter((x) => x.active)) {
      const f = medFrequency(m);
      if (f.kind === 'as_needed') continue;
      for (const t of medSchedule(m).times) {
        if (!t) continue;
        const pattern = f.kind === 'weekly' ? { byDay: f.days } : f.kind === 'interval' ? { everyDays: f.everyDays, startDate: f.startDate } : {};
        const key = JSON.stringify([t, pattern, m.endDate ?? null]);
        if (!seen.has(key)) seen.set(key, { uid: '', title: 'Medication — record it', time: t, ...pattern, ...(m.endDate ? { until: m.endDate } : {}), description: 'Record in My BP & Weight whether you took or skipped your medication.' });
      }
    }
    [...seen.values()].sort((a, b) => a.time.localeCompare(b.time)).forEach((e, i) => ev.push({ ...e, uid: `medication-${i}` }));
  }
  if (r.evening.enabled) ev.push({ uid: 'evening', title: 'Evening blood pressure', time: r.evening.time, description: 'Rest 5 minutes, then take two readings one minute apart. Record them in My BP & Weight.' });
  if (r.weight.enabled && r.weight.weekdays.length) ev.push({ uid: 'weight', title: 'Weight (optional)', time: r.weight.time, byDay: r.weight.weekdays, description: 'If you’d like, weigh yourself under your usual conditions.' });
  return ev;
}

export function buildIcs(d: AppData, now = new Date()): string {
  const tz = d.settings.timeZone;
  const start = todayIn(tz, now).replace(/-/g, '');
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//My BP & Weight Tracker//Reminders//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'X-WR-CALNAME:Health reminders'];
  for (const e of reminderEvents(d)) {
    const hhmm = e.time.replace(':', '') + '00';
    const until = e.until ? `;UNTIL=${e.until.replace(/-/g, '')}T235959Z` : '';
    const rrule = e.byDay ? `RRULE:FREQ=WEEKLY;BYDAY=${e.byDay.map((n) => DAYS[n]).join(',')}${until}` : e.everyDays ? `RRULE:FREQ=DAILY;INTERVAL=${e.everyDays}${until}` : `RRULE:FREQ=DAILY${until}`;
    lines.push(
      'BEGIN:VEVENT',
      `UID:${e.uid}@my-bp-weight-tracker`,
      `DTSTAMP:${stamp}`,
      `DTSTART;TZID=${tz}:${e.everyDays && e.startDate ? e.startDate.replace(/-/g, '') : start}T${hhmm}`,
      'DURATION:PT10M',
      rrule,
      `SUMMARY:${esc(e.title)}`,
      `DESCRIPTION:${esc(e.description)}`,
      'TRANSP:TRANSPARENT',
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      `DESCRIPTION:${esc(e.title)}`,
      'TRIGGER:PT0M',
      'END:VALARM',
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}
