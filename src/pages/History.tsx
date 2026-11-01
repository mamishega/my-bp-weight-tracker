import { useState } from 'react';
import { useStore } from '../store/Store';
import type { SessionType } from '../types';
import { Badge, Button, Card, Checkbox, Empty, LinkButton, Modal, Notice, PageTitle, SelectField, TextField, useToast } from '../components/ui';
import { SESSION_LABEL, SESSION_STYLE, fmt, fmtBP, sessionAverage } from '../lib/bp';
import { addDays, formatDateShort, formatTime, isValidDate, todayIn } from '../lib/time';
import { FLAG_IS_WARNING, QUALITY_LABEL, findDuplicateDoses, findDuplicateSessions, findDuplicateSymptoms, findDuplicateWeights, sessionFlags } from '../lib/quality';
import { fmtWeight } from '../lib/weight';
import { dosesCsv, readingsCsv, symptomsCsv, weightsCsv } from '../lib/csv';
import { saveFile } from '../lib/files';
import { doseTiming } from '../lib/medication';
import { formatDuration } from '../lib/time';

type RecordType = 'all' | 'bp' | 'dose' | 'weight' | 'symptom';

interface Row { key: string; sortAt: string; date: string; kind: RecordType; title: string; detail: React.ReactNode; flags: React.ReactNode; edit?: string; onDelete?: () => void }

