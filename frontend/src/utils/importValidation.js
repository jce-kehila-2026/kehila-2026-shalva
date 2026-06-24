// Pure validation/normalization helpers for Excel IMPORT (no UI, no Firebase).
//
// Every function returns an explicit result the caller can act on:
//   { ok: true,  value }   — normalized, safe-to-store value
//   { ok: false, code }    — a stable machine code (caller maps it to Hebrew)
//
// The day list is NOT duplicated here — it comes from the existing
// activityDays.js single source of truth (which now includes Saturday).

import {
  ACTIVITY_DAYS,
  ACTIVITY_DAY_SHORT_LABELS,
} from './activityDays.js';

// The closed list of activity-time slots (בוקר / צהריים / ערב) — single source.
import { GROUP_TIMES } from './groupOptions.js';


// ---------------------------------------------------------------------------
// Activity day
// ---------------------------------------------------------------------------

// Normalize an imported activity-day cell to the canonical full form
// ('ראשון' and 'יום ראשון' → 'יום ראשון'; 'שבת' / 'יום שבת' → 'יום שבת').
// An unrecognized value is rejected (never stored raw). Empty is accepted as
// empty (the field is optional).
export function normalizeImportedActivityDay(value) {
  // Treat missing as empty (allowed for an optional field).
  if (value === null || value === undefined) {
    return { ok: true, value: '' };
  }

  const trimmed = String(value).trim();

  // Empty cell — allowed.
  if (trimmed === '') {
    return { ok: true, value: '' };
  }

  // Already the canonical full form ('יום ראשון').
  const fullIndex = ACTIVITY_DAYS.indexOf(trimmed);
  if (fullIndex !== -1) {
    return { ok: true, value: ACTIVITY_DAYS[fullIndex] };
  }

  // Short form ('ראשון') — map to the matching full label by index.
  const shortIndex = ACTIVITY_DAY_SHORT_LABELS.indexOf(trimmed);
  if (shortIndex !== -1) {
    return { ok: true, value: ACTIVITY_DAYS[shortIndex] };
  }

  // Anything else is not a known weekday.
  return { ok: false, code: 'UNKNOWN_DAY' };
}


// ---------------------------------------------------------------------------
// Activity time
// ---------------------------------------------------------------------------

// Normalize an imported activity-time cell against the canonical GROUP_TIMES.
// Empty is accepted as empty (optional field); a value that matches a GROUP_TIMES
// entry (after trimming surrounding whitespace) returns that canonical value; an
// unrecognized value is rejected (never stored raw).
export function normalizeImportedActivityTime(value) {
  if (value === null || value === undefined) {
    return { ok: true, value: '' };
  }

  const trimmed = String(value).trim();

  if (trimmed === '') {
    return { ok: true, value: '' };
  }

  const match = GROUP_TIMES.find((time) => time === trimmed);
  if (match) {
    return { ok: true, value: match };
  }

  return { ok: false, code: 'UNKNOWN_TIME' };
}


// ---------------------------------------------------------------------------
// Mobile phone
// ---------------------------------------------------------------------------

// Mask a phone for safe inclusion in an error report / log: only the first two
// and last two characters survive; the full number never appears.
export function maskPhoneForError(value) {
  const text = String(value ?? '');

  // Too short to reveal anything safely — hide it entirely.
  if (text.length <= 4) {
    return '*'.repeat(text.length);
  }

  const head = text.slice(0, 2);
  const tail = text.slice(-2);
  const hidden = '*'.repeat(text.length - 4);

  return `${head}${hidden}${tail}`;
}


