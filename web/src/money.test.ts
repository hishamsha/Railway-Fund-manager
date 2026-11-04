import { describe, expect, it } from 'vitest';
import { addDays, formatDate, formatRupees, indiaToday, paiseToInput, parseRupees } from './money';

describe('parseRupees', () => {
  it('reads typed rupees as exact paise', () => {
    expect(parseRupees('1250')).toBe(125_000);
    expect(parseRupees('19.99')).toBe(1999);
    expect(parseRupees('0.07')).toBe(7);
    expect(parseRupees('1.5')).toBe(150);
    expect(parseRupees(' ₹1,24,600.50 ')).toBe(12_460_050);
    expect(parseRupees('0')).toBe(0);
  });
  it('refuses anything that is not an amount', () => {
    for (const text of ['', 'abc', '-5', '1.234', '1.', '.5', '1e5', '99999999999']) {
      expect(parseRupees(text)).toBeNull();
    }
  });
});

describe('formatting', () => {
  it('uses Indian grouping and shows paise only when present', () => {
    expect(formatRupees(12_460_000)).toBe('₹1,24,600');
    expect(formatRupees(1999)).toBe('₹19.99');
    expect(formatRupees(5)).toBe('₹0.05');
    expect(formatRupees(-8000)).toBe('-₹80');
  });
  it('round-trips an amount through an input box', () => {
    for (const paise of [0, 5, 150, 1999, 125_000]) {
      expect(parseRupees(paiseToInput(paise))).toBe(paise);
    }
  });
  it('keeps dates on the same calendar day', () => {
    expect(formatDate('2026-11-10')).toBe('10 Nov 2026');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });
  it('uses the India date for today', () => {
    expect(indiaToday(new Date('2026-11-04T19:00:00Z'))).toBe('2026-11-05');
    expect(indiaToday(new Date('2026-11-04T18:00:00Z'))).toBe('2026-11-04');
  });
});
