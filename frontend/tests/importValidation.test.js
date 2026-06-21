// Unit tests for the pure Excel-import validation helpers.
import { describe, it, expect } from 'vitest';

import {
  normalizeImportedActivityDay,
  normalizeImportedMobilePhone,
  maskPhoneForError,
  parseImportedDate,
} from '../src/utils/importValidation.js';

import {
  ACTIVITY_DAYS,
  ACTIVITY_DAY_SHORT_LABELS,
} from '../src/utils/activityDays.js';


describe('normalizeImportedActivityDay', () => {
  it('normalizes each allowed day from short AND full form to the canonical full form', () => {
    ACTIVITY_DAYS.forEach((fullDay, index) => {
      const shortDay = ACTIVITY_DAY_SHORT_LABELS[index];

      expect(normalizeImportedActivityDay(fullDay)).toEqual({ ok: true, value: fullDay });
      expect(normalizeImportedActivityDay(shortDay)).toEqual({ ok: true, value: fullDay });
    });
  });

  it('rejects Saturday in both spellings with a dedicated code', () => {
    expect(normalizeImportedActivityDay('שבת')).toEqual({ ok: false, code: 'SATURDAY' });
    expect(normalizeImportedActivityDay('יום שבת')).toEqual({ ok: false, code: 'SATURDAY' });
  });

  it('tolerates surrounding whitespace', () => {
    expect(normalizeImportedActivityDay('  ראשון  ')).toEqual({ ok: true, value: 'יום ראשון' });
    expect(normalizeImportedActivityDay('\tיום שישי\n')).toEqual({ ok: true, value: 'יום שישי' });
    expect(normalizeImportedActivityDay('  שבת ')).toEqual({ ok: false, code: 'SATURDAY' });
  });

  it('accepts an empty value as empty (optional field)', () => {
    expect(normalizeImportedActivityDay('')).toEqual({ ok: true, value: '' });
    expect(normalizeImportedActivityDay('   ')).toEqual({ ok: true, value: '' });
    expect(normalizeImportedActivityDay(null)).toEqual({ ok: true, value: '' });
    expect(normalizeImportedActivityDay(undefined)).toEqual({ ok: true, value: '' });
  });

  it('rejects an unrecognized value (never stored raw)', () => {
    expect(normalizeImportedActivityDay('Sunday')).toEqual({ ok: false, code: 'UNKNOWN_DAY' });
    expect(normalizeImportedActivityDay('יומיום')).toEqual({ ok: false, code: 'UNKNOWN_DAY' });
  });
});


