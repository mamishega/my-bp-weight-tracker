import type { AppData } from '../types';
import { zonedToInstant, todayIn, daysBetween, formatTime, formatDateShort, formatDuration } from './time';
import { estimateSupply } from './medication';

export interface DueReminder {
  /** Unique per occurrence, e.g. "evening:2026-11-01". */
  key: string;
  kind: 'morningPre' | 'medication' | 'postDose' | 'evening' | 'weight' | 'refill' | 'backup' | 'appointment';
  title: string;
  body: string;
  dueAt: string;
  href: string;
}

/**
 * Reminders due now. A reminder disappears when the associated record exists,
 * or when the user dismisses/snoozes it. Dismissing never records an action.
 */
export function dueReminders(d: AppData, now: Date = new Date()): DueReminder[] {
  const r = d.settings.reminders;
  const tz = d.settings.timeZone;
  const today = todayIn(tz, now);
  const nowIso = now.toISOString();
  const out: DueReminder[] = [];
  const at = (time: string) => zonedToInstant(today, time, tz).iso;
  const hasSession = (type: string) => d.sessions.some((s) => s.date === today && s.sessionType === type);

  if (r.morningPre.enabled && at(r.morningPre.time) <= nowIso && !hasSession('morning_pre')) {
    out.push({ key: `morningPre:${today}`, kind: 'morningPre', title: 'Morning reading (before medication)', body: 'When you are ready, rest for 5 minutes and take your morning reading.', dueAt: at(r.morningPre.time), href: '#/add?type=morning_pre' });
  }
  if (r.medication.enabled) {
    for (const m of d.medications.filter((m) => m.active && m.usualTime)) {
      const due = at(m.usualTime!);
      const recorded = d.doses.some((x) => x.medicationId === m.id && x.date === today);
      if (due <= nowIso && !recorded) {
        out.push({ key: `medication:${m.id}:${today}`, kind: 'medication', title: `Morning medication: ${m.name}`, body: `Your usual time is ${formatTime(due, tz)}. Record whether you have taken it or not.`, dueAt: due, href: '#/medication' });
      }
    }
  }
  if (r.postDose.enabled) {
    for (const dose of d.doses.filter((x) => x.date === today && x.status === 'taken' && x.takenAt)) {
      const med = d.medications.find((m) => m.id === dose.medicationId);
      if (!med || med.postDoseReminderMinutes == null) continue;
      const due = new Date(new Date(dose.takenAt!).getTime() + med.postDoseReminderMinutes * 60000).toISOString();
      const done = d.sessions.some((s) => s.sessionType === 'morning_post' && (s.linkedDoseIds.includes(dose.id) || (s.date === today && s.measuredAt >= dose.takenAt!)));
      if (due <= nowIso && !done) {
        out.push({ key: `postDose:${dose.id}`, kind: 'postDose', title: 'After-medication reading', body: `${formatDuration(med.postDoseReminderMinutes)} since ${med.name} was recorded at ${formatTime(dose.takenAt!, dose.timeZone)} (the interval you set from your clinician’s instructions).`, dueAt: due, href: '#/add?type=morning_post' });
      }
    }
  }
  if (r.evening.enabled && at(r.evening.time) <= nowIso && !hasSession('evening')) {
    out.push({ key: `evening:${today}`, kind: 'evening', title: 'Evening reading', body: 'When you are ready, rest for 5 minutes and take your evening reading.', dueAt: at(r.evening.time), href: '#/add?type=evening' });
  }
  const wd = new Date(`${today}T12:00:00Z`).getUTCDay();
  if (r.weight.enabled && r.weight.weekdays.includes(wd) && at(r.weight.time) <= nowIso && !d.weights.some((w) => w.date === today)) {
    out.push({ key: `weight:${today}`, kind: 'weight', title: 'Weight entry (optional)', body: 'If you’d like, weigh yourself under your usual conditions.', dueAt: at(r.weight.time), href: '#/weight' });
  }
  if (r.refill.enabled) {
    for (const m of d.medications.filter((m) => m.active && m.supply?.enabled)) {
      const est = estimateSupply(m, d.doses, d.stock, today);
      if (est.belowThreshold) out.push({ key: `refill:${m.id}:${today}`, kind: 'refill', title: `Refill check: ${m.name}`, body: `Estimated ${est.remaining} units left (estimate only — please check your actual supply).`, dueAt: nowIso, href: '#/medication' });
      if (est.renewalSoon && m.supply?.renewalDate) out.push({ key: `renewal:${m.id}:${today}`, kind: 'refill', title: `Prescription renewal: ${m.name}`, body: `Renewal date you entered: ${formatDateShort(m.supply.renewalDate)}.`, dueAt: nowIso, href: '#/medication' });
    }
  }
  if (r.backup.enabled) {
    const hasData = d.sessions.length + d.weights.length + d.doses.length + d.symptoms.length > 0;
    const last = d.meta.lastBackupAt;
    const overdue = last ? (now.getTime() - new Date(last).getTime()) / 86400_000 >= r.backup.everyDays : hasData;
    if (overdue) out.push({ key: `backup:${today}`, kind: 'backup', title: 'Backup reminder', body: last ? `Last successful backup was ${Math.floor((now.getTime() - new Date(last).getTime()) / 86400_000)} days ago.` : 'You have not made a backup yet. Records are only stored in this browser.', dueAt: nowIso, href: '#/settings' });
  }
  if (r.appointment.enabled) {
    for (const a of d.appointments) {
      const days = daysBetween(today, a.date);
      if (days >= 0 && days <= r.appointment.daysBefore) {
        out.push({ key: `appointment:${a.id}:${today}`, kind: 'appointment', title: `Appointment ${days === 0 ? 'today' : days === 1 ? 'tomorrow' : `in ${days} days`}`, body: `${a.clinician || 'Appointment'} on ${formatDateShort(a.date)}. You can prepare a report to bring.`, dueAt: nowIso, href: '#/appointments' });
      }
    }
  }
  const states = new Map(d.reminderStates.map((s) => [s.id, s]));
  return out.filter((x) => {
    const s = states.get(x.key);
    if (!s) return true;
    if (s.status === 'dismissed') return false;
    return !!s.snoozeUntil && s.snoozeUntil <= nowIso;
  });
}
