import type { AppData, Meta, Settings } from '../types';
import { deviceTimeZone } from './time';

export const SCHEMA_VERSION = 1;

export function uid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return 'id-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export function defaultSettings(now = new Date().toISOString()): Settings {
  return {
    id: 'settings',
    timeZone: deviceTimeZone(),
    weightUnit: 'kg',
    defaultArm: null,
    defaultMonitorId: null,
    monitors: [],
    targets: {
      systolic: null,
      diastolic: null,
      contactSystolicAbove: null,
      contactDiastolicAbove: null,
      contactInstruction: '',
      source: '',
      setOn: null,
    },
    weightGoal: { startKg: null, startDate: null, goalKg: null, targetDate: null, agreedWith: '', milestones: [] },
    reminders: {
      morningPre: { enabled: false, time: '07:00' },
      medication: { enabled: false },
      postDose: { enabled: false },
      evening: { enabled: false, time: '19:00' },
      weight: { enabled: false, time: '07:30', weekdays: [1] },
      refill: { enabled: true },
      backup: { enabled: true, everyDays: 7 },
      appointment: { enabled: true, daysBefore: 2 },
      snoozeMinutes: 15,
    },
    notificationsEnabled: false,
    onboarded: false,
    share: null,
    updatedAt: now,
  };
}

export function defaultMeta(now = new Date().toISOString()): Meta {
  return { id: 'meta', schemaVersion: SCHEMA_VERSION, lastBackupAt: null, lastBackupMethod: null, createdAt: now };
}

export function emptyData(): AppData {
  return {
    sessions: [],
    doses: [],
    medications: [],
    stock: [],
    weights: [],
    dailyLogs: [],
    habits: [],
    habitChecks: [],
    symptoms: [],
    appointments: [],
    questions: [],
    reminderStates: [],
    settings: defaultSettings(),
    meta: defaultMeta(),
  };
}

/** Fill in any settings fields missing from older saved/imported data. */
export function normaliseSettings(s: Partial<Settings> | undefined): Settings {
  const d = defaultSettings();
  if (!s) return d;
  return {
    ...d,
    ...s,
    targets: { ...d.targets, ...(s.targets ?? {}) },
    weightGoal: { ...d.weightGoal, ...(s.weightGoal ?? {}), milestones: s.weightGoal?.milestones ?? [] },
    reminders: {
      ...d.reminders,
      ...(s.reminders ?? {}),
      morningPre: { ...d.reminders.morningPre, ...(s.reminders?.morningPre ?? {}) },
      evening: { ...d.reminders.evening, ...(s.reminders?.evening ?? {}) },
      weight: { ...d.reminders.weight, ...(s.reminders?.weight ?? {}) },
      backup: { ...d.reminders.backup, ...(s.reminders?.backup ?? {}) },
      appointment: { ...d.reminders.appointment, ...(s.reminders?.appointment ?? {}) },
    },
    monitors: s.monitors ?? [],
    share: s.share ?? null,
    id: 'settings',
  };
}
