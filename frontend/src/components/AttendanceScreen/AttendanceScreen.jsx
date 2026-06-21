// AttendanceScreen — mark and save TODAY'S attendance for a group's volunteers.
// The group can be chosen from a dropdown, or locked to one group when opened
// from the guide dashboard. Only the current day is shown and editable —
// previous days are never displayed, so a guide cannot change past records.

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


// Map a stored attendance record to one of the three UI states.
function getStateFromRecord(record) {
  // No record at all means the volunteer was never marked today.
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


// Format a Date object to YYYY-MM-DD (the day-level key stored on each record).
function getDayKey(date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
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

  // Today's already-saved attendance records (at most one per volunteer).
  const [attendanceRecords, setAttendanceRecords] = useState([]);

  // The current marking choice per volunteer: 'present' | 'absent' | 'unmarked'.
  const [marks, setMarks] = useState({});
  const [hasEditedMarks, setHasEditedMarks] = useState(false);
  const [touchedVolunteerIds, setTouchedVolunteerIds] = useState({});

  // True while volunteers load; true while a save is in flight.
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  // Brief "saved" confirmation flag.
  const [justSaved, setJustSaved] = useState(false);

  // Today, fixed for the lifetime of this screen.
  const today = useMemo(() => new Date(), []);
  const todayKey = useMemo(() => getDayKey(today), [today]);

  // Today written out in Hebrew, e.g. "יום ראשון, 14 ביוני 2026".
  const todayLabel = useMemo(() => (
    today.toLocaleDateString('he-IL', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    })
  ), [today]);

  // The full group object matching the current selection.
  const selectedGroup = useMemo(() => (
    groups.find((group) => group.id === selectedGroupId || group.groupName === selectedGroupName)
  ), [groups, selectedGroupId, selectedGroupName]);

  // The effective group name to filter volunteers by.
  const activeGroupName = selectedGroup?.groupName || selectedGroup?.name || selectedGroupName;

  // Load the live groups list.
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

  // Load the selected group's volunteers, pre-filled with today's saved marks.
  const fetchVolunteersByGroup = useCallback(async () => {
    // No group chosen: nothing to load.
    if (!selectedGroupId && !activeGroupName) {
      setVolunteers([]);
      setAttendanceRecords([]);
      return;
    }

    setLoading(true);

    try {
      // Fetch volunteers and today's attendance in parallel.
      const [volunteersSnap, attendanceSnap] = await Promise.all([
        getDocs(collection(db, 'volunteers')),
        getDocs(query(collection(db, 'attendance'), where('dateKey', '==', todayKey))),
      ]);

      const HEBREW_WEEKDAYS = [
        'יום ראשון',
        'יום שני',
        'יום שלישי',
        'יום רביעי',
        'יום חמישי',
        'יום שישי',
        'יום שבת'
      ];
      const todayHebrewDay = HEBREW_WEEKDAYS[today.getDay()];

      // All volunteers matching the active group filter and scheduled for today.
      const volunteersData = volunteersSnap.docs
        .map((documentSnapshot) => ({ id: documentSnapshot.id, ...documentSnapshot.data() }))
        .filter((volunteer) => (
          volunteer.groupId === selectedGroupId ||
          volunteer.groupName === activeGroupName ||
          volunteer.group === activeGroupName
        ))
        .filter((volunteer) => {
          if (volunteer.day && volunteer.day.trim() !== '') {
            return volunteer.day.trim() === todayHebrewDay;
          }
          return true;
        });

      // Today's attendance records for this group.
      const attendanceData = attendanceSnap.docs
        .map((documentSnapshot) => ({ id: documentSnapshot.id, ...documentSnapshot.data() }))
        .filter((record) => (
          record.groupId === selectedGroupId ||
          record.groupName === activeGroupName ||
          record.group === activeGroupName
        ));

      setVolunteers(volunteersData);
      setAttendanceRecords(attendanceData);
    } catch (error) {
      console.error('Error loading volunteers and attendance:', error);
      alert('אירעה שגיאה בטעינת הנתונים');
    } finally {
      setLoading(false);
    }
  }, [activeGroupName, selectedGroupId, todayKey]);

  // Load the groups once on mount.
  useEffect(() => {
    fetchGroups();
  }, [fetchGroups]);

  // Reload volunteers whenever the selected group changes.
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

  // volunteerId -> today's saved record (keeping the latest if duplicates exist).
  const savedByVolunteer = useMemo(() => {
    const map = {};

    attendanceRecords.forEach((record) => {
      const volunteerId = record.volunteerId;
      if (!volunteerId) {
        return;
      }

      // Keep the most recent record if somehow more than one exists.
      const current = map[volunteerId];
      const recordTime = record.date?.toDate?.()?.getTime() || new Date(record.date).getTime() || 0;
      const currentTime = current?.date?.toDate?.()?.getTime() || new Date(current?.date).getTime() || 0;

      if (!current || recordTime > currentTime) {
        map[volunteerId] = record;
      }
    });

    return map;
  }, [attendanceRecords]);

  // Start each attendance session empty so the guide actively fills today's marks.
  useEffect(() => {
    const initial = {};
    volunteers.forEach((volunteer) => {
      initial[volunteer.id] = 'unmarked';
    });
    setMarks(initial);
    setHasEditedMarks(false);
    setTouchedVolunteerIds({});
  }, [volunteers]);

  // Toggle a volunteer's status; clicking the active one clears it.
  const handleStatusSelect = (volunteerId, statusType) => {
    setHasEditedMarks(true);
    setTouchedVolunteerIds((prev) => ({ ...prev, [volunteerId]: true }));
    setMarks((prev) => {
      const current = prev[volunteerId] || 'unmarked';
      const next = current === statusType ? 'unmarked' : statusType;
      return { ...prev, [volunteerId]: next };
    });
  };

  const handleMarkAllPresent = () => {
    setHasEditedMarks(true);
    const touched = {};
    volunteers.forEach((volunteer) => {
      touched[volunteer.id] = true;
    });
    setTouchedVolunteerIds(touched);
    setMarks((prev) => {
      const next = { ...prev };
      volunteers.forEach((volunteer) => {
        next[volunteer.id] = 'present';
      });
      return next;
    });
  };

  // Live counts for the summary bar.
  let presentCount = 0;
  let absentCount = 0;
  let unmarkedCount = 0;
  volunteers.forEach((volunteer) => {
    const state = marks[volunteer.id] || 'unmarked';
    if (state === 'present') {
      presentCount++;
    } else if (state === 'absent') {
      absentCount++;
    } else {
      unmarkedCount++;
    }
  });
  const allMarkedPresent = volunteers.length > 0 && presentCount === volunteers.length;

  // Save today's marks — only writing volunteers whose choice changed.
  const handleSaveAttendance = async () => {
    if (!selectedGroupId && !activeGroupName) {
      alert('יש לבחור קבוצה');
      return;
    }

    if (!hasEditedMarks) {
      alert('יש לסמן נוכחות לפני שמירה');
      return;
    }

    // A filesystem-safe id segment for the group.
    const groupKey = String(selectedGroupId || selectedGroup?.id || activeGroupName || 'group')
      .replace(/\//g, '-');

    setSaving(true);

    try {
      const batch = writeBatch(db);
      let writeCount = 0;

      for (const volunteer of volunteers) {
        if (!touchedVolunteerIds[volunteer.id]) {
          continue;
        }

        const state = marks[volunteer.id] || 'unmarked';

        // Compare against what was loaded so untouched volunteers are skipped.
        const initialState = getStateFromRecord(savedByVolunteer[volunteer.id]);
        if (state === initialState) {
          continue;
        }

        // Deterministic id keeps one record per volunteer per day.
        const attendanceId = `${groupKey}_${todayKey}_${volunteer.id}`;

        if (state === 'unmarked') {
          // Clearing a mark removes the record entirely.
          batch.delete(doc(db, 'attendance', attendanceId));
        } else {
          batch.set(doc(db, 'attendance', attendanceId), {
            groupId: selectedGroupId || selectedGroup?.id || '',
            group: activeGroupName,
            groupName: activeGroupName,
            date: new Date(),
            dateKey: todayKey,
            status: state === 'present',
            volunteerId: volunteer.id,
            volunteerName: getVolunteerName(volunteer),
          });
        }

        writeCount++;
      }

      if (writeCount > 0) {
        await batch.commit();
        await fetchVolunteersByGroup();
      }

      setJustSaved(true);
      window.setTimeout(() => setJustSaved(false), 2500);
      setHasEditedMarks(false);
      setTouchedVolunteerIds({});
    } catch (error) {
      console.error('Error saving attendance:', error);
      alert(`אירעה שגיאה בשמירת הנוכחות: ${error.code || ''} ${error.message || error}`);
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

        {/* Group picker: guides are already locked to the group shown above. */}
        {lockGroup ? (
          !activeGroupName && (
            <div className="locked-group-box">
              קבוצה: <strong>לא שויכה קבוצה</strong>
            </div>
          )
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
            {/* Today banner — the only day this screen marks. */}
            <div className="att-today-banner">
              <span className="att-today-eyebrow">סימון נוכחות להיום</span>
              <span className="att-today-date">{todayLabel}</span>
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

            <div className="att-bulk-actions">
              <button
                type="button"
                className="att-mark-all-present"
                onClick={handleMarkAllPresent}
                disabled={allMarkedPresent}
              >
                {allMarkedPresent ? 'כולם סומנו כנוכחים' : 'סמן את כולם כנוכחים'}
              </button>
            </div>

            {/* One row per volunteer: name on the right, present / absent toggles. */}
            <ul className="att-list">
              {volunteers.map((volunteer) => {
                const name = getVolunteerName(volunteer);
                const status = marks[volunteer.id] || 'unmarked';

                return (
                  <li key={volunteer.id} className={`att-row att-row--${status}`}>
                    <div className="volunteer-name-cell">
                      <span className="att-avatar">{getInitial(name)}</span>
                      <span className="volunteer-name">{name}</span>
                    </div>

                    <div className="att-cell-actions">
                      {/* Present — the check mark is drawn in CSS (see stylesheet). */}
                      <button
                        type="button"
                        className={`att-action-toggle present ${status === 'present' ? 'is-active' : ''}`}
                        onClick={() => handleStatusSelect(volunteer.id, 'present')}
                        aria-pressed={status === 'present'}
                        aria-label={`סמן ${name} כנוכח`}
                        title="נוכח"
                      />

                      {/* Absent — the X is drawn in CSS (see stylesheet). */}
                      <button
                        type="button"
                        className={`att-action-toggle absent ${status === 'absent' ? 'is-active' : ''}`}
                        onClick={() => handleStatusSelect(volunteer.id, 'absent')}
                        aria-pressed={status === 'absent'}
                        aria-label={`סמן ${name} כחסר`}
                        title="חסר"
                      />
                    </div>
                  </li>
                );
              })}
            </ul>

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
