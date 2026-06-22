// Shared, display-only date formatters.
//
// There are TWO distinct value kinds in this codebase and they must never be
// confused:
//   - a date-only string ('YYYY-MM-DD') — a calendar day with no time / zone;
//   - an instant (Date / Firestore Timestamp / { seconds }) — a moment in time.
//
// Each kind has its own formatter below. There is deliberately NO third
// "smart" formatter that inspects the value and guesses which kind it is — the
// caller always knows, and must pick the right function. Both functions return
// a fallback (caller-controlled) instead of throwing, so a bad value can never
// crash a screen.


// ----- date-only -----

// Gregorian leap-year rule: divisible by 4, except centuries that are not also
// divisible by 400 (so 1900 and 2100 are NOT leap years, but 2000 is).
function isLeapYear(year) {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}


// Real number of days in a given month (1..12) of a given year — leap-aware.
function daysInMonth(year, month) {
  // February depends on the leap-year rule.
  if (month === 2) {
    return isLeapYear(year) ? 29 : 28;
  }

  // April, June, September and November have 30 days.
  if (month === 4 || month === 6 || month === 9 || month === 11) {
    return 30;
  }

  // Everything else has 31.
  return 31;
}


// Exactly four-two-two digits, dash-separated, anchored at both ends. No
// optional whitespace and no time suffix are tolerated — the value must be a
// clean 'YYYY-MM-DD' and nothing else.
const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;


// Format a strict 'YYYY-MM-DD' string as 'DD-MM-YYYY' for display.
//
// Accepts ONLY a string in that exact shape; every other value (Date,
// Timestamp-like, object, array, number, boolean, null, undefined, or a
// malformed string) returns the caller's fallback. The calendar validation is
// pure arithmetic — no Date / Date.UTC / new Date is constructed anywhere — so
// the result never depends on the host timezone.
export function formatDateOnlyForDisplay(value, { fallback = '' } = {}) {
  // Only an exact string is acceptable — no coercion of other shapes.
  if (typeof value !== 'string') {
    return fallback;
  }

  // Strict shape check. We do NOT trim, so a value with surrounding whitespace
  // is rejected rather than silently rehabilitated.
  const match = DATE_ONLY_PATTERN.exec(value);
  if (!match) {
    return fallback;
  }

  // The three components, as numbers, for arithmetic validation.
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  // Year 0000 is rejected; 0001..9999 are allowed (the four-digit pattern
  // already caps the upper end at 9999).
  if (year < 1) {
    return fallback;
  }

  // Month must be a real 1..12.
  if (month < 1 || month > 12) {
    return fallback;
  }

  // Day must be within that month's real length (leap-aware).
  if (day < 1 || day > daysInMonth(year, month)) {
    return fallback;
  }

  // Re-emit the original, already zero-padded digit groups in day-first order.
  return `${match[3]}-${match[2]}-${match[1]}`;
}


// ----- instant -----

// The time-precision levels this formatter understands. Anything else is a
// programming mistake and yields the fallback rather than a guessed format.
const ALLOWED_TIME_PRECISIONS = new Set(['none', 'minute', 'second']);


// Resolve one of the supported instant shapes into a VALID Date, or null.
// Strings and raw numbers are intentionally rejected here — only a real Date, a
// Timestamp-like object with a working toDate(), or a { seconds } object count.
function resolveInstantDate(value) {
  // A real Date — accepted only when it is valid (not an "Invalid Date").
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  // From here on only a non-null object can qualify; strings, numbers, booleans,
  // null and undefined all fall through to null.
  if (value === null || typeof value !== 'object') {
    return null;
  }

  // Timestamp-like: a toDate() that returns a valid Date. A throwing toDate(),
  // or one that returns a string / object / Invalid Date, is rejected.
  if (typeof value.toDate === 'function') {
    let produced;

    try {
      produced = value.toDate();
    } catch {
      return null;
    }

    if (produced instanceof Date && !Number.isNaN(produced.getTime())) {
      return produced;
    }

    return null;
  }

  // Plain { seconds } object — only when seconds is a finite number.
  if (typeof value.seconds === 'number' && Number.isFinite(value.seconds)) {
    const fromSeconds = new Date(value.seconds * 1000);
    return Number.isNaN(fromSeconds.getTime()) ? null : fromSeconds;
  }

  // Any other shape.
  return null;
}


// Format an instant (Date / Timestamp-like / { seconds }) for display, always
// in the Asia/Jerusalem timezone and the Gregorian / Latin / 24-hour calendar.
//
// `timePrecision` selects the output shape:
//   - 'none'   -> 'DD-MM-YYYY'
//   - 'minute' -> 'DD-MM-YYYY HH:mm'
//   - 'second' -> 'DD-MM-YYYY HH:mm:ss'
// An unknown precision, a string, a raw number, or any unparseable value returns
// the caller's fallback. The parts are read via formatToParts and assembled by
// hand, so the result never depends on the host locale's order or separators.
// This is a DISPLAY formatter only — it never produces a dateKey / logical key.
export function formatInstantForDisplay(
  value,
  { timePrecision = 'none', fallback = '' } = {},
) {
  // Reject an unsupported precision before doing any work.
  if (!ALLOWED_TIME_PRECISIONS.has(timePrecision)) {
    return fallback;
  }

  // Resolve the supported shapes into a valid Date (strings / numbers rejected).
  const date = resolveInstantDate(value);
  if (!date) {
    return fallback;
  }

  // A fixed, fully explicit configuration. We override numbering system and
  // hour cycle so neither depends on the host locale; midnight reads as '00'.
  // `era: 'short'` is requested so we can read the era part and reject BC/BCE
  // dates — the era is never shown in the output, only used for validation.
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Jerusalem',
    calendar: 'gregory',
    numberingSystem: 'latn',
    hourCycle: 'h23',
    era: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  // Index the parts by type so we can assemble them ourselves.
  const parts = {};
  for (const part of formatter.formatToParts(date)) {
    parts[part.type] = part.value;
  }

  // Reject anything before year 1. The era part is the only reliable sign of
  // BC/BCE; we accept ONLY the positive-era markers and reject everything else.
  if (parts.era !== 'AD' && parts.era !== 'CE') {
    return fallback;
  }

  // The local Gregorian year must be a plain integer in 1..9999 (the positive
  // era already guarantees it is a "year of era"). A five-digit year such as
  // 10000 is out of contract and falls back.
  if (!/^\d+$/.test(parts.year)) {
    return fallback;
  }

  const yearNumber = Number(parts.year);
  if (yearNumber < 1 || yearNumber > 9999) {
    return fallback;
  }

  // Compose an explicit four-digit year, so year 1 renders as '0001'.
  const year = String(yearNumber).padStart(4, '0');

  // Date portion is always day-first DD-MM-YYYY.
  const datePart = `${parts.day}-${parts.month}-${year}`;

  // Date only.
  if (timePrecision === 'none') {
    return datePart;
  }

  // Date + HH:mm.
  if (timePrecision === 'minute') {
    return `${datePart} ${parts.hour}:${parts.minute}`;
  }

  // timePrecision === 'second' -> Date + HH:mm:ss.
  return `${datePart} ${parts.hour}:${parts.minute}:${parts.second}`;
}
