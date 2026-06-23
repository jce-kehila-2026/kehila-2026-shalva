// React hooks for state, effects and memoization.
import { useEffect, useMemo, useState } from 'react'

// Firestore helpers for reading collections.
import { collection, getDocs } from 'firebase/firestore'

// Our Firestore database instance.
import { db } from '../../firebase'

// Shared attendance normalization (one definition across all screens).
import { normalizeAttendanceStatus, getRecordStatus } from '../../utils/attendance'

// Pure resolver for an attendance record's display date (DD-MM-YYYY), with an
// explicit dateKey -> date -> createdAt precedence.
import { resolveAttendanceDisplayDate } from '../../utils/attendanceDisplayDate'

// Styles for this screen.
import './VolunteerDetails.css'


// Firestore collection used for attendance history.
const ATTENDANCE_COLLECTION_NAME = 'attendance'

// Default text for missing volunteer fields.
const FALLBACK = 'לא צוין'

// Used by aria-labelledby for better accessibility.
const TITLE_ID = 'volunteer-details-title'

// Internal attendance status values.
const ATTENDANCE_STATUS = {
  PRESENT: 'present',
  ABSENT: 'absent',
  UNKNOWN: 'unknown',
}


// Safe display text for optional values (turns blanks into a fallback).
function safeText(value, fallback = FALLBACK) {
  if (value === null || value === undefined || value === '') {
    return fallback
  }

  return String(value)
}


// Best available full name for a volunteer, with graceful fallbacks.
function getFullName(volunteer) {
  // No volunteer at all.
  if (!volunteer) {
    return 'מתנדב לא נבחר'
  }

  // Prefer first + last name joined together.
  const fullName = [
    volunteer.firstName,
    volunteer.lastName,
  ]
    .filter(Boolean)
    .join(' ')
    .trim()

  // Fall back through name / email / id / a generic label.
  return (
    fullName ||
    volunteer.name ||
    volunteer.email ||
    volunteer.id ||
    'מתנדב ללא שם'
  )
}


// First letter of the name, used for the avatar circle.
function getInitial(volunteer) {
  return getFullName(volunteer).charAt(0).toUpperCase()
}


// Best available group field for a volunteer.
function getVolunteerGroup(volunteer) {
  return (
    volunteer?.group ||
    volunteer?.assignedGroup ||
    volunteer?.groupName ||
    volunteer?.team ||
    'ללא שיוך'
  )
}


// Best available unique identifier for a volunteer.
function getVolunteerIdentifier(volunteer) {
  return (
    volunteer?.idNumber ||
    volunteer?.identityNumber ||
    volunteer?.phone ||
    volunteer?.email ||
    volunteer?.id ||
    FALLBACK
  )
}


// Turn a Firestore document snapshot into a plain object that keeps its id.
function normalizeDocument(documentSnapshot) {
  return {
    id: documentSnapshot.id,
    ...documentSnapshot.data(),
  }
}


// (normalizeAttendanceStatus now comes from utils/attendance — its
// 'present' / 'absent' / 'unknown' values match ATTENDANCE_STATUS.)


// Internal status -> Hebrew display text.
function statusText(status) {
  if (status === ATTENDANCE_STATUS.PRESENT) {
    return 'נוכח'
  }

  if (status === ATTENDANCE_STATUS.ABSENT) {
    return 'חסר'
  }

  return 'לא ידוע'
}


// Internal status -> CSS class.
function statusClass(status) {
  if (status === ATTENDANCE_STATUS.PRESENT) {
    return 'status-present'
  }

  if (status === ATTENDANCE_STATUS.ABSENT) {
    return 'status-absent'
  }

  return 'status-unknown'
}


// Readable DD-MM-YYYY date for an attendance record, via the shared pure resolver
// (explicit precedence, no type-guessing, never a raw or dotted "23.6.2026").
function getAttendanceDate(attendanceItem) {
  return resolveAttendanceDisplayDate(attendanceItem)
}


// Group for an attendance record, falling back to the volunteer's group.
function getAttendanceGroup(attendanceItem, volunteer) {
  return (
    attendanceItem.group ||
    attendanceItem.groupName ||
    attendanceItem.assignedGroup ||
    getVolunteerGroup(volunteer)
  )
}


// Normalize a value for comparison (trimmed, lower-cased string).
function toSearchValue(value) {
  return String(value || '').trim().toLowerCase()
}


