import { CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Scatter, Tooltip, XAxis, YAxis } from 'recharts';
import type { BPSession, SessionType, WeightEntry, WeightUnit, ISODate } from '../types';
import { SESSION_LABEL, SESSION_STYLE, sessionAverage, fmt, statsFor } from '../lib/bp';
import { dateToDayNumber, dayNumberToDate, formatDateTiny, formatDateShort, formatTime, instantToZoned, daysBetween } from '../lib/time';
import { movingAverage7, fromKg } from '../lib/weight';

const GRID = '#e2e8f0';
const AXIS = '#475569';

function xFor(date: ISODate, iso: string | null, tz: string): number {
  const base = dateToDayNumber(date);
  if (!iso) return base + 0.5;
  const [h, m] = instantToZoned(iso, tz).time.split(':').map(Number);
  // keep within the assigned session day even if measured after midnight
  return base + Math.min(0.99, (h * 60 + m) / 1440);
}

function ticks(from: ISODate, to: ISODate): number[] {
  const a = dateToDayNumber(from);
  const n = daysBetween(from, to);
  const step = n <= 10 ? 1 : n <= 35 ? 7 : n <= 100 ? 14 : 30;
  const out: number[] = [];
  for (let i = 0; i <= n; i += step) out.push(a + i);
  return out;
}

function Legend({ items }: { items: { label: string; color: string; symbol: string; dashed?: boolean }[] }) {
  return (
    <ul className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-xs font-medium text-slate-600" aria-hidden="true">
      {items.map((i) => (
        <li key={i.label} className="flex items-center gap-1">
          <span style={{ color: i.color }} className="text-base">{i.symbol}</span> {i.label}
        </li>
      ))}
    </ul>
  );
}

interface TipPayload { payload?: { tip?: string } }
function Tip({ active, payload }: { active?: boolean; payload?: TipPayload[] }) {
  if (!active || !payload?.length) return null;
  const lines = payload.map((p) => p.payload?.tip).filter(Boolean);
  if (!lines.length) return null;
  return (
    <div className="rounded-lg border border-slate-300 bg-white p-2 text-sm text-slate-900 shadow">
      {[...new Set(lines)].map((l) => <div key={l} className="whitespace-pre-line">{l}</div>)}
    </div>
  );
}

