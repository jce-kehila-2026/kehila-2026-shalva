// Unit tests for the shared activity-day constants + selected-value validators.
import { describe, it, expect } from 'vitest';

import {
  ACTIVITY_DAYS,
  ACTIVITY_DAY_SHORT_LABELS,
  isAllowedActivityDay,
  isSaturdayDateValue,
} from '../src/utils/activityDays.js';

// Anchor dates (Asia/Jerusalem calendar, but the validator is UTC-based):
//   2026-06-19 = Friday, 2026-06-20 = Saturday, 2026-06-21 = Sunday.
const KNOWN_SATURDAY = '2026-06-20';
const KNOWN_FRIDAY = '2026-06-19';
const KNOWN_SUNDAY = '2026-06-21';


describe('ACTIVITY_DAYS', () => {
  it('contains exactly seven values, ordered Sunday → Saturday', () => {
    expect(ACTIVITY_DAYS).toEqual([
      'יום ראשון',
      'יום שני',
      'יום שלישי',
      'יום רביעי',
      'יום חמישי',
      'יום שישי',
      'יום שבת',
    ]);
  });

  it('includes Saturday (now a regular activity day)', () => {
    expect(ACTIVITY_DAYS).toContain('יום שבת');
  });

  it('has no duplicates', () => {
    expect(new Set(ACTIVITY_DAYS).size).toBe(ACTIVITY_DAYS.length);
  });
});


describe('ACTIVITY_DAY_SHORT_LABELS', () => {
  it('contains exactly the matching seven short labels', () => {
    expect(ACTIVITY_DAY_SHORT_LABELS).toEqual([
      'ראשון',
      'שני',
      'שלישי',
      'רביעי',
      'חמישי',
      'שישי',
      'שבת',
    ]);
  });

  it('is derived consistently from the full labels', () => {
    expect(ACTIVITY_DAY_SHORT_LABELS).toEqual(
      ACTIVITY_DAYS.map((day) => day.replace(/^יום\s+/, '')),
    );
  });

  it('includes the short Saturday label', () => {
    expect(ACTIVITY_DAY_SHORT_LABELS).toContain('שבת');
  });
});


describe('isAllowedActivityDay', () => {
  it('is true for every allowed full value (Saturday included)', () => {
    for (const day of ACTIVITY_DAYS) {
      expect(isAllowedActivityDay(day)).toBe(true);
    }
  });

  it('is false for empty, malformed, null, undefined, arrays, objects, and numbers', () => {
    const invalid = ['', '   ', 'ראשון', 'Sunday', null, undefined, 0, 5, NaN, [], {}, ['יום ראשון']];
    for (const value of invalid) {
      expect(isAllowedActivityDay(value)).toBe(false);
    }
  });
});


describe('isSaturdayDateValue', () => {
  it('is true for a known Saturday', () => {
    expect(isSaturdayDateValue(KNOWN_SATURDAY)).toBe(true);
  });

  it('is false for a known Friday and Sunday', () => {
    expect(isSaturdayDateValue(KNOWN_FRIDAY)).toBe(false);
    expect(isSaturdayDateValue(KNOWN_SUNDAY)).toBe(false);
  });

  it('handles valid leap days', () => {
    // 2020-02-29 is a Saturday; 2024-02-29 is a Thursday (both valid leap days).
    expect(isSaturdayDateValue('2020-02-29')).toBe(true);
    expect(isSaturdayDateValue('2024-02-29')).toBe(false);
  });

  it('rejects an invalid leap day (non-leap year Feb 29)', () => {
    expect(isSaturdayDateValue('2025-02-29')).toBe(false);
    expect(isSaturdayDateValue('2026-02-29')).toBe(false);
  });

  it('rejects impossible dates', () => {
    for (const value of ['2026-02-30', '2026-13-01', '2026-00-10', '2026-01-00', '2026-04-31']) {
      expect(isSaturdayDateValue(value)).toBe(false);
    }
  });

  it('rejects malformed formats', () => {
    const malformed = [
      '2026-6-20', '2026/06/20', '20-06-2026', '2026-06-20T00:00',
      '2026-06-20 ', ' 2026-06-20', '2026-06', 'not-a-date', '26-06-20',
    ];
    for (const value of malformed) {
      expect(isSaturdayDateValue(value)).toBe(false);
    }
  });

  it('rejects empty, null, undefined, and non-strings', () => {
    for (const value of ['', null, undefined, 0, 20260620, NaN, [], {}, new Date()]) {
      expect(isSaturdayDateValue(value)).toBe(false);
    }
  });

  it('is timezone-independent (uses UTC, not the local zone)', () => {
    // The result must not change under different process timezones. The validator
    // uses Date.UTC + getUTCDay, so it is correct regardless of whether the TZ
    // change actually takes effect in this runtime.
    const proc = globalThis.process;
    const originalTz = proc?.env?.TZ;
    try {
      for (const tz of ['UTC', 'America/Los_Angeles', 'Asia/Jerusalem', 'Pacific/Kiritimati']) {
        if (proc?.env) {
          proc.env.TZ = tz;
        }
        expect(isSaturdayDateValue(KNOWN_SATURDAY)).toBe(true);
        expect(isSaturdayDateValue(KNOWN_FRIDAY)).toBe(false);
        expect(isSaturdayDateValue(KNOWN_SUNDAY)).toBe(false);
      }
    } finally {
      if (proc?.env) {
        if (originalTz === undefined) {
          delete proc.env.TZ;
        } else {
          proc.env.TZ = originalTz;
        }
      }
    }
  });
});
