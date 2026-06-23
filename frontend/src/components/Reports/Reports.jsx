// Reports — admin reports hub. Loads volunteers, events and attendance,
// builds per-group and per-meeting summary tables (using the shared
// attendance normalizer), and exports any report as CSV that opens
// correctly in Excel in Hebrew (BOM-prefixed).

// React hooks for state, effects, memoization and stable callbacks.
import { useEffect, useMemo, useState } from 'react'

// Firestore helpers for reading collections.
import { collection, getDocs } from 'firebase/firestore'

// Our Firestore database instance.
import { db } from '../../firebase'

// Styles for this screen.
import './Reports.css'

// Shared event status helper (so reports match the other screens).
import { computeEventStatus } from '../../utils/eventStatus'

// Shared attendance normalization (kept in one place across screens).
import { normalizeAttendanceStatus, getRecordStatus } from '../../utils/attendance'

// Canonical grouping key (YYYY-MM-DD) vs DD-MM-YYYY display date for a meeting.
import { resolveAttendanceDateKey, resolveAttendanceDisplayDate } from '../../utils/attendanceDisplayDate'

// Shared day / month / year date selector.
import BirthDatePicker from '../shared/BirthDatePicker/BirthDatePicker'


// Firestore collection names used by the reports screen.
const COLLECTION_NAMES = {
  VOLUNTEERS: 'volunteers',
  EVENTS: 'events',
  ATTENDANCE: 'attendance',
}

// Empty state used before Firebase data is loaded.
const EMPTY_DATA = {
  volunteers: [],
  events: [],
  attendance: [],
}

// Report tabs available in the UI.
const REPORT_TYPES = {
  ATTENDANCE: 'attendance',
  GROUPS: 'groups',
  EVENTS: 'events',
}

// Hebrew labels for each report type (also used as the print heading on page 2).
const REPORT_LABELS = {
  [REPORT_TYPES.ATTENDANCE]: 'דוח נוכחות',
  [REPORT_TYPES.GROUPS]: 'דוח קבוצות',
  [REPORT_TYPES.EVENTS]: 'דוח אירועים',
}


// Fallback text for empty values, and the BOM that makes Excel read Hebrew CSV.
const DEFAULT_TEXT = 'לא צוין'
const CSV_BOM = '﻿'


// Safe text for UI and CSV: turns empty / null / undefined into a fallback.
function safeText(value, fallback = DEFAULT_TEXT) {
  // Treat blank-ish values as missing.
  if (value === null || value === undefined || value === '') {
    return fallback
  }

  return String(value)
}


// Turn a Firestore document snapshot into a plain object that keeps its id.
function normalizeDocument(documentSnapshot) {
  return {
    id: documentSnapshot.id,
    ...documentSnapshot.data(),
  }
}


// Read one collection, returning both its records and any error (never throws).
async function readCollection(collectionName) {
  try {
    // Fetch all documents in the collection.
    const snapshot = await getDocs(collection(db, collectionName))

    // Success: normalized records, no error.
    return {
      records: snapshot.docs.map(normalizeDocument),
      error: null,
    }
  } catch (error) {
    // Failure: log it and return an empty list plus a readable error.
    console.error(`Error loading ${collectionName}:`, error)

    return {
      records: [],
      error: `${collectionName}: ${error.message}`,
    }
  }
}


// Load every collection the reports screen needs (volunteers, events, attendance).
async function loadReportsCollections() {
  // Read all three collections in parallel.
  const [volunteersResult, eventsResult, attendanceResult] = await Promise.all([
    readCollection(COLLECTION_NAMES.VOLUNTEERS),
    readCollection(COLLECTION_NAMES.EVENTS),
    readCollection(COLLECTION_NAMES.ATTENDANCE),
  ])

  // Bundle the data and collect any errors that occurred.
  return {
    data: {
      volunteers: volunteersResult.records,
      events: eventsResult.records,
      attendance: attendanceResult.records,
    },
    errors: [
      volunteersResult.error,
      eventsResult.error,
      attendanceResult.error,
    ].filter(Boolean),
  }
}