// Normalize an imported phone to a local Israeli MOBILE string '05XXXXXXXX'.
//
// Accepts (and converts) the common shapes: local with separators / parentheses,
// '+972…', '00972…', and a bare '5XXXXXXXX' (an unambiguous mobile that merely
// lost its leading 0 — e.g. a numeric Excel cell). It deliberately does NOT:
//   - strip letters and then accept the leftover digits,
//   - guess a leading 0 for anything other than the 9-digit 5XXXXXXXX case,
//   - rely on an operator-prefix list,
//   - ever return a number (always a string).
export function normalizeImportedMobilePhone(value, { required = false } = {}) {
  // Missing value.
  if (value === null || value === undefined) {
    return required ? { ok: false, code: 'REQUIRED' } : { ok: true, value: '' };
  }

  const isNumberInput = typeof value === 'number';

  // A numeric cell is only usable as a positive, exact integer. Reject negative,
  // decimal, NaN and Infinity HERE — before any String()/replace — so a sign or
  // a fractional part can never be silently stripped into a "valid" number.
  if (isNumberInput && (!Number.isSafeInteger(value) || value <= 0)) {
    return { ok: false, code: 'INVALID' };
  }

  const raw = typeof value === 'string' ? value.trim() : String(value);

  // Empty after trimming.
  if (raw === '') {
    return required ? { ok: false, code: 'REQUIRED' } : { ok: true, value: '' };
  }

  // For STRING input, reject illegal characters up front rather than silently
  // stripping them (a stripped sign or letter would corrupt the number).
  if (typeof value === 'string') {
    // A '-' that appears BEFORE the first digit is a negative sign, not a
    // separator. This also catches it inside parentheses or after a '+'
    // (e.g. '(-50…)', '+-972…'). Minuses between digits stay valid separators.
    // Never strip the sign and then accept the remaining digits as a number.
    const firstDigitIndex = raw.search(/\d/);
    const firstMinusIndex = raw.indexOf('-');
    if (firstMinusIndex !== -1 && (firstDigitIndex === -1 || firstMinusIndex < firstDigitIndex)) {
      return { ok: false, code: 'ILLEGAL_CHARS' };
    }

    // A '+' is only legal as the very first character.
    if (raw.includes('+') && raw.indexOf('+') !== 0) {
      return { ok: false, code: 'ILLEGAL_CHARS' };
    }

    // Allow only digits and the usual formatting characters.
    if (!/^\+?[0-9()\s-]+$/.test(raw)) {
      return { ok: false, code: 'ILLEGAL_CHARS' };
    }
  }

  // Reduce to digits, remembering whether a country-code '+' was present.
  const hadPlus = typeof value === 'string' && raw.startsWith('+');
  let digits = raw.replace(/\D/g, '');

  if (!digits) {
    return { ok: false, code: 'INVALID' };
  }

  // Convert international / bare-mobile forms to the local 0-prefixed form.
  if (hadPlus) {
    // '+...' must be the Israeli country code.
    if (!digits.startsWith('972')) {
      return { ok: false, code: 'INVALID' };
    }
    digits = `0${digits.slice(3)}`;
  } else if (digits.startsWith('00972')) {
    digits = `0${digits.slice(5)}`;
  } else if (digits.startsWith('972')) {
    digits = `0${digits.slice(3)}`;
  } else if (digits.length === 9 && digits[0] === '5') {
    // Unambiguous mobile missing its leading 0 (covers numeric cells).
    digits = `0${digits}`;
  }

  // Final shape must be a local mobile: '05' + 8 digits = 10 digits total.
  if (!/^05\d{8}$/.test(digits)) {
    // A numeric cell that didn't resolve cleanly lost information ambiguously.
    if (isNumberInput) {
      return { ok: false, code: 'NUMERIC_AMBIGUOUS' };
    }

    if (digits.length < 10) {
      return { ok: false, code: 'TOO_SHORT' };
    }
    if (digits.length > 10) {
      return { ok: false, code: 'TOO_LONG' };
    }
    return { ok: false, code: 'NOT_MOBILE' };
  }

  return { ok: true, value: digits };
}


// ---------------------------------------------------------------------------
// Excel date
// ---------------------------------------------------------------------------

// Gregorian leap-year rule: divisible by 400, or by 4 but not by 100.
function isLeapYear(year) {
  if (year % 400 === 0) {
    return true;
  }
  if (year % 100 === 0) {
    return false;
  }
  return year % 4 === 0;
}


// True only for a real calendar date (rejects e.g. 2026-02-29, 2026-04-31).
// Pure arithmetic — no new Date / Date.UTC — so it never depends on the machine
// timezone and never relies on Date.UTC's special 0–99 year remapping (which
// would let a 5-digit year slip past the YYYY-MM-DD contract). Year is bounded
// to 1–9999 to match a 4-digit 'YYYY'.
function isRealYMD(year, month, day) {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    return false;
  }

  if (year < 1 || year > 9999) {
    return false;
  }

  if (month < 1 || month > 12) {
    return false;
  }

  // Days in each month (February depends on the leap rule).
  const daysInMonth = [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

  return day >= 1 && day <= daysInMonth[month - 1];
}


// Zero-padded internal 'YYYY-MM-DD'.
function toIsoDate(year, month, day) {
  const yyyy = String(year).padStart(4, '0');
  const mm = String(month).padStart(2, '0');
  const dd = String(day).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}


