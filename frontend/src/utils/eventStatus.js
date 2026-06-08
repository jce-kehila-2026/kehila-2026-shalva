// Shared event-date parsing + status, so every screen shows the same status.

// Parse an event date. A plain "YYYY-MM-DD" is read as a *local* date so the
// day never shifts because of the timezone.
export function parseEventDate(value) {
  // Nothing to parse.
  if (!value) return null;

  // Fast path for the exact "YYYY-MM-DD" shape.
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value).trim());
  if (match) {
    const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    return Number.isNaN(date.getTime()) ? null : date;
  }

  // Fallback to the native parser.
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

// Midnight of the given date, so comparisons ignore the time of day.
function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

// The event's status, derived from its date so it stays current on its own:
// future = מתוכנן, today = פעיל, past = הסתיים. A cancelled event stays בוטל.
export function computeEventStatus(event) {
  // Cancelled is a manual override that always wins.
  if (event.status === 'בוטל') return 'בוטל';

  // Without a valid date, fall back to the stored status (or "planned").
  const date = parseEventDate(event.date);
  if (!date) return event.status || 'מתוכנן';

  // Compare the event day against today.
  const day = startOfDay(date);
  const today = startOfDay(new Date());

  if (day > today) return 'מתוכנן';
  if (day === today) return 'פעיל';
  return 'הסתיים';
}
