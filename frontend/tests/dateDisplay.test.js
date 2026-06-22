// Unit tests for the shared display-only date formatters.
//
// formatInstantForDisplay hard-codes the Asia/Jerusalem timezone, so its
// results must be identical no matter what the process TZ is. The repo runs
// these twice (TZ=UTC and TZ=America/Los_Angeles) to prove that externally; the
// tests themselves only construct Date instants from explicit UTC strings so the
// expectations are unambiguous.
import { describe, it, expect } from 'vitest';

import {
  formatDateOnlyForDisplay,
  formatInstantForDisplay,
} from '../src/utils/dateDisplay.js';


describe('formatDateOnlyForDisplay', () => {
  it('reorders a valid date into DD-MM-YYYY', () => {
    expect(formatDateOnlyForDisplay('2026-06-27')).toBe('27-06-2026');
    expect(formatDateOnlyForDisplay('2026-01-05')).toBe('05-01-2026');
  });

  it('keeps zero-padding on day and month', () => {
    expect(formatDateOnlyForDisplay('2026-03-04')).toBe('04-03-2026');
    expect(formatDateOnlyForDisplay('2026-12-31')).toBe('31-12-2026');
  });

  it('accepts the extreme valid years 0001 and 9999', () => {
    expect(formatDateOnlyForDisplay('0001-01-01')).toBe('01-01-0001');
    expect(formatDateOnlyForDisplay('9999-12-31')).toBe('31-12-9999');
  });

  it('rejects year 0000', () => {
    expect(formatDateOnlyForDisplay('0000-01-01')).toBe('');
  });

  it('accepts real leap days', () => {
    // 2024 (÷4) and 2000 (÷400) are leap years.
    expect(formatDateOnlyForDisplay('2024-02-29')).toBe('29-02-2024');
    expect(formatDateOnlyForDisplay('2000-02-29')).toBe('29-02-2000');
  });

  it('rejects Feb 29 in non-leap years (incl. century rule)', () => {
    // 1900 and 2100 are ÷100 but not ÷400, so they are NOT leap years.
    expect(formatDateOnlyForDisplay('1900-02-29')).toBe('');
    expect(formatDateOnlyForDisplay('2100-02-29')).toBe('');
    expect(formatDateOnlyForDisplay('2026-02-29')).toBe('');
  });

  it('rejects out-of-range months', () => {
    expect(formatDateOnlyForDisplay('2026-00-10')).toBe('');
    expect(formatDateOnlyForDisplay('2026-13-10')).toBe('');
  });

  it('rejects day 00', () => {
    expect(formatDateOnlyForDisplay('2026-01-00')).toBe('');
  });

  it('rejects a day beyond the real length of the month', () => {
    // April and June have 30 days.
    expect(formatDateOnlyForDisplay('2026-04-31')).toBe('');
    expect(formatDateOnlyForDisplay('2026-06-31')).toBe('');
    // ...but the valid last day passes.
    expect(formatDateOnlyForDisplay('2026-04-30')).toBe('30-04-2026');
  });

  it('rejects loose digit counts (no single-digit month/day)', () => {
    expect(formatDateOnlyForDisplay('2026-2-03')).toBe('');
    expect(formatDateOnlyForDisplay('2026-02-3')).toBe('');
  });

  it('rejects slash, dot, datetime-suffix and whitespace variants', () => {
    const malformed = [
      '2026/06/27',
      '27.06.2026',
      '2026.06.27',
      '2026-06-27T00:00:00',
      '2026-06-27 00:00',
      ' 2026-06-27',
      '2026-06-27 ',
      '2026-06-27\n',
    ];

    for (const value of malformed) {
      expect(formatDateOnlyForDisplay(value)).toBe('');
    }
  });

  it('returns the fallback for empty and invalid strings', () => {
    expect(formatDateOnlyForDisplay('')).toBe('');
    expect(formatDateOnlyForDisplay('not-a-date')).toBe('');
  });

  it('honours a custom fallback', () => {
    expect(formatDateOnlyForDisplay('', { fallback: '—' })).toBe('—');
    expect(formatDateOnlyForDisplay('nope', { fallback: 'N/A' })).toBe('N/A');
    // A valid value ignores the fallback.
    expect(formatDateOnlyForDisplay('2026-06-27', { fallback: '—' })).toBe('27-06-2026');
  });

  it('rejects every non-string shape', () => {
    const nonStrings = [
      new Date('2026-06-27T00:00:00Z'),
      { toDate: () => new Date('2026-06-27T00:00:00Z') },
      { seconds: 1782000000 },
      ['2026-06-27'],
      20260627,
      0,
      true,
      false,
      null,
      undefined,
    ];

    for (const value of nonStrings) {
      expect(formatDateOnlyForDisplay(value, { fallback: 'X' })).toBe('X');
    }
  });
});


