import { useCallback, useEffect, useMemo, useState } from 'react';
import { addDoc, collection, getDocs } from 'firebase/firestore';

import { db } from '../firebase';
import { GROUP_NAMES } from './groupOptions';
import './AttendanceScreen.css';

function AttendanceScreen({ initialGroupId = '', initialGroupName = '', lockGroup = false, onBack }) {
  const [groups, setGroups] = useState([]);
  const [selectedGroupId, setSelectedGroupId] = useState(initialGroupId);
  const [selectedGroupName, setSelectedGroupName] = useState(initialGroupName);
  const [volunteers, setVolunteers] = useState([]);
  const [loading, setLoading] = useState(false);

  const selectedGroup = useMemo(() => (
    groups.find((group) => group.id === selectedGroupId || group.groupName === selectedGroupName)
  ), [groups, selectedGroupId, selectedGroupName]);

  const activeGroupName = selectedGroup?.groupName || selectedGroup?.name || selectedGroupName;

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

    setGroups(GROUP_NAMES.map((groupName) => ({ id: groupName, groupName })));
  }, []);

  const fetchVolunteersByGroup = useCallback(async () => {
    if (!selectedGroupId && !activeGroupName) {
      setVolunteers([]);
      return;
    }

    setLoading(true);

    try {
      const snapshot = await getDocs(collection(db, 'volunteers'));
      const volunteersData = snapshot.docs
        .map((documentSnapshot) => ({ id: documentSnapshot.id, ...documentSnapshot.data(), status: false }))
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

  useEffect(() => {
    fetchGroups();
  }, [fetchGroups]);

  useEffect(() => {
    fetchVolunteersByGroup();
  }, [fetchVolunteersByGroup]);

  const handleGroupChange = (event) => {
    const groupId = event.target.value;
    const group = groups.find((item) => item.id === groupId);

    setSelectedGroupId(groupId);
    setSelectedGroupName(group?.groupName || group?.name || groupId);
  };

  const handleStatusChange = (id) => {
    setVolunteers((previousVolunteers) => (
      previousVolunteers.map((volunteer) => (
        volunteer.id === id ? { ...volunteer, status: !volunteer.status } : volunteer
      ))
    ));
  };

  const handleSaveAttendance = async () => {
    if (!selectedGroupId && !activeGroupName) {
      alert('יש לבחור קבוצה');
      return;
    }

    try {
      for (const volunteer of volunteers) {
        const volunteerName = volunteer.name || [volunteer.firstName, volunteer.lastName].filter(Boolean).join(' ').trim();

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
        <div className="attendance-header-row">
          <div>
            <h1>סימון נוכחות</h1>
            <p>בחרו קבוצה וסמנו נוכחות למתנדבים.</p>
          </div>
          {typeof onBack === 'function' && (
            <button className="attendance-back-button" onClick={onBack}>חזרה</button>
          )}
        </div>

        {lockGroup ? (
          <div className="locked-group-box">קבוצה: <strong>{activeGroupName || 'לא שויכה קבוצה'}</strong></div>
        ) : (
          <select value={selectedGroupId} onChange={handleGroupChange}>
            <option value="">בחר קבוצה</option>
            {groups.map((group) => (
              <option key={group.id} value={group.id}>{group.groupName || group.name || group.id}</option>
            ))}
          </select>
        )}

        {loading && <p>טוען מתנדבים...</p>}

        {!loading && (selectedGroupId || activeGroupName) && volunteers.length === 0 && (
          <p>לא נמצאו מתנדבים בקבוצה זו.</p>
        )}

        {!loading && volunteers.length > 0 && (
          <div className="attendance-list">
            {volunteers.map((volunteer) => (
              <div className="attendance-row" key={volunteer.id}>
                <span>{volunteer.name || [volunteer.firstName, volunteer.lastName].filter(Boolean).join(' ').trim() || volunteer.email || 'מתנדב ללא שם'}</span>

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

        <button onClick={handleSaveAttendance} disabled={(!selectedGroupId && !activeGroupName) || volunteers.length === 0}>שמירת נוכחות</button>
      </div>
    </div>
  );
}

export default AttendanceScreen;
