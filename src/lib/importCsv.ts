// Import blood pressure readings from a CSV file exported by a monitor's app
// or another tracker. Nothing is uploaded: the file is read in the browser.
// Values are never changed; rows that can't be read are listed, not guessed.
import type { BPSession, SessionType } from '../types';
import { isValidDate, zonedToInstant } from './time';
import { validateReading } from './bp';
import { uid } from './defaults';

export type Field = 'date' | 'time' | 'datetime' | 'systolic' | 'diastolic' | 'pulse' | 'notes';
export type DateOrder = 'ymd' | 'dmy' | 'mdy';
export type Mapping = Partial<Record<Field, number>>;

/** Split CSV text into rows. Handles quotes, and comma, semicolon or tab separators. */
export function parseCsv(text: string): string[][] {
  const clean = text.replace(/^﻿/, '');
  const firstLine = clean.split(/\r?\n/, 1)[0] ?? '';
  const sep = [',', ';', '\t'].map((c) => [c, firstLine.split(c).length] as const).sort((a, b) => b[1] - a[1])[0][0];
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let q = false;
  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];
    if (q) {
      if (ch === '"' && clean[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') q = false;
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === sep) { row.push(cell.trim()); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && clean[i + 1] === '\n') i++;
      row.push(cell.trim());
      if (row.some((c) => c !== '')) rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  row.push(cell.trim());
  if (row.some((c) => c !== '')) rows.push(row);
  return rows;
}

const PATTERNS: [Field, RegExp][] = [
  ['systolic', /\b(sys|systolic|sbp|upper)\b/i],
  ['diastolic', /\b(dia|diastolic|dbp|lower)\b/i],
  ['pulse', /\b(pulse|heart ?rate|hr|bpm|pul)\b/i],
  ['datetime', /date.?(and|&|\/)?.?time|timestamp|measured.?at|datetime/i],
  ['date', /\bdate\b|\bday\b/i],
  ['time', /\btime\b/i],
  ['notes', /\b(note|notes|comment|comments|memo)\b/i],
];

/** Guess which column holds what, from the header row. */
export function guessMapping(header: string[]): Mapping {
  const m: Mapping = {};
  header.forEach((h, i) => {
    for (const [f, re] of PATTERNS) {
      if (m[f] === undefined && re.test(h)) {
        if ((f === 'date' || f === 'time') && PATTERNS[3][1].test(h)) continue;
        m[f] = i;
        break;
      }
    }
  });
  if (m.datetime !== undefined) { delete m.date; delete m.time; }
  return m;
}

/** Guess the date order from the values (a first part above 12 means day first). */
export function guessDateOrder(samples: string[]): DateOrder {
  let dmy = 0;
  let mdy = 0;
  for (const s of samples) {
    if (/^\d{4}[-/.]/.test(s)) return 'ymd';
    const m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.]\d{2,4}/);
    if (!m) continue;
    if (Number(m[1]) > 12) dmy++;
    if (Number(m[2]) > 12) mdy++;
  }
  return mdy > dmy ? 'mdy' : 'dmy'; // Australian default
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

