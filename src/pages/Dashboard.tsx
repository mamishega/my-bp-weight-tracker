import { useState, type ReactNode } from 'react';
import { useStore } from '../store/Store';
import { Badge, DoseMark, Card, LinkButton, Button, PageTitle, Notice, Checkbox, cx } from '../components/ui';
import { Icon, type IconName } from '../components/Icon';
import { BackupNowButton, LastBackup, useNow } from '../components/Backup';
import { UrgentHelp, SafetyStatement } from '../components/safety';
import { DoseForm } from '../components/DoseForm';
import { sessionAverage, fmtBP, fmt, aboveContactThreshold } from '../lib/bp';
import { formatDateLong, formatTime, todayIn, formatDuration } from '../lib/time';
import { fmtWeight } from '../lib/weight';
import { dayDoseStatus, dayDoseSummary, daySlots, doseLabel, doseTiming, estimateSupply, medFrequency } from '../lib/medication';
import type { Medication, SessionType, DoseStatus } from '../types';

const SESSION_META: Record<SessionType, { icon: IconName; tone: 'blue' | 'orange' | 'green'; label: string }> = {
  morning_pre: { icon: 'sunrise', tone: 'blue', label: 'Morning · before meds' },
  morning_post: { icon: 'pill', tone: 'orange', label: 'Morning · after meds' },
  evening: { icon: 'moon', tone: 'green', label: 'Evening' },
};

function MetricCard({ icon, tone, eyebrow, title, status, children, footer }: { icon: IconName; tone: 'blue' | 'orange' | 'green' | 'teal' | 'slate' | 'violet'; eyebrow: string; title: string; status: ReactNode; children: ReactNode; footer: ReactNode }) {
  const tones = { blue: 'bg-blue-50 text-[#2a78d6] ring-blue-100', orange: 'bg-orange-50 text-[#c9521f] ring-orange-100', green: 'bg-emerald-50 text-[#138a5f] ring-emerald-100', teal: 'bg-teal-50 text-teal-700 ring-teal-100', slate: 'bg-slate-100 text-slate-600 ring-slate-200', violet: 'bg-violet-50 text-violet-700 ring-violet-100' }[tone];
  return (
    <article className="flex flex-col rounded-xl border border-slate-200/90 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04),0_1px_3px_rgba(15,23,42,0.03)]">
      <div className="flex items-start gap-3 px-5 pt-5">
        <span className={cx('inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ring-1', tones)} aria-hidden="true"><Icon name={icon} className="h-5 w-5" /></span>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{eyebrow}</p>
          <h2 className="font-semibold tracking-tight text-slate-900">{title}</h2>
        </div>
        <div className="shrink-0">{status}</div>
      </div>
      <div className="flex-1 px-5 py-4">{children}</div>
      <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 px-5 py-3">{footer}</div>
    </article>
  );
}

