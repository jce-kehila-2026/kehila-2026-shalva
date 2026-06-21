// Shared attendance helpers, so every screen counts attendance the same way.
// Records have been written in a few shapes over time (boolean status, Hebrew
// or English strings), so normalising in one place keeps reports, charts and
// the command center consistent.

// Normalize the many possible attendance values into 'present' / 'absent' /
// 'unknown'.
export function normalizeAttendanceStatus(value) {
  // Booleans map directly.
  if (value === true) {
    return 'present';
  }

  if (value === false) {
    return 'absent';
  }

  // Otherwise compare a lower-cased text form.
  const text = String(value || '').trim().toLowerCase();

  // Words that mean "present" (incl. older 'נוכח' / 'איחר' = arrived/late).
  if (['present', 'yes', 'true', '1', 'נוכח', 'נוכחת', 'כן', 'איחר'].includes(text)) {
    return 'present';
  }

  // Words that mean "absent".
  if (['absent', 'no', 'false', '0', 'נעדר', 'נעדרת', 'לא', 'חסר', 'חסרה'].includes(text)) {
    return 'absent';
  }

  // Anything else is unknown.
  return 'unknown';
}


// Read the status field from an attendance record, trying several field names.
export function getRecordStatus(record) {
  return (
    record.status ??
    record.attendance ??
    record.present ??
    record.isPresent ??
    record.value
  );
}