describe('normalizeImportedMobilePhone', () => {
  const LOCAL = '0501234567';

  it('accepts every supported shape and returns the local 05XXXXXXXX string', () => {
    const accepted = [
      '0501234567',
      '050-123-4567',
      '050 123 4567',
      '(050) 123-4567',
      '+972501234567',
      '00972501234567',
      '501234567',
    ];

    for (const input of accepted) {
      expect(normalizeImportedMobilePhone(input)).toEqual({ ok: true, value: LOCAL });
    }
  });

  it('restores the leading 0 for a bare 9-digit mobile (string and numeric cell)', () => {
    expect(normalizeImportedMobilePhone('501234567')).toEqual({ ok: true, value: LOCAL });
    expect(normalizeImportedMobilePhone(501234567)).toEqual({ ok: true, value: LOCAL });
  });

  it('rejects too-short and too-long numbers', () => {
    expect(normalizeImportedMobilePhone('12345').ok).toBe(false);
    expect(normalizeImportedMobilePhone('050123456789').ok).toBe(false);
    expect(normalizeImportedMobilePhone('050123456789').code).toBe('TOO_LONG');
  });

  it('rejects letters WITHOUT stripping them into a "valid" number', () => {
    const result = normalizeImportedMobilePhone('050-12a-4567');
    expect(result).toEqual({ ok: false, code: 'ILLEGAL_CHARS' });
    expect(result.value).toBeUndefined();
  });

  it('rejects a misplaced plus sign', () => {
    expect(normalizeImportedMobilePhone('050+1234567')).toEqual({ ok: false, code: 'ILLEGAL_CHARS' });
  });

  it('rejects a valid landline (this field is mobile-only)', () => {
    expect(normalizeImportedMobilePhone('02-1234567').ok).toBe(false);
    expect(normalizeImportedMobilePhone('0312345678').code).toBe('NOT_MOBILE');
  });

  it('rejects a numeric cell that lost information ambiguously', () => {
    expect(normalizeImportedMobilePhone(81234567)).toEqual({ ok: false, code: 'NUMERIC_AMBIGUOUS' });
  });

  it('handles emptiness according to the required flag', () => {
    expect(normalizeImportedMobilePhone('')).toEqual({ ok: true, value: '' });
    expect(normalizeImportedMobilePhone('', { required: false })).toEqual({ ok: true, value: '' });
    expect(normalizeImportedMobilePhone('', { required: true })).toEqual({ ok: false, code: 'REQUIRED' });
    expect(normalizeImportedMobilePhone(null, { required: true })).toEqual({ ok: false, code: 'REQUIRED' });
  });

  it('always returns a string value (never a number) on success', () => {
    const fromString = normalizeImportedMobilePhone('0501234567');
    const fromNumber = normalizeImportedMobilePhone(501234567);

    expect(typeof fromString.value).toBe('string');
    expect(typeof fromNumber.value).toBe('string');
  });

  it('rejects negative / decimal / zero numbers without sign-stripping into a valid number', () => {
    // A negative number must never have its sign stripped and the digits accepted.
    const negativeNumber = normalizeImportedMobilePhone(-501234567);
    expect(negativeNumber.ok).toBe(false);
    expect(negativeNumber.value).toBeUndefined();

    // A negative-looking STRING must be rejected the same way.
    const negativeString = normalizeImportedMobilePhone('-501234567');
    expect(negativeString).toEqual({ ok: false, code: 'ILLEGAL_CHARS' });
    expect(negativeString.value).toBeUndefined();

    // A decimal numeric cell is not a phone.
    const decimal = normalizeImportedMobilePhone(501234567.5);
    expect(decimal.ok).toBe(false);
    expect(decimal.value).toBeUndefined();

    // Zero is not a phone.
    const zero = normalizeImportedMobilePhone(0);
    expect(zero.ok).toBe(false);
    expect(zero.value).toBeUndefined();
  });

  it('rejects a minus before the first digit, even inside parentheses or after a +', () => {
    const negatives = ['-501234567', '(-501234567)', '( -501234567 )', '+-972501234567'];

    for (const input of negatives) {
      const result = normalizeImportedMobilePhone(input);
      expect(result).toEqual({ ok: false, code: 'ILLEGAL_CHARS' });
      // On failure there must be no `value` property at all.
      expect(result).not.toHaveProperty('value');
    }
  });

  it('keeps valid parenthesized and separated international numbers valid', () => {
    expect(normalizeImportedMobilePhone('(050) 123-4567')).toEqual({ ok: true, value: LOCAL });
    expect(normalizeImportedMobilePhone('+972-50-123-4567')).toEqual({ ok: true, value: LOCAL });
  });
});


describe('maskPhoneForError', () => {
  it('never contains the full original number', () => {
    const full = '0501234567';
    const masked = maskPhoneForError(full);

    expect(masked).not.toBe(full);
    expect(masked.includes(full)).toBe(false);
    expect(masked).toMatch(/\*/);
    // Keeps only first two + last two visible.
    expect(masked).toBe('05******67');
  });

  it('masks numeric input and short values too', () => {
    expect(maskPhoneForError(501234567).includes('501234567')).toBe(false);
    expect(maskPhoneForError('123')).toBe('***');
  });
});