// All the identifiers we can use to match attendance records to a volunteer.
function buildVolunteerCandidates(volunteer) {
  // No volunteer: nothing to match on.
  if (!volunteer) {
    return []
  }

  const fullName = getFullName(volunteer)

  // Collect every possible id/name, normalize, and drop empties + duplicates.
  return [
    volunteer.id,
    volunteer.uid,
    volunteer.userId,
    volunteer.idNumber,
    volunteer.identityNumber,
    volunteer.email,
    volunteer.phone,
    volunteer.firstName,
    volunteer.lastName,
    volunteer.name,
    fullName,
  ]
    .filter(Boolean)
    .map(toSearchValue)
    .filter((value, index, values) => value && values.indexOf(value) === index)
}


// Does a value contain or equal one of the candidates? Handles strings,
// arrays and nested objects by recursing into them.
function valueMatchesCandidate(value, candidates) {
  // Nothing to compare.
  if (!value || candidates.length === 0) {
    return false
  }

  // Arrays: match if any item matches.
  if (Array.isArray(value)) {
    return value.some((item) => valueMatchesCandidate(item, candidates))
  }

  // Objects: match if any of their values match.
  if (typeof value === 'object') {
    return Object.values(value).some((item) =>
      valueMatchesCandidate(item, candidates),
    )
  }

  // Plain value: compare it against every candidate.
  const text = toSearchValue(value)

  return candidates.some(
    (candidate) =>
      text === candidate ||
      text.includes(candidate) ||
      candidate.includes(text),
  )
}


// Does one attendance record belong to the selected volunteer?
function recordMatchesVolunteer(attendanceItem, candidates, volunteerId) {
  // Modern records carry an exact volunteerId — match ONLY on that, so two
  // volunteers who share a first/last name never inherit each other's history.
  if (attendanceItem.volunteerId) {
    return attendanceItem.volunteerId === volunteerId;
  }

  // Legacy records (no volunteerId): fall back to fuzzy name / phone matching.
  // Direct fields that might hold the volunteer's id / name.
  const directFields = [
    attendanceItem.volunteerId,
    attendanceItem.userId,
    attendanceItem.uid,
    attendanceItem.idNumber,
    attendanceItem.identityNumber,
    attendanceItem.email,
    attendanceItem.phone,
    attendanceItem.name,
    attendanceItem.fullName,
    attendanceItem.volunteerName,
  ]

  // A match on any direct field is enough.
  const hasDirectMatch = directFields.some((fieldValue) =>
    valueMatchesCandidate(fieldValue, candidates),
  )

  if (hasDirectMatch) {
    return true
  }

  // Otherwise look inside the nested lists a record might carry.
  const nestedLists = [
    attendanceItem.records,
    attendanceItem.volunteers,
    attendanceItem.attendees,
    attendanceItem.items,
    attendanceItem.present,
    attendanceItem.absent,
  ]

  return nestedLists.some((listValue) =>
    valueMatchesCandidate(listValue, candidates),
  )
}


// Find the selected volunteer's status inside direct or nested attendance data.
function getNestedAttendanceStatus(attendanceItem, candidates) {
  // First try the record's own status field (via the shared reader).
  const directStatus = normalizeAttendanceStatus(getRecordStatus(attendanceItem))

  if (directStatus !== ATTENDANCE_STATUS.UNKNOWN) {
    return directStatus
  }

  // Volunteer listed in a "present" / "absent" bucket.
  if (valueMatchesCandidate(attendanceItem.present, candidates)) {
    return ATTENDANCE_STATUS.PRESENT
  }

  if (valueMatchesCandidate(attendanceItem.absent, candidates)) {
    return ATTENDANCE_STATUS.ABSENT
  }

  // Otherwise search the nested lists for the matching person's status.
  const nestedLists = [
    attendanceItem.records,
    attendanceItem.volunteers,
    attendanceItem.attendees,
    attendanceItem.items,
  ]

  for (const listValue of nestedLists) {
    // Skip non-arrays.
    if (!Array.isArray(listValue)) {
      continue
    }

    // Find the entry that belongs to this volunteer.
    const matchingItem = listValue.find((item) =>
      valueMatchesCandidate(item, candidates),
    )

    // Read its status if we found one.
    if (matchingItem) {
      return normalizeAttendanceStatus(
        matchingItem.status ??
          matchingItem.attendance ??
          matchingItem.present ??
          matchingItem.isPresent,
      )
    }
  }

  // Nothing found.
  return ATTENDANCE_STATUS.UNKNOWN
}