function BPCard({ type, today }: { type: SessionType; today: string }) {
  const { data } = useStore();
  const tz = data.settings.timeZone;
  const list = data.sessions.filter((s) => s.date === today && s.sessionType === type).sort((a, b) => a.measuredAt.localeCompare(b.measuredAt));
  const meta = SESSION_META[type];
  return (
    <MetricCard
      icon={meta.icon}
      tone={meta.tone}
      eyebrow="Blood pressure"
      title={meta.label}
      status={list.length ? <Badge tone="ok">Recorded</Badge> : <Badge>Not yet</Badge>}
      footer={<>
        <LinkButton href={`#/add?type=${type}`} variant={list.length ? 'secondary' : 'primary'} icon="plus" className="min-h-10 text-sm">{list.length ? 'Add another' : 'Record now'}</LinkButton>
        {list[0] && <LinkButton href={`#/add?id=${list[0].id}`} variant="ghost" icon="pencil" className="min-h-10 text-sm">Edit</LinkButton>}
      </>}
    >
      {list.length === 0 ? (
        <p className="text-sm text-slate-500">No session recorded yet today.</p>
      ) : (
        <ul className="space-y-4">
          {list.map((s, i) => {
            const a = sessionAverage(s);
            const dose = s.linkedDoseIds.map((id) => data.doses.find((d) => d.id === id)).find(Boolean);
            const t = type === 'morning_post' ? doseTiming(s, dose) : null;
            return (
              <li key={s.id} className={cx(i > 0 && 'border-t border-slate-100 pt-3')}>
                {i > 0 && <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Additional session</p>}
                <p className="flex items-baseline gap-1.5">
                  <span className="text-[2.5rem] font-bold leading-none tracking-tight tabular-nums text-slate-900">{fmtBP(a.systolic, a.diastolic)}</span>
                  <span className="text-sm font-medium text-slate-500">mmHg</span>
                </p>
                <p className="mt-2 text-sm text-slate-600">
                  {s.readings.length === 2 ? 'Average of 2 readings' : 'Single-reading session'} · {formatTime(s.measuredAt, s.timeZone, tz)}
                  {a.pulse != null && <> · Pulse {fmt(a.pulse)} bpm</>}
                </p>
                <p className="text-xs text-slate-500">Original readings: {s.readings.map((r) => `${r.systolic}/${r.diastolic}`).join(', ')}</p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {t?.kind === 'ok' && <Badge tone="info" icon="clock">{formatDuration(t.minutes)} after dose</Badge>}
                  {t?.kind === 'unknown_time' && <Badge tone="warn">Medication time unknown</Badge>}
                  {t?.kind === 'before_dose' && <Badge tone="warn">Timing to review</Badge>}
                </div>
                {aboveContactThreshold(s, data.settings) && (
                  <div className="mt-2">
                    <Notice tone="warn" title="Above the level your clinician asked you to report">
                      {data.settings.targets.contactInstruction || 'Follow the instructions your clinician gave you.'} If you have urgent symptoms, call 000.
                    </Notice>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </MetricCard>
  );
}

function MedRow({ med, today }: { med: Medication; today: string }) {
  const { data } = useStore();
  const [open, setOpen] = useState<DoseStatus | null>(null);
  const status = dayDoseStatus(data.doses, med, today);
  const { slots, extra } = daySlots(data.doses, med, today);
  const next = slots.find((s) => !s.record);
  const multi = slots.length > 1;
  const taken = slots[0]?.record?.status === 'taken' ? slots[0].record : null;
  const asNeeded = medFrequency(med).kind === 'as_needed';
  if (slots.length === 0) {
    // Only when needed, or not a dose day.
    return (
      <li className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="font-semibold text-slate-900">{med.name} <span className="font-normal text-slate-500">{med.dose}</span></p>
          <Badge tone={extra.some((d) => d.status === 'taken') ? 'ok' : 'neutral'}>{asNeeded ? (extra.length ? dayDoseSummary(data.doses, med, today) : 'Only when needed') : 'No dose today'}</Badge>
        </div>
        {asNeeded && <div><Button className="min-h-10 px-3 text-sm" icon="plus" onClick={() => setOpen('taken')}>Record a dose</Button></div>}
        {open && <DoseForm med={med} date={today} initialStatus="taken" open onClose={() => setOpen(null)} />}
      </li>
    );
  }
  return (
    <li className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-semibold text-slate-900">{med.name} <span className="font-normal text-slate-500">{med.dose}</span></p>
        <div>
          {multi ? (
            status === 'not_recorded' ? <Badge>Not recorded</Badge> : <Badge tone={status === 'taken' ? 'ok' : status === 'skipped' ? 'info' : 'neutral'}>{dayDoseSummary(data.doses, med, today)}</Badge>
          ) : (
            <>
              {status === 'not_recorded' && <Badge>Not recorded</Badge>}
              {status === 'taken' && <Badge tone="ok">Taken {taken?.takenAt ? `· ${formatTime(taken.takenAt, taken.timeZone)}` : '· time unknown'}</Badge>}
              {status === 'skipped' && <Badge tone="info" icon="skip">Skipped</Badge>}
            </>
          )}
        </div>
      </div>
      {multi && (
        <ul className="flex flex-wrap gap-1.5" aria-label={`${med.name} doses today`}>
          {slots.map((s) => (
            <li key={s.index} className="inline-flex items-center gap-1.5 rounded-full bg-slate-50 px-2 py-0.5 text-xs text-slate-700 ring-1 ring-slate-200">
              <DoseMark status={!s.record ? 'not_recorded' : s.record.status} label={doseLabel(med, s.index)} />
              {doseLabel(med, s.index)}
            </li>
          ))}
        </ul>
      )}
      {next && (
        <div className="grid grid-cols-2 gap-2">
          <Button variant="primary" className="min-h-10 whitespace-nowrap px-3 text-sm" icon="check" onClick={() => setOpen('taken')}>Record taken{multi && <span className="sr-only">: {doseLabel(med, next.index)}</span>}</Button>
          <Button className="min-h-10 whitespace-nowrap px-3 text-sm" onClick={() => setOpen('skipped')}>Record skipped{multi && <span className="sr-only">: {doseLabel(med, next.index)}</span>}</Button>
        </div>
      )}
      {multi && next && <p className="text-xs text-slate-500">Next to record: {doseLabel(med, next.index)}</p>}
      {open && next && <DoseForm med={med} date={today} doseIndex={next.index} initialStatus={open} open onClose={() => setOpen(null)} />}
    </li>
  );
}

function ProgressStep({ done, label, href }: { done: boolean; label: string; href: string }) {
  return (
    <a href={href} className={cx('flex min-h-10 items-center gap-2 rounded-lg border px-3 py-1.5 text-sm font-medium no-underline transition-colors', done ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300')}>
      <span className={cx('inline-flex h-5 w-5 items-center justify-center rounded-full', done ? 'bg-emerald-600 text-white' : 'ring-1 ring-slate-300')} aria-hidden="true">
        {done && <Icon name="check" className="h-3 w-3" strokeWidth={3} />}
      </span>
      {label}<span className="sr-only">: {done ? 'recorded' : 'not yet recorded'}</span>
    </a>
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
  const has = (t: SessionType) => data.sessions.some((s) => s.date === today && s.sessionType === t);
  const recordedCount = (['morning_pre', 'morning_post', 'evening'] as SessionType[]).filter(has).length;
  const medsDone = meds.length > 0 && meds.every((m) => daySlots(data.doses, m, today).slots.every((s) => s.record));
  // (Medicines with nothing scheduled today count as done.)
  const supplyWarnings = meds.map((m) => ({ m, e: estimateSupply(m, data.doses, data.stock, today) })).filter((x) => x.e.belowThreshold || x.e.renewalSoon);
  const hour = Number(new Intl.DateTimeFormat('en-AU', { timeZone: tz, hour: 'numeric', hourCycle: 'h23' }).format(now));
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';

  const toggleHabit = async (habitId: string, done: boolean) => {
    const id = `${habitId}:${today}`;
    if (done) await put('habitChecks', { id, habitId, date: today, createdAt: new Date().toISOString() });
    else await remove('habitChecks', id);
  };

  return (
    <div className="flex flex-col gap-6">
      <PageTitle eyebrow={greeting} actions={<><LinkButton href="#/add" variant="primary" icon="plus">Add reading</LinkButton><BackupNowButton variant="secondary" /></>}>
        {formatDateLong(today)}
      </PageTitle>

      <section aria-label="Today’s progress" className="flex flex-wrap items-center gap-2">
        <span className="mr-1 text-sm font-semibold text-slate-700">{recordedCount} of 3 sessions</span>
        {meds.length > 0 && <ProgressStep done={medsDone} label="Medication" href="#/medication" />}
        <ProgressStep done={has('morning_pre')} label="Before meds" href="#/add?type=morning_pre" />
        <ProgressStep done={has('morning_post')} label="After meds" href="#/add?type=morning_post" />
        <ProgressStep done={has('evening')} label="Evening" href="#/add?type=evening" />
        <ProgressStep done={weights.length > 0} label="Weight (optional)" href="#/weight" />
      </section>

      {isEmpty && mode === 'real' && (
        <Notice tone="info" title="Welcome — your dashboard is empty and ready">
          <p>Start by adding your medication and, if you have one, the weight goal agreed with your healthcare professional. Or record a reading straight away.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <LinkButton href="#/medication" variant="primary" icon="pill">Add medication</LinkButton>
            <LinkButton href="#/weight" icon="weight">Set weight goal</LinkButton>
            <Button variant="ghost" icon="flask" onClick={() => setMode('demo')}>Explore demo mode (sample data)</Button>
          </div>
        </Notice>
      )}

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

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <MetricCard
          icon="pill" tone="teal" eyebrow="Today’s doses" title="Medication"
          status={null}
          footer={<LinkButton href="#/medication" variant="ghost" className="min-h-10 text-sm" icon="chevronRight">{meds.length ? 'Doses & supply' : 'Add medication'}</LinkButton>}
        >
          {meds.length === 0 ? <p className="text-sm text-slate-500">No medication added yet.</p> : <ul className="divide-y divide-slate-100">{meds.map((m) => <MedRow key={m.id} med={m} today={today} />)}</ul>}
          <p className="mt-3 text-xs text-slate-500">Stays “Not recorded” until you record it. The app never assumes a dose was taken or missed.</p>
        </MetricCard>
        <BPCard type="morning_pre" today={today} />
        <BPCard type="morning_post" today={today} />
        <BPCard type="evening" today={today} />
        <MetricCard
          icon="weight" tone="violet" eyebrow="Optional" title="Weight"
          status={weights.length ? <Badge tone="ok">Recorded</Badge> : <Badge>Not today</Badge>}
          footer={<LinkButton href="#/weight" variant={weights.length ? 'secondary' : 'primary'} icon="plus" className="min-h-10 text-sm">{weights.length ? 'Add / view' : 'Record weight'}</LinkButton>}
        >
          {weights.length === 0 ? (
            <p className="text-sm text-slate-500">Weigh in whenever suits you — no need to weigh daily.</p>
          ) : (
            <p className="text-[2.5rem] font-bold leading-none tracking-tight tabular-nums text-slate-900">{fmtWeight(weights[weights.length - 1].kg, data.settings.weightUnit)}</p>
          )}
          {data.settings.weightGoal.goalKg != null && <p className="mt-2 text-sm text-slate-600">Goal: {fmtWeight(data.settings.weightGoal.goalKg, data.settings.weightUnit)}</p>}
        </MetricCard>
        <MetricCard
          icon="database" tone="slate" eyebrow="Your data" title="Backup"
          status={null}
          footer={<BackupNowButton variant="secondary" />}
        >
          <LastBackup />
          <p className="mt-2 text-sm text-slate-600">Records are stored only in this browser. A backup file protects them if browser data is cleared.</p>
        </MetricCard>
      </div>

      <Card title="Today’s healthy habits" subtitle="Celebrate the actions you choose — not the numbers." icon="award" iconTone="green" actions={<LinkButton href="#/symptoms?tab=habits" variant="ghost" className="min-h-10 text-sm">Choose habits</LinkButton>}>
        {habits.length === 0 ? (
          <p className="text-sm text-slate-600">Pick simple actions you’d like to do, such as a walk or preparing a meal at home.</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {habits.map((h) => {
              const done = data.habitChecks.some((c) => c.habitId === h.id && c.date === today);
              return (
                <div key={h.id} className={cx('rounded-lg border px-3 py-2.5', done ? 'border-emerald-200 bg-emerald-50/60' : 'border-slate-200')}>
                  <Checkbox label={<>{h.name}{done && <span className="ml-1 font-medium text-emerald-800">— done, nice work!</span>}</>} checked={done} onChange={(v) => toggleHabit(h.id, v)} />
                </div>
              );
            })}
          </div>
        )}
        <div className="mt-3">
          <LinkButton href="#/symptoms" variant="ghost" icon="clipboard" className="min-h-10 text-sm">Add a lifestyle note or symptom</LinkButton>
        </div>
      </Card>

      <UrgentHelp compact />
      <SafetyStatement />
    </div>
  );
}
