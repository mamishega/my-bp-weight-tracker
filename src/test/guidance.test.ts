import { describe, it, expect } from 'vitest';
import { guidanceOverdue } from '../components/safety';
import { GUIDANCE_REVIEW_DUE, SOURCES } from '../lib/guidance';

describe('health guidance review', () => {
  it('flags the guidance as overdue only after the review date', () => {
    expect(guidanceOverdue('2026-11-01')).toBe(false);
    expect(guidanceOverdue(GUIDANCE_REVIEW_DUE)).toBe(false);
    expect(guidanceOverdue('2027-05-02')).toBe(true);
  });
  it('every source is an https link to an Australian authority', () => {
    for (const s of Object.values(SOURCES)) {
      expect(s.url).toMatch(/^https:\/\/(www\.)?(healthdirect\.gov\.au|heartfoundation\.org\.au|strokefoundation\.org\.au|racgp\.org\.au)\//);
    }
  });
});
