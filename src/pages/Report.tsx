import { useStore } from '../store/Store';
import { useRoute } from '../store/router';
import type { SessionType } from '../types';
import { Button, Notice } from '../components/ui';
import { StatsTable } from './Trends';
import { SESSION_LABEL, CONDITION_LABEL, fmt, fmtBP, prePostComparison, sessionAverage } from '../lib/bp';
import { addDays, dateRange, formatClock, formatDateLong, formatDateShort, formatDuration, formatOffset, formatTime, isValidDate, localDateOf, todayIn } from '../lib/time';
import { QUALITY_LABEL, findDuplicateSessions, sessionFlags } from '../lib/quality';
import { dayDoseStatus, doseTiming } from '../lib/medication';
import { fmtWeight, movingAverage7, describeChange } from '../lib/weight';
import { lifestyleSummary } from './SymptomsLifestyle';
import { SAFETY_STATEMENT } from '../lib/guidance';

const TYPES: SessionType[] = ['morning_pre', 'morning_post', 'evening'];

function H({ children }: { children: React.ReactNode }) {
  return <h2 className="mt-6 border-b-2 border-slate-800 pb-1 text-lg font-bold break-after-avoid">{children}</h2>;
}

export function ReportPage() {
  const { data, mode } = useStore();
  const { params } = useRoute();
  const tz = data.settings.timeZone;
  const today = todayIn(tz);
  const from = isValidDate(params.get('from') ?? '') ? params.get('from')! : addDays(today, -29);
  const to = isValidDate(params.get('to') ?? '') ? params.get('to')! : today;
  const opt = (k: string, def = true) => (params.has(k) ? params.get(k) === '1' : def);
  const unit = data.settings.weightUnit;
  const inR = (d: string) => d >= from && d <= to;
  const sessions = data.sessions.filter((s) => inR(s.date)).sort((a, b) => a.measuredAt.localeCompare(b.measuredAt));
  const doses = data.doses.filter((d) => inR(d.date)).sort((a, b) => a.date.localeCompare(b.date));
  const weights = data.weights.filter((w) => inR(w.date)).sort((a, b) => a.date.localeCompare(b.date));
  const ma = movingAverage7(data.weights).filter((p) => inR(p.date));
  const symptoms = data.symptoms.filter((s) => inR(s.date)).sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
  const logs = data.dailyLogs.filter((l) => inR(l.date)).sort((a, b) => a.date.localeCompare(b.date));
  const days = dateRange(from, to).filter((d) => d <= today);
  const dupes = findDuplicateSessions(data.sessions);
  const comp = prePostComparison(sessions);
  const nextAppt = [...data.appointments].filter((a) => a.date >= today).sort((a, b) => a.date.localeCompare(b.date))[0];
  const questions = data.questions.filter((q) => !q.resolved);
  const t = data.settings.targets;
  const medsInPeriod = data.medications.filter((m) => m.active || doses.some((d) => d.medicationId === m.id));

  const allFlags = sessions.map((s) => ({ s, f: sessionFlags(s, data.sessions, data.doses, dupes) }));
  const countFlag = (k: keyof typeof QUALITY_LABEL) => allFlags.filter((x) => x.f.includes(k)).length;

  return (
    <div className="mx-auto max-w-4xl bg-white p-4 text-slate-900 print:p-0">
      <div className="mb-4 flex flex-wrap gap-2 print:hidden">
        <Button variant="primary" onClick={() => window.print()}>🖨️ Print / Save as PDF</Button>
        <Button onClick={() => history.back()}>Back to options</Button>
        <p className="w-full text-sm text-slate-600">In the print dialog, choose “Save as PDF” to create a PDF. Nothing is sent anywhere.</p>
      </div>
      {mode === 'demo' && <Notice tone="demo" title="DEMO REPORT — SAMPLE DATA, NOT REAL HEALTH RECORDS" />}
      <header>
        <h1 className="text-2xl font-bold">Blood pressure &amp; weight summary</h1>
        <p>Period: <strong>{formatDateLong(from)} – {formatDateLong(to)}</strong></p>
        <p className="text-sm">Prepared {formatDateLong(today)} · Times shown in {tz} unless noted · Name: ______________________</p>
        {nextAppt && <p className="text-sm">For appointment: {formatDateLong(nextAppt.date)}{nextAppt.time && ` at ${formatClock(nextAppt.time)}`}{nextAppt.clinician && ` with ${nextAppt.clinician}`}</p>}
        <p className="mt-2 text-xs text-slate-700">Home-recorded data entered by the patient. {SAFETY_STATEMENT}</p>
      </header>

      <H>Medications</H>
      {medsInPeriod.length === 0 ? <p>No medications recorded.</p> : medsInPeriod.map((m) => (
        <div key={m.id} className="mt-2 break-inside-avoid">
          <p className="font-semibold">{m.name} {m.dose} — usual time {formatClock(m.usualTime)} {!m.active && '(no longer active)'}</p>
          {m.instructions && <p className="text-sm">Instructions: {m.instructions}</p>}
          {m.history.length > 1 && <ul className="text-sm">{m.history.map((v, i) => <li key={i}>From {formatDateShort(localDateOf(v.effectiveFrom, tz))}: {v.name} {v.dose}, usual {formatClock(v.usualTime)}</li>)}</ul>}
          <p className="text-sm">In this period: {days.filter((d) => dayDoseStatus(data.doses, m.id, d) === 'taken').length} days recorded as taken, {days.filter((d) => dayDoseStatus(data.doses, m.id, d) === 'skipped').length} skipped, {days.filter((d) => dayDoseStatus(data.doses, m.id, d) === 'not_recorded').length} not recorded.</p>
        </div>
      ))}
      {doses.length > 0 && (
        <table className="mt-2 w-full text-left text-xs">
          <thead><tr className="border-b"><th className="p-1">Date</th><th className="p-1">Medication (as recorded)</th><th className="p-1">Status</th><th className="p-1">Actual time</th>{opt('doseNotes') && <th className="p-1">Notes</th>}</tr></thead>
          <tbody>{doses.map((d) => <tr key={d.id} className="border-b border-slate-200"><td className="p-1">{formatDateShort(d.date)}</td><td className="p-1">{d.nameSnapshot} {d.doseSnapshot}</td><td className="p-1">{d.status}</td><td className="p-1">{d.status === 'taken' ? (d.takenAt ? formatTime(d.takenAt, d.timeZone, tz) : 'Medication time unknown') : '—'}</td>{opt('doseNotes') && <td className="p-1">{d.notes}</td>}</tr>)}</tbody>
        </table>
      )}

      <H>Blood pressure summary by session type</H>
      {(t.systolic != null || t.diastolic != null) && <p className="text-sm">Personal target entered from clinician advice: {t.systolic ?? '—'}/{t.diastolic ?? '—'} mmHg{t.source && ` (${t.source})`}.</p>}
      <StatsTable data={data} from={from} to={to} />

      {comp.days.length > 0 && (
        <>
          <H>Before vs after medication — observed differences</H>
          <p className="text-sm">{comp.days.length} days with both sessions. Mean observed difference (after − before): {fmt(comp.meanDiffSys)} / {fmt(comp.meanDiffDia)} mmHg. Observed differences only; not a measure of medication effectiveness.</p>
        </>
      )}

      <H>Original readings</H>
      {sessions.length === 0 ? <p>No readings in this period.</p> : (
        <table className="w-full text-left text-xs">
          <thead><tr className="border-b"><th className="p-1">Day</th><th className="p-1">Session</th><th className="p-1">Time</th><th className="p-1">Reading 1</th><th className="p-1">Reading 2</th><th className="p-1">Average</th><th className="p-1">Notes / quality</th></tr></thead>
          <tbody>
            {sessions.map((s) => {
              const a = sessionAverage(s);
              const dose = s.linkedDoseIds.map((id) => data.doses.find((d) => d.id === id)).find(Boolean);
              const tm = s.sessionType === 'morning_post' ? doseTiming(s, dose) : null;
              const f = allFlags.find((x) => x.s.id === s.id)!.f.filter((x) => x !== 'two_readings');
              const rd = (i: number) => (s.readings[i] ? `${s.readings[i].systolic}/${s.readings[i].diastolic}${s.readings[i].pulse ? ` p${s.readings[i].pulse}` : ''}` : '—');
              return (
                <tr key={s.id} className="break-inside-avoid border-b border-slate-200 align-top">
                  <td className="p-1">{formatDateShort(s.date)}</td>
                  <td className="p-1">{SESSION_LABEL[s.sessionType]}</td>
                  <td className="p-1">{formatTime(s.measuredAt, s.timeZone, tz)}{s.timeZone !== tz && ` ${formatOffset(s.utcOffsetMinutes)}`}{tm?.kind === 'ok' && <><br />{formatDuration(tm.minutes)} after dose</>}</td>
                  <td className="p-1">{rd(0)}</td>
                  <td className="p-1">{rd(1)}</td>
                  <td className="p-1 font-semibold">{fmtBP(a.systolic, a.diastolic)}</td>
                  <td className="p-1">
                    {opt('quality') && f.map((x) => QUALITY_LABEL[x]).join('; ')}
                    {opt('quality') && s.conditionFlags.length > 0 && <> ({s.conditionFlags.map((c) => CONDITION_LABEL[c]).join(', ')})</>}
                    {opt('sessionNotes') && (s.notes || s.symptoms) && <div>{[s.symptoms && `Symptoms: ${s.symptoms}`, s.notes].filter(Boolean).join(' · ')}</div>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      <H>Weight</H>
      {weights.length === 0 ? <p>No weight entries in this period.</p> : (
        <>
          <p className="text-sm">{weights.length} entries. First {fmtWeight(weights[0].kg, unit)} ({formatDateShort(weights[0].date)}), latest {fmtWeight(weights[weights.length - 1].kg, unit)} ({formatDateShort(weights[weights.length - 1].date)}): {describeChange(weights[weights.length - 1].kg - weights[0].kg, unit).toLowerCase()}.
            {data.settings.weightGoal.goalKg != null && ` Goal: ${fmtWeight(data.settings.weightGoal.goalKg, unit)}${data.settings.weightGoal.agreedWith ? ` (agreed with ${data.settings.weightGoal.agreedWith})` : ''}.`}</p>
          <table className="mt-1 w-full text-left text-xs">
            <thead><tr className="border-b"><th className="p-1">Date</th><th className="p-1">Weight</th><th className="p-1">7-day average (days with data)</th>{opt('weightNotes', false) && <th className="p-1">Notes</th>}</tr></thead>
            <tbody>{weights.map((w) => { const m = ma.find((x) => x.date === w.date); return <tr key={w.id} className="border-b border-slate-200"><td className="p-1">{formatDateShort(w.date)}</td><td className="p-1">{fmtWeight(w.kg, unit)}</td><td className="p-1">{m ? `${fmtWeight(m.avgKg, unit)} (${m.daysContributing})` : ''}</td>{opt('weightNotes', false) && <td className="p-1">{w.notes}</td>}</tr>; })}</tbody>
          </table>
        </>
      )}

      {opt('symptoms') && (
        <>
          <H>Symptoms diary</H>
          {symptoms.length === 0 ? <p>No symptoms recorded.</p> : (
            <ul className="text-sm">{symptoms.map((s) => <li key={s.id} className="break-inside-avoid">{formatDateShort(s.date)} {formatTime(s.occurredAt, s.timeZone, tz)}: {s.description}{s.severity && ` — ${s.severity}`}{s.duration && `, ${s.duration}`}{s.actionsTaken && `. Actions: ${s.actionsTaken}`}{s.notes && `. ${s.notes}`}</li>)}</ul>
          )}
        </>
      )}

      {opt('lifestyle', false) && (
        <>
          <H>Lifestyle notes (context only)</H>
          {logs.length === 0 ? <p>None.</p> : <ul className="text-sm">{logs.map((l) => <li key={l.id}>{formatDateShort(l.date)}: {[lifestyleSummary(l), l.notes].filter(Boolean).join(' · ')}</li>)}</ul>}
        </>
      )}

      {opt('quality') && (
        <>
          <H>Missing data and measurement quality</H>
          <ul className="text-sm">
            {TYPES.map((ty) => { const n = days.filter((d) => !sessions.some((s) => s.date === d && s.sessionType === ty)).length; return <li key={ty}>{SESSION_LABEL[ty]}: no session recorded on {n} of {days.length} days.</li>; })}
            <li>Single-reading sessions: {countFlag('single_reading')}</li>
            <li>Sessions with unusual measurement conditions noted: {countFlag('unusual_conditions')}</li>
            <li>After-medication sessions with medication time unknown: {countFlag('medication_time_unknown')}</li>
            <li>After-medication sessions measured before the linked dose (timing to review): {countFlag('measured_before_dose')}</li>
            <li>After-medication sessions with no linked dose: {countFlag('no_linked_dose')}</li>
            <li>Possible duplicate sessions (kept, not removed): {countFlag('possible_duplicate')}</li>
            <li>Taken doses with no time recorded: {doses.filter((d) => d.status === 'taken' && !d.takenAt).length}</li>
          </ul>
        </>
      )}

      {opt('questions') && (
        <>
          <H>My questions</H>
          {questions.length === 0 ? <p>None recorded.</p> : <ol className="list-decimal pl-5">{questions.map((q) => <li key={q.id}>{q.text}</li>)}</ol>}
        </>
      )}
      <p className="mt-6 text-xs text-slate-600">Generated by My BP &amp; Weight Tracker from records stored on the patient’s device. Averages: session average = mean of that session’s original readings; period average = mean of session averages, by session type.</p>
    </div>
  );
}