// Best available group name for a volunteer, across the possible field names.
function getVolunteerGroup(user) {
  return (
    user.group ||
    user.assignedGroup ||
    user.groupName ||
    user.team ||
    'ללא שיוך'
  )
}


// Best available group name for an event.
function getEventGroup(event) {
  return (
    event.assignedGroup ||
    event.group ||
    event.groupName ||
    'ללא שיוך'
  )
}


// Best available group name for an attendance record.
function getAttendanceGroup(attendanceItem) {
  return (
    attendanceItem.assignedGroup ||
    attendanceItem.group ||
    attendanceItem.groupName ||
    'ללא שיוך'
  )
}


// (normalizeAttendanceStatus + getRecordStatus now live in utils/attendance.)


// Count present / absent / unknown across a nested list of attendance records.
function countAttendanceFromList(list) {
  return list.reduce(
    (summary, record) => {
      // Normalize this record's status.
      const status = normalizeAttendanceStatus(getRecordStatus(record))

      // Add 1 to the matching tally.
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


// Extract present/absent/unknown totals from the many shapes an attendance doc
// can take (explicit counts, present/absent arrays, a nested list, or a single record).
function getAttendanceCounts(attendanceItem) {
  // Shape 1: explicit numeric counts.
  const presentCount = Number(
    attendanceItem.presentCount ?? attendanceItem.presentTotal,
  )

  const absentCount = Number(
    attendanceItem.absentCount ?? attendanceItem.absentTotal,
  )

  // If either count is a real number, use them.
  if (Number.isFinite(presentCount) || Number.isFinite(absentCount)) {
    return {
      present: Number.isFinite(presentCount) ? presentCount : 0,
      absent: Number.isFinite(absentCount) ? absentCount : 0,
      unknown: 0,
    }
  }

  // Shape 2: separate present / absent arrays — count their lengths.
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

  // Shape 3: a nested list of records under one of these field names.
  const attendanceList =
    attendanceItem.records ||
    attendanceItem.volunteers ||
    attendanceItem.attendees ||
    attendanceItem.items ||
    []

  if (Array.isArray(attendanceList) && attendanceList.length > 0) {
    return countAttendanceFromList(attendanceList)
  }

  // Shape 4: single-volunteer record (one document per volunteer), e.g.
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

  // Nothing usable: all zeros.
  return {
    present: 0,
    absent: 0,
    unknown: 0,
  }
}


// Build one combined per-group report from volunteers, events and attendance.
function buildGroupRows(users, events, attendanceRecords) {
  // Group name -> accumulated stats.
  const groupsMap = new Map()

  // Get (or create) the stats object for a group name.
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

  // Count volunteers per group.
  users.forEach((user) => {
    const group = ensureGroup(getVolunteerGroup(user))

    group.volunteers += 1
  })

  // Count events per group.
  events.forEach((event) => {
    const group = ensureGroup(getEventGroup(event))

    group.events += 1
  })

  // Add attendance numbers and track distinct meeting dates per group.
  attendanceRecords.forEach((attendanceItem) => {
    const group = ensureGroup(getAttendanceGroup(attendanceItem))
    const counts = getAttendanceCounts(attendanceItem)

    group.meetingKeys.add(resolveAttendanceDateKey(attendanceItem))
    group.present += counts.present
    group.absent += counts.absent
  })

  // Turn the map into a sorted array; meetings = number of distinct dates.
  return Array.from(groupsMap.values())
    .map(({ meetingKeys, ...group }) => ({
      ...group,
      attendanceMeetings: meetingKeys.size,
    }))
    .sort((firstGroup, secondGroup) =>
      firstGroup.name.localeCompare(secondGroup.name, 'he'),
    )
}


// Collapse per-volunteer attendance docs into one row per meeting (group + date),
// summing the present / absent / unknown counts.
function buildAttendanceRows(attendanceRecords) {
  // "group__date" -> meeting row.
  const meetings = new Map()

  attendanceRecords.forEach((attendanceItem) => {
    // Identify the meeting by its CANONICAL dateKey (grouping/sorting), but show
    // a DD-MM-YYYY display date — the key is never used as a user-facing label.
    const dateKey = resolveAttendanceDateKey(attendanceItem)
    const displayDate = resolveAttendanceDisplayDate(attendanceItem)
    const group = getAttendanceGroup(attendanceItem)
    const key = `${group}__${dateKey}`

    // Start a fresh row the first time we see this meeting. Both the canonical
    // dateKey (logical / searchable) and the DD-MM-YYYY display date are kept.
    if (!meetings.has(key)) {
      meetings.set(key, {
        id: key,
        dateKey,
        date: displayDate,
        group,
        present: 0,
        absent: 0,
        unknown: 0,
      })
    }

    // Add this record's counts into the meeting row.
    const meeting = meetings.get(key)
    const counts = getAttendanceCounts(attendanceItem)

    meeting.present += counts.present
    meeting.absent += counts.absent
    meeting.unknown += counts.unknown
  })

  return Array.from(meetings.values())
}


// Escape one CSV cell (wrap in quotes and double any inner quotes).
function formatCsvCell(cell) {
  return `"${String(cell ?? '').replace(/"/g, '""')}"`
}


// Download the given rows as a CSV file (BOM included so Excel reads Hebrew).
function downloadCsv(rows) {
  // Join cells with commas and rows with CRLF.
  const csvContent = rows
    .map((row) => row.map(formatCsvCell).join(','))
    .join('\r\n')

  // Build a CSV blob with the BOM prefix.
  const blob = new Blob([CSV_BOM, csvContent], {
    type: 'text/csv;charset=utf-8;',
  })

  // Create a temporary link and click it to trigger the download.
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')

  link.href = url
  link.download = `reports-${new Date().toISOString().slice(0, 10)}.csv`
  link.click()

  // Release the object URL.
  URL.revokeObjectURL(url)
}


// Convert a date-ish value (string / Timestamp / Date / { seconds }) into a
// real Date for range comparisons, or null when it can't be parsed.
function toComparableDate(value) {
  // Nothing to parse.
  if (!value) {
    return null
  }

  // Plain string date (e.g. "2026-05-31").
  if (typeof value === 'string') {
    const parsed = new Date(value)
    return Number.isNaN(parsed.getTime()) ? null : parsed
  }

  // Firestore Timestamp.
  if (typeof value.toDate === 'function') {
    return value.toDate()
  }

  // Native Date.
  if (value instanceof Date) {
    return value
  }

  // Plain { seconds } object.
  if (typeof value.seconds === 'number') {
    return new Date(value.seconds * 1000)
  }

  // Unrecognised shape.
  return null
}


// Is `value`'s date inside the inclusive [fromDate, toDate] range? Empty bounds
// are open-ended; an unparseable date only passes when there's no range at all.
function isWithinRange(value, fromDate, toDate) {
  const date = toComparableDate(value)

  // No usable date: keep it only when no range is set.
  if (!date) {
    return !fromDate && !toDate
  }

  // Lower bound: start of the "from" day.
  if (fromDate) {
    const from = new Date(fromDate)
    from.setHours(0, 0, 0, 0)
    if (date < from) {
      return false
    }
  }

  // Upper bound: end of the "to" day.
  if (toDate) {
    const to = new Date(toDate)
    to.setHours(23, 59, 59, 999)
    if (date > to) {
      return false
    }
  }

  return true
}


// Reports screen: attendance, group and event reports with PDF / Excel export.
export default function Reports({ registerBack }) {
  // Firebase data used by all reports.
  const [data, setData] = useState(EMPTY_DATA)

  // UI states for loading, errors, selected tab, and search.
  const [loading, setLoading] = useState(true)
  const [errors, setErrors] = useState([])
  // The currently shown report. Defaults straight to the attendance report —
  // the separate "pick a report" screen was removed (the tabs already switch).
  const [activeReport, setActiveReport] = useState(REPORT_TYPES.ATTENDANCE)
  const [searchTerm, setSearchTerm] = useState('')

  // Date-range filter (inclusive). Empty strings mean "no bound on that side".
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')

  // Group filter ('' means all groups).
  const [groupFilter, setGroupFilter] = useState('')

  // No internal back layer anymore (the report picker was removed), so the
  // dashboard back button exits Reports directly.
  useEffect(() => {
    if (!registerBack) return
    registerBack(() => false)
  }, [registerBack])


  // Load report data once when the screen opens.
  useEffect(() => {
    // Guards against state updates after the component unmounts.
    let isMounted = true

    // Initial fetch.
    async function loadInitialReportsData() {
      const reportsState = await loadReportsCollections()

      // Bail out if we unmounted while waiting.
      if (!isMounted) {
        return
      }

      setData(reportsState.data)
      setErrors(reportsState.errors)
      setLoading(false)
    }

    loadInitialReportsData()

    // Cleanup: mark as unmounted.
    return () => {
      isMounted = false
    }
  }, [])

  // Events that fall within the selected date range (drives every event-based
  // report so the whole screen reflects the chosen period).
  const dateFilteredEvents = useMemo(
    () => data.events.filter((event) => isWithinRange(event.date, fromDate, toDate)),
    [data.events, fromDate, toDate],
  )

  // Attendance records that fall within the selected date range.
  const dateFilteredAttendance = useMemo(
    () => data.attendance.filter((item) => isWithinRange(item.date ?? item.createdAt, fromDate, toDate)),
    [data.attendance, fromDate, toDate],
  )

  // True when the user has set either side of the range.
  const hasDateFilter = Boolean(fromDate || toDate)

  // Clear both ends of the date range.
  const clearDateRange = () => {
    setFromDate('')
    setToDate('')
  }


  // Group report rows, derived from the (date-filtered) data.
  const groupRows = useMemo(
    () => buildGroupRows(data.volunteers, dateFilteredEvents, dateFilteredAttendance),
    [data.volunteers, dateFilteredEvents, dateFilteredAttendance],
  )

  // Attendance rows, collapsed to one row per meeting (within the date range).
  const attendanceRows = useMemo(
    () => buildAttendanceRows(dateFilteredAttendance),
    [dateFilteredAttendance],
  )

  // Event rows filtered by the search box (on top of the date range).
  const filteredEvents = useMemo(() => {
    // Normalize the search text.
    const search = searchTerm.trim().toLowerCase()

    // Apply the group filter first (when one is chosen).
    const groupScopedEvents = groupFilter
      ? dateFilteredEvents.filter((event) => getEventGroup(event) === groupFilter)
      : dateFilteredEvents

    // No search: show everything in the date range.
    if (!search) {
      return groupScopedEvents
    }

    // Match the search against the event's combined text.
    return groupScopedEvents.filter((event) => {
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
  }, [dateFilteredEvents, searchTerm, groupFilter])

  // Group rows filtered by group name.
  const filteredGroups = useMemo(() => {
    const search = searchTerm.trim().toLowerCase()

    // Group filter narrows to a single group row.
    const scopedGroups = groupFilter
      ? groupRows.filter((group) => group.name === groupFilter)
      : groupRows

    if (!search) {
      return scopedGroups
    }

    return scopedGroups.filter((group) =>
      group.name.toLowerCase().includes(search),
    )
  }, [groupRows, searchTerm, groupFilter])

  // Attendance rows filtered by date or group name.
  const filteredAttendance = useMemo(() => {
    const search = searchTerm.trim().toLowerCase()

    // Group filter keeps only that group's meetings.
    const scopedAttendance = groupFilter
      ? attendanceRows.filter((attendanceItem) => attendanceItem.group === groupFilter)
      : attendanceRows

    if (!search) {
      return scopedAttendance
    }

    return scopedAttendance.filter((attendanceItem) => {
      // Searchable tokens: BOTH the canonical dateKey (YYYY-MM-DD) and the
      // DD-MM-YYYY display date, so either spelling finds the row (a dotted
      // "23.6.2026" intentionally does not).
      const text = [
        attendanceItem.dateKey,
        attendanceItem.date,
        attendanceItem.group,
      ]
        .join(' ')
        .toLowerCase()

      return text.includes(search)
    })
  }, [attendanceRows, searchTerm, groupFilter])

  // Open the browser print dialog (print styles live in the CSS file).
  const handleExportPdf = () => {
    window.print()
  }

  // Export ONLY the active report, with the same columns and the same filtered
  // rows shown on screen (so the date range, group filter and search all apply).
  const handleExportExcel = () => {
    let rows

    if (activeReport === REPORT_TYPES.GROUPS) {
      rows = [
        ['קבוצה', 'מתנדבים', 'אירועים', 'מפגשי נוכחות', 'נוכחים', 'חסרים'],
        ...filteredGroups.map((group) => [
          group.name,
          group.volunteers,
          group.events,
          group.attendanceMeetings,
          group.present,
          group.absent,
        ]),
      ]
    } else if (activeReport === REPORT_TYPES.ATTENDANCE) {
      rows = [
        ['תאריך', 'קבוצה', 'נוכחים', 'חסרים', 'לא ידוע'],
        ...filteredAttendance.map((attendanceItem) => [
          attendanceItem.date,
          attendanceItem.group,
          attendanceItem.present,
          attendanceItem.absent,
          attendanceItem.unknown,
        ]),
      ]
    } else {
      rows = [
        ['שם אירוע', 'תאריך', 'מיקום', 'קבוצה', 'סטטוס'],
        ...filteredEvents.map((event) => [
          safeText(event.name),
          safeText(event.date),
          safeText(event.location),
          getEventGroup(event),
          safeText(computeEventStatus(event)),
        ]),
      ]
    }

    downloadCsv(rows)
  }

  // Render the events report table.
  const renderEventsReport = () => (
    <div className="reports-table-wrap">
      <table className="reports-table">

        {/* Column headers. */}
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
          {/* A row per event, or an empty-state row. */}
          {filteredEvents.length > 0 ? (
            filteredEvents.map((event) => (
              <tr key={event.id}>
                <td data-label="שם אירוע">{safeText(event.name)}</td>
                <td data-label="תאריך">{safeText(event.date)}</td>
                <td data-label="מיקום">{safeText(event.location)}</td>
                <td data-label="קבוצה">{getEventGroup(event)}</td>
                <td data-label="סטטוס">{safeText(computeEventStatus(event))}</td>
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

  // Render the groups report table.
  const renderGroupsReport = () => (
    <div className="reports-table-wrap">
      <table className="reports-table">

        {/* Column headers. */}
        <thead>
          <tr>
            <th>קבוצה</th>
            <th>מתנדבים</th>
            <th>אירועים</th>
            <th>מפגשי נוכחות</th>
            <th>נוכחים</th>
            <th>חסרים</th>
          </tr>
        </thead>

        <tbody>
          {/* A row per group, or an empty-state row. */}
          {filteredGroups.length > 0 ? (
            filteredGroups.map((group) => (
              <tr key={group.name}>
                <td data-label="קבוצה">{group.name}</td>
                <td data-label="מתנדבים">{group.volunteers}</td>
                <td data-label="אירועים">{group.events}</td>
                <td data-label="מפגשי נוכחות">{group.attendanceMeetings}</td>
                <td data-label="נוכחים">{group.present}</td>
                <td data-label="חסרים">{group.absent}</td>
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

  // Render the attendance report table.
  const renderAttendanceReport = () => (
    <div className="reports-table-wrap">
      <table className="reports-table">

        {/* Column headers. */}
        <thead>
          <tr>
            <th>תאריך</th>
            <th>קבוצה</th>
            <th>נוכחים</th>
            <th>חסרים</th>
            <th>לא ידוע</th>
          </tr>
        </thead>

        <tbody>
          {/* A row per meeting, or an empty-state row. */}
          {filteredAttendance.length > 0 ? (
            filteredAttendance.map((attendanceItem) => (
              <tr key={attendanceItem.id}>
                <td data-label="תאריך">{attendanceItem.date}</td>
                <td data-label="קבוצה">{attendanceItem.group}</td>
                <td data-label="נוכחים">{attendanceItem.present}</td>
                <td data-label="חסרים">{attendanceItem.absent}</td>
                <td data-label="לא ידוע">{attendanceItem.unknown}</td>
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

  // Pick which report table to show based on the active tab.
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

        {/* Error banner listing any collections that failed to load. */}
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

        {/* Report names (tabs) at the top — pick which report to view. */}
        <div className="reports-tabs">
          <button
            type="button"
            className={activeReport === REPORT_TYPES.EVENTS ? 'active' : ''}
            onClick={() => setActiveReport(REPORT_TYPES.EVENTS)}
          >
            דוח אירועים
          </button>

          <button
            type="button"
            className={activeReport === REPORT_TYPES.GROUPS ? 'active' : ''}
            onClick={() => setActiveReport(REPORT_TYPES.GROUPS)}
          >
            דוח קבוצות
          </button>

          <button
            type="button"
            className={activeReport === REPORT_TYPES.ATTENDANCE ? 'active' : ''}
            onClick={() => setActiveReport(REPORT_TYPES.ATTENDANCE)}
          >
            דוח נוכחות
          </button>
        </div>

        {/* Step 3 — export actions: small buttons, aligned to the left. */}
        <div className="reports-actions">
          <button type="button" onClick={handleExportPdf} title="נפתח חלון הדפסה — בחרו 'שמירה כ-PDF'">
            📄 ייצוא PDF
          </button>

          <button type="button" onClick={handleExportExcel}>
            📊 ייצוא Excel
          </button>

          <button type="button" onClick={() => window.print()}>
            🖨️ הדפסה
          </button>
        </div>

        {/* Filters: a date range (a period, or a single day = same from/to)
            plus a free-text search of the current report. */}
        <div className="reports-filterbar">

          {/* From date. */}
          <div className="reports-filter-field">
            <BirthDatePicker
              key={`from-${fromDate || 'empty'}`}
              id="reports-from"
              value={fromDate}
              onChange={setFromDate}
              label="מתאריך"
              pastYears={10}
              futureYears={3}
            />
          </div>

          {/* To date. */}
          <div className="reports-filter-field">
            <BirthDatePicker
              key={`to-${toDate || 'empty'}`}
              id="reports-to"
              value={toDate}
              onChange={setToDate}
              label="עד תאריך"
              pastYears={10}
              futureYears={3}
            />
          </div>

          {/* Group filter — narrows the report to one group. */}
          <div className="reports-filter-field">
            <label htmlFor="reports-group">קבוצה</label>
            <select
              id="reports-group"
              value={groupFilter}
              onChange={(event) => setGroupFilter(event.target.value)}
            >
              <option value="">כל הקבוצות</option>
              {groupRows.map((group) => (
                <option key={group.name} value={group.name}>{group.name}</option>
              ))}
            </select>
          </div>

          {/* Clear button, shown only when a range is set. */}
          {hasDateFilter && (
            <button type="button" className="reports-filter-clear" onClick={clearDateRange}>
              ניקוי טווח
            </button>
          )}

          {/* Search within the current report. */}
          <input
            type="search"
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
            placeholder="חיפוש בדוח הנוכחי"
            className="reports-search"
          />
        </div>

        {/* The active report table (the heading shows on the printed PDF). */}
        <section className="reports-panel">
          <h2 className="reports-print-title">{REPORT_LABELS[activeReport]}</h2>

          {/* Loading message while fetching, otherwise the active report. */}
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
