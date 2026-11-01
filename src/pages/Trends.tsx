import { useState } from 'react';
import { useStore } from '../store/Store';
import { useRoute, navigate } from '../store/router';
import type { SessionType, ISODate, AppData } from '../types';
import { DoseMark, DoseLegend, Badge, Button, Card, Checkbox, Empty, LinkButton, Notice, PageTitle, TextField } from '../components/ui';
import { BPChart, WeightChart } from '../components/Charts';
import { SESSION_LABEL, SESSION_STYLE, fmt, fmtBP, prePostComparison, sessionAverage, statsFor } from '../lib/bp';
import { addDays, dateRange, daysBetween, formatDateShort, formatTime, isValidDate, todayIn, weekStart } from '../lib/time';
import { dayDoseStatus, dayDoseSummary, doseCounts, medFrequency, medSchedule } from '../lib/medication';
import { describeChange, fmtWeight, movingAverage7 } from '../lib/weight';
import { lifestyleSummary } from './SymptomsLifestyle';
import { uid } from '../lib/defaults';

const TYPES: SessionType[] = ['morning_pre', 'morning_post', 'evening'];

export function StatsTable({ data, from, to }: { data: AppData; from: ISODate; to: ISODate }) {
  const sessions = data.sessions.filter((s) => s.date >= from && s.date <= to);
  return (
    <div>
      <p className="mb-2 text-sm text-slate-600">Each session type is summarised separately. They are never combined.</p>
      <div tabIndex={0} className="overflow-x-auto rounded-lg ring-1 ring-slate-200">
      <table className="w-full text-left text-sm [&_td]:px-3 [&_td]:py-2.5 [&_th]:px-3 [&_th]:py-2.5">
        <caption className="sr-only">Blood pressure summary by session type</caption>
        <thead><tr className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500"><th className="p-2" scope="col">Session type</th><th className="p-2" scope="col">Sessions</th><th className="p-2" scope="col">Readings</th><th className="p-2" scope="col">Single-reading</th><th className="p-2" scope="col">Average (mmHg)</th><th className="p-2" scope="col">Avg pulse</th><th className="p-2" scope="col">Range of readings</th></tr></thead>
        <tbody>
          {TYPES.map((t) => {
            const s = statsFor(sessions, t);
            return (
              <tr key={t} className="border-b border-slate-100">
                <th scope="row" className="p-2 font-medium"><span aria-hidden="true" style={{ color: SESSION_STYLE[t].color }}>{SESSION_STYLE[t].symbol} </span>{SESSION_LABEL[t]}</th>
                <td className="p-2">{s.sessions}</td>
                <td className="p-2">{s.readings}</td>
                <td className="p-2">{s.singleReadingSessions}</td>
                <td className="p-2 font-semibold tabular-nums">{s.meanSystolic == null ? '—' : fmtBP(s.meanSystolic, s.meanDiastolic!)}</td>
                <td className="p-2">{fmt(s.meanPulse)}</td>
                <td className="p-2">{s.minSystolic == null ? '—' : `${s.minSystolic}–${s.maxSystolic} / ${s.minDiastolic}–${s.maxDiastolic}`}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      </div>
      <p className="mt-2 text-xs text-slate-500">Averaging: each session’s average is the mean of its original readings (1 or 2). The period average is the mean of those session averages, each session counting equally. Days without readings are left out — never counted as zero.</p>
    </div>
  );
}

function RangePicker({ from, to, onChange }: { from: ISODate; to: ISODate; onChange: (f: ISODate, t: ISODate) => void }) {
  const { data } = useStore();
  const today = todayIn(data.settings.timeZone);
  const [cf, setCf] = useState(from);
  const [ct, setCt] = useState(to);
  const [rangeErr, setRangeErr] = useState<string | null>(null);
  const n = daysBetween(from, to) + 1;
  const preset = to === today && [7, 30, 90].includes(n) ? n : null;
  return (
    <div className="flex flex-wrap items-end gap-2" role="group" aria-label="Date range">
      {[7, 30, 90].map((d) => (
        <Button key={d} aria-pressed={preset === d} variant={preset === d ? 'primary' : 'secondary'} onClick={() => onChange(addDays(today, -(d - 1)), today)}>{d} days</Button>
      ))}
      <div className="w-40"><TextField label="From" type="date" value={cf} onChange={(e) => setCf(e.target.value)} /></div>
      <div className="w-40"><TextField label="To" type="date" value={ct} onChange={(e) => setCt(e.target.value)} /></div>
      <Button variant={preset ? 'secondary' : 'primary'} onClick={() => {
        if (!isValidDate(cf) || !isValidDate(ct)) return setRangeErr('Enter both dates.');
        if (cf > ct) return setRangeErr('The “From” date must be on or before the “To” date.');
        setRangeErr(null);
        onChange(cf, ct);
      }}>Apply custom range</Button>
      {rangeErr && <p role="alert" className="w-full text-sm font-medium text-red-700">{rangeErr}</p>}
    </div>
  );
}

function MedHistoryGrid({ data, from, to }: { data: AppData; from: ISODate; to: ISODate }) {
  const days = dateRange(from, to);
  const meds = data.medications;
  if (meds.length === 0) return <Empty>No medications added.</Empty>;
  return (
    <div tabIndex={0} className="overflow-x-auto">
      <table className="text-center text-xs">
        <thead><tr><th className="p-1 text-left">Medication</th>{days.map((d) => <th key={d} scope="col" className="p-0.5 font-normal text-slate-600">{d.slice(8)}</th>)}</tr></thead>
        <tbody>
          {meds.map((m) => (
            <tr key={m.id}>
              <th scope="row" className="whitespace-nowrap p-1 text-left font-medium">{m.name}</th>
              {days.map((d) => {
                const s = dayDoseStatus(data.doses, m, d);
                const sum = dayDoseSummary(data.doses, m, d);
                return <td key={d} className="p-0.5"><DoseMark status={s} label={`${formatDateShort(d)}${sum ? ` (${sum})` : ''}`} /></td>;
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <DoseLegend partial={meds.some((m) => medSchedule(m).perDay > 1)} notScheduled={meds.some((m) => medFrequency(m).kind !== 'daily' || !!m.endDate)} />
    </div>
  );
}

function WeeklyReview() {
  const { data, put } = useStore();
  const tz = data.settings.timeZone;
  const today = todayIn(tz);
  const [ws, setWs] = useState(weekStart(today));
  const [q, setQ] = useState('');
  const we = addDays(ws, 6);
  const days = dateRange(ws, we);
  const sessions = data.sessions.filter((s) => s.date >= ws && s.date <= we);
  const weights = data.weights.filter((w) => w.date >= ws && w.date <= we);
  const ma = movingAverage7(data.weights).filter((p) => p.date >= ws && p.date <= we);
  const unit = data.settings.weightUnit;
  const pastDays = days.filter((d) => d <= today);
  const habits = data.habits;
  const openQs = data.questions.filter((x) => !x.resolved);

  return (
    <Card title="Weekly review" subtitle="A supportive look at what you recorded" icon="calendar" actions={
      <div className="flex gap-2">
        <Button icon="chevronLeft" onClick={() => setWs(addDays(ws, -7))}>Previous week</Button>
        <Button onClick={() => setWs(addDays(ws, 7))} disabled={addDays(ws, 7) > today} >Next week <span aria-hidden="true">›</span></Button>
      </div>
    }>
      <p className="mb-3 font-medium">{formatDateShort(ws)} – {formatDateShort(we)}</p>
      <h3 className="font-semibold">Measurement sessions</h3>
      <div tabIndex={0} className="overflow-x-auto">
        <table className="w-full text-center text-sm">
          <thead><tr><th className="p-1 text-left">Session</th>{days.map((d) => <th key={d} scope="col" className="p-1 font-normal">{formatDateShort(d).split(',')[0]}</th>)}<th className="p-1">Recorded</th></tr></thead>
          <tbody>
            {TYPES.map((t) => {
              const n = pastDays.filter((d) => sessions.some((s) => s.date === d && s.sessionType === t)).length;
              return (
                <tr key={t} className="border-t">
                  <th scope="row" className="p-1 text-left font-medium">{SESSION_LABEL[t]}</th>
                  {days.map((d) => {
                    const has = sessions.some((s) => s.date === d && s.sessionType === t);
                    return <td key={d} className="p-1">{d > today ? '' : <span className="inline-flex justify-center"><DoseMark status={has ? 'taken' : 'not_recorded'} label={`${formatDateShort(d)}, ${has ? 'recorded' : 'not recorded'}`} /></span>}</td>;
                  })}
                  <td className="p-1">{n} of {pastDays.length}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="mt-2 text-xs text-slate-500">Filled tick = session recorded; dot = not recorded. Unrecorded sessions are simply missing data.</p>
      </div>
      <h3 className="mt-4 font-semibold">Averages for this week</h3>
      <StatsTable data={data} from={ws} to={we} />
      <h3 className="mt-4 font-semibold">Medication records</h3>
      <ul className="text-sm">
        {data.medications.filter((m) => m.active || data.doses.some((d) => d.medicationId === m.id && d.date >= ws && d.date <= we)).map((m) => {
          const c = doseCounts(data.doses, m, pastDays);
          if (medFrequency(m).kind === 'as_needed') return <li key={m.id}><span className="font-medium">{m.name} (only when needed):</span> taken {c.extraTaken} time{c.extraTaken === 1 ? '' : 's'}</li>;
          const unit = medSchedule(m).perDay > 1 || medFrequency(m).kind !== 'daily' ? `of ${c.expected} scheduled doses ` : '';
          return <li key={m.id}><span className="font-medium">{m.name}:</span> {c.taken} {unit}recorded as taken · {c.skipped} skipped · {c.notRecorded} not recorded{c.extraTaken ? ` · ${c.extraTaken} extra` : ''}</li>;
        })}
        {data.medications.length === 0 && <li>No medications added.</li>}
      </ul>
      <h3 className="mt-4 font-semibold">Weight</h3>
      <p className="text-sm">{weights.length} measurement{weights.length === 1 ? '' : 's'} this week.{' '}
        {ma.length >= 2 ? <>7-day average moved from {fmtWeight(ma[0].avgKg, unit)} to {fmtWeight(ma[ma.length - 1].avgKg, unit)} ({describeChange(ma[ma.length - 1].avgKg - ma[0].avgKg, unit).toLowerCase()}).</> : ma.length === 1 ? <>Latest: {fmtWeight(ma[0].kg, unit)}.</> : null}
      </p>
      <h3 className="mt-4 font-semibold">Habits you completed</h3>
      {habits.length === 0 ? <p className="text-sm">No habits chosen. <a href="#/symptoms?tab=habits" className="underline">Choose habits</a></p> : (
        <ul className="text-sm">
          {habits.map((h) => {
            const n = data.habitChecks.filter((c) => c.habitId === h.id && c.date >= ws && c.date <= we).length;
            return <li key={h.id}>{n > 0 ? `${h.name}: done on ${n} day${n === 1 ? '' : 's'} — well done for making time for it.` : `${h.name}: not ticked this week — every week is a fresh start.`}</li>;
          })}
        </ul>
      )}
      <h3 className="mt-4 font-semibold">Notes and questions for my doctor</h3>
      <ul className="list-disc pl-5 text-sm">
        {openQs.map((x) => <li key={x.id}>{x.text}</li>)}
        {openQs.length === 0 && <li className="list-none">No open questions.</li>}
      </ul>
      <form className="mt-2 flex flex-wrap items-end gap-2" onSubmit={async (e) => { e.preventDefault(); if (!q.trim()) return; const now = new Date().toISOString(); await put('questions', { id: uid(), text: q.trim(), appointmentId: null, resolved: false, createdAt: now, updatedAt: now }); setQ(''); }}>
        <div className="min-w-60 flex-1"><TextField label="Add a question" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <Button type="submit">Add</Button>
      </form>
      <p className="mt-3 text-sm text-slate-600">This review just shows what was recorded. It doesn’t label weeks as good or bad.</p>
    </Card>
  );
}

export function TrendsPage() {
  const { data } = useStore();
  const { params } = useRoute();
  const tz = data.settings.timeZone;
  const today = todayIn(tz);
  const from = params.get('from') && isValidDate(params.get('from')!) ? params.get('from')! : addDays(today, -29);
  const to = params.get('to') && isValidDate(params.get('to')!) ? params.get('to')! : today;
  const [visible, setVisible] = useState<Record<SessionType, boolean>>({ morning_pre: true, morning_post: true, evening: true });
  const sessions = data.sessions.filter((s) => s.date >= from && s.date <= to);
  const comp = prePostComparison(sessions);
  const logs = data.dailyLogs.filter((l) => l.date >= from && l.date <= to).sort((a, b) => a.date.localeCompare(b.date));
  const setRange = (f: string, t: string) => navigate(`/trends?from=${f}&to=${t}`);

  return (
    <div className="flex flex-col gap-4">
      <PageTitle sub="Trends show what you recorded. They can’t show why something changed." actions={<LinkButton href="#/week" icon="calendar">7-day measurement week</LinkButton>}>Trends &amp; Weekly Review</PageTitle>
      <Card><RangePicker key={from + to} from={from} to={to} onChange={setRange} /></Card>
      <Card title="Summary by session type" icon="list" iconTone="slate"><StatsTable data={data} from={from} to={to} /></Card>
      <Card title="Blood pressure and weight" subtitle="Aligned on a shared date axis" icon="chart">
        <fieldset className="mb-3 flex flex-wrap gap-4">
          <legend className="sr-only">Show session types</legend>
          {TYPES.map((t) => <Checkbox key={t} label={<><span aria-hidden="true" style={{ color: SESSION_STYLE[t].color }}>{SESSION_STYLE[t].symbol} </span>{SESSION_LABEL[t]}</>} checked={visible[t]} onChange={(v) => setVisible({ ...visible, [t]: v })} />)}
        </fieldset>
        <div className="flex flex-col gap-6">
          <BPChart sessions={sessions} measure="systolic" from={from} to={to} target={data.settings.targets.systolic} visible={visible} />
          <BPChart sessions={sessions} measure="diastolic" from={from} to={to} target={data.settings.targets.diastolic} visible={visible} />
          <WeightChart weights={data.weights} from={from} to={to} unit={data.settings.weightUnit} goalKg={data.settings.weightGoal.goalKg} />
        </div>
        <Notice tone="info">The charts share the same date axis. Changes that happen at the same time don’t show that one caused the other.</Notice>
        <details className="mt-3">
          <summary className="min-h-11 cursor-pointer py-2 font-medium">Show blood pressure data as a table</summary>
          {sessions.length === 0 ? <Empty>No readings.</Empty> : (
            <div tabIndex={0} className="overflow-x-auto rounded-lg ring-1 ring-slate-200">
              <table className="w-full text-left text-sm [&_td]:px-3 [&_td]:py-2.5 [&_th]:px-3 [&_th]:py-2.5">
                <thead><tr className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500"><th className="p-2">Day</th><th className="p-2">Session</th><th className="p-2">Time</th><th className="p-2">Original readings</th><th className="p-2">Session average</th><th className="p-2">Pulse</th></tr></thead>
                <tbody>
                  {[...sessions].sort((a, b) => a.measuredAt.localeCompare(b.measuredAt)).map((s) => {
                    const a = sessionAverage(s);
                    return <tr key={s.id} className="border-b border-slate-100"><td className="p-2">{formatDateShort(s.date)}</td><td className="p-2">{SESSION_STYLE[s.sessionType].symbol} {SESSION_LABEL[s.sessionType]}</td><td className="p-2">{formatTime(s.measuredAt, s.timeZone, tz)}</td><td className="p-2">{s.readings.map((r) => `${r.systolic}/${r.diastolic}`).join(', ')} {s.readings.length === 1 && <Badge>Single</Badge>}</td><td className="p-2 font-semibold">{fmtBP(a.systolic, a.diastolic)}</td><td className="p-2">{fmt(a.pulse)}</td></tr>;
                  })}
                </tbody>
              </table>
            </div>
          )}
        </details>
      </Card>

      <Card title="Before and after medication" subtitle="Observed differences, not proof of effect" icon="pill" iconTone="orange">
        {comp.days.length === 0 ? <Empty>No days in this period have both a before- and after-medication session.</Empty> : (
          <>
            <p className="mb-2">On <strong>{comp.days.length}</strong> day{comp.days.length === 1 ? '' : 's'} with both sessions, the after-medication session average differed from the before-medication average by <strong>{fmt(comp.meanDiffSys)}</strong> mmHg systolic and <strong>{fmt(comp.meanDiffDia)}</strong> mmHg diastolic on average (negative = lower after).</p>
            <div tabIndex={0} className="overflow-x-auto rounded-lg ring-1 ring-slate-200">
              <table className="w-full text-left text-sm [&_td]:px-3 [&_td]:py-2.5 [&_th]:px-3 [&_th]:py-2.5">
                <thead><tr className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500"><th className="p-2">Day</th><th className="p-2">Before</th><th className="p-2">After</th><th className="p-2">Observed difference</th></tr></thead>
                <tbody>{comp.days.map((d) => <tr key={d.date} className="border-b border-slate-100"><td className="p-2">{formatDateShort(d.date)}</td><td className="p-2">{fmtBP(d.pre.systolic, d.pre.diastolic)}</td><td className="p-2">{fmtBP(d.post.systolic, d.post.diastolic)}</td><td className="p-2">{fmt(d.diffSystolic)} / {fmt(d.diffDiastolic)}</td></tr>)}</tbody>
              </table>
            </div>
          </>
        )}
        <p className="mt-2 text-sm text-slate-600">These are observed differences between two measurements on the same morning. Time of day, rest, activity and normal variation also play a part, so they don’t show how well a medicine works. Uses the first session of each type per day.</p>
      </Card>

      <Card title="Medication recording history" icon="pill" iconTone="slate"><MedHistoryGrid data={data} from={from} to={to} /></Card>

      <Card title="Lifestyle context" subtitle="Context only — never treated as a cause" icon="activity" iconTone="slate">
        {logs.length === 0 ? <Empty>No daily lifestyle notes in this period.</Empty> : (
          <ul className="space-y-1 text-sm">{logs.map((l) => <li key={l.id}><strong>{formatDateShort(l.date)}:</strong> {lifestyleSummary(l) || l.notes}</li>)}</ul>
        )}
        <p className="mt-2 text-xs text-slate-600">Shown for context only. The app never claims a lifestyle factor caused a reading or weight change.</p>
      </Card>

      <WeeklyReview />
    </div>
  );
}
