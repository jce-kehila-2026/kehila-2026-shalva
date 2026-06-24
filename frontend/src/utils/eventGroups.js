// Shared helpers for an event's group assignment, so every screen reads it the
// same way. An event can now be assigned to MORE THAN ONE group: the source of
// truth is the `assignedGroups` array. Older documents stored only a single
// `assignedGroup` string, so these helpers also accept that legacy shape and
// fold it into the array — no migration needed.

// The label used for an event that is not linked to any group.
export const NO_GROUP = 'ללא שיוך';


// Return an event's assigned groups as a clean array of group names.
// Reads the new `assignedGroups` array first, then falls back to the legacy
// single `assignedGroup` string. The "no group" sentinel and empty values are
// dropped, and duplicates are removed — so the result is always real groups.
export function getEventGroups(event) {
  // Nothing to read from.
  if (!event) {
    return [];
  }

  // Prefer the new array; otherwise wrap the legacy single value.
  const rawGroups = Array.isArray(event.assignedGroups)
    ? event.assignedGroups
    : [event.assignedGroup];

  // Keep only real, non-empty group names (drop the "no group" sentinel).
  const cleaned = rawGroups
    .map((name) => (typeof name === 'string' ? name.trim() : ''))
    .filter((name) => name && name !== NO_GROUP);

  // De-duplicate while preserving order.
  return [...new Set(cleaned)];
}


// True when the given group name is one of the event's assigned groups.
// Used for filtering events and for matching an event to a group.
export function eventMatchesGroupName(event, groupName) {
  // An empty filter matches nothing meaningful here — the caller decides.
  if (!groupName) {
    return false;
  }

  return getEventGroups(event).includes(groupName);
}


// A human-readable label for an event's groups: the names joined by commas, or
// the fallback (default "ללא שיוך") when the event has no real group.
export function formatEventGroups(event, { fallback = NO_GROUP } = {}) {
  const groups = getEventGroups(event);

  return groups.length > 0 ? groups.join(', ') : fallback;
}