export function parseDate(s: string, order: DateOrder): string | null {
  const t = s.trim();
  let y: number, mo: number, d: number;
  let m = t.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (m) [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  else if ((m = t.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/))) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    y = Number(m[3]) < 100 ? 2000 + Number(m[3]) : Number(m[3]);
    [d, mo] = order === 'mdy' ? [b, a] : [a, b];
  } else if ((m = t.match(/^(\d{1,2})[ -]([A-Za-z]{3})[A-Za-z]*[ -,]*(\d{4})/))) {
    [d, mo, y] = [Number(m[1]), MONTHS.indexOf(m[2].toLowerCase()) + 1, Number(m[3])];
  } else if ((m = t.match(/^([A-Za-z]{3})[A-Za-z]* (\d{1,2}),? (\d{4})/))) {
    [mo, d, y] = [MONTHS.indexOf(m[1].toLowerCase()) + 1, Number(m[2]), Number(m[3])];
  } else return null;
  const iso = `${String(y).padStart(4, '0')}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  return isValidDate(iso) ? iso : null;
}

export function parseTime(s: string): string | null {
  const m = s.trim().match(/(\d{1,2})[:.](\d{2})(?:[:.]\d{2})?\s*([ap]\.?m\.?)?/i);
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2]);
  const ap = m[3]?.toLowerCase().replace(/\./g, '');
  if (ap === 'pm' && h < 12) h += 12;
  if (ap === 'am' && h === 12) h = 0;
  if (h > 23 || min > 59) return null;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

export interface ImportRule {
  /** Readings at or after this time are evening; before it, `morningType`. */
  eveningFrom: string;
  morningType: SessionType;
  dateOrder: DateOrder;
  timeZone: string;
  source: string;
}

export interface ImportPreview {
  sessions: BPSession[];
  readings: number;
  skippedDuplicates: number;
  problems: { row: number; reason: string }[];
}

/** Turn mapped rows into sessions (readings within 10 minutes become one session, at most 2 readings). */
export function buildImport(rows: string[][], mapping: Mapping, rule: ImportRule, existing: BPSession[], now = new Date().toISOString()): ImportPreview {
  const problems: ImportPreview['problems'] = [];
  const parsed: { at: string; date: string; time: string; offset: number; sys: number; dia: number; pulse: number | null; notes: string }[] = [];
  rows.forEach((r, i) => {
    const rowNo = i + 2; // +1 header, +1 human counting
    const get = (f: Field) => (mapping[f] === undefined ? '' : r[mapping[f]!] ?? '');
    const dt = get('datetime');
    const date = parseDate(dt || get('date'), rule.dateOrder);
    // In a combined column the time is the part after the date ("2026-11-01T07:30", "01/11/2026 7:30 pm").
    const tm = dt.match(/[T\s,]+(\d{1,2}[:.]\d{2}(?:[:.]\d{2})?\s*(?:[ap]\.?m\.?)?)/i);
    const time = parseTime(dt ? tm?.[1] ?? '' : get('time'));
    if (!date) return problems.push({ row: rowNo, reason: 'Date not recognised' });
    if (!time) return problems.push({ row: rowNo, reason: 'Time not recognised' });
    const v = validateReading({ systolic: get('systolic'), diastolic: get('diastolic'), pulse: get('pulse').replace(/[^\d.]/g, '') }, 'r');
    if (!v.value) return problems.push({ row: rowNo, reason: v.issues[0]?.message ?? 'Values not recognised' });
    const z = zonedToInstant(date, time, rule.timeZone);
    parsed.push({ at: z.iso, date, time, offset: z.offsetMinutes, sys: v.value.systolic, dia: v.value.diastolic, pulse: v.value.pulse, notes: get('notes') });
  });
  parsed.sort((a, b) => a.at.localeCompare(b.at));

  const existingKeys = new Set(existing.flatMap((s) => s.readings.map((x) => `${x.measuredAt.slice(0, 16)}|${x.systolic}|${x.diastolic}`)));
  let skippedDuplicates = 0;
  const fresh = parsed.filter((p) => {
    const dup = existingKeys.has(`${p.at.slice(0, 16)}|${p.sys}|${p.dia}`);
    if (dup) skippedDuplicates++;
    return !dup;
  });

  const sessions: BPSession[] = [];
  for (const p of fresh) {
    const last = sessions[sessions.length - 1];
    if (last && last.readings.length < 2 && Date.parse(p.at) - Date.parse(last.readings[last.readings.length - 1].measuredAt) <= 10 * 60_000 && last.date === p.date) {
      last.readings.push({ systolic: p.sys, diastolic: p.dia, pulse: p.pulse, measuredAt: p.at });
      if (p.notes && !last.notes.includes(p.notes)) last.notes = [last.notes, p.notes].filter(Boolean).join(' · ');
      continue;
    }
    const type: SessionType = p.time >= rule.eveningFrom ? 'evening' : rule.morningType;
    sessions.push({
      id: uid(), sessionType: type, date: p.date, measuredAt: p.at, timeZone: rule.timeZone, utcOffsetMinutes: p.offset,
      readings: [{ systolic: p.sys, diastolic: p.dia, pulse: p.pulse, measuredAt: p.at }],
      arm: null, monitorId: null, monitorLabel: `Imported (${rule.source})`, conditionFlags: [], symptoms: '',
      notes: [p.notes, `Imported from ${rule.source}`].filter(Boolean).join(' · '), linkedDoseIds: [], unusualConfirmed: false, createdAt: now, updatedAt: now,
    } as BPSession);
  }
  return { sessions, readings: fresh.length, skippedDuplicates, problems };
}
