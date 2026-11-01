import { useState } from 'react';
import { useStore } from '../store/Store';
import { useRoute } from '../store/router';
import type { MeasurementWeek } from '../types';
import { Badge, Button, Card, LinkButton, Notice, PageTitle, SelectField, TextField, useToast, DoseMark, TypedConfirm } from '../components/ui';
import { Logo } from '../components/Icon';
import { StatsTable } from './Trends';
import { MEASUREMENT_STEPS, SAFETY_STATEMENT, SOURCES } from '../lib/guidance';
import { fmtBP, sessionAverage } from '../lib/bp';
import { addDays, formatDateLong, formatDateShort, formatTime, isValidDate, todayIn } from '../lib/time';
import { uid } from '../lib/defaults';
import { MIN_COMPLETE_DAYS, WEEK_DAYS, currentWeek, weekEnd, weekProgress, type WeekProgress } from '../lib/week';

function Cell({ s, tz }: { s: WeekProgress['days'][number]['morning']; tz: string }) {
  if (!s) return <span className="inline-flex items-center gap-1.5 text-slate-500"><DoseMark status="not_recorded" /> Not recorded</span>;
  const a = sessionAverage(s);
  return (
    <span className="inline-flex flex-wrap items-center gap-x-1.5">
      <DoseMark status="taken" label="Recorded" />
      <strong className="tabular-nums">{fmtBP(a.systolic, a.diastolic)}</strong>
      <span className="text-xs text-slate-500">{formatTime(s.measuredAt, s.timeZone, tz)} · {s.readings.map((r) => `${r.systolic}/${r.diastolic}`).join(', ')}{s.readings.length === 1 ? ' (single)' : ''}</span>
    </span>
  );
}

