import { useEffect, useMemo, useState } from 'react'

import { collection, getDocs } from 'firebase/firestore'

import { db } from '../../firebase'
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

/**
 * Returns safe display text for optional values.
 */
function safeText(value, fallback = FALLBACK) {
  if (value === null || value === undefined || value === '') {
    return fallback
  }

  return String(value)
}

/**
 * Builds the best available full name for a volunteer.
 */
function getFullName(volunteer) {
  if (!volunteer) {
    return 'מתנדב לא נבחר'
  }

  const fullName = [
    volunteer.firstName,
    volunteer.lastName,
  ]
    .filter(Boolean)
    .join(' ')
    .trim()

  return (
    fullName ||
    volunteer.name ||
    volunteer.email ||
    volunteer.id ||
    'מתנדב ללא שם'
  )
}

/**
 * Uses the first letter of the volunteer name for the avatar.
 */
function getInitial(volunteer) {
  return getFullName(volunteer).charAt(0).toUpperCase()
}

/**
 * Finds the best available group field for a volunteer.
 */
function getVolunteerGroup(volunteer) {
  return (
    volunteer?.group ||
    volunteer?.assignedGroup ||
    volunteer?.groupName ||
    volunteer?.team ||
    'ללא שיוך'
  )
}

/**
 * Finds the best available unique identifier for a volunteer.
 */
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

/**
 * Converts a Firestore document snapshot into a plain object with its id.
 */
function normalizeDocument(documentSnapshot) {
  return {
    id: documentSnapshot.id,
    ...documentSnapshot.data(),
  }
}

/**
 * Converts different attendance values into one consistent status.
 */
function normalizeAttendanceStatus(value) {
  if (value === true) {
    return ATTENDANCE_STATUS.PRESENT
  }

  if (value === false) {
    return ATTENDANCE_STATUS.ABSENT
  }

  const text = String(value || '').trim().toLowerCase()

  if (['present', 'yes', 'true', '1', 'נוכח', 'כן'].includes(text)) {
    return ATTENDANCE_STATUS.PRESENT
  }

  if (['absent', 'no', 'false', '0', 'נעדר', 'לא'].includes(text)) {
    return ATTENDANCE_STATUS.ABSENT
  }

  return ATTENDANCE_STATUS.UNKNOWN
}

/**
 * Converts internal attendance status into Hebrew display text.
 */
function statusText(status) {
  if (status === ATTENDANCE_STATUS.PRESENT) {
    return 'נוכח'
  }

  if (status === ATTENDANCE_STATUS.ABSENT) {
    return 'נעדר'
  }

  return 'לא ידוע'
}

/**
 * Maps attendance status into a CSS class.
 */
function statusClass(status) {
  if (status === ATTENDANCE_STATUS.PRESENT) {
    return 'status-present'
  }

  if (status === ATTENDANCE_STATUS.ABSENT) {
    return 'status-absent'
  }

  return 'status-unknown'
}

/**
 * Gets a readable date from an attendance record.
 */
function getAttendanceDate(attendanceItem) {
  if (attendanceItem.date) {
    return attendanceItem.date
  }

  if (attendanceItem.createdAt?.toDate) {
    return attendanceItem.createdAt.toDate().toLocaleDateString('he-IL')
  }

  return 'ללא תאריך'
}

/**
 * Gets the group for an attendance record.
 * Falls back to the volunteer group when the attendance record has no group.
 */
function getAttendanceGroup(attendanceItem, volunteer) {
  return (
    attendanceItem.group ||
    attendanceItem.groupName ||
    attendanceItem.assignedGroup ||
    getVolunteerGroup(volunteer)
  )
}

/**
 * Normalizes a value before comparing it to volunteer identifiers.
 */
function toSearchValue(value) {
  return String(value || '').trim().toLowerCase()
}

/**
 * Builds a list of possible identifiers for matching attendance records.
 * This supports different Firestore data shapes.
 */
