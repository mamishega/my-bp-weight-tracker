// At-a-glance overview at the top of the doctor's shared view. Factual
// summaries only: averages by session type (never combined), what was
// recorded, and counts against the target the patient entered from their
// clinician. No interpretation, no alerts.
import type { AppData, ISODate, SessionType } from '../types';
import { Stat, DoseMark, DoseLegend } from './ui';
import { SESSION_LABEL, SESSION_SHORT, SESSION_STYLE, fmt, fmtBP, sessionAverage, statsFor } from '../lib/bp';
import { addDays, dateRange, formatDateShort, formatDateTiny, formatTime } from '../lib/time';
import { dayDoseStatus, dayDoseSummary, describeSchedule, doseCounts, medFrequency, medSchedule } from '../lib/medication';
import { describeChange, fmtWeight, movingAverage7 } from '../lib/weight';

const TYPES: SessionType[] = ['morning_pre', 'morning_post', 'evening'];

export function DoctorDashboard({ data, from, to, showSymptoms }: { data: AppData; from: ISODate; to: ISODate; showSymptoms: boolean }) {
  const tz = data.settings.timeZone;
  const unit = data.settings.weightUnit;
  const t = data.settings.targets;
  const week = addDays(to, -6);
  const inPeriod = data.sessions.filter((s) => s.date >= from && s.date <= to && s.readings.length > 0);
  const inWeek = inPeriod.filter((s) => s.date >= week);
  const sorted = [...inPeriod].sort((a, b) => b.measuredAt.localeCompare(a.measuredAt));
  const latest = sorted[0];
  const latestAvg = latest ? sessionAverage(latest) : null;
  const days = dateRange(from, to);
  const daysWithReading = new Set(inPeriod.map((s) => s.date)).size;
  const weekDays = dateRange(week, to);

  const weights = data.weights.filter((w) => w.date >= from && w.date <= to).sort((a, b) => a.date.localeCompare(b.date));
  const lastW = weights[weights.length - 1];
  const ma = movingAverage7(data.weights).filter((p) => p.date <= to).pop();
  const meds = data.medications.filter((m) => m.active);

  const aboveTarget = (t.systolic != null || t.diastolic != null)
    ? inPeriod.filter((s) => { const a = sessionAverage(s); return (t.systolic != null && a.systolic > t.systolic) || (t.diastolic != null && a.diastolic > t.diastolic); }).length
    : null;
  const recentSymptoms = data.symptoms.filter((s) => s.date >= week && s.date <= to).length;

  return (
    <section aria-labelledby="overview-h" className="mt-6 break-inside-avoid">
      <h2 id="overview-h" className="border-b-2 border-slate-800 pb-1 text-lg font-bold">At a glance</h2>
      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Latest reading"
          value={latestAvg ? <>{fmtBP(latestAvg.systolic, latestAvg.diastolic)} <span className="text-sm font-medium text-slate-500">mmHg</span></> : '—'}
          sub={latest ? `${SESSION_SHORT[latest.sessionType]} · ${formatDateShort(latest.date)} ${formatTime(latest.measuredAt, latest.timeZone, tz)}${latest.readings.length === 1 ? ' · single reading' : ''}` : 'No readings in this period'}
        />
        <Stat label="Days with a reading" value={`${daysWithReading} of ${days.length}`} sub={`${inPeriod.length} sessions in this period`} />
        <Stat
          label="Latest weight"
          value={lastW ? fmtWeight(lastW.kg, unit) : '—'}
          sub={lastW ? `${formatDateShort(lastW.date)}${ma ? ` · 7-day avg ${fmtWeight(ma.avgKg, unit)}` : ''}${weights.length > 1 ? ` · ${describeChange(lastW.kg - weights[0].kg, unit).toLowerCase()} in period` : ''}` : 'No weight in this period'}
        />
        <Stat
          label="Patient’s target"
          value={t.systolic != null || t.diastolic != null ? <>{t.systolic ?? '—'}/{t.diastolic ?? '—'} <span className="text-sm font-medium text-slate-500">mmHg</span></> : 'Not entered'}
          sub={aboveTarget != null ? `${aboveTarget} of ${inPeriod.length} sessions averaged above it` : 'Entered by the patient from clinician advice'}
        />
      </div>

      <h3 className="mt-5 text-base font-semibold">Average by session type</h3>
      <p className="text-sm text-slate-600">Mean of session averages. Session types are never combined.</p>
      <div className="mt-2 grid gap-3 sm:grid-cols-3">
        {TYPES.map((ty) => {
          const p = statsFor(inPeriod, ty);
          const w = statsFor(inWeek, ty);
          return (
            <Stat
              key={ty}
              label={<><span aria-hidden="true" style={{ color: SESSION_STYLE[ty].color }}>{SESSION_STYLE[ty].symbol} </span>{SESSION_LABEL[ty]}</>}
              value={p.meanSystolic != null ? <>{fmt(p.meanSystolic)}/{fmt(p.meanDiastolic)} <span className="text-sm font-medium text-slate-500">mmHg</span></> : '—'}
              sub={`${p.sessions} session${p.sessions === 1 ? '' : 's'} in period · last 7 days: ${w.meanSystolic != null ? `${fmt(w.meanSystolic)}/${fmt(w.meanDiastolic)} (${w.sessions})` : 'none'}`}
            />
          );
        })}
      </div>

      {meds.length > 0 && (
        <>
          <h3 className="mt-5 text-base font-semibold">Medication records, last 7 days</h3>
          <div className="mt-2 flex flex-col gap-2">
            {meds.map((m) => {
              const st = weekDays.map((d) => ({ d, s: dayDoseStatus(data.doses, m, d), sum: dayDoseSummary(data.doses, m, d) }));
              const c = doseCounts(data.doses, m, weekDays);
              const multi = medSchedule(m).perDay > 1 || medFrequency(m).kind !== 'daily';
              const asNeeded = medFrequency(m).kind === 'as_needed';
              return (
                <div key={m.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg bg-slate-50 p-3 ring-1 ring-slate-200/70">
                  <p className="min-w-40 font-semibold">{m.name} {m.dose}<span className="block text-xs font-normal text-slate-500">{describeSchedule(m)}</span></p>
                  <ul className="flex gap-1" aria-label={`${m.name}, last 7 days`}>
                    {st.map((x) => <li key={x.d} className="flex flex-col items-center text-[0.65rem] text-slate-500"><DoseMark status={x.s} label={`${formatDateShort(x.d)}${x.sum ? ` (${x.sum})` : ''}`} />{formatDateTiny(x.d)}</li>)}
                  </ul>
                  <p className="text-sm text-slate-700">{asNeeded ? `Taken ${c.extraTaken} time${c.extraTaken === 1 ? '' : 's'} (only when needed)` : <>{multi ? `${c.taken} of ${c.expected} scheduled doses taken` : `Taken ${c.taken}`} · skipped {c.skipped} · not recorded {c.notRecorded}{c.extraTaken ? ` · ${c.extraTaken} extra` : ''}</>}</p>
                </div>
              );
            })}
            <DoseLegend partial={meds.some((m) => medSchedule(m).perDay > 1)} notScheduled={meds.some((m) => medFrequency(m).kind !== 'daily' || !!m.endDate)} />
          </div>
        </>
      )}

      {sorted.length > 0 && (
        <>
          <h3 className="mt-5 text-base font-semibold">Most recent sessions</h3>
          <div tabIndex={0} className="mt-2 overflow-x-auto rounded-lg ring-1 ring-slate-200">
            <table className="w-full text-left text-sm [&_td]:px-3 [&_td]:py-2 [&_th]:px-3 [&_th]:py-2">
              <caption className="sr-only">Five most recent blood pressure sessions</caption>
              <thead><tr className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500"><th scope="col">When</th><th scope="col">Session</th><th scope="col">Average</th><th scope="col">Readings</th></tr></thead>
              <tbody>
                {sorted.slice(0, 5).map((s) => {
                  const a = sessionAverage(s);
                  return (
                    <tr key={s.id} className="border-t border-slate-100">
                      <td>{formatDateShort(s.date)} {formatTime(s.measuredAt, s.timeZone, tz)}</td>
                      <td>{SESSION_SHORT[s.sessionType]}</td>
                      <td className="font-semibold tabular-nums">{fmtBP(a.systolic, a.diastolic)}{a.pulse != null && <span className="font-normal text-slate-500"> · pulse {fmt(a.pulse, 0)}</span>}</td>
                      <td className="tabular-nums">{s.readings.map((r) => `${r.systolic}/${r.diastolic}`).join(', ')}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {showSymptoms && (
        <p className="mt-4 text-sm text-slate-700">Symptom diary entries in the last 7 days: <strong>{recentSymptoms}</strong>{recentSymptoms > 0 && ' (details in the symptoms section below)'}.</p>
      )}
    </section>
  );
}
