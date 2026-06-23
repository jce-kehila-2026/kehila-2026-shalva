// Unit tests for the logical attendance-day key helpers.
//
// getJerusalemDateKey hard-codes the Asia/Jerusalem timezone, so its result
// must be identical no matter what the process TZ is. The repo runs this file
// twice (TZ=UTC and TZ=America/Los_Angeles) to prove that externally; the tests
// construct instants from explicit UTC strings so the expectations are exact.
import { describe, it, expect } from 'vitest';

import { getJerusalemDateKey, getJerusalemWeekdayName, buildAttendanceId } from '../src/utils/dateKey.js';
import { isSaturdayDateValue } from '../src/utils/activityDays.js';


describe('getJerusalemDateKey', () => {
  it('maps a summer instant (UTC+3 / IDT) to the Jerusalem day', () => {
    // 2026-06-26T21:30:00Z is 2026-06-27 00:30 in Jerusalem (summer, UTC+3).
    expect(getJerusalemDateKey(new Date('2026-06-26T21:30:00Z'))).toBe('2026-06-27');
  });

  it('maps a winter instant (UTC+2 / IST) to the Jerusalem day', () => {
    // 2026-01-15T22:30:00Z is 2026-01-16 00:30 in Jerusalem (winter, UTC+2).
    expect(getJerusalemDateKey(new Date('2026-01-15T22:30:00Z'))).toBe('2026-01-16');
  });

  it('puts the day boundary at Jerusalem midnight (summer, 21:00Z)', () => {
    expect(getJerusalemDateKey(new Date('2026-06-26T20:59:00Z'))).toBe('2026-06-26');
    expect(getJerusalemDateKey(new Date('2026-06-26T21:00:00Z'))).toBe('2026-06-27');
  });

  it('puts the day boundary at Jerusalem midnight (winter, 22:00Z)', () => {
    expect(getJerusalemDateKey(new Date('2026-01-15T21:59:00Z'))).toBe('2026-01-15');
    expect(getJerusalemDateKey(new Date('2026-01-15T22:00:00Z'))).toBe('2026-01-16');
  });

  it('defaults to "now" but always returns a strict YYYY-MM-DD', () => {
    expect(getJerusalemDateKey()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('always returns a strict YYYY-MM-DD for valid instants', () => {
    for (const iso of ['2026-06-26T21:30:00Z', '2000-02-29T10:00:00Z', '2026-12-31T23:00:00Z']) {
      expect(getJerusalemDateKey(new Date(iso))).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it('rejects an Invalid Date with an empty string', () => {
    expect(getJerusalemDateKey(new Date('not-a-date'))).toBe('');
  });

  it('rejects non-Date shapes with an empty string', () => {
    for (const value of ['2026-06-27', 1782000000000, null, {}, [], { toDate: () => new Date() }]) {
      expect(getJerusalemDateKey(value)).toBe('');
    }
  });

  it('produces a Saturday key for a Saturday instant (cross-checked)', () => {
    // 2026-06-26T21:30:00Z -> 2026-06-27 in Jerusalem, which is a Saturday.
    const key = getJerusalemDateKey(new Date('2026-06-26T21:30:00Z'));
    expect(key).toBe('2026-06-27');
    expect(isSaturdayDateValue(key)).toBe(true);
  });

  it('produces a non-Saturday key for a Friday-evening Jerusalem instant', () => {
    // 2026-06-26 is a Friday in Jerusalem; an afternoon instant stays on it.
    const key = getJerusalemDateKey(new Date('2026-06-26T12:00:00Z'));
    expect(key).toBe('2026-06-26');
    expect(isSaturdayDateValue(key)).toBe(false);
  });
});


describe('buildAttendanceId', () => {
  it('composes groupId_dateKey_volunteerId', () => {
    expect(buildAttendanceId('groupA', '2026-06-27', 'vol1')).toBe('groupA_2026-06-27_vol1');
  });

  it('keeps underscores inside groupId / volunteerId intact (no splitting)', () => {
    expect(buildAttendanceId('grp_1', '2026-06-27', 'vol_2'))
      .toBe('grp_1_2026-06-27_vol_2');
  });
});


describe('getJerusalemDateKey — year contract', () => {
  // Noon UTC keeps these off the day boundary, so only the YEAR is under test.
  it('zero-pads year 0001 to four digits', () => {
    expect(getJerusalemDateKey(new Date('0001-06-26T12:00:00Z'))).toMatch(/^0001-\d{2}-\d{2}$/);
  });

  it('accepts year 9999', () => {
    expect(getJerusalemDateKey(new Date('9999-06-26T12:00:00Z'))).toMatch(/^9999-\d{2}-\d{2}$/);
  });

  it('rejects year 0000 (1 BC) with an empty string', () => {
    expect(getJerusalemDateKey(new Date('0000-06-26T12:00:00Z'))).toBe('');
  });

  it('rejects a five-digit year (10000) with an empty string', () => {
    expect(getJerusalemDateKey(new Date('+010000-06-26T12:00:00Z'))).toBe('');
  });
});


describe('getJerusalemWeekdayName', () => {
  it('returns the full Hebrew weekday in Asia/Jerusalem', () => {
    expect(getJerusalemWeekdayName(new Date('2026-06-21T10:00:00Z'))).toBe('יום ראשון');
    expect(getJerusalemWeekdayName(new Date('2026-06-26T10:00:00Z'))).toBe('יום שישי');
  });

  it('uses the Jerusalem day boundary — same instant gives Saturday', () => {
    // 2026-06-26T21:30:00Z is already 2026-06-27 (Saturday) in Jerusalem.
    const instant = new Date('2026-06-26T21:30:00Z');
    expect(getJerusalemDateKey(instant)).toBe('2026-06-27');
    expect(getJerusalemWeekdayName(instant)).toBe('יום שבת');
    expect(isSaturdayDateValue(getJerusalemDateKey(instant))).toBe(true);
  });

  it('rejects an invalid Date / non-Date with an empty string', () => {
    expect(getJerusalemWeekdayName(new Date('nope'))).toBe('');
    expect(getJerusalemWeekdayName('2026-06-27')).toBe('');
    expect(getJerusalemWeekdayName(null)).toBe('');
  });
});
