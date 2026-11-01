import { describe, it, expect } from 'vitest';
import { buildImport, guessDateOrder, guessMapping, parseCsv, parseDate, parseTime } from '../lib/importCsv';
import type { BPSession } from '../types';

const rule = { eveningFrom: '12:00', morningType: 'morning_pre' as const, dateOrder: 'dmy' as const, timeZone: 'Australia/Sydney', source: 'test.csv' };

describe('CSV import of readings', () => {
  it('parses quotes, commas inside quotes and semicolon files', () => {
    expect(parseCsv('a,b\n"x, y","he said ""hi"""\n')).toEqual([['a', 'b'], ['x, y', 'he said "hi"']]);
    expect(parseCsv('﻿Date;Sys;Dia\r\n01/11/2026;130;80\r\n')).toEqual([['Date', 'Sys', 'Dia'], ['01/11/2026', '130', '80']]);
  });

  it('guesses columns from common monitor-app headers', () => {
    expect(guessMapping(['Measurement Date', 'Time', 'Systolic (mmHg)', 'Diastolic (mmHg)', 'Pulse (bpm)', 'Notes'])).toEqual({ date: 0, time: 1, systolic: 2, diastolic: 3, pulse: 4, notes: 5 });
    expect(guessMapping(['Date/Time', 'SYS', 'DIA', 'Heart rate'])).toEqual({ datetime: 0, systolic: 1, diastolic: 2, pulse: 3 });
  });

  it('reads Australian, US and ISO dates and 12/24-hour times', () => {
    expect(parseDate('02/11/2026', 'dmy')).toBe('2026-11-02');
    expect(parseDate('11/02/2026', 'mdy')).toBe('2026-11-02');
    expect(parseDate('2026-11-02', 'dmy')).toBe('2026-11-02');
    expect(parseDate('2 Nov 2026', 'dmy')).toBe('2026-11-02');
    expect(parseDate('Nov 2, 2026', 'dmy')).toBe('2026-11-02');
    expect(parseDate('31/02/2026', 'dmy')).toBeNull();
    expect(parseTime('7:05 pm')).toBe('19:05');
    expect(parseTime('12:10 AM')).toBe('00:10');
    expect(parseTime('07.30')).toBe('07:30');
    expect(guessDateOrder(['13/11/2026', '01/11/2026'])).toBe('dmy');
    expect(guessDateOrder(['11/13/2026'])).toBe('mdy');
  });

  it('pairs readings within 10 minutes, sets the session type by the user’s rule, and keeps values exactly', () => {
    const rows = parseCsv([
      'Date,Time,Sys,Dia,Pulse',
      '02/11/2026,07:00,141,88,70',
      '02/11/2026,07:01,139,86,71',
      '02/11/2026,07:02,145,90,72', // third within 10 min: new session (max 2 readings)
      '02/11/2026,19:30,135,84,',
      'bad,row,x,y,z',
    ].join('\n'));
    const p = buildImport(rows.slice(1), guessMapping(rows[0]), rule, []);
    expect(p.sessions).toHaveLength(3);
    expect(p.sessions[0].readings.map((r) => [r.systolic, r.diastolic, r.pulse])).toEqual([[141, 88, 70], [139, 86, 71]]);
    expect(p.sessions.map((s) => s.sessionType)).toEqual(['morning_pre', 'morning_pre', 'evening']);
    expect(p.sessions[2].readings[0].pulse).toBeNull();
    expect(p.sessions[0].measuredAt).toBe('2026-11-01T20:00:00.000Z'); // Sydney, UTC+11
    expect(p.sessions[0].date).toBe('2026-11-02');
    expect(p.problems).toEqual([{ row: 6, reason: 'Date not recognised' }]);
  });

  it('reads a combined date-time column and skips readings already in the app', () => {
    const rows = parseCsv('Timestamp,Systolic,Diastolic\n2026-11-02T07:00:00,141,88\n2026-11-02 19:30,135,84\n');
    const existing = [{ readings: [{ systolic: 141, diastolic: 88, pulse: null, measuredAt: '2026-11-01T20:00:00.000Z' }] }] as BPSession[];
    const p = buildImport(rows.slice(1), guessMapping(rows[0]), rule, existing);
    expect(p.skippedDuplicates).toBe(1);
    expect(p.sessions).toHaveLength(1);
    expect(p.sessions[0]).toMatchObject({ sessionType: 'evening', monitorLabel: 'Imported (test.csv)' });
  });

  it('reports unreadable values instead of guessing', () => {
    const rows = parseCsv('Date,Time,Sys,Dia\n02/11/2026,07:00,abc,80\n02/11/2026,,130,80\n');
    const p = buildImport(rows.slice(1), guessMapping(rows[0]), rule, []);
    expect(p.sessions).toEqual([]);
    expect(p.problems.map((x) => x.reason)).toEqual([expect.stringMatching(/Systolic/), 'Time not recognised']);
  });
});
