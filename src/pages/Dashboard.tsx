import { useState } from 'react';
import { useStore } from '../store/Store';
import { Badge, Card, LinkButton, Button, PageTitle, Notice, Checkbox } from '../components/ui';
import { BackupNowButton, LastBackup, useNow } from '../components/Backup';
import { UrgentHelp, SafetyStatement } from '../components/safety';
import { DoseForm } from '../components/DoseForm';
import { SESSION_LABEL, SESSION_STYLE, sessionAverage, fmtBP, fmt, readingKindLabel, aboveContactThreshold } from '../lib/bp';
import { formatDateLong, formatTime, todayIn, formatDuration } from '../lib/time';
import { fmtWeight } from '../lib/weight';
import { dayDoseStatus, doseTiming, estimateSupply } from '../lib/medication';
import type { Medication, SessionType, DoseStatus } from '../types';

function BPCard({ type, today }: { type: SessionType; today: string }) {
  const { data } = useStore();
  const tz = data.settings.timeZone;
  const list = data.sessions.filter((s) => s.date === today && s.sessionType === type).sort((a, b) => a.measuredAt.localeCompare(b.measuredAt));
  const st = SESSION_STYLE[type];
  return (
    <Card as="article" className="flex flex-col" title={<span className="flex items-center gap-2"><span aria-hidden="true" style={{ color: st.color }}>{st.symbol}</span>{SESSION_LABEL[type]}</span>}>
      {list.length === 0 ? (
        <div className="flex-1">
          <Badge tone="neutral" icon="○">Not yet recorded today</Badge>
        </div>
      ) : (
        <ul className="flex-1 space-y-3">
          {list.map((s, i) => {
            const a = sessionAverage(s);
            const dose = s.linkedDoseIds.map((id) => data.doses.find((d) => d.id === id)).find(Boolean);
            const t = type === 'morning_post' ? doseTiming(s, dose) : null;
            return (
              <li key={s.id}>
                {i === 0 && <Badge tone="ok">Recorded</Badge>}
                {i > 0 && <Badge tone="info">Additional session</Badge>}
                <p className="mt-1 text-4xl font-bold tabular-nums tracking-tight">
                  {fmtBP(a.systolic, a.diastolic)} <span className="text-base font-normal text-slate-600">mmHg</span>
                </p>
                <p className="text-sm text-slate-700">
                  {s.readings.length === 2 ? 'Average of 2 readings' : 'Single reading'} · {formatTime(s.measuredAt, s.timeZone, tz)}
                  {a.pulse != null && <> · Pulse {fmt(a.pulse)} bpm</>}
                </p>
                <p className="text-xs text-slate-600">{readingKindLabel(s)}: {s.readings.map((r) => `${r.systolic}/${r.diastolic}`).join(', ')}</p>
                {t?.kind === 'ok' && <p className="text-sm">⏱ {formatDuration(t.minutes)} after recorded dose</p>}
                {t?.kind === 'unknown_time' && <Badge tone="warn">Medication time unknown</Badge>}
                {t?.kind === 'before_dose' && <Badge tone="warn">Timing to review: measured before linked dose</Badge>}
                {aboveContactThreshold(s, data.settings) && (
                  <Notice tone="warn" title="Above the level your clinician asked you to report">
                    {data.settings.targets.contactInstruction || 'Follow the instructions your clinician gave you.'} If you have urgent symptoms, call 000.
                  </Notice>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        <LinkButton href={`#/add?type=${type}`} variant={list.length ? 'secondary' : 'primary'}>
          <span aria-hidden="true">➕</span> {list.length ? 'Add another' : 'Record now'}
        </LinkButton>
        {list[0] && <LinkButton href={`#/add?id=${list[0].id}`} variant="ghost">Edit</LinkButton>}
      </div>
    </Card>
  );
}

function MedRow({ med, today }: { med: Medication; today: string }) {
  const { data } = useStore();
  const [open, setOpen] = useState<DoseStatus | null>(null);
  const status = dayDoseStatus(data.doses, med.id, today);
  const rec = data.doses.filter((d) => d.medicationId === med.id && d.date === today);
  const taken = rec.find((d) => d.status === 'taken');
  return (
    <li className="rounded-lg border border-slate-200 p-3">
      <p className="font-semibold">{med.name} <span className="font-normal text-slate-700">{med.dose}</span></p>
      <div className="mt-1">
        {status === 'not_recorded' && <Badge tone="neutral" icon="○">Not recorded</Badge>}
        {status === 'taken' && <Badge tone="ok">Taken {taken?.takenAt ? `at ${formatTime(taken.takenAt, taken.timeZone)}` : '— medication time unknown'}</Badge>}
        {status === 'skipped' && <Badge tone="info" icon="⤼">Skipped</Badge>}
      </div>
      {status === 'not_recorded' && (
        <div className="mt-2 flex flex-wrap gap-2">
          <Button variant="primary" onClick={() => setOpen('taken')}>Record taken</Button>
          <Button onClick={() => setOpen('skipped')}>Record skipped</Button>
        </div>
      )}
      {open && <DoseForm med={med} date={today} initialStatus={open} open onClose={() => setOpen(null)} />}
    </li>
  );
}

export function Dashboard() {
  const { data, put, remove, mode, setMode } = useStore();
  const now = useNow(60_000);
  const tz = data.settings.timeZone;
  const today = todayIn(tz, now);
  const meds = data.medications.filter((m) => m.active);
  const weights = data.weights.filter((w) => w.date === today);
  const habits = data.habits.filter((h) => h.active);
  const isEmpty = data.sessions.length + data.weights.length + data.medications.length === 0;
  const recordedCount = (['morning_pre', 'morning_post', 'evening'] as SessionType[]).filter((t) => data.sessions.some((s) => s.date === today && s.sessionType === t)).length;
  const supplyWarnings = meds.map((m) => ({ m, e: estimateSupply(m, data.doses, data.stock, today) })).filter((x) => x.e.belowThreshold || x.e.renewalSoon);

  const toggleHabit = async (habitId: string, done: boolean) => {
    const id = `${habitId}:${today}`;
    if (done) await put('habitChecks', { id, habitId, date: today, createdAt: new Date().toISOString() });
    else await remove('habitChecks', id);
  };

  return (
    <div className="flex flex-col gap-4">
      <PageTitle sub={<>Today: <strong>{recordedCount} of 3</strong> blood pressure sessions recorded{weights.length ? ' · weight recorded' : ''}.</>}>
        {formatDateLong(today)}
      </PageTitle>

      {isEmpty && mode === 'real' && (
        <Notice tone="info" title="Welcome — your dashboard is empty and ready">
          <p>Start by adding your morning medication and, if you have one, the weight goal agreed with your healthcare professional. Or record a reading straight away.</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <LinkButton href="#/medication" variant="primary">Add medication</LinkButton>
            <LinkButton href="#/weight">Set weight goal</LinkButton>
            <Button variant="ghost" onClick={() => setMode('demo')}>Explore demo mode (sample data)</Button>
          </div>
        </Notice>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <Card as="article" title={<span><span aria-hidden="true">💊</span> Morning medication</span>}>
          {meds.length === 0 ? (
            <>
              <p className="text-slate-700">No medication added yet.</p>
              <LinkButton href="#/medication" className="mt-2">Add medication</LinkButton>
            </>
          ) : (
            <ul className="space-y-2">{meds.map((m) => <MedRow key={m.id} med={m} today={today} />)}</ul>
          )}
          <p className="mt-2 text-xs text-slate-600">Status stays “Not recorded” until you record it. The app never assumes a dose was taken or missed.</p>
        </Card>
        <BPCard type="morning_pre" today={today} />
        <BPCard type="morning_post" today={today} />
        <BPCard type="evening" today={today} />
        <Card as="article" title={<span><span aria-hidden="true">⚖️</span> Weight</span>}>
          {weights.length === 0 ? (
            <Badge tone="neutral" icon="○">Not recorded today (optional)</Badge>
          ) : (
            <>
              <Badge tone="ok">Recorded</Badge>
              <p className="mt-1 text-4xl font-bold tabular-nums">{fmtWeight(weights[weights.length - 1].kg, data.settings.weightUnit)}</p>
            </>
          )}
          {data.settings.weightGoal.goalKg != null && <p className="mt-1 text-sm text-slate-700">Goal: {fmtWeight(data.settings.weightGoal.goalKg, data.settings.weightUnit)}</p>}
          <LinkButton href="#/weight" className="mt-3" variant={weights.length ? 'secondary' : 'primary'}>
            <span aria-hidden="true">➕</span> {weights.length ? 'Add / view' : 'Record weight'}
          </LinkButton>
        </Card>
        <Card as="article" title={<span><span aria-hidden="true">💾</span> Backup</span>}>
          <LastBackup />
          <p className="mt-2 text-sm text-slate-700">Records are stored only in this browser. A backup file protects them if browser data is cleared.</p>
          <div className="mt-3"><BackupNowButton /></div>
        </Card>
      </div>

      {supplyWarnings.length > 0 && (
        <Notice tone="warn" title="Medication supply (estimate)">
          <ul>
            {supplyWarnings.map(({ m, e }) => (
              <li key={m.id}>
                {m.name}: {e.belowThreshold && <>about {e.remaining} units left (estimated). </>}
                {e.renewalSoon && m.supply?.renewalDate && <>Prescription renewal date {m.supply.renewalDate}. </>}
                <a href="#/medication">Check supply</a>
              </li>
            ))}
          </ul>
        </Notice>
      )}

      <Card title="Today’s healthy habits" actions={<LinkButton href="#/symptoms?tab=habits" variant="ghost">Choose habits</LinkButton>}>
        {habits.length === 0 ? (
          <p className="text-slate-700">Pick simple actions you’d like to do, such as a walk or preparing a meal at home.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {habits.map((h) => {
              const done = data.habitChecks.some((c) => c.habitId === h.id && c.date === today);
              return <Checkbox key={h.id} label={<>{h.name} {done && <span className="text-emerald-800">— done, nice work! 🎉</span>}</>} checked={done} onChange={(v) => toggleHabit(h.id, v)} />;
            })}
          </div>
        )}
        <div className="mt-3 flex flex-wrap gap-2">
          <LinkButton href="#/symptoms" variant="ghost">📝 Add lifestyle note or symptom</LinkButton>
        </div>
      </Card>

      <UrgentHelp compact />
      <SafetyStatement />
    </div>
  );
}