function buildVolunteerCandidates(volunteer) {
  if (!volunteer) {
    return []
  }

  const fullName = getFullName(volunteer)

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

/**
 * Checks whether a value contains or equals one of the volunteer candidates.
 * Supports strings, arrays, and nested objects.
 */
function valueMatchesCandidate(value, candidates) {
  if (!value || candidates.length === 0) {
    return false
  }

  if (Array.isArray(value)) {
    return value.some((item) => valueMatchesCandidate(item, candidates))
  }

  if (typeof value === 'object') {
    return Object.values(value).some((item) =>
      valueMatchesCandidate(item, candidates),
    )
  }

  const text = toSearchValue(value)

  return candidates.some(
    (candidate) =>
      text === candidate ||
      text.includes(candidate) ||
      candidate.includes(text),
  )
}

/**
 * Checks whether one attendance record belongs to the selected volunteer.
 */
function recordMatchesVolunteer(attendanceItem, candidates) {
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

  const hasDirectMatch = directFields.some((fieldValue) =>
    valueMatchesCandidate(fieldValue, candidates),
  )

  if (hasDirectMatch) {
    return true
  }

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

/**
 * Finds the selected volunteer status inside direct or nested attendance data.
 */
function getNestedAttendanceStatus(attendanceItem, candidates) {
  const directStatus = normalizeAttendanceStatus(
    attendanceItem.status ??
      attendanceItem.attendance ??
      attendanceItem.isPresent,
  )

  if (directStatus !== ATTENDANCE_STATUS.UNKNOWN) {
    return directStatus
  }

  if (valueMatchesCandidate(attendanceItem.present, candidates)) {
    return ATTENDANCE_STATUS.PRESENT
  }

  if (valueMatchesCandidate(attendanceItem.absent, candidates)) {
    return ATTENDANCE_STATUS.ABSENT
  }

  const nestedLists = [
    attendanceItem.records,
    attendanceItem.volunteers,
    attendanceItem.attendees,
    attendanceItem.items,
  ]

  for (const listValue of nestedLists) {
    if (!Array.isArray(listValue)) {
      continue
    }

    const matchingItem = listValue.find((item) =>
      valueMatchesCandidate(item, candidates),
    )

    if (matchingItem) {
      return normalizeAttendanceStatus(
        matchingItem.status ??
          matchingItem.attendance ??
          matchingItem.present ??
          matchingItem.isPresent,
      )
    }
  }

  return ATTENDANCE_STATUS.UNKNOWN
}

/**
 * Builds table rows for the selected volunteer attendance history.
 */
function buildAttendanceRows(attendanceRecords, volunteer) {
  const candidates = buildVolunteerCandidates(volunteer)

  if (candidates.length === 0) {
    return []
  }

  return attendanceRecords
    .filter((attendanceItem) =>
      recordMatchesVolunteer(attendanceItem, candidates),
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

/**
 * Counts attendance statuses for the summary cards.
 */
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

/**
 * Screen 14 — Volunteer Details.
 * Shows personal information, group assignment, and attendance history.
 */
export default function VolunteerDetails({ volunteer, onBack }) {
  // Attendance records loaded from Firestore.
  const [attendanceRecords, setAttendanceRecords] = useState([])

  // UI state for attendance loading and Firebase errors.
  const [attendanceLoading, setAttendanceLoading] = useState(true)
  const [attendanceError, setAttendanceError] = useState(null)

  /**
   * Loads attendance history once when the screen opens.
   * The isMounted flag prevents state updates after unmount.
   */
  useEffect(() => {
    let isMounted = true

    async function loadAttendanceHistory() {
      try {
        const snapshot = await getDocs(
          collection(db, ATTENDANCE_COLLECTION_NAME),
        )

        if (!isMounted) {
          return
        }

        setAttendanceRecords(snapshot.docs.map(normalizeDocument))
        setAttendanceError(null)
      } catch (error) {
        console.error('Error loading attendance history:', error)

        if (!isMounted) {
          return
        }

        setAttendanceError(error.message)
      } finally {
        if (isMounted) {
          setAttendanceLoading(false)
        }
      }
    }

    loadAttendanceHistory()

    return () => {
      isMounted = false
    }
  }, [])

  /**
   * Builds attendance rows only when the records or selected volunteer change.
   */
  const attendanceRows = useMemo(
    () => buildAttendanceRows(attendanceRecords, volunteer),
    [attendanceRecords, volunteer],
  )

  /**
   * Builds the summary cards from the filtered attendance rows.
   */
  const attendanceSummary = useMemo(
    () => buildAttendanceSummary(attendanceRows),
    [attendanceRows],
  )

  /**
   * Returns to the volunteer list if a back handler exists.
   */
  const handleBack = () => {
    if (typeof onBack === 'function') {
      onBack()
    }
  }

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
        <header className="volunteer-details-header">
          <div className="volunteer-details-profile">
            <div className="volunteer-details-avatar">
              {getInitial(volunteer)}
            </div>

            <div>
              <div className="volunteer-details-eyebrow">
                מסך 14
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

        <div className="volunteer-details-summary-grid">
          <article className="volunteer-details-summary-card">
            <span>{attendanceSummary.present}</span>
            <p>נוכח</p>
          </article>

          <article className="volunteer-details-summary-card">
            <span>{attendanceSummary.absent}</span>
            <p>נעדר</p>
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

        <section className="volunteer-details-section">
          <h2>Personal Info</h2>

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
              <span>מזהה</span>
              <strong dir="ltr">
                {getVolunteerIdentifier(volunteer)}
              </strong>
            </div>
          </div>
        </section>

        <section className="volunteer-details-section volunteer-details-group-section">
          <h2>Group</h2>

          <div className="volunteer-details-group-card">
            <span>קבוצה משויכת</span>
            <strong>{getVolunteerGroup(volunteer)}</strong>
          </div>
        </section>

        <section className="volunteer-details-section">
          <h2>Attendance History</h2>

          {attendanceError && (
            <div className="volunteer-details-error">
              שגיאה בטעינת היסטוריית נוכחות: {attendanceError}
            </div>
          )}

          {attendanceLoading ? (
            <div className="volunteer-details-loading">
              טוען היסטוריית נוכחות...
            </div>
          ) : (
            <div className="volunteer-details-table-wrap">
              <table className="volunteer-details-table">
                <thead>
                  <tr>
                    <th>תאריך</th>
                    <th>קבוצה</th>
                    <th>סטטוס</th>
                    <th>הערה</th>
                  </tr>
                </thead>

                <tbody>
                  {attendanceRows.length > 0 ? (
                    attendanceRows.map((attendanceItem) => (
                      <tr key={attendanceItem.id}>
                        <td>{attendanceItem.date}</td>
                        <td>{attendanceItem.group}</td>

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