describe('formatInstantForDisplay', () => {
  // 2026-06-26T21:30:00Z is, in Asia/Jerusalem (UTC+3 in June, IDT),
  // 2026-06-27 00:30:00.
  const SUMMER_UTC = '2026-06-26T21:30:00Z';

  it('formats a valid Date at each precision', () => {
    const date = new Date(SUMMER_UTC);

    expect(formatInstantForDisplay(date)).toBe('27-06-2026');
    expect(formatInstantForDisplay(date, { timePrecision: 'none' })).toBe('27-06-2026');
    expect(formatInstantForDisplay(date, { timePrecision: 'minute' })).toBe('27-06-2026 00:30');
    expect(formatInstantForDisplay(date, { timePrecision: 'second' })).toBe('27-06-2026 00:30:00');
  });

  it('accepts a Timestamp-like object via toDate()', () => {
    const timestampLike = { toDate: () => new Date(SUMMER_UTC) };

    expect(formatInstantForDisplay(timestampLike, { timePrecision: 'second' }))
      .toBe('27-06-2026 00:30:00');
  });

  it('accepts a { seconds } object', () => {
    const seconds = Math.floor(new Date(SUMMER_UTC).getTime() / 1000);

    expect(formatInstantForDisplay({ seconds }, { timePrecision: 'minute' }))
      .toBe('27-06-2026 00:30');
  });

  it('rejects strings, including ISO and YYYY-MM-DD', () => {
    expect(formatInstantForDisplay(SUMMER_UTC, { fallback: 'X' })).toBe('X');
    expect(formatInstantForDisplay('2026-06-26', { fallback: 'X' })).toBe('X');
  });

  it('rejects a raw number', () => {
    const ms = new Date(SUMMER_UTC).getTime();

    expect(formatInstantForDisplay(ms, { fallback: 'X' })).toBe('X');
    expect(formatInstantForDisplay(0, { fallback: 'X' })).toBe('X');
  });

  it('rejects an Invalid Date', () => {
    expect(formatInstantForDisplay(new Date('not-a-date'), { fallback: 'X' })).toBe('X');
  });

  it('rejects a toDate() that throws', () => {
    const thrower = { toDate: () => { throw new Error('boom'); } };

    expect(formatInstantForDisplay(thrower, { fallback: 'X' })).toBe('X');
  });

  it('rejects a toDate() that returns a non-Date or Invalid Date', () => {
    const cases = [
      { toDate: () => '2026-06-26' },
      { toDate: () => ({}) },
      { toDate: () => new Date('not-a-date') },
      { toDate: () => null },
      { toDate: () => 123 },
    ];

    for (const value of cases) {
      expect(formatInstantForDisplay(value, { fallback: 'X' })).toBe('X');
    }
  });

  it('rejects a non-finite or non-numeric seconds field', () => {
    const cases = [
      { seconds: NaN },
      { seconds: Infinity },
      { seconds: -Infinity },
      { seconds: '123' },
    ];

    for (const value of cases) {
      expect(formatInstantForDisplay(value, { fallback: 'X' })).toBe('X');
    }
  });

  it('rejects an unknown timePrecision', () => {
    const date = new Date(SUMMER_UTC);

    expect(formatInstantForDisplay(date, { timePrecision: 'hour', fallback: 'X' })).toBe('X');
    expect(formatInstantForDisplay(date, { timePrecision: '', fallback: 'X' })).toBe('X');
    expect(formatInstantForDisplay(date, { timePrecision: 'minutes', fallback: 'X' })).toBe('X');
  });

  it('uses the default empty fallback and honours a custom one', () => {
    expect(formatInstantForDisplay('nope')).toBe('');
    expect(formatInstantForDisplay('nope', { fallback: '—' })).toBe('—');
    expect(formatInstantForDisplay(null, { fallback: 'N/A' })).toBe('N/A');
    expect(formatInstantForDisplay(undefined, { fallback: 'N/A' })).toBe('N/A');
    expect(formatInstantForDisplay([], { fallback: 'N/A' })).toBe('N/A');
  });

  it('crosses the day boundary using the Jerusalem zone (summer, UTC+3)', () => {
    // 21:30Z on the 26th is 00:30 on the 27th in Jerusalem.
    expect(formatInstantForDisplay(new Date(SUMMER_UTC), { timePrecision: 'second' }))
      .toBe('27-06-2026 00:30:00');
  });

  it('handles a winter instant away from any DST transition (UTC+2)', () => {
    // 2026-01-15 is winter (IST, UTC+2): 10:00Z -> 12:00 local.
    const winter = new Date('2026-01-15T10:00:00Z');

    expect(formatInstantForDisplay(winter, { timePrecision: 'second' }))
      .toBe('15-01-2026 12:00:00');
  });

  it('zero-pads day, month, hour, minute and second', () => {
    // 2026-03-05 is still winter (UTC+2): 05:08:09Z -> 07:08:09 local.
    const padded = new Date('2026-03-05T05:08:09Z');

    expect(formatInstantForDisplay(padded, { timePrecision: 'second' }))
      .toBe('05-03-2026 07:08:09');
  });

  it('shows midnight as 00, never 24', () => {
    // 21:00Z on the 26th is exactly 00:00 on the 27th in Jerusalem (summer).
    const midnight = new Date('2026-06-26T21:00:00Z');

    expect(formatInstantForDisplay(midnight, { timePrecision: 'second' }))
      .toBe('27-06-2026 00:00:00');
    expect(formatInstantForDisplay(midnight, { timePrecision: 'minute' }))
      .toBe('27-06-2026 00:00');
  });
});


