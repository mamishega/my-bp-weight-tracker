import { useState } from 'react';
import { useStore } from '../store/Store';
import { useRoute, navigate } from '../store/router';
import { useDirtyForm } from '../store/dirty';
import type { Arm, BPSession, ConditionFlag, SessionType } from '../types';
import { SESSION_LABEL, SESSION_STYLE, CONDITION_LABEL, validateReading, sessionAverage, fmtBP, type FieldIssue } from '../lib/bp';
import { addDays, formatDuration, formatTime, instantToZoned, isValidDate, isValidTime, nowTimeIn, todayIn, zonedToInstant, formatDateShort } from '../lib/time';
import { doseTiming, suggestDoseLinks } from '../lib/medication';
import { sessionsLookDuplicate } from '../lib/quality';
import { uid } from '../lib/defaults';
import { Badge, Button, Card, Checkbox, Notice, Optional, PageTitle, RadioGroup, SelectField, TextArea, TextField, useToast, Modal } from '../components/ui';
import { Timer } from '../components/Timer';
import { MeasurementGuide, UrgentHelp } from '../components/safety';

interface ReadingInput { systolic: string; diastolic: string; pulse: string; time: string }

const emptyReading = (time: string): ReadingInput => ({ systolic: '', diastolic: '', pulse: '', time });