export function HistoryPage() {
  const { data, remove, mode } = useStore();
  const toast = useToast();
  const tz = data.settings.timeZone;
  const today = todayIn(tz);
  const [from, setFrom] = useState(addDays(today, -29));
  const [to, setTo] = useState(today);
  const [kind, setKind] = useState<RecordType>('all');
  const [stype, setStype] = useState<SessionType | 'all'>('all');
  const [onlyIssues, setOnlyIssues] = useState(false);
  const [del, setDel] = useState<Row | null>(null);
  const [reportOpts, setReportOpts] = useState({ sessionNotes: true, symptoms: true, lifestyle: false, doseNotes: true, questions: true, quality: true, weightNotes: false });

  const inRange = (d: string) => (!isValidDate(from) || d >= from) && (!isValidDate(to) || d <= to);
  const sDupes = findDuplicateSessions(data.sessions);
  const dDupes = findDuplicateDoses(data.doses);
  const wDupes = findDuplicateWeights(data.weights);
  const syDupes = findDuplicateSymptoms(data.symptoms);
  const rows: Row[] = [];

  if (kind === 'all' || kind === 'bp') {
    for (const s of data.sessions) {
      if (!inRange(s.date) || (stype !== 'all' && s.sessionType !== stype)) continue;
      const f = sessionFlags(s, data.sessions, data.doses, sDupes);
      if (onlyIssues && !f.some((x) => FLAG_IS_WARNING[x])) continue;
      const a = sessionAverage(s);
      const dose = s.linkedDoseIds.map((id) => data.doses.find((d) => d.id === id)).find(Boolean);
      const t = s.sessionType === 'morning_post' ? doseTiming(s, dose) : null;
      rows.push({
        key: s.id, sortAt: s.measuredAt, date: s.date, kind: 'bp',
        title: `${SESSION_STYLE[s.sessionType].symbol} ${SESSION_LABEL[s.sessionType]}`,
        detail: <><span className="font-semibold tabular-nums">{s.readings.map((r) => `${r.systolic}/${r.diastolic}${r.pulse ? ` (${r.pulse})` : ''}`).join(', ')}</span> → avg {fmtBP(a.systolic, a.diastolic)}{a.pulse != null && `, pulse ${fmt(a.pulse)}`} · {formatTime(s.measuredAt, s.timeZone, tz)}{t?.kind === 'ok' && ` · ${formatDuration(t.minutes)} after dose`}{s.notes && <span className="block text-slate-600">{s.notes}</span>}</>,
        flags: <>{f.map((x) => <Badge key={x} tone={FLAG_IS_WARNING[x] ? 'warn' : 'neutral'} icon={FLAG_IS_WARNING[x] ? '⚠️' : 'ℹ️'}>{QUALITY_LABEL[x]}</Badge>)}</>,
        edit: `#/add?id=${s.id}`,
        onDelete: () => remove('sessions', s.id),
      });
    }
  }
  if ((kind === 'all' && stype === 'all') || kind === 'dose') {
    for (const d of data.doses) {
      if (!inRange(d.date)) continue;
      const issues = d.status === 'taken' && !d.takenAt;
      if (onlyIssues && !issues && !dDupes.has(d.id)) continue;
      rows.push({ key: d.id, sortAt: d.takenAt ?? `${d.date}T00:00`, date: d.date, kind: 'dose', title: `💊 ${d.nameSnapshot} ${d.doseSnapshot}`, detail: <>{d.status === 'taken' ? '✔ Taken' : '⤼ Skipped'}{d.takenAt && ` at ${formatTime(d.takenAt, d.timeZone, tz)}`}{d.notes && <span className="block text-slate-600">{d.notes}</span>}</>, flags: <>{issues && <Badge tone="warn">Medication time unknown</Badge>}{dDupes.has(d.id) && <Badge tone="warn">Possible duplicate</Badge>}</>, edit: '#/medication', onDelete: () => remove('doses', d.id) });
    }
  }
  if ((kind === 'all' && stype === 'all') || kind === 'weight') {
    for (const w of data.weights) {
      if (!inRange(w.date) || (onlyIssues && !wDupes.has(w.id))) continue;
      rows.push({ key: w.id, sortAt: w.measuredAt ?? `${w.date}T00:00`, date: w.date, kind: 'weight', title: '⚖️ Weight', detail: <>{fmtWeight(w.kg, data.settings.weightUnit)} (entered {w.enteredValue} {w.enteredUnit}){w.measuredAt && ` · ${formatTime(w.measuredAt, w.timeZone, tz)}`}{w.notes && <span className="block text-slate-600">{w.notes}</span>}</>, flags: wDupes.has(w.id) ? <Badge tone="warn">Possible duplicate</Badge> : null, edit: '#/weight', onDelete: () => remove('weights', w.id) });
    }
  }
  if ((kind === 'all' && stype === 'all') || kind === 'symptom') {
    for (const s of data.symptoms) {
      if (!inRange(s.date) || (onlyIssues && !syDupes.has(s.id))) continue;
      rows.push({ key: s.id, sortAt: s.occurredAt, date: s.date, kind: 'symptom', title: '📝 Symptom', detail: <>{s.description}{s.severity && ` · ${s.severity}`} · {formatTime(s.occurredAt, s.timeZone, tz)}</>, flags: syDupes.has(s.id) ? <Badge tone="warn">Possible duplicate</Badge> : null, edit: '#/symptoms', onDelete: () => remove('symptoms', s.id) });
    }
  }
  rows.sort((a, b) => b.date.localeCompare(a.date) || b.sortAt.localeCompare(a.sortAt));

  const exportCsv = async (name: string, content: string) => {
    const out = await saveFile(`${mode === 'demo' ? 'DEMO-' : ''}${name}-${today}.csv`, content, 'text/csv');
    if (out.status === 'saved') toast('CSV saved.');
    else if (out.status === 'downloaded-unconfirmed') toast('CSV download started. Check your downloads.', 'info');
    else if (out.status === 'cancelled') toast('Export cancelled.', 'warn');
    else toast(`Export failed: ${out.error}`, 'danger');
  };

  const q = new URLSearchParams({ from, to, ...Object.fromEntries(Object.entries(reportOpts).map(([k, v]) => [k, v ? '1' : '0'])) });

  return (
    <div className="flex flex-col gap-4">
      <PageTitle sub="Every original record, with data-quality notes. Nothing is deleted automatically.">History &amp; Reports</PageTitle>
      <Card title="Filter">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <TextField label="From" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          <TextField label="To" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          <SelectField label="Record type" value={kind} onChange={(e) => setKind(e.target.value as RecordType)}>
            <option value="all">All records</option><option value="bp">Blood pressure</option><option value="dose">Medication doses</option><option value="weight">Weight</option><option value="symptom">Symptoms</option>
          </SelectField>
          <SelectField label="Session type" value={stype} onChange={(e) => { setStype(e.target.value as SessionType | 'all'); if (e.target.value !== 'all') setKind('bp'); }}>
            <option value="all">All session types</option>
            {(['morning_pre', 'morning_post', 'evening'] as SessionType[]).map((t) => <option key={t} value={t}>{SESSION_LABEL[t]}</option>)}
          </SelectField>
        </div>
        <div className="mt-3"><Checkbox label="Only show records with data-quality warnings" checked={onlyIssues} onChange={setOnlyIssues} hint="Possible duplicates, missing medication times, timing to review, unusual conditions." /></div>
      </Card>
      <Card title={`Records (${rows.length})`}>
        {rows.length === 0 ? <Empty>No records match these filters.</Empty> : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead><tr className="border-b"><th className="p-2" scope="col">Day</th><th className="p-2" scope="col">Record</th><th className="p-2" scope="col">Details</th><th className="p-2" scope="col">Data quality</th><th className="p-2" scope="col"><span className="sr-only">Actions</span></th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.key} className="border-b border-slate-100 align-top">
                    <td className="whitespace-nowrap p-2">{formatDateShort(r.date)}</td>
                    <td className="p-2 font-medium">{r.title}</td>
                    <td className="p-2">{r.detail}</td>
                    <td className="p-2"><div className="flex flex-wrap gap-1">{r.flags}</div></td>
                    <td className="whitespace-nowrap p-2">{r.edit && <LinkButton href={r.edit} variant="ghost">Edit</LinkButton>}{r.onDelete && <Button variant="ghost" onClick={() => setDel(r)}>Delete</Button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card title="Appointment report">
        <p className="mb-2">Prepare a printable summary for the dates above ({isValidDate(from) ? formatDateShort(from) : '—'} – {isValidDate(to) ? formatDateShort(to) : '—'}). You can preview it before printing or saving as PDF.</p>
        <fieldset className="grid gap-2 sm:grid-cols-2">
          <legend className="mb-1 font-medium">Optional content to include</legend>
          <Checkbox label="Notes on readings" checked={reportOpts.sessionNotes} onChange={(v) => setReportOpts({ ...reportOpts, sessionNotes: v })} />
          <Checkbox label="Symptoms diary" checked={reportOpts.symptoms} onChange={(v) => setReportOpts({ ...reportOpts, symptoms: v })} />
          <Checkbox label="Lifestyle notes" checked={reportOpts.lifestyle} onChange={(v) => setReportOpts({ ...reportOpts, lifestyle: v })} />
          <Checkbox label="Medication dose notes" checked={reportOpts.doseNotes} onChange={(v) => setReportOpts({ ...reportOpts, doseNotes: v })} />
          <Checkbox label="Weight notes" checked={reportOpts.weightNotes} onChange={(v) => setReportOpts({ ...reportOpts, weightNotes: v })} />
          <Checkbox label="My questions for the doctor" checked={reportOpts.questions} onChange={(v) => setReportOpts({ ...reportOpts, questions: v })} />
          <Checkbox label="Missing data and measurement quality notes" checked={reportOpts.quality} onChange={(v) => setReportOpts({ ...reportOpts, quality: v })} />
        </fieldset>
        <div className="mt-3"><LinkButton href={`#/report?${q.toString()}`} variant="primary">Preview report</LinkButton></div>
        <p className="mt-2 text-sm text-slate-600">Reports are never sent anywhere automatically. You decide whether to print, save or share them.</p>
      </Card>

      <Card title="CSV export">
        <p className="mb-2 text-sm">Spreadsheet files of your original records (all dates). CSV files are not backups — use the JSON backup in Settings to be able to restore.</p>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => exportCsv('bp-readings', readingsCsv(data))}>Blood pressure readings</Button>
          <Button onClick={() => exportCsv('medication-records', dosesCsv(data))}>Medication records</Button>
          <Button onClick={() => exportCsv('weight', weightsCsv(data))}>Weight</Button>
          <Button onClick={() => exportCsv('symptoms', symptomsCsv(data))}>Symptoms</Button>
        </div>
        <Notice tone="warn">Exported files contain sensitive personal health information. Store and share them carefully.</Notice>
      </Card>

      <Modal open={!!del} onClose={() => setDel(null)} title="Delete this record?" footer={<><Button onClick={() => setDel(null)}>Keep</Button><Button variant="danger" onClick={async () => { await del!.onDelete!(); setDel(null); toast('Record deleted.', 'info'); }}>Delete</Button></>}>
        <p>{del?.title} — {del && formatDateShort(del.date)}. This can’t be undone (except by restoring a backup).</p>
      </Modal>
    </div>
  );
}
