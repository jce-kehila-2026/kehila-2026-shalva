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

// Static fallback group names (when the live groups list is empty).
import { GROUP_NAMES } from '../../utils/groupOptions';

// Shared display-name helper.
import { getDisplayName } from '../../utils/people';

// Styles for this screen.
import './AttendanceScreen.css';


// A volunteer's display name (this screen's fallback wording).
const getVolunteerName = (volunteer) => getDisplayName(volunteer, 'מתנדב ללא שם');


// Today's day-level key (YYYY-MM-DD) — the same key stored on each attendance
// record, so we can both read today's marks back and write idempotently.
function getTodayKey() {
  const now = new Date();
  return [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
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

  // The selected group's volunteers (each with a local present/absent status).
  const [volunteers, setVolunteers] = useState([]);

  // True while volunteers load; true while a save is in flight.
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  // True once today's already-saved attendance was merged in (edit mode).
  const [loadedExisting, setLoadedExisting] = useState(false);

  // Brief "saved ✓" confirmation flag.
  const [justSaved, setJustSaved] = useState(false);

  // The full group object matching the current selection.
  const selectedGroup = useMemo(() => (
    groups.find((group) => group.id === selectedGroupId || group.groupName === selectedGroupName)
  ), [groups, selectedGroupId, selectedGroupName]);

  // The effective group name to filter volunteers by.
  const activeGroupName = selectedGroup?.groupName || selectedGroup?.name || selectedGroupName;

  // Load the groups (falling back to the static list if none exist).
  const fetchGroups = useCallback(async () => {
    try {
      const snapshot = await getDocs(collection(db, 'groups'));
      const groupsData = snapshot.docs.map((documentSnapshot) => ({
        id: documentSnapshot.id,
        ...documentSnapshot.data(),
      }));

      if (groupsData.length > 0) {
        setGroups(groupsData);
        return;
      }
    } catch (error) {
      console.error('Error loading groups:', error);
    }

    // Fallback: build groups from the static names.
    setGroups(GROUP_NAMES.map((groupName) => ({ id: groupName, groupName })));
  }, []);

  // Load the selected group's volunteers, pre-filled with today's saved marks.
  const fetchVolunteersByGroup = useCallback(async () => {
    // No group chosen: nothing to load.
    if (!selectedGroupId && !activeGroupName) {
      setVolunteers([]);
      setLoadedExisting(false);
      return;
    }

    setLoading(true);

    try {
      const todayKey = getTodayKey();

      // Read the volunteers and today's attendance together.
      const [volunteersSnap, attendanceSnap] = await Promise.all([
        getDocs(collection(db, 'volunteers')),
        getDocs(query(collection(db, 'attendance'), where('dateKey', '==', todayKey))),
      ]);

      // Map volunteerId -> the status already saved today (so we can edit it).
      const savedStatus = new Map();
      attendanceSnap.docs.forEach((documentSnapshot) => {
        const record = documentSnapshot.data();
        if (record.volunteerId !== undefined) {
          savedStatus.set(record.volunteerId, record.status === true);
        }
      });

      // Keep only this group's volunteers; seed each from today's saved status
      // (defaulting to "not present" when there's no record yet).
      const volunteersData = volunteersSnap.docs
        .map((documentSnapshot) => ({ id: documentSnapshot.id, ...documentSnapshot.data() }))
        .filter((volunteer) => (
          volunteer.groupId === selectedGroupId ||
          volunteer.groupName === activeGroupName ||
          volunteer.group === activeGroupName
        ))
        .map((volunteer) => ({
          ...volunteer,
          status: savedStatus.has(volunteer.id) ? savedStatus.get(volunteer.id) : false,
        }));

      // Were any of these volunteers already marked today?
      const anyExisting = volunteersData.some((volunteer) => savedStatus.has(volunteer.id));

      setVolunteers(volunteersData);
      setLoadedExisting(anyExisting);
    } catch (error) {
      console.error('Error loading volunteers:', error);
      alert('אירעה שגיאה בטעינת המתנדבים');
    } finally {
      setLoading(false);
    }
  }, [activeGroupName, selectedGroupId]);

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

  // Flip one volunteer's present/absent status.
  const handleStatusChange = (id) => {
    setVolunteers((previousVolunteers) => (
      previousVolunteers.map((volunteer) => (
        volunteer.id === id ? { ...volunteer, status: !volunteer.status } : volunteer
      ))
    ));
  };

  // Mark everyone present, or clear everyone, in one tap.
  const markAll = (present) => {
    setVolunteers((previousVolunteers) => (
      previousVolunteers.map((volunteer) => ({ ...volunteer, status: present }))
    ));
  };

  // Live counts for the summary bar.
  const presentCount = volunteers.filter((volunteer) => volunteer.status).length;
  const absentCount = volunteers.length - presentCount;

  // Save attendance — one document per volunteer, committed as a single atomic
  // batch. Each document uses a DETERMINISTIC id (group + day + volunteer), so
  // saving the same group again on the same day OVERWRITES the record instead
  // of creating a duplicate.
  const handleSaveAttendance = async () => {
    // A group must be chosen first.
    if (!selectedGroupId && !activeGroupName) {
      alert('יש לבחור קבוצה');
      return;
    }

    const now = new Date();
    const dateKey = getTodayKey();

    // The group part of the id — never empty, and '/' is illegal in doc ids.
    const groupKey = String(selectedGroupId || selectedGroup?.id || activeGroupName || 'group')
      .replace(/\//g, '-');

    setSaving(true);

    try {
      // One batch = all-or-nothing, and no half-saved attendance.
      const batch = writeBatch(db);

      for (const volunteer of volunteers) {
        const volunteerName = getVolunteerName(volunteer);
        const attendanceId = `${groupKey}_${dateKey}_${volunteer.id}`;

        batch.set(doc(db, 'attendance', attendanceId), {
          groupId: selectedGroupId || selectedGroup?.id || '',
          group: activeGroupName,
          groupName: activeGroupName,
          date: now,
          dateKey,
          status: volunteer.status,
          volunteerId: volunteer.id,
          volunteerName,
        });
      }

      await batch.commit();

      // Now there's saved data for today — flash a confirmation.
      setLoadedExisting(true);
      setJustSaved(true);
      window.setTimeout(() => setJustSaved(false), 2500);
    } catch (error) {
      console.error('Error saving attendance:', error);
      alert('אירעה שגיאה בשמירת הנוכחות');
    } finally {
      setSaving(false);
    }
  };

  // Whether a group is selected at all.
  const hasGroup = Boolean(selectedGroupId || activeGroupName);

  return (
    <div className="attendance-page" dir="rtl">
      <div className="attendance-card">

        {/* Header: title + group name, and an optional back button. */}
        <div className="attendance-header-row">
          <div className="attendance-title-block">
            <h1>סימון נוכחות</h1>
            {activeGroupName && <p className="attendance-sub">קבוצת {activeGroupName} · {getTodayLabel()}</p>}
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
            {/* Note that we loaded marks already saved today. */}
            {loadedExisting && (
              <div className="att-loaded-note">
                נטענה הנוכחות שכבר סומנה היום — אפשר לעדכן ולשמור שוב.
              </div>
            )}

            {/* Live summary: present / absent / total. */}
            <div className="att-summary">
              <div className="att-stat att-stat-present">
                <span className="att-stat-num">{presentCount}</span>
                <span className="att-stat-label">נוכחים</span>
              </div>
              <div className="att-stat att-stat-absent">
                <span className="att-stat-num">{absentCount}</span>
                <span className="att-stat-label">לא נוכחים</span>
              </div>
              <div className="att-stat att-stat-total">
                <span className="att-stat-num">{volunteers.length}</span>
                <span className="att-stat-label">סה״כ</span>
              </div>
            </div>

            {/* Quick actions. */}
            <div className="att-quick">
              <button type="button" className="att-quick-btn" onClick={() => markAll(true)}>
                סימון כולם כנוכחים
              </button>
              <button type="button" className="att-quick-btn" onClick={() => markAll(false)}>
                ניקוי הכל
              </button>
            </div>

            {/* The roster — tap a row to toggle present / not present. */}
            <div className="attendance-list">
              {volunteers.map((volunteer) => {
                const name = getVolunteerName(volunteer);

                return (
                  <button
                    type="button"
                    key={volunteer.id}
                    className={`att-row ${volunteer.status ? 'is-present' : 'is-absent'}`}
                    onClick={() => handleStatusChange(volunteer.id)}
                    aria-pressed={volunteer.status}
                  >
                    <span className="att-avatar">{getInitial(name)}</span>
                    <span className="att-name">{name}</span>
                    <span className="att-status-pill">
                      {volunteer.status ? 'נוכח/ת' : 'לא נוכח/ת'}
                    </span>
                  </button>
                );
              })}
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


// Today as a short Hebrew date label (e.g. "8 ביוני").
function getTodayLabel() {
  return new Date().toLocaleDateString('he-IL', { day: 'numeric', month: 'long' });
}


export default AttendanceScreen;
