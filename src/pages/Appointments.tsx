import { useState } from 'react';
import { useStore } from '../store/Store';
import type { Appointment } from '../types';
import { Badge, Button, Card, Empty, LinkButton, Modal, PageTitle, SelectField, TextArea, TextField, useToast } from '../components/ui';
import { addDays, daysBetween, formatClock, formatDateLong, isValidDate, isValidTime, todayIn } from '../lib/time';
import { uid } from '../lib/defaults';

function ApptForm({ existing, onClose }: { existing?: Appointment; onClose: () => void }) {
  const { data, put } = useStore();
  const toast = useToast();
  const [date, setDate] = useState(existing?.date ?? addDays(todayIn(data.settings.timeZone), 7));
  const [time, setTime] = useState(existing?.time ?? '');
  const [clinician, setClinician] = useState(existing?.clinician ?? '');
  const [location, setLocation] = useState(existing?.location ?? '');
  const [purpose, setPurpose] = useState(existing?.purpose ?? '');
  const [notes, setNotes] = useState(existing?.notes ?? '');
  const [err, setErr] = useState<Record<string, string>>({});
  const save = async () => {
    const e: Record<string, string> = {};
    if (!isValidDate(date)) e.date = 'Enter a valid date.';
    if (time && !isValidTime(time)) e.time = 'Enter a valid time or leave blank.';
    setErr(e);
    if (Object.keys(e).length) return;
    const now = new Date().toISOString();
    await put('appointments', { id: existing?.id ?? uid(), date, time: time || null, clinician, location, purpose, notes, createdAt: existing?.createdAt ?? now, updatedAt: now });
    toast('Appointment saved.');
    onClose();
  };
  return (
    <Modal open onClose={onClose} title={existing ? 'Edit appointment' : 'Add appointment'} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={save}>Save</Button></>}>
      <div className="flex flex-col gap-3">
        <div className="grid grid-cols-2 gap-3">
          <TextField label="Date" type="date" value={date} onChange={(e) => setDate(e.target.value)} error={err.date} />
          <TextField label="Time" type="time" optional value={time} onChange={(e) => setTime(e.target.value)} error={err.time} />
        </div>
        <TextField label="Clinician" optional value={clinician} onChange={(e) => setClinician(e.target.value)} />
        <TextField label="Location" optional value={location} onChange={(e) => setLocation(e.target.value)} />
        <TextField label="Purpose" optional value={purpose} onChange={(e) => setPurpose(e.target.value)} />
        <TextArea label="Notes" optional value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>
    </Modal>
  );
}

export function AppointmentsPage() {
  const { data, put, remove } = useStore();
  const today = todayIn(data.settings.timeZone);
  const [edit, setEdit] = useState<Appointment | 'new' | null>(null);
  const [del, setDel] = useState<Appointment | null>(null);
  const [q, setQ] = useState('');
  const [qAppt, setQAppt] = useState('');
  const upcoming = data.appointments.filter((a) => a.date >= today).sort((a, b) => a.date.localeCompare(b.date));
  const past = data.appointments.filter((a) => a.date < today).sort((a, b) => b.date.localeCompare(a.date));
  const addQ = async () => {
    if (!q.trim()) return;
    const now = new Date().toISOString();
    await put('questions', { id: uid(), text: q.trim(), appointmentId: qAppt || null, resolved: false, createdAt: now, updatedAt: now });
    setQ('');
  };
  const card = (a: Appointment) => {
    const d = daysBetween(today, a.date);
    return (
      <li key={a.id} className="rounded-lg border border-slate-200 p-3">
        <p className="font-semibold">{formatDateLong(a.date)}{a.time && `, ${formatClock(a.time)}`} {d >= 0 && <Badge tone="info" icon="📅">{d === 0 ? 'Today' : d === 1 ? 'Tomorrow' : `In ${d} days`}</Badge>}</p>
        <p>{[a.clinician, a.location, a.purpose].filter(Boolean).join(' · ')}</p>
        {a.notes && <p className="text-sm text-slate-700">{a.notes}</p>}
        <div className="mt-2 flex flex-wrap gap-2">
          <LinkButton href={`#/report?from=${addDays(a.date < today ? a.date : today, -29)}&to=${a.date < today ? a.date : today}`} variant="primary">Prepare report</LinkButton>
          <Button variant="ghost" onClick={() => setEdit(a)}>Edit</Button>
          <Button variant="ghost" onClick={() => setDel(a)}>Delete</Button>
        </div>
      </li>
    );
  };
  return (
    <div className="flex flex-col gap-4">
      <PageTitle sub="Plan for your next visit and keep questions in one place.">Appointments</PageTitle>
      <div><Button variant="primary" onClick={() => setEdit('new')}>➕ Add appointment</Button></div>
      <Card title="Upcoming">{upcoming.length === 0 ? <Empty>No upcoming appointments.</Empty> : <ul className="space-y-2">{upcoming.map(card)}</ul>}</Card>
      <Card title="Questions for my doctor">
        <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); void addQ(); }}>
          <div className="min-w-60 flex-1"><TextField label="Question or note" value={q} onChange={(e) => setQ(e.target.value)} /></div>
          <div className="w-56"><SelectField label="For appointment" optional value={qAppt} onChange={(e) => setQAppt(e.target.value)}><option value="">Any</option>{upcoming.map((a) => <option key={a.id} value={a.id}>{a.date} {a.clinician}</option>)}</SelectField></div>
          <Button type="submit">Add</Button>
        </form>
        {data.questions.length === 0 ? <div className="mt-3"><Empty>No questions yet.</Empty></div> : (
          <ul className="mt-3 space-y-2">
            {[...data.questions].sort((a, b) => Number(a.resolved) - Number(b.resolved) || a.createdAt.localeCompare(b.createdAt)).map((x) => (
              <li key={x.id} className="flex flex-wrap items-center gap-2">
                <input type="checkbox" className="h-5 w-5 accent-teal-700" checked={x.resolved} aria-label={`Mark “${x.text}” as discussed`} onChange={(e) => put('questions', { ...x, resolved: e.target.checked, updatedAt: new Date().toISOString() })} />
                <span className={x.resolved ? 'text-slate-500 line-through' : ''}>{x.text}</span>
                {x.resolved && <Badge tone="ok">Discussed</Badge>}
                <Button variant="ghost" onClick={() => remove('questions', x.id)} aria-label={`Delete question ${x.text}`}>Delete</Button>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {past.length > 0 && <Card title="Past appointments"><ul className="space-y-2">{past.map(card)}</ul></Card>}
      {edit && <ApptForm existing={edit === 'new' ? undefined : edit} onClose={() => setEdit(null)} />}
      <Modal open={!!del} onClose={() => setDel(null)} title="Delete appointment?" footer={<><Button onClick={() => setDel(null)}>Keep</Button><Button variant="danger" onClick={async () => { await remove('appointments', del!.id); setDel(null); }}>Delete</Button></>}><p>{del && formatDateLong(del.date)}</p></Modal>
    </div>
  );
}