// Decode an Excel serial day-number to { y, m, d }, honouring the workbook's
// date system. Returns the string 'FAKE_LEAP' for the bogus 1900-02-29 serial,
// or null when the serial is out of range. Only the integer day part is used,
// so a fractional time-of-day never shifts the calendar day. No SheetJS needed.
function serialToParts(serial, date1904) {
  if (typeof serial !== 'number' || !Number.isFinite(serial)) {
    return null;
  }

  const dayNumber = Math.floor(serial);
  const MS_PER_DAY = 86400000;

  // 1904 system: serial 0 = 1904-01-01, and there is no phantom leap day.
  if (date1904) {
    if (dayNumber < 0) {
      return null;
    }

    const probe = new Date(Date.UTC(1904, 0, 1) + dayNumber * MS_PER_DAY);
    return { y: probe.getUTCFullYear(), m: probe.getUTCMonth() + 1, d: probe.getUTCDate() };
  }

  // 1900 system: serial 1 = 1900-01-01.
  if (dayNumber < 1) {
    return null;
  }

  // Serial 60 is Excel's non-existent 1900-02-29.
  if (dayNumber === 60) {
    return 'FAKE_LEAP';
  }

  // Skip the phantom day for everything after it.
  const adjusted = dayNumber > 60 ? dayNumber - 1 : dayNumber;
  const probe = new Date(Date.UTC(1900, 0, 1) + (adjusted - 1) * MS_PER_DAY);

  return { y: probe.getUTCFullYear(), m: probe.getUTCMonth() + 1, d: probe.getUTCDate() };
}


// Parse an imported date into the internal 'YYYY-MM-DD' string.
//
// Accepts: strict 'YYYY-MM-DD', strict 'DD-MM-YYYY' (day-first, Israeli rule),
// a Date object, a decoded { y, m, d } parts object, and an Excel serial number
// (with the workbook's date1904 flag). Rejects: slash formats, impossible
// dates, the bogus 1900-02-29 serial, and anything unrecognized.
//
// Never uses new Date('YYYY-MM-DD') (timezone-sensitive) and never imports xlsx
// (serial decoding is done here, so lazy-loading elsewhere is untouched).
export function parseImportedDate(value, { date1904 = false } = {}) {
  // Missing — accepted as empty.
  if (value === null || value === undefined) {
    return { ok: true, value: '' };
  }

  // Excel serial number.
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      return { ok: false, code: 'INVALID' };
    }

    const parts = serialToParts(value, date1904);

    if (parts === 'FAKE_LEAP') {
      return { ok: false, code: 'EXCEL_FAKE_LEAP' };
    }
    if (!parts) {
      return { ok: false, code: 'INVALID' };
    }
    if (!isRealYMD(parts.y, parts.m, parts.d)) {
      return { ok: false, code: 'INVALID_DATE' };
    }

    return { ok: true, value: toIsoDate(parts.y, parts.m, parts.d) };
  }

  // A real Date object — read its UTC components. This branch is meant for a
  // Date produced by a SheetJS cellDates read (UTC-midnight semantics), or any
  // Date built with UTC intent — NOT an arbitrary local "instant". For a
  // UTC-built date the calendar day is stable across machine timezones.
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      return { ok: false, code: 'INVALID' };
    }

    const y = value.getUTCFullYear();
    const m = value.getUTCMonth() + 1;
    const d = value.getUTCDate();

    if (!isRealYMD(y, m, d)) {
      return { ok: false, code: 'INVALID_DATE' };
    }

    return { ok: true, value: toIsoDate(y, m, d) };
  }

  // A decoded parts object { y, m, d } (decouples a lazy SheetJS decode from
  // this validation step).
  if (typeof value === 'object') {
    const { y, m, d } = value;

    if ([y, m, d].every((part) => Number.isInteger(part))) {
      if (!isRealYMD(y, m, d)) {
        return { ok: false, code: 'INVALID_DATE' };
      }
      return { ok: true, value: toIsoDate(y, m, d) };
    }

    return { ok: false, code: 'UNRECOGNIZED' };
  }

  // String forms.
  if (typeof value === 'string') {
    const trimmed = value.trim();

    if (trimmed === '') {
      return { ok: true, value: '' };
    }

    // Slash formats are explicitly rejected (no documented rule for them).
    if (trimmed.includes('/')) {
      return { ok: false, code: 'SLASH' };
    }

    // Strict 'YYYY-MM-DD'.
    let match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
    if (match) {
      const y = Number(match[1]);
      const m = Number(match[2]);
      const d = Number(match[3]);

      if (!isRealYMD(y, m, d)) {
        return { ok: false, code: 'INVALID_DATE' };
      }
      return { ok: true, value: toIsoDate(y, m, d) };
    }

    // Strict 'DD-MM-YYYY' (day-first): 06-07-2026 → 2026-07-06.
    match = /^(\d{2})-(\d{2})-(\d{4})$/.exec(trimmed);
    if (match) {
      const d = Number(match[1]);
      const m = Number(match[2]);
      const y = Number(match[3]);

      if (!isRealYMD(y, m, d)) {
        return { ok: false, code: 'INVALID_DATE' };
      }
      return { ok: true, value: toIsoDate(y, m, d) };
    }

    return { ok: false, code: 'UNRECOGNIZED' };
  }

  // Booleans and anything else.
  return { ok: false, code: 'UNRECOGNIZED' };
}
