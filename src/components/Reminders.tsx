import { useEffect, useMemo, useRef } from 'react';
import { useStore } from '../store/Store';
import { dueReminders } from '../lib/reminders';
import { useNow } from './Backup';
import { Button } from './ui';
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
    <section aria-label="Reminders" className="border-b border-amber-300 bg-amber-50 px-3 py-2 print:hidden sm:px-6">
      <ul className="flex flex-col gap-2">
        {due.map((r) => (
          <li key={r.key} className="flex flex-wrap items-center gap-2 rounded-lg bg-white/70 p-2">
            <div className="min-w-0 flex-1 basis-56">
              <span aria-hidden="true">🔔 </span>
              <span className="font-semibold text-amber-950">{r.title}</span>
              <p className="text-sm text-amber-950">{r.body}</p>
            </div>
            <div className="flex w-full flex-wrap gap-2 sm:w-auto">
              <a href={r.href} className="inline-flex min-h-11 items-center rounded-lg border border-teal-700 bg-teal-700 px-3 font-medium text-white no-underline">Open</a>
              <Button onClick={() => snooze(r.key)} aria-label={`Snooze ${r.title} for ${data.settings.reminders.snoozeMinutes} minutes`}>Snooze {data.settings.reminders.snoozeMinutes} min</Button>
              <Button variant="ghost" onClick={() => dismiss(r.key)} aria-label={`Dismiss ${r.title} for now`}>Dismiss</Button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
