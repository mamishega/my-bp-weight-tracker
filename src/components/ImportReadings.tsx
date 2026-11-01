import { useMemo, useState } from 'react';
import { useStore } from '../store/Store';
import type { SessionType } from '../types';
import { Button, Card, Checkbox, Notice, SelectField, TextField, useToast } from './ui';
import { readFileText } from '../lib/files';
import { buildImport, guessDateOrder, guessMapping, parseCsv, type DateOrder, type Field, type Mapping } from '../lib/importCsv';
import { SESSION_LABEL, fmtBP, sessionAverage } from '../lib/bp';
import { formatDateShort, formatTime } from '../lib/time';

const FIELDS: { f: Field; label: string; required?: boolean }[] = [
  { f: 'datetime', label: 'Date and time (one column)' },
  { f: 'date', label: 'Date' },
  { f: 'time', label: 'Time' },
  { f: 'systolic', label: 'Systolic (top number)', required: true },
  { f: 'diastolic', label: 'Diastolic (bottom number)', required: true },
  { f: 'pulse', label: 'Pulse' },
  { f: 'notes', label: 'Notes' },
];

/** Import readings from a CSV export (monitor apps, other trackers). Read on this device only. */
export function ImportReadingsCard() {
  const { data, mode, putMany } = useStore();
  const toast = useToast();
  const tz = data.settings.timeZone;
  const [fileName, setFileName] = useState('');
  const [rows, setRows] = useState<string[][] | null>(null);
  const [mapping, setMapping] = useState<Mapping>({});
  const [order, setOrder] = useState<DateOrder>('dmy');
  const [eveningFrom, setEveningFrom] = useState('12:00');
  const [morningType, setMorningType] = useState<SessionType>('morning_pre');
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fileKey, setFileKey] = useState(0);

  const onFile = async (file?: File) => {
    setError(null); setRows(null); setConfirmed(false);
    if (!file) return;
    const all = parseCsv(await readFileText(file));
    if (all.length < 2) return setError('This file has no rows to import. Choose a CSV file with a header row and readings.');
    const m = guessMapping(all[0]);
    setFileName(file.name);
    setRows(all);
    setMapping(m);
    setOrder(guessDateOrder(all.slice(1, 40).map((r) => r[m.datetime ?? m.date ?? -1] ?? '')));
  };
  const header = rows?.[0] ?? [];
  const ready = rows && mapping.systolic !== undefined && mapping.diastolic !== undefined && (mapping.datetime !== undefined || (mapping.date !== undefined && mapping.time !== undefined));
  const preview = useMemo(
    () => (ready && rows ? buildImport(rows.slice(1), mapping, { eveningFrom, morningType, dateOrder: order, timeZone: tz, source: fileName || 'CSV file' }, data.sessions) : null),
    [ready, rows, mapping, eveningFrom, morningType, order, tz, fileName, data.sessions],
  );
  const doImport = async () => {
    if (!preview) return;
    // The patient confirmed these are the values their monitor recorded.
    await putMany('sessions', preview.sessions.map((s) => ({ ...s, unusualConfirmed: true })));
    toast(`Imported ${preview.readings} reading${preview.readings === 1 ? '' : 's'} in ${preview.sessions.length} session${preview.sessions.length === 1 ? '' : 's'}.`);
    setRows(null); setFileKey((k) => k + 1); setConfirmed(false);
  };

  if (mode === 'demo') return null;
  return (
    <Card title="Import readings from a CSV file" subtitle="From a monitor’s app or another tracker. Read on this device only." icon="upload" iconTone="blue">
      <label className="text-sm font-semibold text-slate-800" htmlFor="import-csv">Choose a CSV file</label>
      <input key={fileKey} id="import-csv" type="file" accept=".csv,text/csv,text/plain" className="mt-1.5 block w-full rounded-lg border border-dashed border-slate-300 bg-slate-50 p-2 text-sm text-slate-600 file:mr-3 file:min-h-10 file:cursor-pointer file:rounded-lg file:border file:border-slate-300 file:bg-white file:px-4 file:text-sm file:font-semibold file:text-slate-800" onChange={(e) => onFile(e.target.files?.[0])} />
      <p className="mt-1 text-sm text-slate-600">Most monitor apps (for example Omron Connect, Withings, Qardio) can export readings as CSV. Apple Health exports aren’t CSV and can’t be read yet.</p>
      {error && <div className="mt-3"><Notice tone="danger" role="alert">{error}</Notice></div>}
      {rows && (
        <div className="mt-4 flex flex-col gap-4">
          <fieldset>
            <legend className="mb-2 text-sm font-semibold text-slate-800">Which column holds what? (guessed from the header row; please check)</legend>
            <div className="grid gap-3 sm:grid-cols-2">
              {FIELDS.map(({ f, label }) => (
                <SelectField key={f} label={label} value={mapping[f] === undefined ? '' : String(mapping[f])} onChange={(e) => setMapping((m) => ({ ...m, [f]: e.target.value === '' ? undefined : Number(e.target.value) }))}>
                  <option value="">Not in this file</option>
                  {header.map((h, i) => <option key={i} value={i}>{h || `Column ${i + 1}`}</option>)}
                </SelectField>
              ))}
            </div>
          </fieldset>
          <div className="grid gap-3 sm:grid-cols-3">
            <SelectField label="Date format" value={order} onChange={(e) => setOrder(e.target.value as DateOrder)}>
              <option value="dmy">Day/month/year (Australia)</option>
              <option value="mdy">Month/day/year (US)</option>
              <option value="ymd">Year-month-day</option>
            </SelectField>
            <SelectField label="Readings before the evening time are" value={morningType} onChange={(e) => setMorningType(e.target.value as SessionType)}>
              <option value="morning_pre">{SESSION_LABEL.morning_pre}</option>
              <option value="morning_post">{SESSION_LABEL.morning_post}</option>
            </SelectField>
            <TextField label="Evening readings start at" type="time" value={eveningFrom} onChange={(e) => setEveningFrom(e.target.value || '12:00')} hint={`Times are read in ${tz}.`} />
          </div>
          {!ready && <Notice tone="warn">Choose the systolic, diastolic and date/time columns to see a preview.</Notice>}
          {preview && (
            <Notice tone="info" title="Preview">
              <p>{preview.readings} reading{preview.readings === 1 ? '' : 's'} in {preview.sessions.length} session{preview.sessions.length === 1 ? '' : 's'} (readings within 10 minutes are paired).{preview.skippedDuplicates > 0 && ` ${preview.skippedDuplicates} already in the app will be skipped.`}{preview.problems.length > 0 && ` ${preview.problems.length} row${preview.problems.length === 1 ? '' : 's'} couldn’t be read.`}</p>
              {preview.sessions.length > 0 && (
                <ul className="mt-2 text-sm">
                  {preview.sessions.slice(0, 5).map((s) => { const a = sessionAverage(s); return <li key={s.id}>{formatDateShort(s.date)} {formatTime(s.measuredAt, s.timeZone)} · {SESSION_LABEL[s.sessionType]} · {s.readings.map((r) => `${r.systolic}/${r.diastolic}`).join(', ')} (avg {fmtBP(a.systolic, a.diastolic)})</li>; })}
                  {preview.sessions.length > 5 && <li>…and {preview.sessions.length - 5} more</li>}
                </ul>
              )}
              {preview.problems.length > 0 && (
                <details className="mt-2"><summary className="cursor-pointer text-sm font-medium">Rows that couldn’t be read</summary>
                  <ul className="text-sm">{preview.problems.slice(0, 20).map((p) => <li key={p.row}>Row {p.row}: {p.reason}</li>)}</ul>
                </details>
              )}
            </Notice>
          )}
          {preview && preview.sessions.length > 0 && (
            <>
              <Checkbox label="These are the values my monitor recorded" checked={confirmed} onChange={setConfirmed} hint="Values are imported exactly as in the file. Session types follow the rule above; you can change any session afterwards in History." />
              <div><Button variant="primary" icon="upload" disabled={!confirmed} onClick={doImport}>Import {preview.sessions.length} session{preview.sessions.length === 1 ? '' : 's'}</Button></div>
            </>
          )}
        </div>
      )}
    </Card>
  );
}
