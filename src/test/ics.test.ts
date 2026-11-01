import { describe, it, expect } from 'vitest';
import { buildIcs } from '../lib/ics';
import { emptyData } from '../lib/defaults';
import { mkMed } from './medication.test';

describe('calendar reminders export', () => {
  it('creates daily/weekly events with alarms in the user time zone and no health details', () => {
    const d = emptyData();
    d.settings.timeZone = 'Australia/Sydney';
    d.settings.reminders.morningPre = { enabled: true, time: '07:00' };
    d.settings.reminders.evening = { enabled: true, time: '19:30' };
    d.settings.reminders.medication = { enabled: true };
    d.settings.reminders.weight = { enabled: true, time: '07:15', weekdays: [1, 4] };
    d.medications = [mkMed({ name: 'Secretpril', usualTime: '07:30' })];
    const ics = buildIcs(d, new Date('2026-11-01T00:00:00Z'));
    expect(ics).toContain('DTSTART;TZID=Australia/Sydney:20261101T070000');
    expect(ics).toContain('DTSTART;TZID=Australia/Sydney:20261101T193000');
    expect(ics).toContain('DTSTART;TZID=Australia/Sydney:20261101T073000');
    expect(ics).toContain('RRULE:FREQ=WEEKLY;BYDAY=MO,TH');
    expect(ics.match(/BEGIN:VALARM/g)).toHaveLength(4);
    expect(ics).not.toContain('Secretpril');
    expect(ics.split('\r\n').every((l) => l.length <= 75)).toBe(true);
  });
});
