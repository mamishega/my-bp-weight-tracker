// Calendar (.ics) export of the reminder schedule. Calendar apps alert reliably
// even when this web app is closed. Titles are deliberately generic (no
// medication names, readings or other health details) because calendars are
// often synced to cloud services.
import type { AppData } from '../types';
import { todayIn } from './time';

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

export interface IcsEvent { uid: string; title: string; time: string; byDay?: number[]; description: string }

export function reminderEvents(d: AppData): IcsEvent[] {
  const r = d.settings.reminders;
  const ev: IcsEvent[] = [];
  if (r.morningPre.enabled) ev.push({ uid: 'morning-pre', title: 'Morning blood pressure (before medication)', time: r.morningPre.time, description: 'Rest 5 minutes, then take two readings one minute apart. Record them in My BP & Weight.' });
  if (r.medication.enabled) {
    const times = [...new Set(d.medications.filter((m) => m.active && m.usualTime).map((m) => m.usualTime!))].sort();
    times.forEach((t, i) => ev.push({ uid: `medication-${i}`, title: 'Morning medication — record it', time: t, description: 'Record in My BP & Weight whether you took or skipped your morning medication.' }));
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
    const rrule = e.byDay ? `RRULE:FREQ=WEEKLY;BYDAY=${e.byDay.map((n) => DAYS[n]).join(',')}` : 'RRULE:FREQ=DAILY';
    lines.push(
      'BEGIN:VEVENT',
      `UID:${e.uid}@my-bp-weight-tracker`,
      `DTSTAMP:${stamp}`,
      `DTSTART;TZID=${tz}:${start}T${hhmm}`,
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
