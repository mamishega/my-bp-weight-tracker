// Typed data models. All instants are stored as ISO-8601 UTC strings together
// with the IANA time zone and UTC offset (minutes) that applied when recorded.
// `date` fields are the user-assigned calendar day (YYYY-MM-DD) and are kept
// separate from the instant so a session can cross midnight without being
// relabelled.

export type ID = string;
export type ISODate = string; // YYYY-MM-DD
export type ISOInstant = string; // 2026-11-01T21:15:00.000Z

export type SessionType = 'morning_pre' | 'morning_post' | 'evening';
export const SESSION_TYPES: SessionType[] = ['morning_pre', 'morning_post', 'evening'];

export type Arm = 'left' | 'right';

export type ConditionFlag =
  | 'insufficient_rest'
  | 'recent_caffeine'
  | 'recent_exercise'
  | 'recent_smoking'
  | 'talking'
  | 'different_device'
  | 'different_arm'
  | 'cuff_issue'
  | 'pain_or_stress'
  | 'full_bladder';

export interface BPReading {
  systolic: number;
  diastolic: number;
  pulse: number | null;
  /** Instant this individual reading was taken. */
  measuredAt: ISOInstant;
}

export interface BPSession {
  id: ID;
  sessionType: SessionType;
  /** User-assigned calendar day for this session. */
  date: ISODate;
  /** Instant of the first reading. */
  measuredAt: ISOInstant;
  timeZone: string;
  utcOffsetMinutes: number;
  /** 1 or 2 original readings, never modified by averaging. */
  readings: BPReading[];
  arm: Arm | null;
  monitorId: ID | null;
  /** Snapshot of the monitor label at time of recording. */
  monitorLabel: string | null;
  conditionFlags: ConditionFlag[];
  symptoms: string;
  notes: string;
  /** For after-medication sessions: the dose record(s) this follows. */
  linkedDoseIds: ID[];
  /** User confirmed unusual values were correct. */
  unusualConfirmed: boolean;
  createdAt: ISOInstant;
  updatedAt: ISOInstant;
}

export interface SupplySettings {
  enabled: boolean;
  /** Prescribed units (tablets etc.) taken per day. */
  unitsPerDay: number;
  refillThresholdUnits: number | null;
  renewalDate: ISODate | null;
}

export interface MedicationVersion {
  effectiveFrom: ISOInstant;
  /** Local calendar day this version applies from (newer versions); older ones use effectiveFrom's date. */
  effectiveDate?: ISODate;
  name: string;
  dose: string;
  usualTime: string | null; // HH:mm (first dose time)
  /** Scheduled doses per day and their times (older versions: once a day at usualTime). */
  timesPerDay?: number;
  doseTimes?: (string | null)[];
  frequency?: MedFrequency;
  endDate?: ISODate | null;
  instructions: string;
}

/** Which days a medicine is taken. Missing = every day. */
export type MedFrequency =
  | { kind: 'daily' }
  | { kind: 'weekly'; days: number[] } // 0 = Sunday
  | { kind: 'interval'; everyDays: number; startDate: ISODate }
  | { kind: 'as_needed' };

export interface Medication {
  id: ID;
  name: string;
  dose: string;
  /** Time of the first dose (kept for older code and backups; = doseTimes[0]). */
  usualTime: string | null;
  /** How many times a day it is taken (1–6). Missing in older data = 1. */
  timesPerDay?: number;
  /** Usual time of each dose (HH:mm), one per dose; null = no set time. */
  doseTimes?: (string | null)[];
  /** Which days it is taken (every day, some weekdays, every N days, only when needed). */
  frequency?: MedFrequency;
  /** Last day of a course (optional). After it, no doses are scheduled. */
  endDate?: ISODate | null;
  instructions: string;
  active: boolean;
  /** Minutes after the recorded dose time to remind for an after-medication
   * reading. Entered from clinician instructions; null = no reminder. */
  postDoseReminderMinutes: number | null;
  supply: SupplySettings | null;
  /** Every previous and current version, oldest first. */
  history: MedicationVersion[];
  createdAt: ISOInstant;
  updatedAt: ISOInstant;
}

export type DoseStatus = 'taken' | 'skipped';

export interface DoseRecord {
  id: ID;
  medicationId: ID;
  date: ISODate;
  status: DoseStatus;
  /** Actual time taken. null = taken but time unknown, or skipped. */
  takenAt: ISOInstant | null;
  timeZone: string;
  utcOffsetMinutes: number | null;
  /** Units consumed by this dose (only counted when status is 'taken'). */
  units: number | null;
  /** Which scheduled dose this record is for: its position (0-based) and usual time. Missing = not specified (older records). */
  doseIndex?: number | null;
  scheduledTime?: string | null;
  nameSnapshot: string;
  doseSnapshot: string;
  notes: string;
  createdAt: ISOInstant;
  updatedAt: ISOInstant;
}

export interface StockEvent {
  id: ID;
  medicationId: ID;
  at: ISOInstant;
  /** count = manual count/correction of units on hand; add = units added (refill). */
  kind: 'count' | 'add';
  units: number;
  note: string;
  createdAt: ISOInstant;
}

export type WeightUnit = 'kg' | 'lb';

export interface WeightEntry {
  id: ID;
  date: ISODate;
  measuredAt: ISOInstant | null;
  timeZone: string;
  utcOffsetMinutes: number | null;
  kg: number;
  /** Original value and unit as typed. */
  enteredValue: number;
  enteredUnit: WeightUnit;
  notes: string;
  createdAt: ISOInstant;
  updatedAt: ISOInstant;
}

