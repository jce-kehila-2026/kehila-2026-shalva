// Pure resolver for an attendance record's DISPLAY date (DD-MM-YYYY), with an
// EXPLICIT precedence and no type-guessing — each candidate is tried with the
// formatter that matches its kind, so a truthy-but-malformed value can never
// hide a later valid one (e.g. a bad `date` string must not mask a good
// `createdAt`). Display only; never used as a logical key.
import { formatDateOnlyForDisplay, formatInstantForDisplay } from './dateDisplay';
import { getJerusalemDateKey } from './dateKey';

const NO_DATE = 'ללא תאריך';

// `value` is a strict 'YYYY-MM-DD' string -> return it, else ''. (Re-uses the
// date-only formatter's validation; the original string is the canonical key.)
function strictDateKey(value) {
  return formatDateOnlyForDisplay(value, { fallback: '' }) ? value : '';
}

// Resolve one of the supported instant shapes (Date / Timestamp / { seconds })
// into a valid Date, or null. Strings/numbers are intentionally rejected here.
function toInstantDate(value) {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  if (value && typeof value.toDate === 'function') {
    try {
      const produced = value.toDate();
      return produced instanceof Date && !Number.isNaN(produced.getTime()) ? produced : null;
    } catch {
      return null;
    }
  }
  if (value && typeof value.seconds === 'number' && Number.isFinite(value.seconds)) {
    const fromSeconds = new Date(value.seconds * 1000);
    return Number.isNaN(fromSeconds.getTime()) ? null : fromSeconds;
  }
  return null;
}

// The CANONICAL grouping key for an attendance record: a 'YYYY-MM-DD' string,
// resolved with the same explicit precedence as the display date. This is the
// logical key (grouping / filtering / sorting) — never shown to the user.
//   1. dateKey strict 'YYYY-MM-DD'
//   2. date    strict 'YYYY-MM-DD'
//   3. date    instant   -> Asia/Jerusalem dateKey
//   4. createdAt instant -> Asia/Jerusalem dateKey
//   5. ''
export function resolveAttendanceDateKey(record) {
  if (!record) {
    return '';
  }

  const fromDateKey = strictDateKey(record.dateKey);
  if (fromDateKey) {
    return fromDateKey;
  }

  const fromDateString = strictDateKey(record.date);
  if (fromDateString) {
    return fromDateString;
  }

  const instant = toInstantDate(record.date) || toInstantDate(record.createdAt);
  return instant ? getJerusalemDateKey(instant) : '';
}

// Precedence:
//   1. dateKey   as a strict 'YYYY-MM-DD'  -> date-only formatter
//   2. date      as a strict 'YYYY-MM-DD'  -> date-only formatter
//   3. date      as an instant             -> instant formatter (Asia/Jerusalem)
//   4. createdAt as an instant             -> instant formatter (Asia/Jerusalem)
//   5. otherwise                           -> 'ללא תאריך'
export function resolveAttendanceDisplayDate(record) {
  if (!record) {
    return NO_DATE;
  }

  // 1. Canonical date-only key.
  const fromDateKey = formatDateOnlyForDisplay(record.dateKey, { fallback: '' });
  if (fromDateKey) {
    return fromDateKey;
  }

  // 2. A legacy 'date' that is itself a strict date-only string.
  const fromDateString = formatDateOnlyForDisplay(record.date, { fallback: '' });
  if (fromDateString) {
    return fromDateString;
  }

  // 3. 'date' as an instant (Date / Timestamp / { seconds }).
  const fromDateInstant = formatInstantForDisplay(record.date, { fallback: '' });
  if (fromDateInstant) {
    return fromDateInstant;
  }

  // 4. 'createdAt' as an instant — reached even when `date` was a bad string.
  const fromCreatedAt = formatInstantForDisplay(record.createdAt, { fallback: '' });
  if (fromCreatedAt) {
    return fromCreatedAt;
  }

  // 5. Nothing usable.
  return NO_DATE;
}