describe('parseImportedDate', () => {
  it('accepts strict YYYY-MM-DD', () => {
    expect(parseImportedDate('2026-06-27')).toEqual({ ok: true, value: '2026-06-27' });
  });

  it('accepts strict DD-MM-YYYY as day-first', () => {
    expect(parseImportedDate('27-06-2026')).toEqual({ ok: true, value: '2026-06-27' });
    expect(parseImportedDate('06-07-2026')).toEqual({ ok: true, value: '2026-07-06' });
  });

  it('rejects slash formats', () => {
    expect(parseImportedDate('06/07/2026')).toEqual({ ok: false, code: 'SLASH' });
    expect(parseImportedDate('2026/06/27')).toEqual({ ok: false, code: 'SLASH' });
  });

  it('accepts a valid leap day and rejects an invalid one', () => {
    expect(parseImportedDate('2024-02-29')).toEqual({ ok: true, value: '2024-02-29' });
    expect(parseImportedDate('2026-02-29')).toEqual({ ok: false, code: 'INVALID_DATE' });
    expect(parseImportedDate('2026-04-31')).toEqual({ ok: false, code: 'INVALID_DATE' });
  });

  it('accepts boundary years and rejects out-of-range years', () => {
    // Lowest 4-digit years and the highest year are valid calendar dates.
    expect(parseImportedDate('0001-01-01')).toEqual({ ok: true, value: '0001-01-01' });
    expect(parseImportedDate('0099-01-01')).toEqual({ ok: true, value: '0099-01-01' });
    expect(parseImportedDate('9999-12-31')).toEqual({ ok: true, value: '9999-12-31' });

    // Years outside 1–9999 are rejected (via the parts-object path).
    expect(parseImportedDate({ y: 10000, m: 1, d: 1 })).toEqual({ ok: false, code: 'INVALID_DATE' });
    expect(parseImportedDate({ y: 0, m: 1, d: 1 })).toEqual({ ok: false, code: 'INVALID_DATE' });
  });

  it('applies the Gregorian leap rule at century boundaries', () => {
    // 1900 is NOT a leap year (divisible by 100, not 400).
    expect(parseImportedDate('1900-02-29')).toEqual({ ok: false, code: 'INVALID_DATE' });
    // 2000 IS a leap year (divisible by 400).
    expect(parseImportedDate('2000-02-29')).toEqual({ ok: true, value: '2000-02-29' });
  });

  it('accepts a Saturday birth date (no Saturday rule on dates)', () => {
    // 2026-06-27 is a Saturday; a birth date may fall on any day.
    expect(parseImportedDate('2026-06-27')).toEqual({ ok: true, value: '2026-06-27' });
  });

  it('decodes an Excel serial in the 1900 date system', () => {
    // 36326 (1900 system) = 1999-06-15 (empirically confirmed via a real round-trip).
    expect(parseImportedDate(36326)).toEqual({ ok: true, value: '1999-06-15' });
  });

  it('decodes an Excel serial in the 1904 date system', () => {
    // Same calendar date, 1462 less in the 1904 system.
    expect(parseImportedDate(34864, { date1904: true })).toEqual({ ok: true, value: '1999-06-15' });
  });

  it('handles 1900-system serial boundaries around the phantom leap day', () => {
    expect(parseImportedDate(1)).toEqual({ ok: true, value: '1900-01-01' });
    expect(parseImportedDate(59)).toEqual({ ok: true, value: '1900-02-28' });
    expect(parseImportedDate(60)).toEqual({ ok: false, code: 'EXCEL_FAKE_LEAP' });
    expect(parseImportedDate(61)).toEqual({ ok: true, value: '1900-03-01' });
  });

  it('handles 1904-system serial boundaries (no phantom day; 1904 is a leap year)', () => {
    expect(parseImportedDate(0, { date1904: true })).toEqual({ ok: true, value: '1904-01-01' });
    expect(parseImportedDate(59, { date1904: true })).toEqual({ ok: true, value: '1904-02-29' });
    expect(parseImportedDate(60, { date1904: true })).toEqual({ ok: true, value: '1904-03-01' });
  });

  it('ignores a fractional time-of-day part (no day shift)', () => {
    expect(parseImportedDate(36326.5)).toEqual({ ok: true, value: '1999-06-15' });
    expect(parseImportedDate(36326.999)).toEqual({ ok: true, value: '1999-06-15' });
  });

  it('rejects the bogus 1900-02-29 serial', () => {
    expect(parseImportedDate(60)).toEqual({ ok: false, code: 'EXCEL_FAKE_LEAP' });
  });

  it('accepts a Date object and a decoded parts object', () => {
    expect(parseImportedDate(new Date(Date.UTC(2026, 5, 27)))).toEqual({ ok: true, value: '2026-06-27' });
    expect(parseImportedDate({ y: 2026, m: 6, d: 27 })).toEqual({ ok: true, value: '2026-06-27' });
  });

  it('rejects unrecognized values and empties to empty', () => {
    expect(parseImportedDate('not-a-date')).toEqual({ ok: false, code: 'UNRECOGNIZED' });
    expect(parseImportedDate('')).toEqual({ ok: true, value: '' });
    expect(parseImportedDate(null)).toEqual({ ok: true, value: '' });
  });

  it('gives the same result under different machine timezones', () => {
    const proc = globalThis.process;
    const originalTz = proc?.env?.TZ;

    try {
      for (const tz of ['UTC', 'America/Los_Angeles', 'Asia/Jerusalem', 'Pacific/Kiritimati']) {
        if (proc?.env) {
          proc.env.TZ = tz;
        }

        expect(parseImportedDate('2026-06-27')).toEqual({ ok: true, value: '2026-06-27' });
        expect(parseImportedDate(36326)).toEqual({ ok: true, value: '1999-06-15' });
        expect(parseImportedDate(36326.5)).toEqual({ ok: true, value: '1999-06-15' });
        // The Date branch (UTC-built date) must also be timezone-stable.
        expect(parseImportedDate(new Date(Date.UTC(2026, 5, 27)))).toEqual({ ok: true, value: '2026-06-27' });
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
