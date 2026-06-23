// Logical attendance-day key helpers. These produce / compose CANONICAL keys
// (YYYY-MM-DD strings, document ids) — they are NOT display formatters and have
// no relation to dateDisplay.js. The day is always resolved in the
// Asia/Jerusalem timezone so an instant near midnight maps to the right local
// activity day regardless of the machine/browser timezone.


// Resolve an instant (a real Date) into its Asia/Jerusalem calendar day, as a
// strict 'YYYY-MM-DD' string. Returns '' for anything that is not a valid Date,
// so callers can fail-closed. Uses Intl.formatToParts (NOT getFullYear/getMonth/
// getDate, which would read the process timezone).
export function getJerusalemDateKey(value = new Date()) {
  // Only a valid Date is acceptable — never a string, number or other shape.
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    return '';
  }

  // Fixed, fully explicit configuration so the result never depends on the host
  // locale or timezone. `era: 'short'` lets us reject BC/BCE dates.
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jerusalem',
    calendar: 'gregory',
    numberingSystem: 'latn',
    era: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });

  // Read the individual parts and assemble YYYY-MM-DD ourselves.
  const parts = {};
  for (const part of formatter.formatToParts(value)) {
    parts[part.type] = part.value;
  }

  // Reject anything before year 1 (BC/BCE) — the era is the only reliable sign.
  if (parts.era !== 'AD' && parts.era !== 'CE') {
    return '';
  }

  // Strict Gregorian year 0001–9999 only; a five-digit year (10000) is rejected.
  if (!/^\d+$/.test(parts.year)) {
    return '';
  }

  const yearNumber = Number(parts.year);
  if (yearNumber < 1 || yearNumber > 9999) {
    return '';
  }

  // Zero-pad the year to exactly four digits (so year 1 becomes '0001').
  const year = String(yearNumber).padStart(4, '0');

  return `${year}-${parts.month}-${parts.day}`;
}


// The Hebrew weekday name of an instant, resolved in Asia/Jerusalem (e.g.
// 'יום ראשון' … 'יום שבת'). Matches the `volunteer.day` values, so it can drive
// the "scheduled today" filter and the screen heading. '' for an invalid Date.
// Uses Intl with an explicit timeZone — NEVER getDay() of the process timezone.
export function getJerusalemWeekdayName(value) {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    return '';
  }

  return new Intl.DateTimeFormat('he-IL', {
    timeZone: 'Asia/Jerusalem',
    weekday: 'long',
  }).format(value);
}


// Compose the canonical attendance document id from its three identity parts.
// Plain concatenation — the id is NEVER parsed back, so an underscore inside a
// groupId or volunteerId is harmless.
export function buildAttendanceId(groupId, dateKey, volunteerId) {
  return `${groupId}_${dateKey}_${volunteerId}`;
}
