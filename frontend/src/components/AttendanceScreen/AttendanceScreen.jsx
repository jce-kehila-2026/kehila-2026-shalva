// AttendanceScreen — mark and save attendance for a group's volunteers.
// The group can be chosen from a dropdown, or locked to one group when opened
// from the guide dashboard. Saving writes one document per volunteer.

// React hooks for state, effects, memoization and stable callbacks.
import { useCallback, useEffect, useMemo, useState } from 'react';

// Firestore helpers for reading and adding documents.
import { addDoc, collection, getDocs } from 'firebase/firestore';

// Our Firestore database instance.
import { db } from '../../firebase';

// Static fallback group names (when the live groups list is empty).
import { GROUP_NAMES } from '../../utils/groupOptions';

// Styles for this screen.
import './AttendanceScreen.css';


// Best available display name for a volunteer, with graceful fallbacks.
const getVolunteerName = (volunteer) => (
  volunteer.name ||
  [volunteer.firstName, volunteer.lastName].filter(Boolean).join(' ').trim() ||
  volunteer.email ||
  'מתנדב ללא שם'
);


function AttendanceScreen({ initialGroupId = '', initialGroupName = '', lockGroup = false, onBack }) {
  // The available groups.
  const [groups, setGroups] = useState([]);

  // The currently selected group (id + name).
  const [selectedGroupId, setSelectedGroupId] = useState(initialGroupId);
  const [selectedGroupName, setSelectedGroupName] = useState(initialGroupName);

  // The selected group's volunteers (each with a local present/absent status).
  const [volunteers, setVolunteers] = useState([]);

  // True while volunteers are loading.
  const [loading, setLoading] = useState(false);

  // The full group object matching the current selection.
  const selectedGroup = useMemo(() => (
    groups.find((group) => group.id === selectedGroupId || group.groupName === selectedGroupName)
  ), [groups, selectedGroupId, selectedGroupName]);

  // The effective group name to filter volunteers by.
  const activeGroupName = selectedGroup?.groupName || selectedGroup?.name || selectedGroupName;

  // Load the groups (falling back to the static list if none exist).
  const fetchGroups = useCallback(async () => {
    try {
      // Read the groups collection.
      const snapshot = await getDocs(collection(db, 'groups'));
      const groupsData = snapshot.docs.map((documentSnapshot) => ({
        id: documentSnapshot.id,
        ...documentSnapshot.data(),
      }));

      // Use the live groups if there are any.
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

  // Load the volunteers that belong to the selected group.
  const fetchVolunteersByGroup = useCallback(async () => {
    // No group chosen: nothing to load.
    if (!selectedGroupId && !activeGroupName) {
      setVolunteers([]);
      return;
    }

    setLoading(true);

    try {
      // Read all volunteers.
      const snapshot = await getDocs(collection(db, 'volunteers'));

      // Load all volunteers, default everyone to "not present" (status: false),
      // then keep only those that belong to the selected group.
      const volunteersData = snapshot.docs
        .map((documentSnapshot) => ({
          id: documentSnapshot.id,
          ...documentSnapshot.data(),
          status: false,
        }))
        .filter((volunteer) => (
          volunteer.groupId === selectedGroupId ||
          volunteer.groupName === activeGroupName ||
          volunteer.group === activeGroupName
        ));

      setVolunteers(volunteersData);
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

  // Save one attendance document per volunteer.
  const handleSaveAttendance = async () => {
    // A group must be chosen first.
    if (!selectedGroupId && !activeGroupName) {
      alert('יש לבחור קבוצה');
      return;
    }

    try {
      // Write a record for each volunteer.
      for (const volunteer of volunteers) {
        const volunteerName = getVolunteerName(volunteer);

        await addDoc(collection(db, 'attendance'), {
          groupId: selectedGroupId || selectedGroup?.id || '',
          group: activeGroupName,
          groupName: activeGroupName,
          date: new Date(),
          status: volunteer.status,
          volunteerId: volunteer.id,
          volunteerName,
        });
      }

      alert('הנוכחות נשמרה בהצלחה!');
    } catch (error) {
      console.error('Error saving attendance:', error);
      alert('אירעה שגיאה בשמירת הנוכחות');
    }
  };

  return (
    <div className="attendance-page" dir="rtl">
      <div className="attendance-card">

        {/* Header: title/description + optional back button. */}
        <div className="attendance-header-row">
          <div>
            <h1>סימון נוכחות</h1>
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
          <select value={selectedGroupId} onChange={handleGroupChange}>
            <option value="">בחר קבוצה</option>
            {groups.map((group) => (
              <option key={group.id} value={group.id}>{group.groupName || group.name || group.id}</option>
            ))}
          </select>
        )}

        {/* Loading message while volunteers load. */}
        {loading && <p>טוען מתנדבים...</p>}

        {/* Empty message when a group is chosen but has no volunteers. */}
        {!loading && (selectedGroupId || activeGroupName) && volunteers.length === 0 && (
          <p>לא נמצאו מתנדבים בקבוצה זו.</p>
        )}

        {/* The list of volunteers with a "present" checkbox each. */}
        {!loading && volunteers.length > 0 && (
          <div className="attendance-list">
            {volunteers.map((volunteer) => (
              <div className="attendance-row" key={volunteer.id}>
                <span>{getVolunteerName(volunteer)}</span>

                <label>
                  <input
                    type="checkbox"
                    checked={volunteer.status}
                    onChange={() => handleStatusChange(volunteer.id)}
                  />
                  הגיע/ה
                </label>
              </div>
            ))}
          </div>
        )}

        {/* Save button (disabled until a group with volunteers is chosen). */}
        <button
          onClick={handleSaveAttendance}
          disabled={(!selectedGroupId && !activeGroupName) || volunteers.length === 0}
        >
          שמירת נוכחות
        </button>
      </div>
    </div>
  );
}

export default AttendanceScreen;
