// AttendanceScreen — mark and save attendance for a group's volunteers.
// The group can be chosen from a dropdown, or locked to one group when opened
// from the guide dashboard. It loads any attendance already saved TODAY so the
// guide can review who was marked and toggle / un-toggle before saving again.

// React hooks for state, effects, memoization and stable callbacks.
import { useCallback, useEffect, useMemo, useState } from 'react';

// Firestore helpers. A batch keeps the save atomic + deterministic ids avoid
// duplicate records; a query reads back today's already-saved attendance.
import { collection, doc, getDocs, query, where, writeBatch } from 'firebase/firestore';

// Our Firestore database instance.
import { db } from '../../firebase';

// Shared display-name helper.
import { getDisplayName } from '../../utils/people';

// Shared attendance normalization (handles old Hebrew/string statuses too).
import { normalizeAttendanceStatus, getRecordStatus } from '../../utils/attendance';

// Styles for this screen.
import './AttendanceScreen.css';


// A volunteer's display name (this screen's fallback wording).
const getVolunteerName = (volunteer) => getDisplayName(volunteer, 'מתנדב ללא שם');


// Map a stored attendance record to the grid's three UI states.
function getGridStateFromRecord(record) {
  // No record at all means the day was never marked.
  if (!record) {
    return 'unmarked';
  }

  // Normalize boolean / Hebrew / English statuses the same way everywhere.
  const normalized = normalizeAttendanceStatus(getRecordStatus(record));

  if (normalized === 'present') {
    return 'present';
  }

  if (normalized === 'absent') {
    return 'absent';
  }

  return 'unmarked';
}


// Start of the week (Sunday) containing a given date.
function getStartOfWeek(date) {
  const d = new Date(date);
  const day = d.getDay(); // 0 is Sunday, 1 is Monday, etc.
  d.setDate(d.getDate() - day);
  d.setHours(0, 0, 0, 0);
  return d;
}


// Generate the 7 days of the week starting from a given Sunday.
function getWeekDays(sunday) {
  const days = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(sunday);
    d.setDate(sunday.getDate() + i);
    days.push(d);
  }
  return days;
}


// Format a Date object to YYYY-MM-DD.
function getDayKey(date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
}


// Today's day-level key.
function getTodayKey() {
  return getDayKey(new Date());
}


// Formats a Sunday date into a Hebrew range string (e.g. "7 ביוני – 13 ביוני 2026").
function getWeekRangeLabel(sunday) {
  const saturday = new Date(sunday);
  saturday.setDate(sunday.getDate() + 6);
  
  const options = { day: 'numeric', month: 'long' };
  const sunLabel = sunday.toLocaleDateString('he-IL', options);
  const satLabel = saturday.toLocaleDateString('he-IL', options);
  const year = sunday.getFullYear();
  
  return `${sunLabel} – ${satLabel} ${year}`;
}


// First character of a name, used for the round avatar.
function getInitial(name) {
  const trimmed = (name || '').trim();
  return trimmed ? trimmed[0] : '?';
}


