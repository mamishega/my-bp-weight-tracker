import { useStore } from '../store/Store';
import { Badge, Card, LinkButton } from './ui';
import { formatDateShort, todayIn } from '../lib/time';
import { MIN_COMPLETE_DAYS, currentWeek, weekProgress } from '../lib/week';

/** Compact progress for the dashboard. */
export function WeekProgressCard() {
  const { data } = useStore();
  const today = todayIn(data.settings.timeZone);
  const w = currentWeek(data.settings.measurementWeeks, today);
  if (!w) return null;
  const p = weekProgress(data.sessions, w, today);
  const t = p.days.find((d) => d.date === today);
  return (
    <Card title={<>Measurement week · {p.dayNumber === 0 ? `starts ${formatDateShort(w.startDate)}` : `day ${p.dayNumber} of ${w.days}`}</>} icon="calendar" iconTone="violet" actions={<LinkButton href="#/week" variant="ghost" icon="chevronRight">Open</LinkButton>}>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        {t && <><Badge tone={t.morning ? 'ok' : 'neutral'} icon={t.morning ? 'check' : 'circle'}>Morning</Badge><Badge tone={t.evening ? 'ok' : 'neutral'} icon={t.evening ? 'check' : 'circle'}>Evening</Badge></>}
        <span className="text-slate-700">{p.completeDays} complete day{p.completeDays === 1 ? '' : 's'} so far (aim: at least {MIN_COMPLETE_DAYS} of {w.days})</span>
      </div>
    </Card>
  );
}
