import { useEffect, useMemo, useRef } from 'react';
import { useStore } from '../store/Store';
import { dueReminders } from '../lib/reminders';
import { useNow } from './Backup';
import { Button } from './ui';
import { Icon } from './Icon';
import { showSystemNotification } from '../lib/pwa';

/** In-app reminders. Snoozing or dismissing never marks the action as done. */
export function RemindersBar() {
  const { data, put } = useStore();
  const now = useNow(30_000);
  const due = useMemo(() => dueReminders(data, now), [data, now]);
  const notified = useRef(new Set<string>());

  useEffect(() => {
    if (!data.settings.notificationsEnabled) return;
    for (const r of due) {
      if (notified.current.has(r.key) || sessionStorage.getItem(`bpt-n-${r.key}`)) continue;
      notified.current.add(r.key);
      sessionStorage.setItem(`bpt-n-${r.key}`, '1');
      void showSystemNotification(r.title, r.body, r.key);
    }
  }, [due, data.settings.notificationsEnabled]);

  if (due.length === 0) return null;
  const snooze = (key: string) =>
    put('reminderStates', { id: key, status: 'snoozed', snoozeUntil: new Date(Date.now() + data.settings.reminders.snoozeMinutes * 60000).toISOString(), updatedAt: new Date().toISOString() });
  const dismiss = (key: string) => put('reminderStates', { id: key, status: 'dismissed', snoozeUntil: null, updatedAt: new Date().toISOString() });

  return (
    <section aria-label="Reminders" className="mx-auto max-w-6xl px-4 pt-4 print:hidden sm:px-8">
      <ul className="flex flex-col gap-2">
        {due.map((r) => (
          <li key={r.key} className="flex flex-wrap items-center gap-3 rounded-xl border border-amber-200 bg-amber-50/80 p-3">
            <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-100 text-amber-800" aria-hidden="true"><Icon name="bell" className="h-[18px] w-[18px]" /></span>
            <div className="min-w-0 flex-1 basis-48">
              <p className="font-semibold text-amber-950">{r.title}</p>
              <p className="text-sm text-amber-900">{r.body}</p>
            </div>
            <div className="flex w-full flex-wrap gap-2 sm:w-auto">
              <a href={r.href} className="inline-flex min-h-10 items-center rounded-lg border border-teal-700 bg-teal-700 px-3 text-sm font-semibold text-white no-underline hover:bg-teal-800">Open<span className="sr-only"> — {r.title}</span></a>
              <Button className="min-h-10 text-sm" onClick={() => snooze(r.key)}>Snooze {data.settings.reminders.snoozeMinutes} min<span className="sr-only"> — {r.title}</span></Button>
              <Button variant="ghost" className="min-h-10 text-sm" onClick={() => dismiss(r.key)}>Dismiss<span className="sr-only"> — {r.title}</span></Button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
