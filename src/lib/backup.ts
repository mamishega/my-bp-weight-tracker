import { COLLECTIONS, type AppData, type CollectionName, type DataMode } from '../types';
import { SCHEMA_VERSION, normaliseSettings, defaultMeta } from './defaults';
import { isValidDate } from './time';

export const BACKUP_APP_ID = 'my-bp-weight-tracker';

export interface BackupFile {
  app: typeof BACKUP_APP_ID;
  schemaVersion: number;
  mode: DataMode;
  exportedAt: string;
  exportedTimeZone: string;
  counts: Record<CollectionName, number>;
  data: AppData;
}

export function buildBackup(data: AppData, mode: DataMode, now = new Date()): BackupFile {
  const counts = Object.fromEntries(COLLECTIONS.map((c) => [c, data[c].length])) as Record<CollectionName, number>;
  return {
    app: BACKUP_APP_ID,
    schemaVersion: SCHEMA_VERSION,
    mode,
    exportedAt: now.toISOString(),
    exportedTimeZone: data.settings.timeZone,
    counts,
    data,
  };
}

export function backupFileName(mode: DataMode, now = new Date()): string {
  const stamp = now.toISOString().slice(0, 16).replace(/[:T]/g, '-');
  return `${mode === 'demo' ? 'DEMO-' : ''}bp-weight-backup-${stamp}.json`;
}

type Check = (r: Record<string, unknown>) => string | null;
const isStr = (v: unknown) => typeof v === 'string';
const isNum = (v: unknown) => typeof v === 'number' && Number.isFinite(v);
const isIso = (v: unknown) => isStr(v) && !Number.isNaN(Date.parse(v as string));
const isDate = (v: unknown) => isStr(v) && isValidDate(v as string);

const CHECKS: Partial<Record<CollectionName, Check>> = {
  sessions: (r) => {
    if (!['morning_pre', 'morning_post', 'evening'].includes(r.sessionType as string)) return 'unknown session type';
    if (!isDate(r.date)) return 'invalid date';
    if (!isIso(r.measuredAt)) return 'invalid measurement time';
    if (!isStr(r.timeZone)) return 'missing time zone';
    if (!Array.isArray(r.readings) || r.readings.length < 1 || r.readings.length > 2) return 'must have 1 or 2 readings';
    for (const rd of r.readings as Record<string, unknown>[]) {
      if (!isNum(rd.systolic) || !isNum(rd.diastolic)) return 'reading values must be numbers';
      if (!isIso(rd.measuredAt)) return 'reading time invalid';
    }
    if (!Array.isArray(r.linkedDoseIds)) return 'linkedDoseIds missing';
    if (!Array.isArray(r.conditionFlags)) return 'conditionFlags missing';
    return null;
  },
  doses: (r) => {
    if (!isStr(r.medicationId)) return 'missing medication';
    if (!isDate(r.date)) return 'invalid date';
    if (!['taken', 'skipped'].includes(r.status as string)) return 'invalid status';
    if (r.takenAt !== null && !isIso(r.takenAt)) return 'invalid taken time';
    return null;
  },
  medications: (r) => (!isStr(r.name) ? 'missing name' : !Array.isArray(r.history) ? 'missing history' : null),
  stock: (r) => (!isStr(r.medicationId) || !isIso(r.at) || !isNum(r.units) || !['count', 'add'].includes(r.kind as string) ? 'invalid stock record' : null),
  weights: (r) => (!isDate(r.date) || !isNum(r.kg) || (r.kg as number) <= 0 ? 'invalid weight' : null),
  dailyLogs: (r) => (!isDate(r.date) ? 'invalid date' : null),
  habits: (r) => (!isStr(r.name) ? 'missing name' : null),
  habitChecks: (r) => (!isStr(r.habitId) || !isDate(r.date) ? 'invalid habit check' : null),
  symptoms: (r) => (!isIso(r.occurredAt) || !isStr(r.description) ? 'invalid symptom' : null),
  appointments: (r) => (!isDate(r.date) ? 'invalid date' : null),
  questions: (r) => (!isStr(r.text) ? 'missing text' : null),
};

export interface ValidationResult {
  ok: boolean;
  errors: string[];
  backup: BackupFile | null;
}

/** Strictly validate a parsed backup. Nothing is written until the user confirms. */
export function validateBackup(raw: unknown, currentMode: DataMode): ValidationResult {
  const errors: string[] = [];
  if (!raw || typeof raw !== 'object') return { ok: false, errors: ['The file is not a valid backup (not a JSON object).'], backup: null };
  const b = raw as Record<string, unknown>;
  if (b.app !== BACKUP_APP_ID) errors.push('This file was not created by My BP & Weight Tracker.');
  if (typeof b.schemaVersion !== 'number' || b.schemaVersion > SCHEMA_VERSION) errors.push(`Unsupported backup version (${String(b.schemaVersion)}). Update the app and try again.`);
  if (b.mode !== 'real' && b.mode !== 'demo') errors.push('Backup is missing its data mode.');
  else if (b.mode !== currentMode)
    errors.push(
      b.mode === 'demo'
        ? 'This is a DEMO backup containing sample data. It cannot be restored into your personal records.'
        : 'This is a backup of personal records. It cannot be restored into demo mode. Switch to personal records first.',
    );
  const data = b.data as Record<string, unknown> | undefined;
  if (!data || typeof data !== 'object') errors.push('Backup has no data section.');
  else {
    for (const name of COLLECTIONS) {
      const list = data[name];
      if (list === undefined) continue; // tolerate stores added later
      if (!Array.isArray(list)) {
        errors.push(`${name}: expected a list.`);
        continue;
      }
      const ids = new Set<string>();
      list.forEach((rec, i) => {
        if (!rec || typeof rec !== 'object') return errors.push(`${name} #${i + 1}: not a record.`);
        const r = rec as Record<string, unknown>;
        if (!isStr(r.id) || !(r.id as string)) return errors.push(`${name} #${i + 1}: missing id.`);
        if (ids.has(r.id as string)) errors.push(`${name} #${i + 1}: repeated id ${r.id as string}.`);
        ids.add(r.id as string);
        const msg = CHECKS[name]?.(r);
        if (msg) errors.push(`${name} #${i + 1} (${r.id as string}): ${msg}.`);
      });
    }
  }
  if (errors.length) return { ok: false, errors: errors.slice(0, 50), backup: null };
  const d = data as Record<string, unknown>;
  const normal: AppData = {
    ...(Object.fromEntries(COLLECTIONS.map((c) => [c, (d[c] as unknown[]) ?? []])) as unknown as AppData),
    settings: normaliseSettings(d.settings as AppData['settings']),
    meta: { ...defaultMeta(), ...((d.meta as object) ?? {}), id: 'meta' },
  };
  return { ok: true, errors: [], backup: { ...(b as unknown as BackupFile), data: normal } };
}