function AttendanceScreen({ initialGroupId = '', initialGroupName = '', lockGroup = false, onBack }) {
  // The available groups.
  const [groups, setGroups] = useState([]);

  // The currently selected group (id + name).
  const [selectedGroupId, setSelectedGroupId] = useState(initialGroupId);
  const [selectedGroupName, setSelectedGroupName] = useState(initialGroupName);

  // The selected group's volunteers.
  const [volunteers, setVolunteers] = useState([]);

  // The selected group's attendance records for the active week.
  const [attendanceRecords, setAttendanceRecords] = useState([]);

  // The active week's Sunday.
  const [currentWeekStart, setCurrentWeekStart] = useState(() => getStartOfWeek(new Date()));

  // The current UI checkbox state per volunteer and day.
  const [gridState, setGridState] = useState({});

  // True while volunteers load; true while a save is in flight.
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  // Brief "saved ✓" confirmation flag.
  const [justSaved, setJustSaved] = useState(false);

  // The full group object matching the current selection.
  const selectedGroup = useMemo(() => (
    groups.find((group) => group.id === selectedGroupId || group.groupName === selectedGroupName)
  ), [groups, selectedGroupId, selectedGroupName]);

  // The effective group name to filter volunteers by.
  const activeGroupName = selectedGroup?.groupName || selectedGroup?.name || selectedGroupName;

  const weekDays = useMemo(() => getWeekDays(currentWeekStart), [currentWeekStart]);
  const weekDaysKeys = useMemo(() => weekDays.map(getDayKey), [weekDays]);

  // Load the groups (falling back to the static list if none exist).
  const fetchGroups = useCallback(async () => {
    try {
      const snapshot = await getDocs(collection(db, 'groups'));
      const groupsData = snapshot.docs.map((documentSnapshot) => ({
        id: documentSnapshot.id,
        ...documentSnapshot.data(),
      }));

      // Live groups only — the picker always mirrors the real system.
      setGroups(groupsData);
    } catch (error) {
      console.error('Error loading groups:', error);
    }
  }, []);

  // Load the selected group's volunteers, pre-filled with the week's saved marks.
  const fetchVolunteersByGroup = useCallback(async () => {
    // No group chosen: nothing to load.
    if (!selectedGroupId && !activeGroupName) {
      setVolunteers([]);
      setAttendanceRecords([]);
      return;
    }

    setLoading(true);

    try {
      // Fetch volunteers and the week's attendance in parallel.
      const [volunteersSnap, attendanceSnap] = await Promise.all([
        getDocs(collection(db, 'volunteers')),
        getDocs(query(collection(db, 'attendance'), where('dateKey', 'in', weekDaysKeys))),
      ]);

      // All volunteers matching active group filter.
      const volunteersData = volunteersSnap.docs
        .map((documentSnapshot) => ({ id: documentSnapshot.id, ...documentSnapshot.data() }))
        .filter((volunteer) => (
          volunteer.groupId === selectedGroupId ||
          volunteer.groupName === activeGroupName ||
          volunteer.group === activeGroupName
        ));

      // Attendance records for this week and group.
      const groupName = activeGroupName;
      const attendanceData = attendanceSnap.docs
        .map((doc) => ({ id: doc.id, ...doc.data() }))
        .filter((rec) => (
          rec.groupId === selectedGroupId ||
          rec.groupName === groupName ||
          rec.group === groupName
        ));

      setVolunteers(volunteersData);
      setAttendanceRecords(attendanceData);
    } catch (error) {
      console.error('Error loading volunteers and attendance:', error);
      alert('אירעה שגיאה בטעינת הנתונים');
    } finally {
      setLoading(false);
    }
  }, [activeGroupName, selectedGroupId, weekDaysKeys]);

  // Load the groups once on mount.
  useEffect(() => {
    fetchGroups();
  }, [fetchGroups]);

  // Reload volunteers whenever the selected group or week changes.
  useEffect(() => {
    fetchVolunteersByGroup();
  }, [fetchVolunteersByGroup]);

  // Update the selection when the dropdown changes.
  const handleGroupChange = (event) => {
    const groupId = event.target.value;
    const group = groups.find((item) => item.id === groupId);

    setSelectedGroupId(groupId);
    setSelectedGroupName(group?.groupName || group?.name || groupId);
  };

  // Map volunteerId -> dayKey -> attendanceRecord
  const initialAttendance = useMemo(() => {
    const map = {};
    volunteers.forEach((v) => {
      map[v.id] = {};
    });

    attendanceRecords.forEach((rec) => {
      const vId = rec.volunteerId;
      const dKey = rec.dateKey;
      if (!vId || !dKey || !map[vId]) return;

      // Keep the latest one if duplicates exist
      const currentLatest = map[vId][dKey];
      const recTime = rec.date?.toDate?.()?.getTime() || new Date(rec.date).getTime() || 0;
      const curTime = currentLatest?.date?.toDate?.()?.getTime() || new Date(currentLatest?.date).getTime() || 0;

      if (!currentLatest || recTime > curTime) {
        map[vId][dKey] = rec;
      }
    });

    return map;
  }, [attendanceRecords, volunteers]);

  // Reset gridState whenever the initial database records or roster changes
  useEffect(() => {
    const initialGrid = {};
    volunteers.forEach((v) => {
      initialGrid[v.id] = {};
      weekDaysKeys.forEach((dKey) => {
        const rec = initialAttendance[v.id]?.[dKey];

        // One shared mapping for booleans and older string statuses.
        initialGrid[v.id][dKey] = getGridStateFromRecord(rec);
      });
    });
    setGridState(initialGrid);
  }, [initialAttendance, weekDaysKeys, volunteers]);

  const handleStatusSelect = (volunteerId, dKey, statusType) => {
    setGridState((prev) => {
      const current = prev[volunteerId]?.[dKey] || 'unmarked';
      const next = current === statusType ? 'unmarked' : statusType;
      return {
        ...prev,
        [volunteerId]: {
          ...prev[volunteerId],
          [dKey]: next,
        },
      };
    });
  };

  const goToPrevWeek = () => {
    setCurrentWeekStart((prev) => {
      const d = new Date(prev);
      d.setDate(prev.getDate() - 7);
      return d;
    });
  };

  const goToNextWeek = () => {
    setCurrentWeekStart((prev) => {
      const d = new Date(prev);
      d.setDate(prev.getDate() + 7);
      return d;
    });
  };

  const goToCurrentWeek = () => {
    setCurrentWeekStart(getStartOfWeek(new Date()));
  };

  // Live counts for the weekly summary bar.
  let presentCount = 0;
  let absentCount = 0;
  let unmarkedCount = 0;
  volunteers.forEach((v) => {
    weekDaysKeys.forEach((dKey) => {
      const state = gridState[v.id]?.[dKey] || 'unmarked';
      if (state === 'present') {
        presentCount++;
      } else if (state === 'absent') {
        absentCount++;
      } else {
        unmarkedCount++;
      }
    });
  });

  // Save attendance — save/update records for modified days only.
  const handleSaveAttendance = async () => {
    if (!selectedGroupId && !activeGroupName) {
      alert('יש לבחור קבוצה');
      return;
    }

    const now = new Date();
    const groupKey = String(selectedGroupId || selectedGroup?.id || activeGroupName || 'group')
      .replace(/\//g, '-');

    setSaving(true);

    // Find which days have changes
    const modifiedDays = new Set();
    weekDays.forEach((day) => {
      const dKey = getDayKey(day);
      const dayChanged = volunteers.some((v) => {
        const currentVal = gridState[v.id]?.[dKey] || 'unmarked';

        // Compare against the same mapping the grid was loaded with, so
        // untouched days are never flagged as modified.
        const initialVal = getGridStateFromRecord(initialAttendance[v.id]?.[dKey]);

        return currentVal !== initialVal;
      });
      if (dayChanged) {
        modifiedDays.add(dKey);
      }
    });

    try {
      const batch = writeBatch(db);
      let writeCount = 0;

      for (const day of weekDays) {
        const dKey = getDayKey(day);
        if (!modifiedDays.has(dKey)) continue;

        const targetDate = new Date(day);
        targetDate.setHours(now.getHours(), now.getMinutes(), now.getSeconds(), now.getMilliseconds());

        for (const volunteer of volunteers) {
          const volunteerName = getVolunteerName(volunteer);
          const attendanceId = `${groupKey}_${dKey}_${volunteer.id}`;
          const state = gridState[volunteer.id]?.[dKey] || 'unmarked';

          if (state === 'unmarked') {
            batch.delete(doc(db, 'attendance', attendanceId));
          } else {
            batch.set(doc(db, 'attendance', attendanceId), {
              groupId: selectedGroupId || selectedGroup?.id || '',
              group: activeGroupName,
              groupName: activeGroupName,
              date: targetDate,
              dateKey: dKey,
              status: state === 'present',
              volunteerId: volunteer.id,
              volunteerName,
            });
          }
          writeCount++;
        }
      }

      if (writeCount > 0) {
        await batch.commit();
        await fetchVolunteersByGroup();
      }

      setJustSaved(true);
      window.setTimeout(() => setJustSaved(false), 2500);
    } catch (error) {
      console.error('Error saving attendance:', error);
      alert('אירעה שגיאה בשמירת הנוכחות');
    } finally {
      setSaving(false);
    }
  };

  const hasGroup = Boolean(selectedGroupId || activeGroupName);

  return (
    <div className="attendance-page" dir="rtl">
      <div className="attendance-card">

        {/* Header: title + group name, and an optional back button. */}
        <div className="attendance-header-row">
          <div className="attendance-title-block">
            <h1>סימון נוכחות</h1>
            {activeGroupName && <p className="attendance-sub">קבוצת {activeGroupName}</p>}
          </div>
          {typeof onBack === 'function' && (
            <button className="attendance-back-button" onClick={onBack}>חזרה</button>
          )}
        </div>

        {/* Group: a read-only box when locked, otherwise a dropdown. */}
        {lockGroup ? (
          <div className="locked-group-box">
            קבוצה: <strong>{activeGroupName || 'לא שויכה קבוצה'}</strong>
          </div>
        ) : (
          <select className="att-select" value={selectedGroupId} onChange={handleGroupChange}>
            <option value="">בחר קבוצה</option>
            {groups.map((group) => (
              <option key={group.id} value={group.id}>{group.groupName || group.name || group.id}</option>
            ))}
          </select>
        )}

        {/* Loading / empty states. */}
        {loading && <p className="att-note">טוען מתנדבים...</p>}

        {!loading && hasGroup && volunteers.length === 0 && (
          <p className="att-note">לא נמצאו מתנדבים בקבוצה זו.</p>
        )}

        {/* The marking UI, once a group with volunteers is loaded. */}
        {!loading && volunteers.length > 0 && (
          <>
            {/* Week Navigation */}
            <div className="week-nav">
              <button type="button" className="week-nav-btn" onClick={goToNextWeek}>
                שבוע הבא ◀
              </button>
              <span className="week-label">{getWeekRangeLabel(currentWeekStart)}</span>
              <button type="button" className="week-nav-today-btn" onClick={goToCurrentWeek}>
                השבוע הנוכחי
              </button>
              <button type="button" className="week-nav-btn" onClick={goToPrevWeek}>
                ▶ שבוע קודם
              </button>
            </div>

            {/* Live summary: present / absent / unmarked. */}
            <div className="att-summary">
              <div className="att-stat att-stat-present">
                <span className="att-stat-num">{presentCount}</span>
                <span className="att-stat-label">נוכחים</span>
              </div>
              <div className="att-stat att-stat-absent">
                <span className="att-stat-num">{absentCount}</span>
                <span className="att-stat-label">חסרים</span>
              </div>
              <div className="att-stat att-stat-unmarked">
                <span className="att-stat-num">{unmarkedCount}</span>
                <span className="att-stat-label">לא סומנו</span>
              </div>
            </div>

            {/* The weekly table container */}
            <div className="attendance-table-container">
              <table className="attendance-table">
                <thead>
                  <tr>
                    <th className="sticky-col">שם המתנדב</th>
                    {weekDays.map((day) => {
                      const dKey = getDayKey(day);
                      const isToday = dKey === getTodayKey();
                      const dayName = day.toLocaleDateString('he-IL', { weekday: 'long' }).replace('יום ', '');
                      const dateStr = day.toLocaleDateString('he-IL', { day: 'numeric', month: 'numeric' });
                      
                      return (
                        <th key={dKey} className={isToday ? 'is-today' : ''}>
                          <div className="th-content">
                            <span className="day-name">{dayName}</span>
                            <span className="day-date">{dateStr}</span>
                          </div>
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {volunteers.map((volunteer) => {
                    const name = getVolunteerName(volunteer);
                    return (
                      <tr key={volunteer.id}>
                        <td className="sticky-col">
                          <div className="volunteer-name-cell">
                            <span className="att-avatar">{getInitial(name)}</span>
                            <span className="volunteer-name">{name}</span>
                          </div>
                        </td>
                        {weekDays.map((day) => {
                          const dKey = getDayKey(day);
                          const status = gridState[volunteer.id]?.[dKey] || 'unmarked';
                          const isToday = dKey === getTodayKey();
                          return (
                            <td key={dKey} className={`attendance-cell ${isToday ? 'is-today' : ''}`}>
                              <div className="att-cell-actions">
                                <button
                                  type="button"
                                  className={`att-action-toggle present ${status === 'present' ? 'is-active' : ''}`}
                                  onClick={() => handleStatusSelect(volunteer.id, dKey, 'present')}
                                  aria-pressed={status === 'present'}
                                  aria-label={`סמן ${name} כנוכח`}
                                  title="נוכח"
                                >
                                  ✓
                                </button>
                                <button
                                  type="button"
                                  className={`att-action-toggle absent ${status === 'absent' ? 'is-active' : ''}`}
                                  onClick={() => handleStatusSelect(volunteer.id, dKey, 'absent')}
                                  aria-pressed={status === 'absent'}
                                  aria-label={`סמן ${name} כחסר`}
                                  title="חסר"
                                >
                                  ✗
                                </button>
                              </div>
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Save. */}
            <button className="att-save" onClick={handleSaveAttendance} disabled={saving}>
              {saving ? 'שומר...' : justSaved ? 'נשמרה הנוכחות' : 'שמירת נוכחות'}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

export default AttendanceScreen;
