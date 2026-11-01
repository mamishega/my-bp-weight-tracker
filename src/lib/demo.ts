// Clearly labelled SAMPLE data, only ever written to the separate demo database.

import type { AppData, BPSession, DoseRecord, Medication, SessionType, WeightEntry } from '../types';
import { emptyData } from './defaults';
import { addDays, todayIn, zonedToInstant } from './time';

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

export function buildDemoData(timeZone: string, now = new Date()): AppData {
  const rand = rng(42);
  const d = emptyData();
  const ts = now.toISOString();
  d.settings = { ...d.settings, timeZone, onboarded: true, defaultArm: 'left', defaultMonitorId: 'demo-monitor',
    monitors: [{ id: 'demo-monitor', label: 'SAMPLE upper-arm monitor', model: 'Example model', cuffSize: 'Medium 22–32 cm', notes: '' }],
    targets: { ...d.settings.targets, systolic: 135, diastolic: 85, source: 'SAMPLE — not real advice', setOn: addDays(todayIn(timeZone, now), -60) },
    weightGoal: { startKg: 92, startDate: addDays(todayIn(timeZone, now), -59), goalKg: 85, targetDate: null, agreedWith: 'SAMPLE', milestones: [{ id: 'm1', label: 'First 2 kg', kg: 90, achievedOn: null }] },
  };
  const med: Medication = {
    id: 'demo-med', name: 'SAMPLE medicine', dose: '10 mg', usualTime: '07:30', instructions: 'Sample instructions only', active: true,
    postDoseReminderMinutes: 120, supply: { enabled: true, unitsPerDay: 1, refillThresholdUnits: 7, renewalDate: addDays(todayIn(timeZone, now), 40) },
    history: [{ effectiveFrom: zonedToInstant(addDays(todayIn(timeZone, now), -60), '07:00', timeZone).iso, name: 'SAMPLE medicine', dose: '10 mg', usualTime: '07:30', instructions: 'Sample instructions only' }],
    createdAt: ts, updatedAt: ts,
  };
  d.medications = [med];
  const today = todayIn(timeZone, now);
  const start = addDays(today, -59);
  d.stock = [{ id: 'demo-stock', medicationId: med.id, at: zonedToInstant(start, '06:00', timeZone).iso, kind: 'count', units: 90, note: 'SAMPLE count', createdAt: ts }];
  d.habits = [
    { id: 'h-walk', name: 'Walk for 20 minutes', active: true, createdAt: ts, updatedAt: ts },
    { id: 'h-cook', name: 'Prepare a meal at home', active: true, createdAt: ts, updatedAt: ts },
  ];
  for (let i = 0; i < 60; i++) {
    const date = addDays(start, i);
    const mk = (type: SessionType, time: string, base: number, linked: string[] = []): BPSession => {
      const at = zonedToInstant(date, time, timeZone);
      const two = rand() > 0.15;
      const r = () => ({ systolic: Math.round(base + rand() * 10 - 5), diastolic: Math.round(base * 0.62 + rand() * 6 - 3), pulse: Math.round(66 + rand() * 10) });
      const readings = [{ ...r(), measuredAt: at.iso }];
      if (two) readings.push({ ...r(), measuredAt: new Date(new Date(at.iso).getTime() + 60000).toISOString() });
      return { id: `demo-${type}-${date}`, sessionType: type, date, measuredAt: at.iso, timeZone, utcOffsetMinutes: at.offsetMinutes, readings, arm: 'left', monitorId: 'demo-monitor', monitorLabel: 'SAMPLE upper-arm monitor', conditionFlags: rand() > 0.9 ? ['recent_caffeine'] : [], symptoms: '', notes: '', linkedDoseIds: linked, unusualConfirmed: false, createdAt: ts, updatedAt: ts };
    };
    const trend = 146 - i * 0.12;
    if (rand() > 0.08) d.sessions.push(mk('morning_pre', '07:00', trend));
    let doseId: string | null = null;
    const roll = rand();
    if (roll > 0.06) {
      const takenAt = roll > 0.12 ? zonedToInstant(date, `07:${String(25 + Math.floor(rand() * 15)).padStart(2, '0')}`, timeZone) : null;
      const dose: DoseRecord = { id: `demo-dose-${date}`, medicationId: med.id, date, status: roll > 0.09 ? 'taken' : 'skipped', takenAt: roll > 0.09 ? takenAt?.iso ?? null : null, timeZone, utcOffsetMinutes: takenAt?.offsetMinutes ?? null, units: 1, nameSnapshot: med.name, doseSnapshot: med.dose, notes: '', createdAt: ts, updatedAt: ts };
      d.doses.push(dose);
      if (dose.status === 'taken') doseId = dose.id;
    }
    if (doseId && rand() > 0.5) d.sessions.push(mk('morning_post', '09:40', trend - 6, [doseId]));
    if (rand() > 0.15) d.sessions.push(mk('evening', '19:30', trend - 4));
    if (i % 3 === 0 || rand() > 0.8) {
      const kg = 92 - i * 0.07 + (rand() - 0.5) * 0.8;
      const at = zonedToInstant(date, '06:45', timeZone);
      const w: WeightEntry = { id: `demo-w-${date}`, date, measuredAt: at.iso, timeZone, utcOffsetMinutes: at.offsetMinutes, kg: Math.round(kg * 10) / 10, enteredValue: Math.round(kg * 10) / 10, enteredUnit: 'kg', notes: '', createdAt: ts, updatedAt: ts };
      d.weights.push(w);
    }
    if (rand() > 0.5) d.habitChecks.push({ id: `h-walk:${date}`, habitId: 'h-walk', date, createdAt: ts });
    if (rand() > 0.6) d.habitChecks.push({ id: `h-cook:${date}`, habitId: 'h-cook', date, createdAt: ts });
    if (rand() > 0.7) {
      d.dailyLogs.push({ id: date, date, sleepHours: Math.round((6 + rand() * 2.5) * 2) / 2, sleepQuality: 1 + Math.floor(rand() * 5), stress: 1 + Math.floor(rand() * 5), activityMinutes: Math.round(rand() * 45), activityNote: '', caffeineDrinks: Math.floor(rand() * 3), alcoholDrinks: rand() > 0.8 ? 1 : 0, saltyMeal: rand() > 0.85, illnessOrPain: false, unusual: '', tags: [], notes: 'SAMPLE note', createdAt: ts, updatedAt: ts });
    }
  }
  // A SAMPLE medicine taken twice a day (separate random stream so the rest of the sample data is unchanged).
  const r2 = rng(7);
  const medB: Medication = {
    id: 'demo-med-b', name: 'SAMPLE medicine B', dose: '5 mg', usualTime: '08:00', timesPerDay: 2, doseTimes: ['08:00', '20:00'], instructions: 'Sample instructions only', active: true,
    postDoseReminderMinutes: null, supply: null,
    history: [{ effectiveFrom: zonedToInstant(addDays(today, -30), '07:00', timeZone).iso, name: 'SAMPLE medicine B', dose: '5 mg', usualTime: '08:00', timesPerDay: 2, doseTimes: ['08:00', '20:00'], instructions: 'Sample instructions only' }],
    createdAt: ts, updatedAt: ts,
  };
  d.medications.push(medB);
  for (let i = 29; i >= 0; i--) {
    const date = addDays(today, -i);
    (['08:00', '20:00'] as const).forEach((time, idx) => {
      if (i === 0 && idx === 1) return; // today's evening dose not recorded yet
      const roll = r2();
      if (roll < 0.06) return; // not recorded
      const status = roll < 0.1 ? 'skipped' : 'taken';
      const at = zonedToInstant(date, `${time.slice(0, 2)}:${String(Math.floor(r2() * 20)).padStart(2, '0')}`, timeZone);
      if (at.iso > now.toISOString()) return; // never record a dose in the future
      d.doses.push({ id: `demo-dose-b-${date}-${idx}`, medicationId: medB.id, date, status, takenAt: status === 'taken' ? at.iso : null, timeZone, utcOffsetMinutes: status === 'taken' ? at.offsetMinutes : null, units: status === 'taken' ? 1 : null, doseIndex: idx, scheduledTime: time, nameSnapshot: medB.name, doseSnapshot: medB.dose, notes: '', createdAt: ts, updatedAt: ts });
    });
  }
  const sAt = zonedToInstant(addDays(today, -10), '15:00', timeZone);
  d.symptoms.push({ id: 'demo-sym', date: addDays(today, -10), occurredAt: sAt.iso, timeZone, utcOffsetMinutes: sAt.offsetMinutes, description: 'SAMPLE: mild headache', severity: 'mild', duration: '1 hour', relatedSessionId: null, relatedDoseId: null, actionsTaken: 'Rested, drank water', notes: '', createdAt: ts, updatedAt: ts });
  d.appointments.push({ id: 'demo-appt', date: addDays(today, 5), time: '10:30', clinician: 'SAMPLE GP', location: 'Sample clinic', purpose: 'Blood pressure review', notes: '', createdAt: ts, updatedAt: ts });
  d.settings.measurementWeeks = [{ id: 'demo-week', startDate: addDays(today, -9), days: 7, createdAt: ts }];
  d.questions.push({ id: 'demo-q', text: 'SAMPLE: Should I keep taking after-medication readings?', appointmentId: 'demo-appt', resolved: false, createdAt: ts, updatedAt: ts });
  return d;
}