// Build the attendance-history table rows for the selected volunteer.
function buildAttendanceRows(attendanceRecords, volunteer) {
  // The identifiers we'll match records against.
  const candidates = buildVolunteerCandidates(volunteer)

  // No volunteer to match: no rows.
  if (candidates.length === 0) {
    return []
  }

  // Keep only this volunteer's records and shape them for the table.
  return attendanceRecords
    .filter((attendanceItem) =>
      recordMatchesVolunteer(attendanceItem, candidates, volunteer.id),
    )
    .map((attendanceItem) => ({
      id: attendanceItem.id,
      date: getAttendanceDate(attendanceItem),
      group: getAttendanceGroup(attendanceItem, volunteer),
      status: getNestedAttendanceStatus(attendanceItem, candidates),
      note:
        attendanceItem.note ||
        attendanceItem.notes ||
        attendanceItem.eventName ||
        attendanceItem.event ||
        '',
    }))
}


// Count present / absent / unknown across the rows, for the summary cards.
function buildAttendanceSummary(attendanceRows) {
  return attendanceRows.reduce(
    (summary, attendanceItem) => ({
      present:
        summary.present +
        (attendanceItem.status === ATTENDANCE_STATUS.PRESENT ? 1 : 0),
      absent:
        summary.absent +
        (attendanceItem.status === ATTENDANCE_STATUS.ABSENT ? 1 : 0),
      unknown:
        summary.unknown +
        (attendanceItem.status === ATTENDANCE_STATUS.UNKNOWN ? 1 : 0),
    }),
    {
      present: 0,
      absent: 0,
      unknown: 0,
    },
  )
}


