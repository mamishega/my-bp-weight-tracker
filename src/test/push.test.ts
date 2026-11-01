import { describe, it, expect } from 'vitest';
import { pushSchedule } from '../lib/push';
import { emptyData } from '../lib/defaults';
import type { Medication } from '../types';

const med = (p: Partial<Medication>): Medication => ({ id: 'm', name: 'Secret Medicine Name', dose: '5 mg', usualTime: '08:00', instructions: '', active: true, postDoseReminderMinutes: null, supply: null, history: [], createdAt: '', updatedAt: '', ...p });

describe('reminders when the app is closed', () => {
  it('sends only times (with days / interval / end) and generic titles, never medicine names', () => {
    const base = emptyData();
    const d = {
      ...base,
      settings: { ...base.settings, reminders: { ...base.settings.reminders, morningPre: { enabled: true, time: '07:00' }, evening: { enabled: true, time: '19:30' }, medication: { enabled: true }, weight: { enabled: true, time: '07:30', weekdays: [1] } } },
      medications: [med({ timesPerDay: 2, doseTimes: ['08:00', '20:00'] }), med({ id: 'w', doseTimes: ['09:00'], frequency: { kind: 'interval', everyDays: 2, startDate: '2026-11-01' }, endDate: '2026-12-01' })],
    };
    const items = pushSchedule(d);
    expect(items.map(({ t, d: days, n, s, u, url }) => ({ t, days, n, s, u, url }))).toEqual([
      { t: '07:00', days: undefined, n: undefined, s: undefined, u: undefined, url: '#/add?type=morning_pre' },
      { t: '08:00', days: undefined, n: undefined, s: undefined, u: undefined, url: '#/medication' },
      { t: '09:00', days: undefined, n: 2, s: '2026-11-01', u: '2026-12-01', url: '#/medication' },
      { t: '20:00', days: undefined, n: undefined, s: undefined, u: undefined, url: '#/medication' },
      { t: '19:30', days: undefined, n: undefined, s: undefined, u: undefined, url: '#/add?type=evening' },
      { t: '07:30', days: [1], n: undefined, s: undefined, u: undefined, url: '#/weight' },
    ]);
    expect(JSON.stringify(items)).not.toContain('Secret Medicine Name');
  });

  it('sends nothing when no timed reminder is on', () => {
    expect(pushSchedule(emptyData())).toEqual([]);
  });
});
