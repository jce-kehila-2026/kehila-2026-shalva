// Shared activity-day constants + selected-value validation.
//
// Saturday (שבת) is NOT a permitted activity / scheduled day. These helpers
// validate a USER-SELECTED value — a chosen weekday, or a chosen calendar date.
// They contain NO current-time / "is it Saturday now" logic; nothing here reads
// the clock.

// The six allowed activity days, Sunday → Friday (full Hebrew form). This is the
// single source of truth — selectors and templates should reference it.
export const ACTIVITY_DAYS = [
  'יום ראשון',
  'יום שני',
  'יום שלישי',
  'יום רביעי',
  'יום חמישי',
  'יום שישי',
];

// Short labels (e.g. 'ראשון'), DERIVED from the full labels by dropping the
// leading "יום " — so there is only one list to maintain.
export const ACTIVITY_DAY_SHORT_LABELS = ACTIVITY_DAYS.map(
  (day) => day.replace(/^יום\s+/, ''),
);

// The legacy Saturday value, kept ONLY so existing records can still be shown
// (never offered as a new choice).
export const LEGACY_SATURDAY_ACTIVITY_DAY = 'יום שבת';


// True only for one of the six exact allowed full values.
export function isAllowedActivityDay(value) {
  return typeof value === 'string' && ACTIVITY_DAYS.includes(value);
}


// True for an existing Saturday value in either stored format — the full
// 'יום שבת' or the short 'שבת' — tolerating surrounding whitespace. Never true
// for a Sunday–Friday value.
export function isLegacySaturdayActivityDay(value) {
  if (typeof value !== 'string') {
    return false;
  }

  const trimmed = value.trim();
  return trimmed === 'יום שבת' || trimmed === 'שבת';
}


// True when a strict 'YYYY-MM-DD' date-only string falls on a Saturday.
//
// Timezone-independent: the date is built with Date.UTC(...) and read with
// getUTCDay(), so the result never depends on the developer/CI machine's local
// timezone (and we deliberately avoid new Date('YYYY-MM-DD'), whose parsing is
// timezone-sensitive). Impossible dates are rejected by checking that the
// constructed Y/M/D round-trip exactly, since JS date math silently rolls over
// (e.g. 2026-02-30 → March). This is selected-DATE validation, not a clock check.
export function isSaturdayDateValue(value) {
  if (typeof value !== 'string') {
    return false;
  }

  // Strict YYYY-MM-DD shape only (exactly 4-2-2 digits).
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    return false;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  // Build the instant in UTC, so the weekday is timezone-independent.
  const date = new Date(Date.UTC(year, month - 1, day));

  // Reject impossible dates: the round-trip must match the input exactly.
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return false;
  }

  // 6 === Saturday.
  return date.getUTCDay() === 6;
}