export interface DailyLog {
  id: ID; // same as date
  date: ISODate;
  sleepHours: number | null;
  sleepQuality: number | null; // 1-5
  stress: number | null; // 1-5
  activityMinutes: number | null;
  activityNote: string;
  caffeineDrinks: number | null;
  alcoholDrinks: number | null;
  saltyMeal: boolean;
  illnessOrPain: boolean;
  unusual: string;
  tags: string[];
  notes: string;
  createdAt: ISOInstant;
  updatedAt: ISOInstant;
}

export interface Habit {
  id: ID;
  name: string;
  active: boolean;
  createdAt: ISOInstant;
  updatedAt: ISOInstant;
}

export interface HabitCheck {
  id: ID; // `${habitId}:${date}`
  habitId: ID;
  date: ISODate;
  createdAt: ISOInstant;
}

export type Severity = 'mild' | 'moderate' | 'severe';

export interface SymptomEntry {
  id: ID;
  date: ISODate;
  occurredAt: ISOInstant;
  timeZone: string;
  utcOffsetMinutes: number;
  description: string;
  severity: Severity | null;
  duration: string;
  relatedSessionId: ID | null;
  relatedDoseId: ID | null;
  actionsTaken: string;
  notes: string;
  createdAt: ISOInstant;
  updatedAt: ISOInstant;
}

export interface Appointment {
  id: ID;
  date: ISODate;
  time: string | null;
  clinician: string;
  location: string;
  purpose: string;
  notes: string;
  createdAt: ISOInstant;
  updatedAt: ISOInstant;
}

export interface Question {
  id: ID;
  text: string;
  appointmentId: ID | null;
  resolved: boolean;
  createdAt: ISOInstant;
  updatedAt: ISOInstant;
}

export interface ReminderState {
  id: ID; // `${reminderKey}`
  status: 'snoozed' | 'dismissed';
  snoozeUntil: ISOInstant | null;
  updatedAt: ISOInstant;
}

export interface Monitor {
  id: ID;
  label: string;
  model: string;
  cuffSize: string;
  notes: string;
}

export interface Milestone {
  id: ID;
  label: string;
  kg: number | null;
  achievedOn: ISODate | null;
}

export interface TimedReminder {
  enabled: boolean;
  time: string; // HH:mm
}

export interface ReminderSettings {
  morningPre: TimedReminder;
  medication: { enabled: boolean };
  postDose: { enabled: boolean };
  evening: TimedReminder;
  weight: TimedReminder & { weekdays: number[] }; // 0=Sun
  refill: { enabled: boolean };
  backup: { enabled: boolean; everyDays: number };
  appointment: { enabled: boolean; daysBefore: number };
  snoozeMinutes: number;
}

export interface Settings {
  id: 'settings';
  timeZone: string;
  weightUnit: WeightUnit;
  defaultArm: Arm | null;
  defaultMonitorId: ID | null;
  monitors: Monitor[];
  /** Personal targets entered from clinician advice. */
  targets: {
    systolic: number | null;
    diastolic: number | null;
    contactSystolicAbove: number | null;
    contactDiastolicAbove: number | null;
    contactInstruction: string;
    source: string;
    setOn: ISODate | null;
  };
  weightGoal: {
    startKg: number | null;
    startDate: ISODate | null;
    goalKg: number | null;
    targetDate: ISODate | null;
    agreedWith: string;
    milestones: Milestone[];
  };
  reminders: ReminderSettings;
  notificationsEnabled: boolean;
  onboarded: boolean;
  /** Live doctor share link, if one is active. */
  share: ShareConfig | null;
  /** Guided 7-day home measurement weeks (newest last). */
  measurementWeeks?: MeasurementWeek[];
  updatedAt: ISOInstant;
}

export interface MeasurementWeek {
  id: ID;
  startDate: ISODate;
  /** Number of days (7). */
  days: number;
  createdAt: ISOInstant;
}

/** What the doctor's live link includes. */
export interface ShareOptions {
  /** Rolling window: the last N days up to the latest update. */
  windowDays: number;
  /** Name shown at the top of the doctor's view (optional). */
  displayName: string;
  sessionNotes: boolean;
  symptoms: boolean;
  lifestyle: boolean;
  doseNotes: boolean;
  questions: boolean;
  quality: boolean;
  weightNotes: boolean;
}

export interface ShareConfig {
  id: string;
  /** Secret that lets this device update or delete the link. */
  token: string;
  /** Link secret (16 chars; key and id are derived from it) or, for older links, the 43-char key. Only in the link's #fragment. */
  key: string;
  /** Name label shown in the link, e.g. "sam-citizen" (cosmetic). */
  linkName: string;
  /** Optional PIN the doctor must enter (told separately). Short links only. */
  pin?: string | null;
  createdAt: ISOInstant;
  expiresAt: ISOInstant;
  options: ShareOptions;
}

export interface Meta {
  id: 'meta';
  schemaVersion: number;
  lastBackupAt: ISOInstant | null;
  lastBackupMethod: string | null;
  createdAt: ISOInstant;
}

/** Collections stored as separate object stores. */
export interface Collections {
  sessions: BPSession;
  doses: DoseRecord;
  medications: Medication;
  stock: StockEvent;
  weights: WeightEntry;
  dailyLogs: DailyLog;
  habits: Habit;
  habitChecks: HabitCheck;
  symptoms: SymptomEntry;
  appointments: Appointment;
  questions: Question;
  reminderStates: ReminderState;
}

export type CollectionName = keyof Collections;

export const COLLECTIONS: CollectionName[] = [
  'sessions',
  'doses',
  'medications',
  'stock',
  'weights',
  'dailyLogs',
  'habits',
  'habitChecks',
  'symptoms',
  'appointments',
  'questions',
  'reminderStates',
];

export type AppData = { [K in CollectionName]: Collections[K][] } & {
  settings: Settings;
  meta: Meta;
};

export type DataMode = 'real' | 'demo';
