import { describe, it, expect } from 'vitest';
import { doseTiming, estimateSupply, updateMedication, versionAt, dayDoseStatus } from '../lib/medication';
import { sessionFlags } from '../lib/quality';
import type { DoseRecord, Medication, StockEvent } from '../types';
import { mkSession } from './bp.test';

const t0 = '2026-10-01T00:00:00.000Z';
export function mkMed(p: Partial<Medication> = {}): Medication {
  return { id: 'm1', name: 'Medicine A', dose: '10 mg', usualTime: '07:30', instructions: '', active: true, postDoseReminderMinutes: null,
    supply: { enabled: true, unitsPerDay: 1, refillThresholdUnits: 5, renewalDate: null },
    history: [{ effectiveFrom: t0, name: 'Medicine A', dose: '10 mg', usualTime: '07:30', instructions: '' }], createdAt: t0, updatedAt: t0, ...p };
}
export function mkDose(p: Partial<DoseRecord>): DoseRecord {
  return { id: Math.random().toString(36).slice(2), medicationId: 'm1', date: '2026-11-02', status: 'taken', takenAt: '2026-11-01T20:30:00.000Z', timeZone: 'Australia/Sydney', utcOffsetMinutes: 660,
    units: 1, nameSnapshot: 'Medicine A', doseSnapshot: '10 mg', notes: '', createdAt: '2026-11-01T20:31:00.000Z', updatedAt: '2026-11-01T20:31:00.000Z', ...p };
}

describe('medication timing', () => {
  it('reports actual elapsed time from dose to measurement', () => {
    const d = mkDose({ takenAt: '2026-11-01T20:30:00.000Z' });
    const s = mkSession({ sessionType: 'morning_post', measuredAt: '2026-11-01T22:45:00.000Z', readings: [[130, 80]], linkedDoseIds: [d.id] });
    expect(doseTiming(s, d)).toMatchObject({ kind: 'ok', minutes: 135 });
  });
  it('shows medication time unknown when dose time is missing', () => {
    const d = mkDose({ takenAt: null });
    const s = mkSession({ sessionType: 'morning_post', readings: [[130, 80]], linkedDoseIds: [d.id] });
    expect(doseTiming(s, d).kind).toBe('unknown_time');
    expect(sessionFlags(s, [s], [d])).toContain('medication_time_unknown');
  });
  it('flags a measurement taken before the linked dose', () => {
    const d = mkDose({ takenAt: '2026-11-01T21:00:00.000Z' });
    const s = mkSession({ sessionType: 'morning_post', measuredAt: '2026-11-01T20:40:00.000Z', readings: [[130, 80]], linkedDoseIds: [d.id] });
    expect(doseTiming(s, d)).toMatchObject({ kind: 'before_dose', minutes: -20 });
    expect(sessionFlags(s, [s], [d])).toContain('measured_before_dose');
  });
  it('a deleted linked dose shows as no dose linked', () => {
    const s = mkSession({ sessionType: 'morning_post', readings: [[130, 80]], linkedDoseIds: ['gone'] });
    expect(sessionFlags(s, [s], [])).toContain('no_linked_dose');
  });
  it('absence of a record is "not recorded", never missed', () => {
    expect(dayDoseStatus([], 'm1', '2026-11-02')).toBe('not_recorded');
    expect(dayDoseStatus([mkDose({ status: 'skipped', takenAt: null })], 'm1', '2026-11-02')).toBe('skipped');
  });
});

describe('historical medication changes', () => {
  it('appends a version on prescription change and keeps earlier versions', () => {
    const m = mkMed();
    const m2 = updateMedication(m, { dose: '20 mg' }, '2026-11-01T00:00:00.000Z');
    expect(m2.history).toHaveLength(2);
    expect(versionAt(m2, '2026-10-15T00:00:00.000Z').dose).toBe('10 mg');
    expect(versionAt(m2, '2026-11-05T00:00:00.000Z').dose).toBe('20 mg');
  });
  it('non-prescription edits do not add versions', () => {
    expect(updateMedication(mkMed(), { active: false }, '2026-11-01T00:00:00.000Z').history).toHaveLength(1);
  });
  it('dose records keep their name/dose snapshot after a change', () => {
    const d = mkDose({ doseSnapshot: '10 mg' });
    updateMedication(mkMed(), { dose: '20 mg' }, '2026-11-03T00:00:00.000Z');
    expect(d.doseSnapshot).toBe('10 mg');
  });
});

describe('estimated supply', () => {
  const med = mkMed();
  const count: StockEvent = { id: 's1', medicationId: 'm1', at: '2026-11-01T00:00:00.000Z', kind: 'count', units: 30, note: '', createdAt: '2026-11-01T00:00:00.000Z' };
  const day = (n: number, p: Partial<DoseRecord> = {}) => mkDose({ id: `d${n}`, date: `2026-11-0${n}`, takenAt: `2026-11-0${n}T21:00:00.000Z`, ...p });

  it('is unknown until a manual count exists', () => {
    expect(estimateSupply(med, [day(2)], [], '2026-11-05').known).toBe(false);
  });
  it('only confirmed taken doses after the count reduce supply', () => {
    const doses = [day(2), day(3), day(4, { status: 'skipped', takenAt: null }), mkDose({ id: 'old', takenAt: '2026-10-30T21:00:00.000Z', date: '2026-10-31' })];
    const e = estimateSupply(med, doses, [count], '2026-11-05');
    expect(e.remaining).toBe(28);
    expect(e.dosesCounted).toBe(2);
  });
  it('editing a dose never double counts (derived, not incremental)', () => {
    let doses = [day(2), day(3)];
    expect(estimateSupply(med, doses, [count], '2026-11-05').remaining).toBe(28);
    doses = doses.map((d) => (d.id === 'd3' ? { ...d, notes: 'edited', updatedAt: '2026-11-04T00:00:00.000Z' } : d));
    expect(estimateSupply(med, doses, [count], '2026-11-05').remaining).toBe(28);
    doses = doses.map((d) => (d.id === 'd3' ? { ...d, units: 2 } : d));
    expect(estimateSupply(med, doses, [count], '2026-11-05').remaining).toBe(27);
    doses = doses.map((d) => (d.id === 'd3' ? { ...d, status: 'skipped' as const, takenAt: null } : d));
    expect(estimateSupply(med, doses, [count], '2026-11-05').remaining).toBe(29);
  });
  it('deleting a dose restores the estimate', () => {
    const doses = [day(2), day(3)];
    expect(estimateSupply(med, doses.filter((d) => d.id !== 'd2'), [count], '2026-11-05').remaining).toBe(29);
  });
  it('a later manual correction resets the baseline; refills add', () => {
    const stock: StockEvent[] = [count, { ...count, id: 's2', at: '2026-11-03T22:00:00.000Z', units: 20 }, { ...count, id: 's3', kind: 'add', at: '2026-11-04T00:00:00.000Z', units: 30 }];
    const e = estimateSupply(med, [day(2), day(3), day(4)], stock, '2026-11-05');
    expect(e.remaining).toBe(20 + 30 - 1);
  });
  it('warns at the refill threshold', () => {
    const low = { ...count, units: 6 };
    expect(estimateSupply(med, [day(2)], [low], '2026-11-05').belowThreshold).toBe(true);
  });
});