describe('formatInstantForDisplay — year contract', () => {
  // Noon UTC keeps these edge cases off the day boundary, so the Jerusalem-local
  // calendar day stays on the same date and only the YEAR is under test. The
  // year is matched with a regex so the assertion is robust to the historical
  // Jerusalem offset (LMT) of very early years, while still proving four-digit
  // zero-padding.
  it('renders a four-digit padded year for year 0001', () => {
    const early = new Date('0001-06-26T12:00:00Z');

    expect(formatInstantForDisplay(early)).toMatch(/^\d{2}-\d{2}-0001$/);
    expect(formatInstantForDisplay(early, { timePrecision: 'second' }))
      .toMatch(/^\d{2}-\d{2}-0001 \d{2}:\d{2}:\d{2}$/);
  });

  it('renders year 9999 as four digits', () => {
    const late = new Date('9999-06-26T12:00:00Z');

    expect(formatInstantForDisplay(late)).toMatch(/^\d{2}-\d{2}-9999$/);
  });

  it('rejects year 0000 (1 BC) and earlier BC years', () => {
    expect(formatInstantForDisplay(new Date('0000-06-26T12:00:00Z'), { fallback: 'X' })).toBe('X');
    expect(formatInstantForDisplay(new Date('-000001-06-26T12:00:00Z'), { fallback: 'X' })).toBe('X');
  });

  it('rejects a five-digit year (10000)', () => {
    expect(formatInstantForDisplay(new Date('+010000-06-26T12:00:00Z'), { fallback: 'X' })).toBe('X');
  });
});