/** Content key used to spot records that look the same but have different ids. */
function contentKey(name: CollectionName, r: Record<string, unknown>): string | null {
  switch (name) {
    case 'sessions': {
      const rd = (r.readings as { systolic: number; diastolic: number }[])[0];
      return `${r.sessionType}|${r.measuredAt}|${rd?.systolic}/${rd?.diastolic}`;
    }
    case 'doses':
      return `${r.medicationId}|${r.date}|${r.status}|${r.takenAt}`;
    case 'weights':
      return `${r.date}|${r.kg}|${r.measuredAt}`;
    case 'symptoms':
      return `${r.occurredAt}|${String(r.description).trim().toLowerCase()}`;
    case 'dailyLogs':
      return `${r.date}`;
    case 'habitChecks':
      return `${r.habitId}|${r.date}`;
    case 'stock':
      return `${r.medicationId}|${r.at}|${r.kind}|${r.units}`;
    default:
      return null;
  }
}

function stable(v: unknown): string {
  return JSON.stringify(v, (_k, val) =>
    val && typeof val === 'object' && !Array.isArray(val) ? Object.fromEntries(Object.entries(val).sort(([a], [b]) => a.localeCompare(b))) : val,
  );
}

export interface StorePlan {
  name: CollectionName;
  incoming: number;
  newRecords: unknown[];
  identical: number;
  conflicts: { existing: unknown; incoming: unknown }[];
  possibleDuplicates: { existing: unknown; incoming: unknown }[];
}

export interface ImportPlan {
  stores: StorePlan[];
  totalIncoming: number;
}

export function planImport(current: AppData, backup: BackupFile): ImportPlan {
  const stores: StorePlan[] = COLLECTIONS.map((name) => {
    const cur = current[name] as unknown as Record<string, unknown>[];
    const inc = backup.data[name] as unknown as Record<string, unknown>[];
    const byId = new Map(cur.map((r) => [r.id as string, r]));
    const byKey = new Map<string, Record<string, unknown>>();
    for (const r of cur) {
      const k = contentKey(name, r);
      if (k) byKey.set(k, r);
    }
    const plan: StorePlan = { name, incoming: inc.length, newRecords: [], identical: 0, conflicts: [], possibleDuplicates: [] };
    for (const r of inc) {
      const existing = byId.get(r.id as string);
      if (existing) {
        if (stable(existing) === stable(r)) plan.identical++;
        else plan.conflicts.push({ existing, incoming: r });
        continue;
      }
      const k = contentKey(name, r);
      const dupe = k ? byKey.get(k) : undefined;
      if (dupe) plan.possibleDuplicates.push({ existing: dupe, incoming: r });
      else plan.newRecords.push(r);
    }
    return plan;
  });
  return { stores, totalIncoming: stores.reduce((a, s) => a + s.incoming, 0) };
}

export interface MergeOptions {
  conflicts: 'keep_current' | 'use_backup';
  possibleDuplicates: 'skip' | 'import';
  settings: 'keep_current' | 'use_backup';
}

/** Produce the merged dataset. Current records are never removed by a merge. */
export function applyMerge(current: AppData, backup: BackupFile, plan: ImportPlan, opts: MergeOptions): AppData {
  const out: AppData = { ...current };
  for (const sp of plan.stores) {
    const list = [...(current[sp.name] as unknown as Record<string, unknown>[])];
    const index = new Map(list.map((r, i) => [r.id as string, i]));
    for (const r of sp.newRecords as Record<string, unknown>[]) list.push(r);
    if (opts.possibleDuplicates === 'import') for (const d of sp.possibleDuplicates) list.push(d.incoming as Record<string, unknown>);
    if (opts.conflicts === 'use_backup') {
      for (const c of sp.conflicts) {
        const inc = c.incoming as Record<string, unknown>;
        list[index.get(inc.id as string)!] = inc;
      }
    }
    (out as unknown as Record<string, unknown>)[sp.name] = list;
  }
  if (opts.settings === 'use_backup') out.settings = backup.data.settings;
  out.meta = current.meta;
  return out;
}

/** Replace: the backup becomes the full dataset (backup indicator kept from current device). */
export function applyReplace(current: AppData, backup: BackupFile): AppData {
  return { ...backup.data, meta: { ...backup.data.meta, lastBackupAt: current.meta.lastBackupAt, lastBackupMethod: current.meta.lastBackupMethod } };
}
