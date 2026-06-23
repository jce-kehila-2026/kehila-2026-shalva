// Pure planning + reconciliation for the attendance writer. Kept out of React so
// it can be unit-tested directly: buildAttendanceOperations turns the current UI
// state into a flat list of independent write operations (no Firestore here),
// and reconcileAttendanceResults folds the per-operation outcomes back into the
// local baseline so a retry re-sends ONLY the failures.

import { getDisplayName } from './people';
import { buildAttendanceId } from './dateKey';
import { normalizeAttendanceStatus, getRecordStatus } from './attendance';

const VOLUNTEER_FALLBACK_NAME = 'מתנדב ללא שם';


// Map a stored attendance record to one of the three UI states (tolerates the
// older boolean / Hebrew / English status shapes).
export function attendanceStateFromRecord(record) {
  if (!record) {
    return 'unmarked';
  }

  const normalized = normalizeAttendanceStatus(getRecordStatus(record));

  if (normalized === 'present') {
    return 'present';
  }

  if (normalized === 'absent') {
    return 'absent';
  }

  return 'unmarked';
}


// Build the full list of attendance write operations WITHOUT performing any
// write. Returns { ok: false, error } to abort the whole save BEFORE any write
// (no canonical group id, or an existing record whose identity doesn't match),
// or { ok: true, operations }, where each operation is:
//   { type: 'set' | 'delete', volunteerId, volunteerName, attendanceId,
//     desiredState, previousRecord, payload? }
// Only touched volunteers whose desired state differs from the saved record
// produce an operation. A create uses the canonical id; an update / delete of an
// existing record reuses that record's real id (so legacy ids are edited in place).
export function buildAttendanceOperations({
  volunteers,
  marks,
  touchedVolunteerIds,
  savedByVolunteer,
  canonicalGroupId,
  canonicalGroupName,
  dateKey,
  saveInstant,
}) {
  if (!canonicalGroupId) {
    return { ok: false, error: 'שגיאה: לא נמצא מזהה קבוצה קנוני. לא ניתן לשמור נוכחות.' };
  }

  const operations = [];

  for (const volunteer of volunteers) {
    // Only volunteers the user actually touched are candidates.
    if (!touchedVolunteerIds[volunteer.id]) {
      continue;
    }

    // Defense-in-depth (not relying on the React filter or the Rules alone): a
    // touched volunteer MUST belong to the canonical group, or the whole plan is
    // aborted before any write.
    if (volunteer.groupId !== canonicalGroupId) {
      return { ok: false, error: 'זוהה מתנדב שאינו שייך לקבוצה הנוכחית. השמירה בוטלה.' };
    }

    const desiredState = marks[volunteer.id] || 'unmarked';
    const previousRecord = savedByVolunteer[volunteer.id] || null;

    // Skip when the choice already equals what is saved.
    if (desiredState === attendanceStateFromRecord(previousRecord)) {
      continue;
    }

    const volunteerName = getDisplayName(volunteer, VOLUNTEER_FALLBACK_NAME);

    // Reuse an existing record's REAL id when its identity matches exactly;
    // otherwise use the canonical id for a brand-new record.
    let attendanceId;
    if (previousRecord) {
      const identityMatches =
        previousRecord.groupId === canonicalGroupId &&
        previousRecord.volunteerId === volunteer.id &&
        previousRecord.dateKey === dateKey;

      if (!identityMatches) {
        // Fail closed on a mismatched existing record — never guess.
        return { ok: false, error: 'זוהתה רשומת נוכחות קיימת שאינה תואמת. השמירה בוטלה.' };
      }

      attendanceId = previousRecord.id;
    } else {
      attendanceId = buildAttendanceId(canonicalGroupId, dateKey, volunteer.id);
    }

    if (desiredState === 'unmarked') {
      operations.push({
        type: 'delete',
        volunteerId: volunteer.id,
        volunteerName,
        attendanceId,
        desiredState,
        previousRecord,
      });
    } else {
      operations.push({
        type: 'set',
        volunteerId: volunteer.id,
        volunteerName,
        attendanceId,
        desiredState,
        previousRecord,
        payload: {
          groupId: canonicalGroupId,
          group: canonicalGroupName,
          groupName: canonicalGroupName,
          date: saveInstant,
          dateKey,
          status: desiredState === 'present',
          volunteerId: volunteer.id,
          volunteerName,
        },
      });
    }
  }

  return { ok: true, operations };
}


// Fold the per-operation settled results back into the loaded baseline. Pure: it
// returns the next attendanceRecords array (ONLY succeeded operations applied)
// plus the succeeded / failed breakdown. Failed operations leave the baseline
// untouched, so the next save retries only them; deterministic ids keep a create
// idempotent and a successful delete removes only its own id.
export function reconcileAttendanceResults(operations, results, previousRecords) {
  const succeededVolunteerIds = [];
  const failed = [];
  let nextRecords = previousRecords.slice();

  operations.forEach((operation, index) => {
    const result = results[index];

    if (result && result.status === 'fulfilled') {
      succeededVolunteerIds.push(operation.volunteerId);

      // Remove only the record with this exact id; re-add it for a set.
      nextRecords = nextRecords.filter((record) => record.id !== operation.attendanceId);

      if (operation.type === 'set') {
        nextRecords.push({ id: operation.attendanceId, ...operation.payload });
      }
    } else {
      failed.push({
        volunteerId: operation.volunteerId,
        volunteerName: operation.volunteerName,
        reason: result ? result.reason : undefined,
      });
    }
  });

  return {
    nextRecords,
    succeededVolunteerIds,
    failed,
    succeededCount: succeededVolunteerIds.length,
    failedCount: failed.length,
  };
}
