import { useCallback, useEffect, useMemo, useState } from 'react'

import { collection, getDocs } from 'firebase/firestore'

import { db } from '../../firebase'
import './Reports.css'

// Firestore collection names used by the reports screen.
const COLLECTION_NAMES = {
  USERS: 'users',
  EVENTS: 'events',
  ATTENDANCE: 'attendance',
}

// Empty state used before Firebase data is loaded.
const EMPTY_DATA = {
  users: [],
  events: [],
  attendance: [],
}

// Report tabs available in the UI.
const REPORT_TYPES = {
  ATTENDANCE: 'attendance',
  GROUPS: 'groups',
  EVENTS: 'events',
}

// Event statuses used for the event status summary section.
const EVENT_STATUSES = [
  'מתוכנן',
  'פעיל',
  'הסתיים',
  'בוטל',
]

const DEFAULT_TEXT = 'לא צוין'
const CSV_BOM = '\ufeff'

/**
 * Returns safe text for UI and CSV output.
 * Prevents empty, null, or undefined values from appearing as blank cells.
 */
function safeText(value, fallback = DEFAULT_TEXT) {
  if (value === null || value === undefined || value === '') {
    return fallback
  }

  return String(value)
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
 * Reads one Firestore collection and returns both records and error state.
 * This keeps Firebase errors from breaking the whole reports screen.
 */
async function readCollection(collectionName) {
  try {
    const snapshot = await getDocs(collection(db, collectionName))

    return {
      records: snapshot.docs.map(normalizeDocument),
      error: null,
    }
  } catch (error) {
    console.error(`Error loading ${collectionName}:`, error)

    return {
      records: [],
      error: `${collectionName}: ${error.message}`,
    }
  }
}

/**
 * Loads all data needed for the reports screen.
 * The screen uses users, events, and attendance together.
 */
async function loadReportsCollections() {
  const [usersResult, eventsResult, attendanceResult] = await Promise.all([
    readCollection(COLLECTION_NAMES.USERS),
    readCollection(COLLECTION_NAMES.EVENTS),
    readCollection(COLLECTION_NAMES.ATTENDANCE),
  ])

  return {
    data: {
      users: usersResult.records,
      events: eventsResult.records,
      attendance: attendanceResult.records,
    },
    errors: [
      usersResult.error,
      eventsResult.error,
      attendanceResult.error,
    ].filter(Boolean),
  }
}

/**
 * Finds the best available group name for a volunteer.
 */
function getVolunteerGroup(user) {
  return (
    user.group ||
    user.assignedGroup ||
    user.groupName ||
    user.team ||
    'ללא שיוך'
  )
}

/**
 * Finds the best available group name for an event.
 */
function getEventGroup(event) {
  return (
    event.assignedGroup ||
    event.group ||
    event.groupName ||
    'ללא שיוך'
  )
}

/**
 * Finds the best available group name for an attendance record.
 */
function getAttendanceGroup(attendanceItem) {
  return (
    attendanceItem.assignedGroup ||
    attendanceItem.group ||
    attendanceItem.groupName ||
    'ללא שיוך'
  )
}

/**
 * Normalizes different attendance values into one known status.
 * This supports several possible data shapes from other screens.
 */
function normalizeAttendanceStatus(value) {
  if (value === true) {
    return 'present'
  }

  if (value === false) {
    return 'absent'
  }

  const text = String(value || '').trim().toLowerCase()

  if (['present', 'yes', 'true', '1', 'נוכח', 'כן'].includes(text)) {
    return 'present'
  }

  if (['absent', 'no', 'false', '0', 'נעדר', 'לא'].includes(text)) {
    return 'absent'
  }

  return 'unknown'
}

/**
 * Gets the status field from one attendance item.
 */
function getRecordStatus(record) {
  return (
    record.status ??
    record.attendance ??
    record.present ??
    record.isPresent ??
    record.value
  )
}

/**
 * Counts present, absent, and unknown values inside a nested attendance list.
 */
function countAttendanceFromList(list) {
  return list.reduce(
    (summary, record) => {
      const status = normalizeAttendanceStatus(getRecordStatus(record))

      return {
        present: summary.present + (status === 'present' ? 1 : 0),
        absent: summary.absent + (status === 'absent' ? 1 : 0),
        unknown: summary.unknown + (status === 'unknown' ? 1 : 0),
      }
    },
    {
      present: 0,
      absent: 0,
      unknown: 0,
    },
  )
}

/**
 * Extracts attendance totals from multiple possible Firestore structures.
 */
function getAttendanceCounts(attendanceItem) {
  const presentCount = Number(
    attendanceItem.presentCount ?? attendanceItem.presentTotal,
  )

  const absentCount = Number(
    attendanceItem.absentCount ?? attendanceItem.absentTotal,
  )

  if (Number.isFinite(presentCount) || Number.isFinite(absentCount)) {
    return {
      present: Number.isFinite(presentCount) ? presentCount : 0,
      absent: Number.isFinite(absentCount) ? absentCount : 0,
      unknown: 0,
    }
  }

  if (
    Array.isArray(attendanceItem.present) ||
    Array.isArray(attendanceItem.absent)
  ) {
    return {
      present: Array.isArray(attendanceItem.present)
        ? attendanceItem.present.length
        : 0,
      absent: Array.isArray(attendanceItem.absent)
        ? attendanceItem.absent.length
        : 0,
      unknown: 0,
    }
  }

  const attendanceList =
    attendanceItem.records ||
    attendanceItem.volunteers ||
    attendanceItem.attendees ||
    attendanceItem.items ||
    []

  if (Array.isArray(attendanceList) && attendanceList.length > 0) {
    return countAttendanceFromList(attendanceList)
  }

  // Single-volunteer record (one document per volunteer), e.g.
  // { status: true/false, volunteerId, date }. This is what the
  // attendance screen actually writes, so count it as one person.
  const singleStatusValue = getRecordStatus(attendanceItem)

  if (singleStatusValue !== undefined && singleStatusValue !== null) {
    const status = normalizeAttendanceStatus(singleStatusValue)

    return {
      present: status === 'present' ? 1 : 0,
      absent: status === 'absent' ? 1 : 0,
      unknown: status === 'unknown' ? 1 : 0,
    }
  }

  return {
    present: 0,
    absent: 0,
    unknown: 0,
  }
}

/**
 * Gets a readable date from an attendance record.
 */
function getAttendanceDate(attendanceItem) {
  const value = attendanceItem.date ?? attendanceItem.createdAt

  if (!value) {
    return 'ללא תאריך'
  }

  // Plain string date (e.g. "2026-05-31").
  if (typeof value === 'string') {
    return value
  }

  // Firestore Timestamp.
  if (typeof value.toDate === 'function') {
    return value.toDate().toLocaleDateString('he-IL')
  }

  // Native Date.
  if (value instanceof Date) {
    return value.toLocaleDateString('he-IL')
  }

  // Plain { seconds } object.
  if (typeof value.seconds === 'number') {
    return new Date(value.seconds * 1000).toLocaleDateString('he-IL')
  }

  return 'ללא תאריך'
}

/**
 * Calculates total attendance statistics for the summary cards.
 */
function calculateAttendanceStats(attendanceRecords) {
  return attendanceRecords.reduce(
    (summary, attendanceItem) => {
      const counts = getAttendanceCounts(attendanceItem)

      return {
        meetings: summary.meetings + 1,
        present: summary.present + counts.present,
        absent: summary.absent + counts.absent,
        unknown: summary.unknown + counts.unknown,
      }
    },
    {
      meetings: 0,
      present: 0,
      absent: 0,
      unknown: 0,
    },
  )
}

/**
 * Builds one combined group report from volunteers, events, and attendance.
 */
function buildGroupRows(users, events, attendanceRecords) {
  const groupsMap = new Map()

  const ensureGroup = (groupName) => {
    const normalizedGroupName = groupName || 'ללא שיוך'

    if (!groupsMap.has(normalizedGroupName)) {
      groupsMap.set(normalizedGroupName, {
        name: normalizedGroupName,
        volunteers: 0,
        events: 0,
        attendanceMeetings: 0,
        present: 0,
        absent: 0,
        meetingKeys: new Set(),
      })
    }

    return groupsMap.get(normalizedGroupName)
  }

  users.forEach((user) => {
    const group = ensureGroup(getVolunteerGroup(user))

    group.volunteers += 1
  })

  events.forEach((event) => {
    const group = ensureGroup(getEventGroup(event))

    group.events += 1
  })

  attendanceRecords.forEach((attendanceItem) => {
    const group = ensureGroup(getAttendanceGroup(attendanceItem))
    const counts = getAttendanceCounts(attendanceItem)

    group.meetingKeys.add(getAttendanceDate(attendanceItem))
    group.present += counts.present
    group.absent += counts.absent
  })

  return Array.from(groupsMap.values())
    .map(({ meetingKeys, ...group }) => ({
      ...group,
      attendanceMeetings: meetingKeys.size,
    }))
    .sort((firstGroup, secondGroup) =>
      firstGroup.name.localeCompare(secondGroup.name, 'he'),
    )
}

/**
 * Groups the per-volunteer attendance documents into one row per meeting
 * (same group + same date), summing present / absent / unknown counts.
 */
function buildAttendanceRows(attendanceRecords) {
  const meetings = new Map()

  attendanceRecords.forEach((attendanceItem) => {
    const date = getAttendanceDate(attendanceItem)
    const group = getAttendanceGroup(attendanceItem)
    const key = `${group}__${date}`

    if (!meetings.has(key)) {
      meetings.set(key, {
        id: key,
        date,
        group,
        present: 0,
        absent: 0,
        unknown: 0,
      })
    }

    const meeting = meetings.get(key)
    const counts = getAttendanceCounts(attendanceItem)

    meeting.present += counts.present
    meeting.absent += counts.absent
    meeting.unknown += counts.unknown
  })

  return Array.from(meetings.values())
}

/**
 * Escapes a single CSV cell.
 * Quotes are doubled according to CSV rules.
 */
function formatCsvCell(cell) {
  return `"${String(cell ?? '').replace(/"/g, '""')}"`
}

/**
 * Downloads the given rows as a CSV file.
 * The BOM helps Excel open Hebrew text correctly.
 */
function downloadCsv(rows) {
  const csvContent = rows
    .map((row) => row.map(formatCsvCell).join(','))
    .join('\r\n')

  const blob = new Blob([CSV_BOM, csvContent], {
    type: 'text/csv;charset=utf-8;',
  })

  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')

  link.href = url
  link.download = `reports-${new Date().toISOString().slice(0, 10)}.csv`
  link.click()

  URL.revokeObjectURL(url)
}

/**
 * Screen 13 — Reports.
 * Shows attendance, group, and event reports with PDF and Excel export.
 */
export default function Reports() {
  // Firebase data used by all reports.
  const [data, setData] = useState(EMPTY_DATA)

  // UI states for loading, errors, selected tab, and search.
  const [loading, setLoading] = useState(true)
  const [errors, setErrors] = useState([])
  const [activeReport, setActiveReport] = useState(REPORT_TYPES.EVENTS)
  const [searchTerm, setSearchTerm] = useState('')

  /**
   * Reloads reports data manually when the user clicks refresh.
   */
  const loadReportsData = useCallback(async () => {
    setLoading(true)
    setErrors([])

    const reportsState = await loadReportsCollections()

    setData(reportsState.data)
    setErrors(reportsState.errors)
    setLoading(false)
  }, [])

  /**
   * Loads report data once when the screen opens.
   * The isMounted flag prevents state updates after the component unmounts.
   */
  useEffect(() => {
    let isMounted = true

    async function loadInitialReportsData() {
      const reportsState = await loadReportsCollections()

      if (!isMounted) {
        return
      }

      setData(reportsState.data)
      setErrors(reportsState.errors)
      setLoading(false)
    }

    loadInitialReportsData()

    return () => {
      isMounted = false
    }
  }, [])

  const attendanceStats = useMemo(
    () => calculateAttendanceStats(data.attendance),
    [data.attendance],
  )

  const attendanceTotal =
    attendanceStats.present +
    attendanceStats.absent +
    attendanceStats.unknown

  const attendanceRate =
    attendanceTotal > 0
      ? Math.round((attendanceStats.present / attendanceTotal) * 100)
      : 0

  /**
   * Counts how many events exist for each status.
   */
  const eventStatusCounts = useMemo(() => {
    return EVENT_STATUSES.reduce((summary, status) => {
      return {
        ...summary,
        [status]: data.events.filter((event) => event.status === status).length,
      }
    }, {})
  }, [data.events])

  /**
   * Group report rows are calculated from all report data.
   */
  const groupRows = useMemo(
    () => buildGroupRows(data.users, data.events, data.attendance),
    [data.users, data.events, data.attendance],
  )

  /**
   * Attendance rows are normalized for table rendering.
   */
  const attendanceRows = useMemo(
    () => buildAttendanceRows(data.attendance),
    [data.attendance],
  )

  /**
   * Filters event report rows by the current search text.
   */
  const filteredEvents = useMemo(() => {
    const search = searchTerm.trim().toLowerCase()

    if (!search) {
      return data.events
    }

    return data.events.filter((event) => {
      const text = [
        event.name,
        event.date,
        event.location,
        getEventGroup(event),
        event.status,
      ]
        .join(' ')
        .toLowerCase()

      return text.includes(search)
    })
  }, [data.events, searchTerm])

  /**
   * Filters group report rows by group name.
   */
  const filteredGroups = useMemo(() => {
    const search = searchTerm.trim().toLowerCase()

    if (!search) {
      return groupRows
    }

    return groupRows.filter((group) =>
      group.name.toLowerCase().includes(search),
    )
  }, [groupRows, searchTerm])

  /**
   * Filters attendance report rows by date or group name.
   */
  const filteredAttendance = useMemo(() => {
    const search = searchTerm.trim().toLowerCase()

    if (!search) {
      return attendanceRows
    }

    return attendanceRows.filter((attendanceItem) => {
      const text = [
        attendanceItem.date,
        attendanceItem.group,
      ]
        .join(' ')
        .toLowerCase()

      return text.includes(search)
    })
  }, [attendanceRows, searchTerm])

  /**
   * Opens the browser print dialog.
   * The CSS file contains print-specific styles.
   */
  const handleExportPdf = () => {
    window.print()
  }

  /**
   * Exports all report types into one CSV file.
   * The UI labels say Excel because CSV opens directly in Excel.
   */
  const handleExportExcel = () => {
    const rows = [
      [
        'סוג דוח',
        'שם / קבוצה',
        'תאריך',
        'מיקום',
        'סטטוס',
        'נוכחים',
        'נעדרים',
        'הערות',
      ],

      ...data.events.map((event) => [
        'דוח אירועים',
        safeText(event.name),
        safeText(event.date),
        safeText(event.location),
        safeText(event.status),
        '',
        '',
        `קבוצה: ${getEventGroup(event)}`,
      ]),

      ...groupRows.map((group) => [
        'דוח קבוצות',
        group.name,
        '',
        '',
        '',
        group.present,
        group.absent,
        `מתנדבים: ${group.volunteers}, אירועים: ${group.events}, מפגשי נוכחות: ${group.attendanceMeetings}`,
      ]),

      ...attendanceRows.map((attendanceItem) => [
        'דוח נוכחות',
        attendanceItem.group,
        attendanceItem.date,
        '',
        '',
        attendanceItem.present,
        attendanceItem.absent,
        `לא ידוע: ${attendanceItem.unknown}`,
      ]),
    ]

    downloadCsv(rows)
  }

  /**
   * Renders the event report table.
   */
  const renderEventsReport = () => (
    <div className="reports-table-wrap">
      <table className="reports-table">
        <thead>
          <tr>
            <th>שם אירוע</th>
            <th>תאריך</th>
            <th>מיקום</th>
            <th>קבוצה</th>
            <th>סטטוס</th>
          </tr>
        </thead>

        <tbody>
          {filteredEvents.length > 0 ? (
            filteredEvents.map((event) => (
              <tr key={event.id}>
                <td>{safeText(event.name)}</td>
                <td>{safeText(event.date)}</td>
                <td>{safeText(event.location)}</td>
                <td>{getEventGroup(event)}</td>
                <td>{safeText(event.status)}</td>
              </tr>
            ))
          ) : (
            <tr>
              <td colSpan="5" className="reports-empty">
                אין אירועים להצגה.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )

  /**
   * Renders the group report table.
   */
  const renderGroupsReport = () => (
    <div className="reports-table-wrap">
      <table className="reports-table">
        <thead>
          <tr>
            <th>קבוצה</th>
            <th>מתנדבים</th>
            <th>אירועים</th>
            <th>מפגשי נוכחות</th>
            <th>נוכחים</th>
            <th>נעדרים</th>
          </tr>
        </thead>

        <tbody>
          {filteredGroups.length > 0 ? (
            filteredGroups.map((group) => (
              <tr key={group.name}>
                <td>{group.name}</td>
                <td>{group.volunteers}</td>
                <td>{group.events}</td>
                <td>{group.attendanceMeetings}</td>
                <td>{group.present}</td>
                <td>{group.absent}</td>
              </tr>
            ))
          ) : (
            <tr>
              <td colSpan="6" className="reports-empty">
                אין קבוצות להצגה.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )

  /**
   * Renders the attendance report table.
   */
  const renderAttendanceReport = () => (
    <div className="reports-table-wrap">
      <table className="reports-table">
        <thead>
          <tr>
            <th>תאריך</th>
            <th>קבוצה</th>
            <th>נוכחים</th>
            <th>נעדרים</th>
            <th>לא ידוע</th>
          </tr>
        </thead>

        <tbody>
          {filteredAttendance.length > 0 ? (
            filteredAttendance.map((attendanceItem) => (
              <tr key={attendanceItem.id}>
                <td>{attendanceItem.date}</td>
                <td>{attendanceItem.group}</td>
                <td>{attendanceItem.present}</td>
                <td>{attendanceItem.absent}</td>
                <td>{attendanceItem.unknown}</td>
              </tr>
            ))
          ) : (
            <tr>
              <td colSpan="5" className="reports-empty">
                אין נתוני נוכחות להצגה.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )

  /**
   * Chooses which report table to display according to the active tab.
   */
  const renderActiveReport = () => {
    if (activeReport === REPORT_TYPES.ATTENDANCE) {
      return renderAttendanceReport()
    }

    if (activeReport === REPORT_TYPES.GROUPS) {
      return renderGroupsReport()
    }

    return renderEventsReport()
  }

  return (
    <main className="reports-container" dir="rtl">
      <section className="reports-card">
        <header className="reports-header">
          <div>
            <div className="reports-eyebrow">
              מסך 13
            </div>

            <h1 className="reports-title">
              דוחות
            </h1>

            <p className="reports-subtitle">
              צפייה בדוחות נוכחות, קבוצות ואירועים עם אפשרות ייצוא ל־PDF או Excel.
            </p>
          </div>

          <div className="reports-actions">
            <button type="button" onClick={loadReportsData}>
              רענון נתונים
            </button>

            <button type="button" onClick={handleExportPdf}>
              Export PDF
            </button>

            <button type="button" onClick={handleExportExcel}>
              Export Excel
            </button>
          </div>
        </header>

        {errors.length > 0 && (
          <div className="reports-error">
            חלק מהנתונים לא נטענו:

            <ul>
              {errors.map((error) => (
                <li key={error}>
                  {error}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="reports-summary-grid">
          <article className="reports-summary-card">
            <span>{data.users.length}</span>
            <p>מתנדבים</p>
          </article>

          <article className="reports-summary-card">
            <span>{groupRows.length}</span>
            <p>קבוצות</p>
          </article>

          <article className="reports-summary-card">
            <span>{data.events.length}</span>
            <p>אירועים</p>
          </article>

          <article className="reports-summary-card">
            <span>{attendanceRate}%</span>
            <p>אחוז נוכחות</p>
          </article>
        </div>

        <section className="reports-status-section">
          <h2>סיכום אירועים לפי סטטוס</h2>

          <div className="reports-status-grid">
            {EVENT_STATUSES.map((status) => (
              <div key={status} className="reports-status-item">
                <strong>{eventStatusCounts[status] || 0}</strong>
                <span>{status}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="reports-panel">
          <div className="reports-panel-header">
            <div className="reports-tabs">
              <button
                type="button"
                className={activeReport === REPORT_TYPES.EVENTS ? 'active' : ''}
                onClick={() => setActiveReport(REPORT_TYPES.EVENTS)}
              >
                Event Reports
              </button>

              <button
                type="button"
                className={activeReport === REPORT_TYPES.GROUPS ? 'active' : ''}
                onClick={() => setActiveReport(REPORT_TYPES.GROUPS)}
              >
                Group Reports
              </button>

              <button
                type="button"
                className={activeReport === REPORT_TYPES.ATTENDANCE ? 'active' : ''}
                onClick={() => setActiveReport(REPORT_TYPES.ATTENDANCE)}
              >
                Attendance Reports
              </button>
            </div>

            <input
              type="search"
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              placeholder="חיפוש בדוח הנוכחי"
              className="reports-search"
            />
          </div>

          {loading ? (
            <div className="reports-loading">
              טוען דוחות מ־Firebase...
            </div>
          ) : (
            renderActiveReport()
          )}
        </section>
      </section>
    </main>
  )
}