export function BPChart({ sessions, measure, from, to, target, visible }: { sessions: BPSession[]; measure: 'systolic' | 'diastolic'; from: ISODate; to: ISODate; target: number | null; visible: Record<SessionType, boolean> }) {
  const types = (['morning_pre', 'morning_post', 'evening'] as SessionType[]).filter((t) => visible[t]);
  const series = types.map((t) => ({
    type: t,
    data: sessions
      .filter((s) => s.sessionType === t)
      .sort((a, b) => a.measuredAt.localeCompare(b.measuredAt))
      .map((s) => {
        const a = sessionAverage(s);
        return { x: xFor(s.date, s.measuredAt, s.timeZone), y: Math.round(a[measure] * 10) / 10, tip: `${SESSION_LABEL[t]}\n${formatDateShort(s.date)} ${formatTime(s.measuredAt, s.timeZone)}\n${measure === 'systolic' ? 'Systolic' : 'Diastolic'} ${fmt(a[measure])} mmHg (${s.readings.length === 2 ? 'avg of 2' : 'single'})` };
      }),
  }));
  const total = series.reduce((a, s) => a + s.data.length, 0);
  const desc = `${measure === 'systolic' ? 'Systolic' : 'Diastolic'} blood pressure from ${formatDateShort(from)} to ${formatDateShort(to)}. ` +
    types.map((t) => {
      const st = statsFor(sessions, t);
      const m = measure === 'systolic' ? st.meanSystolic : st.meanDiastolic;
      return `${SESSION_LABEL[t]}: ${st.sessions} sessions${m != null ? `, average ${fmt(m)} mmHg` : ''}`;
    }).join('. ') + '.';
  return (
    <figure>
      <figcaption className="mb-1 text-sm font-semibold text-slate-800">{measure === 'systolic' ? 'Systolic (top number)' : 'Diastolic (bottom number)'} — mmHg, session averages</figcaption>
      <Legend items={types.map((t) => ({ label: SESSION_LABEL[t], color: SESSION_STYLE[t].color, symbol: SESSION_STYLE[t].symbol }))} />
      {total === 0 ? (
        <p className="rounded-lg border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">No readings in this period.</p>
      ) : (
        <div role="img" aria-label={desc} className="h-64 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart syncId="trends" syncMethod="value" margin={{ top: 8, right: 12, bottom: 4, left: 0 }}>
              <CartesianGrid stroke={GRID} vertical={false} />
              <XAxis type="number" dataKey="x" domain={[dateToDayNumber(from), dateToDayNumber(to) + 1]} ticks={ticks(from, to)} tickFormatter={(v: number) => formatDateTiny(dayNumberToDate(Math.floor(v)))} stroke={AXIS} fontSize={12} allowDuplicatedCategory={false} />
              <YAxis type="number" dataKey="y" domain={['dataMin - 8', 'dataMax + 8']} stroke={AXIS} fontSize={12} width={44} tickFormatter={(v: number) => String(Math.round(v))} label={{ value: 'mmHg', angle: -90, position: 'insideLeft', fill: AXIS, fontSize: 12 }} />
              {target != null && <ReferenceLine y={target} stroke="#64748b" strokeDasharray="4 4" label={{ value: `Your target ${target}`, fill: '#334155', fontSize: 11, position: 'insideTopRight' }} />}
              <Tooltip content={<Tip />} cursor={{ stroke: '#94a3b8' }} />
              {series.map((s) => (
                <Scatter key={s.type} name={SESSION_LABEL[s.type]} data={s.data} fill={SESSION_STYLE[s.type].color} shape={SESSION_STYLE[s.type].shape} line={{ stroke: SESSION_STYLE[s.type].color, strokeWidth: 2 }} lineJointType="linear" isAnimationActive={false} />
              ))}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}
      <p className="sr-only">{desc}</p>
    </figure>
  );
}

export function WeightChart({ weights, from, to, unit, goalKg }: { weights: WeightEntry[]; from: ISODate; to: ISODate; unit: WeightUnit; goalKg: number | null }) {
  const ma = movingAverage7(weights).filter((p) => p.date >= from && p.date <= to);
  const daily = ma.map((p) => ({ x: dateToDayNumber(p.date) + 0.5, y: Math.round(fromKg(p.kg, unit) * 10) / 10, tip: `${formatDateShort(p.date)}\nWeight ${fromKg(p.kg, unit).toFixed(1)} ${unit}\n7-day avg ${fromKg(p.avgKg, unit).toFixed(1)} ${unit} (${p.daysContributing} day${p.daysContributing === 1 ? '' : 's'} with data)` }));
  const avg = ma.map((p) => ({ x: dateToDayNumber(p.date) + 0.5, y: Math.round(fromKg(p.avgKg, unit) * 10) / 10 }));
  const desc = ma.length
    ? `Weight from ${formatDateShort(from)} to ${formatDateShort(to)}: ${ma.length} days with a measurement, from ${fromKg(ma[0].kg, unit).toFixed(1)} to ${fromKg(ma[ma.length - 1].kg, unit).toFixed(1)} ${unit}. Latest 7-day average ${fromKg(ma[ma.length - 1].avgKg, unit).toFixed(1)} ${unit} from ${ma[ma.length - 1].daysContributing} days.`
    : 'No weight measurements in this period.';
  return (
    <figure>
      <figcaption className="mb-1 text-sm font-semibold text-slate-800">Weight — {unit}</figcaption>
      <Legend items={[{ label: 'Daily weight', color: '#2a78d6', symbol: '●' }, { label: '7-day moving average (days with data only)', color: '#0d366b', symbol: '━' }]} />
      {ma.length === 0 ? (
        <p className="rounded-lg border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">No weight measurements in this period.</p>
      ) : (
        <div role="img" aria-label={desc} className="h-56 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart syncId="trends" syncMethod="value" margin={{ top: 8, right: 12, bottom: 4, left: 0 }}>
              <CartesianGrid stroke={GRID} vertical={false} />
              <XAxis type="number" dataKey="x" domain={[dateToDayNumber(from), dateToDayNumber(to) + 1]} ticks={ticks(from, to)} tickFormatter={(v: number) => formatDateTiny(dayNumberToDate(Math.floor(v)))} stroke={AXIS} fontSize={12} />
              <YAxis type="number" dataKey="y" domain={['dataMin - 1', 'dataMax + 1']} stroke={AXIS} fontSize={12} width={44} tickFormatter={(v: number) => v.toFixed(0)} label={{ value: unit, angle: -90, position: 'insideLeft', fill: AXIS, fontSize: 12 }} />
              {goalKg != null && <ReferenceLine y={Math.round(fromKg(goalKg, unit) * 10) / 10} stroke="#64748b" strokeDasharray="4 4" label={{ value: 'Your goal', fill: '#334155', fontSize: 11, position: 'insideTopRight' }} />}
              <Tooltip content={<Tip />} />
              <Scatter name="Daily weight" data={daily} fill="#2a78d6" isAnimationActive={false} />
              <Line data={avg} dataKey="y" type="monotone" stroke="#0d366b" strokeWidth={2} dot={false} isAnimationActive={false} name="7-day average" />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}
      <p className="sr-only">{desc}</p>
    </figure>
  );
}