export function WeekTable({ p, tz }: { p: WeekProgress; tz: string }) {
  return (
    <div tabIndex={0} className="overflow-x-auto rounded-lg ring-1 ring-slate-200">
      <table className="w-full text-left text-sm [&_td]:px-3 [&_td]:py-2 [&_th]:px-3 [&_th]:py-2">
        <caption className="sr-only">Measurement week, day by day</caption>
        <thead><tr className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500"><th scope="col">Day</th><th scope="col">Morning (before medication)</th><th scope="col">Evening</th></tr></thead>
        <tbody>
          {p.days.map((d, i) => (
            <tr key={d.date} className="border-t border-slate-100 align-top">
              <th scope="row" className="whitespace-nowrap font-medium">Day {i + 1}<span className="block text-xs font-normal text-slate-500">{formatDateShort(d.date)}</span></th>
              <td><Cell s={d.morning} tz={tz} /></td>
              <td><Cell s={d.evening} tz={tz} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function WeekFacts({ p }: { p: WeekProgress }) {
  return (
    <ul className="list-disc pl-5 text-sm text-slate-800">
      <li>Days with both a morning and an evening session: <strong>{p.completeDays} of {p.week.days}</strong> (the routine asks for at least {MIN_COMPLETE_DAYS})</li>
      <li>Sessions with two readings one minute apart: {p.twoReadingSessions} of {p.sessions}</li>
    </ul>
  );
}

function StartWeek() {
  const { data, saveSettings } = useStore();
  const toast = useToast();
  const today = todayIn(data.settings.timeZone);
  const [start, setStart] = useState(today);
  const [custom, setCustom] = useState('');
  const begin = async () => {
    const startDate = start === 'custom' ? custom : start;
    if (!isValidDate(startDate)) return;
    const w: MeasurementWeek = { id: uid(), startDate, days: WEEK_DAYS, createdAt: new Date().toISOString() };
    await saveSettings({ ...data.settings, measurementWeeks: [...(data.settings.measurementWeeks ?? []), w] });
    toast(`Measurement week set for ${formatDateShort(startDate)} to ${formatDateShort(weekEnd(w))}.`);
  };
  return (
    <Card title="Start a 7-day measurement week" subtitle="Often asked for before a blood pressure review" icon="calendar">
      <ol className="list-decimal space-y-1 pl-5 text-sm text-slate-800">{MEASUREMENT_STEPS.map((s) => <li key={s}>{s}</li>)}</ol>
      <p className="mt-2 text-xs text-slate-600">Source: <a href={SOURCES.homeMonitoring.url} target="_blank" rel="noopener noreferrer">{SOURCES.homeMonitoring.publisher}, {SOURCES.homeMonitoring.title}</a>. If your doctor gave you a different routine, follow theirs.</p>
      <div className="mt-4 grid max-w-xl gap-3 sm:grid-cols-2">
        <SelectField label="Start on" value={start} onChange={(e) => setStart(e.target.value)}>
          <option value={today}>Today ({formatDateShort(today)})</option>
          <option value={addDays(today, 1)}>Tomorrow ({formatDateShort(addDays(today, 1))})</option>
          <option value="custom">Another day…</option>
        </SelectField>
        {start === 'custom' && <TextField label="Start date" type="date" value={custom} onChange={(e) => setCustom(e.target.value)} />}
      </div>
      <div className="mt-4"><Button variant="primary" icon="calendar" disabled={start === 'custom' && !isValidDate(custom)} onClick={begin}>Start measurement week</Button></div>
      <p className="mt-2 text-sm text-slate-600">Tip: turn on the morning and evening reminders in <a href="#/settings">Settings</a> for the week.</p>
    </Card>
  );
}

export function MeasurementWeekPage() {
  const { data, saveSettings } = useStore();
  const { params } = useRoute();
  const tz = data.settings.timeZone;
  const today = todayIn(tz);
  const weeks = data.settings.measurementWeeks ?? [];
  const chosen = weeks.find((w) => w.id === params.get('id'));
  const cur = chosen ?? currentWeek(weeks, today);
  const [cancel, setCancel] = useState(false);
  const past = [...weeks].filter((w) => weekEnd(w) < today).reverse();

  if (!cur) {
    return (
      <div className="flex flex-col gap-4">
        <PageTitle sub="Morning and evening readings for 7 days, then a one-page summary for your doctor.">Measurement week</PageTitle>
        <StartWeek />
        {past.length > 0 && (
          <Card title="Past measurement weeks" icon="list" iconTone="slate">
            <ul className="flex flex-col gap-1">{past.map((w) => <li key={w.id}><a href={`#/week?id=${w.id}`}>{formatDateShort(w.startDate)} – {formatDateShort(weekEnd(w))}</a></li>)}</ul>
          </Card>
        )}
      </div>
    );
  }

  const p = weekProgress(data.sessions, cur, today);
  const todayRow = p.days.find((d) => d.date === today);
  const remove = async () => {
    await saveSettings({ ...data.settings, measurementWeeks: weeks.filter((w) => w.id !== cur.id) });
    setCancel(false);
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="print:hidden">
        <PageTitle sub={`${formatDateLong(cur.startDate)} – ${formatDateLong(p.endDate)}`} actions={<Button icon="printer" onClick={() => window.print()}>Print / Save as PDF</Button>}>
          Measurement week {p.finished ? <Badge tone="ok">Finished</Badge> : p.dayNumber === 0 ? <Badge>Starts {formatDateShort(cur.startDate)}</Badge> : <Badge tone="info">Day {p.dayNumber} of {cur.days}</Badge>}
        </PageTitle>
      </div>
      {todayRow && (
        <Card title="Today" icon="clock" className="print:hidden">
          <div className="flex flex-wrap gap-2">
            {todayRow.morning ? <Badge tone="ok" icon="check">Morning recorded</Badge> : <LinkButton href="#/add?type=morning_pre" variant="primary" icon="plus">Add morning reading (before medication)</LinkButton>}
            {todayRow.evening ? <Badge tone="ok" icon="check">Evening recorded</Badge> : <LinkButton href="#/add?type=evening" icon="plus">Add evening reading</LinkButton>}
          </div>
        </Card>
      )}
      <article className="rounded-xl border border-slate-200 bg-white p-6 text-slate-900 shadow-sm sm:p-8 print:border-0 print:p-0 print:shadow-none">
        <div className="mb-2 hidden items-center gap-2 text-sm font-semibold text-slate-600 print:flex"><Logo className="h-7 w-7" /> My BP &amp; Weight Tracker</div>
        <h2 className="text-lg font-bold">Home blood pressure: measurement week {formatDateShort(cur.startDate)} – {formatDateShort(p.endDate)}</h2>
        <p className="mb-3 text-xs text-slate-700">Home-recorded by the patient. Morning = before medication. {SAFETY_STATEMENT}</p>
        <WeekFacts p={p} />
        <h3 className="mt-4 mb-2 font-semibold">Averages for the week</h3>
        <StatsTable data={data} from={cur.startDate} to={p.endDate} />
        <h3 className="mt-4 mb-2 font-semibold">Day by day</h3>
        <WeekTable p={p} tz={tz} />
        <p className="mt-3 text-xs text-slate-600">Each cell shows the session average with the original readings. Only the first morning (before medication) and evening session each day is shown. All sessions are in History.</p>
      </article>
      <div className="flex flex-wrap gap-2 print:hidden">
        {chosen && !p.finished ? null : chosen ? <LinkButton href="#/week" icon="chevronLeft">Back</LinkButton> : null}
        <Button variant="ghost" onClick={() => setCancel(true)}>{p.finished ? 'Delete this week' : 'Cancel this week'}</Button>
      </div>
      {!p.finished && <Notice tone="info">Readings are never changed or removed by cancelling. Only the week’s dates are forgotten.</Notice>}
      <TypedConfirm open={cancel} onClose={() => setCancel(false)} onConfirm={remove} title="Remove this measurement week?" word="REMOVE" confirmLabel="Remove week">
        <p>Your readings stay in History. Only the week’s start date is removed.</p>
      </TypedConfirm>
    </div>
  );
}