function plusMinute(t: string): string {
  const [h, m] = t.split(':').map(Number);
  const total = (h * 60 + m + 1) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

export function AddReading() {
  const { params } = useRoute();
  const { data } = useStore();
  const editId = params.get('id');
  const existing = editId ? data.sessions.find((s) => s.id === editId) : undefined;
  if (editId && !existing) return <Notice tone="warn" title="Reading not found">It may have been deleted. <a href="#/history">Go to History</a></Notice>;
  // key forces a fresh form when switching between records
  return <ReadingForm key={editId ?? params.get('type') ?? 'new'} existing={existing} initialType={(params.get('type') as SessionType) || null} />;
}

function ReadingForm({ existing, initialType }: { existing?: BPSession; initialType: SessionType | null }) {
  const { data, put, remove, saveSettings } = useStore();
  const toast = useToast();
  const settings = data.settings;
  const tz = existing?.timeZone ?? settings.timeZone;
  const now = new Date();
  const initDate = existing ? instantToZoned(existing.measuredAt, tz).date : todayIn(tz, now);
  const initTime = existing ? instantToZoned(existing.measuredAt, tz).time : nowTimeIn(tz, now);

  const [type, setType] = useState<SessionType | null>(existing?.sessionType ?? initialType);
  const [mDate, setMDate] = useState(initDate);
  const [sessionDay, setSessionDay] = useState(existing?.date ?? initDate);
  const [dayTouched, setDayTouched] = useState(!!existing && existing.date !== initDate);
  const [single, setSingle] = useState(existing ? existing.readings.length === 1 : false);
  const [r, setR] = useState<ReadingInput[]>(() =>
    existing
      ? [0, 1].map((i) => {
          const x = existing.readings[i];
          return x ? { systolic: String(x.systolic), diastolic: String(x.diastolic), pulse: x.pulse == null ? '' : String(x.pulse), time: instantToZoned(x.measuredAt, tz).time } : emptyReading(plusMinute(initTime));
        })
      : [emptyReading(initTime), emptyReading(plusMinute(initTime))],
  );
  const [arm, setArm] = useState<Arm | ''>(existing ? existing.arm ?? '' : settings.defaultArm ?? '');
  const [monitorId, setMonitorId] = useState(existing ? existing.monitorId ?? '' : settings.defaultMonitorId ?? '');
  const [saveDefaults, setSaveDefaults] = useState(false);
  const [flags, setFlags] = useState<ConditionFlag[]>(existing?.conditionFlags ?? []);
  const [symptoms, setSymptoms] = useState(existing?.symptoms ?? '');
  const [notes, setNotes] = useState(existing?.notes ?? '');
  const [linked, setLinked] = useState<string[]>(existing?.linkedDoseIds ?? suggestDoseLinks(initDate, data.doses));
  const [linkTouched, setLinkTouched] = useState(!!existing);
  const [confirmed, setConfirmed] = useState(existing?.unusualConfirmed ?? false);
  const [submitted, setSubmitted] = useState(false);
  const [dupeAck, setDupeAck] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  useDirtyForm('reading', dirty);

  const touch = () => setDirty(true);
  const setReading = (i: number, k: keyof ReadingInput, v: string) => {
    touch();
    setR((rs) => rs.map((x, j) => (j === i ? { ...x, [k]: v } : x)));
    setConfirmed(false);
  };
  const onDate = (v: string) => {
    touch();
    setMDate(v);
    if (!dayTouched) setSessionDay(v);
    if (!linkTouched) setLinked(suggestDoseLinks(v, data.doses));
  };

  const count = single ? 1 : 2;
  const validations = r.slice(0, count).map((x, i) => validateReading(x, `r${i}`));
  const issues: FieldIssue[] = validations.flatMap((v) => v.issues);
  const timeErrors: Record<string, string> = {};
  if (!isValidDate(mDate)) timeErrors.mDate = 'Enter a valid date.';
  if (!isValidDate(sessionDay)) timeErrors.sessionDay = 'Enter a valid date.';
  r.slice(0, count).forEach((x, i) => { if (!isValidTime(x.time)) timeErrors[`t${i}`] = 'Enter a valid time.'; });
  const errors = issues.filter((i) => i.level === 'error');
  const checks = issues.filter((i) => i.level === 'check');
  const issueFor = (f: string, lvl: 'error' | 'check') => (submitted || lvl === 'check' ? issues.find((i) => i.field === f && i.level === lvl)?.message : undefined) ?? null;

  const zoned = Object.keys(timeErrors).length
    ? null
    : r.slice(0, count).map((x, i) => {
        // A second reading earlier on the clock than the first is treated as past midnight.
        const d = i === 1 && x.time < r[0].time ? addDays(mDate, 1) : mDate;
        return zonedToInstant(d, x.time, tz);
      });

  const draft: BPSession | null = zoned && errors.length === 0 && type
    ? {
        id: existing?.id ?? 'draft',
        sessionType: type,
        date: sessionDay,
        measuredAt: zoned[0].iso,
        timeZone: tz,
        utcOffsetMinutes: zoned[0].offsetMinutes,
        readings: validations.map((v, i) => ({ ...v.value!, measuredAt: zoned[i].iso })),
        arm: arm || null,
        monitorId: monitorId || null,
        monitorLabel: settings.monitors.find((m) => m.id === monitorId)?.label ?? existing?.monitorLabel ?? null,
        conditionFlags: flags,
        symptoms,
        notes,
        linkedDoseIds: type === 'morning_post' ? linked : [],
        unusualConfirmed: checks.length > 0 && confirmed,
        createdAt: existing?.createdAt ?? new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }
    : null;
  const lookalikes = draft ? data.sessions.filter((s) => sessionsLookDuplicate(draft, s)) : [];
  const candidateDoses = data.doses.filter((d) => d.date >= addDays(sessionDay, -1) && d.date <= sessionDay).sort((a, b) => (b.takenAt ?? '').localeCompare(a.takenAt ?? ''));

  const save = async () => {
    setSubmitted(true);
    if (!type || errors.length || Object.keys(timeErrors).length || !draft) {
      // Move focus to the first problem: the session type if missing, otherwise the first invalid field.
      requestAnimationFrame(() => (type ? document.querySelector<HTMLElement>('[aria-invalid="true"]') : document.querySelector<HTMLElement>('#type-fieldset input'))?.focus());
      return;
    }
    if (checks.length && !confirmed) return;
    if (lookalikes.length && !dupeAck) return;
    const rec = { ...draft, id: existing?.id ?? uid() };
    await put('sessions', rec);
    if (saveDefaults) await saveSettings({ ...settings, defaultArm: (arm || null) as Arm | null, defaultMonitorId: monitorId || null });
    setDirty(false);
    const leave = () => (existing && window.history.length > 1 ? window.history.back() : navigate('/'));
    toast(`${SESSION_LABEL[rec.sessionType]} saved: ${fmtBP(sessionAverage(rec).systolic, sessionAverage(rec).diastolic)} mmHg${rec.readings.length === 1 ? ' (single reading)' : ' (average of 2)'}.`);
    leave();
  };

  const del = async () => {
    if (!existing) return;
    await remove('sessions', existing.id);
    setDirty(false);
    toast('Session deleted.', 'info');
    navigate('/history');
  };

  const gapOrAmbiguous = zoned?.find((z) => z.status !== 'ok');
  const afterMidnight = type === 'evening' && isValidTime(r[0].time) && r[0].time < '05:00';

  return (
    <div className="flex flex-col gap-4">
      <PageTitle sub="Record what your monitor shows. Optional details are folded away.">{existing ? 'Edit reading' : 'Add Reading'}</PageTitle>
      <MeasurementGuide />
      <div className="grid gap-2 sm:grid-cols-2">
        <Timer seconds={300} label="5-min rest" doneText="Rest complete — take your first reading when ready." />
        <Timer seconds={60} label="1-min interval" doneText="One minute passed — take your second reading when ready." />
      </div>
      <p className="text-sm text-slate-600">Timers are optional. You can enter or edit readings at any time.</p>

      <form onSubmit={(e) => { e.preventDefault(); void save(); }} noValidate className="flex flex-col gap-4">
        <Card>
          <div id="type-fieldset">
            <RadioGroup
              name="session-type"
              legend="Session type (you choose — the app never relabels it by clock time)"
              value={type}
              onChange={(v) => { touch(); setType(v); }}
              options={(['morning_pre', 'morning_post', 'evening'] as SessionType[]).map((t) => ({ value: t, label: <><span aria-hidden="true" style={{ color: SESSION_STYLE[t].color }}>{SESSION_STYLE[t].symbol} </span>{SESSION_LABEL[t]}</> }))}
            />
          </div>
          {submitted && !type && <p className="mt-2 text-sm font-medium text-red-700" role="alert">Choose a session type.</p>}
        </Card>

        <Card title="Readings" subtitle="Enter exactly what your monitor shows (mmHg)" icon="activity">
          <div className="mb-3 grid gap-3 sm:grid-cols-2">
            <TextField label="Measurement date" type="date" value={mDate} onChange={(e) => onDate(e.target.value)} error={timeErrors.mDate} />
            <TextField label="Time of first reading" type="time" value={r[0].time} onChange={(e) => { setReading(0, 'time', e.target.value); if (r[1].time === plusMinute(r[0].time)) setReading(1, 'time', plusMinute(e.target.value)); }} error={timeErrors.t0} hint={`Time zone: ${tz}`} />
          </div>
          {gapOrAmbiguous?.status === 'gap' && <Notice tone="warn">This time doesn’t exist on this date because clocks moved forward for daylight saving. It will be saved as {formatTime(gapOrAmbiguous.iso, tz)}. Please check the time.</Notice>}
          {gapOrAmbiguous?.status === 'ambiguous' && <Notice tone="info">This time happens twice on this date because clocks moved back. It will be saved as the first occurrence (offset {gapOrAmbiguous.offsetMinutes / 60} h).</Notice>}

          <div className="mb-2 flex flex-wrap gap-2" role="group" aria-label="Number of readings">
            <Button variant={!single ? 'primary' : 'secondary'} aria-pressed={!single} onClick={() => { touch(); setSingle(false); }}>Two readings (recommended)</Button>
            <Button variant={single ? 'primary' : 'secondary'} aria-pressed={single} onClick={() => { touch(); setSingle(true); }}>Single reading</Button>
          </div>
          {single && <Badge tone="info">This will be saved as a single-reading session</Badge>}

          {r.slice(0, count).map((x, i) => (
            <fieldset key={i} className="mt-3 rounded-lg border border-slate-200 p-3">
              <legend className="px-1 font-semibold">Reading {i + 1}</legend>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <TextField label="Systolic (top)" inputMode="numeric" autoComplete="off" value={x.systolic} onChange={(e) => setReading(i, 'systolic', e.target.value)} error={issueFor(`r${i}.systolic`, 'error')} check={issueFor(`r${i}.systolic`, 'check')} className="text-2xl font-bold" />
                <TextField label="Diastolic (bottom)" inputMode="numeric" autoComplete="off" value={x.diastolic} onChange={(e) => setReading(i, 'diastolic', e.target.value)} error={issueFor(`r${i}.diastolic`, 'error')} check={issueFor(`r${i}.diastolic`, 'check')} className="text-2xl font-bold" />
                <TextField label="Pulse (bpm)" optional inputMode="numeric" autoComplete="off" value={x.pulse} onChange={(e) => setReading(i, 'pulse', e.target.value)} error={issueFor(`r${i}.pulse`, 'error')} check={issueFor(`r${i}.pulse`, 'check')} />
                {i === 1 && <TextField label="Time" type="time" value={x.time} onChange={(e) => setReading(1, 'time', e.target.value)} error={timeErrors.t1} />}
              </div>
            </fieldset>
          ))}

          {draft && (
            <p className="mt-3 text-lg" aria-live="polite">
              Session average: <strong className="tabular-nums">{fmtBP(sessionAverage(draft).systolic, sessionAverage(draft).diastolic)} mmHg</strong>
              <span className="text-sm text-slate-600"> ({draft.readings.length === 2 ? 'mean of 2 original readings; both are kept' : 'single reading'})</span>
            </p>
          )}

          {checks.length > 0 && (
            <div className="mt-3">
              <Notice tone="warn" title="Please check these values">
                <p>Some values are unusual. Check they match your monitor. If they are correct, confirm and save — high readings are never discarded.</p>
              </Notice>
              <div className="mt-2">
                <Checkbox label="I’ve checked — these are the values my monitor showed" checked={confirmed} onChange={setConfirmed} />
              </div>
              {submitted && !confirmed && <p className="mt-1 text-sm font-medium text-red-700" role="alert">Confirm the values, or correct them, to save.</p>}
            </div>
          )}
        </Card>

        {type === 'morning_post' && (
          <Card title="Linked medication dose" icon="pill" iconTone="orange">
            {candidateDoses.length === 0 ? (
              <Notice tone="warn" title="No dose recorded for this day">You can still save. Record the dose on the Medication page and link it later by editing this reading. <a href="#/medication">Record a dose</a></Notice>
            ) : (
              <div className="flex flex-col gap-2">
                {candidateDoses.map((d) => {
                  const t = draft ? doseTiming(draft, d) : null;
                  return (
                    <Checkbox
                      key={d.id}
                      checked={linked.includes(d.id)}
                      onChange={(v) => { touch(); setLinkTouched(true); setLinked((l) => (v ? [...l, d.id] : l.filter((x) => x !== d.id))); }}
                      label={<>{d.nameSnapshot} {d.doseSnapshot} — {formatDateShort(d.date)}, {d.status === 'skipped' ? 'recorded as skipped' : d.takenAt ? `taken ${formatTime(d.takenAt, d.timeZone)}` : 'Medication time unknown'}</>}
                      hint={t?.kind === 'ok' ? `Measured ${formatDuration(t.minutes)} after this dose.` : t?.kind === 'before_dose' ? `Timing to review: this measurement is ${formatDuration(-t.minutes)} BEFORE the recorded dose time.` : t?.kind === 'unknown_time' ? 'Medication time unknown — elapsed time can’t be calculated.' : undefined}
                    />
                  );
                })}
              </div>
            )}
            <p className="mt-2 text-sm text-slate-600">Your after-medication timing should follow your clinician’s instructions.</p>
          </Card>
        )}

        <Optional summary="Arm and monitor" defaultOpen={!settings.defaultArm && settings.monitors.length > 0}>
          <SelectField label="Arm used" value={arm} onChange={(e) => { touch(); setArm(e.target.value as Arm | ''); }}>
            <option value="">Not recorded</option>
            <option value="left">Left</option>
            <option value="right">Right</option>
          </SelectField>
          <SelectField label="Monitor" value={monitorId} onChange={(e) => { touch(); setMonitorId(e.target.value); }} hint={settings.monitors.length === 0 ? 'Add monitors in Settings.' : undefined}>
            <option value="">Not recorded</option>
            {settings.monitors.map((m) => <option key={m.id} value={m.id}>{m.label}{m.cuffSize ? ` (${m.cuffSize})` : ''}</option>)}
          </SelectField>
          <Checkbox label="Save arm and monitor as my defaults" checked={saveDefaults} onChange={setSaveDefaults} />
        </Optional>

        <Optional summary={`Measurement conditions${flags.length ? ` (${flags.length} noted)` : ''}`}>
          <p className="text-sm text-slate-600">Note anything that might have affected this reading. It will be shown as “unusual measurement conditions”.</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {(Object.keys(CONDITION_LABEL) as ConditionFlag[]).map((f) => (
              <Checkbox key={f} label={CONDITION_LABEL[f]} checked={flags.includes(f)} onChange={(v) => { touch(); setFlags((fl) => (v ? [...fl, f] : fl.filter((x) => x !== f))); }} />
            ))}
          </div>
        </Optional>

        <Optional summary="Symptoms and notes" defaultOpen={!!(existing?.symptoms || existing?.notes)}>
          <UrgentHelp compact />
          <TextArea label="Symptoms" optional value={symptoms} onChange={(e) => { touch(); setSymptoms(e.target.value); }} hint="For a fuller record, use the Symptoms diary." />
          <TextArea label="Notes" optional value={notes} onChange={(e) => { touch(); setNotes(e.target.value); }} />
        </Optional>

        <Optional summary={`Session day: ${formatDateShort(sessionDay)}`} defaultOpen={afterMidnight || dayTouched}>
          {afterMidnight && <Notice tone="info">Measured after midnight? You can count this evening session for the previous day.</Notice>}
          <TextField label="Count this session for day" type="date" value={sessionDay} onChange={(e) => { touch(); setDayTouched(true); setSessionDay(e.target.value); }} error={timeErrors.sessionDay} hint="Usually the measurement date. The actual time is always kept." />
          {afterMidnight && <Button onClick={() => { touch(); setDayTouched(true); setSessionDay(addDays(mDate, -1)); }}>Use previous day ({formatDateShort(addDays(mDate, -1))})</Button>}
        </Optional>

        {lookalikes.length > 0 && (
          <Notice tone="warn" title="Possible duplicate">
            <p>A similar {type ? SESSION_LABEL[type].toLowerCase() : ''} session already exists: {lookalikes.map((s) => `${formatTime(s.measuredAt, s.timeZone)} ${s.readings.map((x) => `${x.systolic}/${x.diastolic}`).join(', ')}`).join('; ')}. Nothing will be deleted.</p>
            <div className="mt-2"><Checkbox label="This is a separate measurement — save it anyway" checked={dupeAck} onChange={setDupeAck} /></div>
          </Notice>
        )}

        {submitted && (errors.length > 0 || Object.keys(timeErrors).length > 0) && (
          <Notice tone="danger" role="alert" title="Some details need correcting">
            <ul>{[...errors.map((e) => e.message), ...Object.values(timeErrors)].map((m, i) => <li key={i}>{m}</li>)}</ul>
          </Notice>
        )}

        <div className="sticky bottom-16 z-10 flex flex-wrap gap-2 rounded-xl border border-slate-200 bg-white/95 p-3 shadow md:bottom-2">
          <Button type="submit" variant="primary" className="flex-1 sm:flex-none">{existing ? 'Save changes' : 'Save reading'}</Button>
          <Button onClick={() => (window.history.length > 1 ? window.history.back() : navigate('/'))}>Cancel</Button>
          {existing && <Button variant="danger" onClick={() => setConfirmDelete(true)}>Delete</Button>}
        </div>
      </form>

      <Modal open={confirmDelete} onClose={() => setConfirmDelete(false)} title="Delete this session?" footer={<><Button onClick={() => setConfirmDelete(false)}>Keep it</Button><Button variant="danger" onClick={del}>Delete session</Button></>}>
        <p>This permanently removes both original readings in this session from this device. Backups you already made are not affected.</p>
      </Modal>
    </div>
  );
}