// Volunteer details: personal info, group assignment and attendance history.
export default function VolunteerDetails({ volunteer, onBack }) {
  // Attendance records loaded from Firestore.
  const [attendanceRecords, setAttendanceRecords] = useState([])

  // UI state for attendance loading and Firebase errors.
  const [attendanceLoading, setAttendanceLoading] = useState(true)
  const [attendanceError, setAttendanceError] = useState(null)

  // Load attendance history once when the screen opens.
  useEffect(() => {
    // Guards against state updates after unmount.
    let isMounted = true

    async function loadAttendanceHistory() {
      try {
        // Read the whole attendance collection.
        const snapshot = await getDocs(
          collection(db, ATTENDANCE_COLLECTION_NAME),
        )

        // Bail out if we unmounted while waiting.
        if (!isMounted) {
          return
        }

        // Store the normalized records.
        setAttendanceRecords(snapshot.docs.map(normalizeDocument))
        setAttendanceError(null)
      } catch (error) {
        // Record the error (if still mounted).
        console.error('Error loading attendance history:', error)

        if (!isMounted) {
          return
        }

        setAttendanceError(error.message)
      } finally {
        // Clear the loading flag.
        if (isMounted) {
          setAttendanceLoading(false)
        }
      }
    }

    loadAttendanceHistory()

    // Cleanup: mark as unmounted.
    return () => {
      isMounted = false
    }
  }, [])

  // The table rows for this volunteer (recomputed only when inputs change).
  const attendanceRows = useMemo(
    () => buildAttendanceRows(attendanceRecords, volunteer),
    [attendanceRecords, volunteer],
  )

  // The summary-card counts derived from those rows.
  const attendanceSummary = useMemo(
    () => buildAttendanceSummary(attendanceRows),
    [attendanceRows],
  )

  // Go back to the volunteer list if a handler was provided.
  const handleBack = () => {
    if (typeof onBack === 'function') {
      onBack()
    }
  }

  // Empty state: no volunteer was selected.
  if (!volunteer) {
    return (
      <main className="volunteer-details-container" dir="rtl">
        <section className="volunteer-details-card">
          <div className="volunteer-details-empty">
            <h1>לא נבחר מתנדב</h1>

            <p>
              חזור לרשימת המתנדבים ובחר מתנדב להצגת פרטים.
            </p>

            <button type="button" onClick={handleBack}>
              חזרה לרשימה
            </button>
          </div>
        </section>
      </main>
    )
  }

  return (
    <main
      className="volunteer-details-container"
      dir="rtl"
      aria-labelledby={TITLE_ID}
    >
      <section className="volunteer-details-card">

        {/* Header: avatar, name and the back button. */}
        <header className="volunteer-details-header">
          <div className="volunteer-details-profile">

            {/* Avatar showing the name's first letter. */}
            <div className="volunteer-details-avatar">
              {getInitial(volunteer)}
            </div>

            <div>
              <div className="volunteer-details-eyebrow">
                פרטי מתנדב
              </div>

              <h1 id={TITLE_ID} className="volunteer-details-title">
                {getFullName(volunteer)}
              </h1>

              <p className="volunteer-details-subtitle">
                פרטי מתנדב, שיוך קבוצה והיסטוריית נוכחות.
              </p>
            </div>
          </div>

          <button
            type="button"
            className="volunteer-details-back-btn"
            onClick={handleBack}
          >
            חזרה לרשימה
          </button>
        </header>

        {/* Attendance summary cards. */}
        <div className="volunteer-details-summary-grid">
          <article className="volunteer-details-summary-card">
            <span>{attendanceSummary.present}</span>
            <p>נוכח</p>
          </article>

          <article className="volunteer-details-summary-card">
            <span>{attendanceSummary.absent}</span>
            <p>חסר</p>
          </article>

          <article className="volunteer-details-summary-card">
            <span>{attendanceSummary.unknown}</span>
            <p>לא ידוע</p>
          </article>

          <article className="volunteer-details-summary-card">
            <span>{attendanceRows.length}</span>
            <p>רשומות נוכחות</p>
          </article>
        </div>

        {/* Personal information section. */}
        <section className="volunteer-details-section">
          <h2>פרטים אישיים</h2>

          <div className="volunteer-details-info-grid">
            <div className="volunteer-details-info-item">
              <span>שם פרטי</span>
              <strong>{safeText(volunteer.firstName)}</strong>
            </div>

            <div className="volunteer-details-info-item">
              <span>שם משפחה</span>
              <strong>{safeText(volunteer.lastName)}</strong>
            </div>

            <div className="volunteer-details-info-item">
              <span>טלפון</span>
              <strong dir="ltr">{safeText(volunteer.phone)}</strong>
            </div>

            <div className="volunteer-details-info-item">
              <span>אימייל</span>
              <strong dir="ltr">{safeText(volunteer.email)}</strong>
            </div>

            <div className="volunteer-details-info-item">
              <span>כתובת</span>
              <strong>{safeText(volunteer.address)}</strong>
            </div>

            <div className="volunteer-details-info-item">
              <span>גיל</span>
              <strong>{safeText(volunteer.age)}</strong>
            </div>

            <div className="volunteer-details-info-item">
              <span>בית ספר</span>
              <strong>{safeText(volunteer.school)}</strong>
            </div>

            <div className="volunteer-details-info-item">
              <span>ניסיון</span>
              <strong>{safeText(volunteer.experience)}</strong>
            </div>

            <div className="volunteer-details-info-item">
              <span>יום פעילות</span>
              <strong>{safeText(volunteer.day, 'כל הימים / לא מוגדר')}</strong>
            </div>

            <div className="volunteer-details-info-item">
              <span>תוכנית</span>
              <strong>{safeText(volunteer.programName, 'לא שויכה תוכנית')}</strong>
            </div>

            <div className="volunteer-details-info-item">
               <span>מזהה</span>
               <strong dir="ltr">
                 {getVolunteerIdentifier(volunteer)}
               </strong>
            </div>
          </div>
        </section>

        {/* Group assignment section. */}
        <section className="volunteer-details-section volunteer-details-group-section">
          <h2>שיוך לקבוצה</h2>

          <div className="volunteer-details-group-card">
            <span>קבוצה משויכת</span>
            <strong>{getVolunteerGroup(volunteer)}</strong>
          </div>
        </section>

        {/* Attendance history section. */}
        <section className="volunteer-details-section">
          <h2>היסטוריית נוכחות</h2>

          {/* Error banner if the history failed to load. */}
          {attendanceError && (
            <div className="volunteer-details-error">
              שגיאה בטעינת היסטוריית נוכחות: {attendanceError}
            </div>
          )}

          {/* Loading message, otherwise the history table. */}
          {attendanceLoading ? (
            <div className="volunteer-details-loading">
              טוען היסטוריית נוכחות...
            </div>
          ) : (
            <div className="volunteer-details-table-wrap">
              <table className="volunteer-details-table">

                {/* Column headers. */}
                <thead>
                  <tr>
                    <th>תאריך</th>
                    <th>קבוצה</th>
                    <th>סטטוס</th>
                    <th>הערה</th>
                  </tr>
                </thead>

                <tbody>
                  {/* A row per attendance record, or an empty-state row. */}
                  {attendanceRows.length > 0 ? (
                    attendanceRows.map((attendanceItem) => (
                      <tr key={attendanceItem.id}>
                        <td>{attendanceItem.date}</td>
                        <td>{attendanceItem.group}</td>

                        {/* Status badge (colour comes from statusClass). */}
                        <td>
                          <span
                            className={`volunteer-details-status ${statusClass(attendanceItem.status)}`}
                          >
                            {statusText(attendanceItem.status)}
                          </span>
                        </td>

                        <td>
                          {safeText(attendanceItem.note, 'אין הערה')}
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td
                        colSpan="4"
                        className="volunteer-details-empty-row"
                      >
                        אין עדיין היסטוריית נוכחות למתנדב הזה.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </section>
    </main>
  )
}
