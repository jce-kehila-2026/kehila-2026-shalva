// GroupDetails — read-only overview of a single group: the assigned guide,
// the group's volunteers, and placeholders for attendance and events.

// React hooks for state and side effects.
import { useEffect, useState } from 'react';

// Firestore helpers for reading single docs and collections.
import { collection, doc, getDoc, getDocs } from 'firebase/firestore';

// Our Firestore database instance.
import { db } from '../../firebase';

// Shared display-name helper.
import { getDisplayName } from '../../utils/people';

// Shares the group management styles.
import './GroupManagement.css';


// A person's display name (this screen's fallback wording).
const getPersonName = (person) => getDisplayName(person, 'לא הוזן שם');


const GroupDetails = ({ groupId, onBack }) => {
  // True while the group's data loads.
  const [loading, setLoading] = useState(true);

  // The group, its guide, and its volunteers.
  const [group, setGroup] = useState(null);
  const [guide, setGuide] = useState(null);
  const [volunteers, setVolunteers] = useState([]);

  // Load everything for the given group whenever the id changes.
  useEffect(() => {
    const fetchAllGroupData = async () => {
      // No group id: nothing to load.
      if (!groupId) {
        setGroup(null);
        setLoading(false);
        return;
      }

      setLoading(true);

      try {
        // Read the group document.
        const groupRef = doc(db, 'groups', groupId);
        const groupSnap = await getDoc(groupRef);

        // Bail out if the group doesn't exist.
        if (!groupSnap.exists()) {
          console.error('קבוצה לא נמצאה');
          setGroup(null);
          return;
        }

        // Store the group and remember its name for matching volunteers.
        const groupData = { id: groupSnap.id, ...groupSnap.data() };
        const groupName = groupData.groupName || groupData.name || '';
        setGroup(groupData);

        // Load the assigned guide (merging the guides + users records).
        if (groupData.guideId) {
          const [guideSnap, guideUserSnap] = await Promise.all([
            getDoc(doc(db, 'guides', groupData.guideId)),
            getDoc(doc(db, 'users', groupData.guideId)),
          ]);

          setGuide({
            id: groupData.guideId,
            ...(guideSnap.exists() ? guideSnap.data() : {}),
            ...(guideUserSnap.exists() ? guideUserSnap.data() : {}),
          });
        } else {
          // No guide assigned.
          setGuide(null);
        }

        // Load all volunteers and keep only those that belong to this group
        // (matched either by group id or by group name).
        const volunteersSnap = await getDocs(collection(db, 'volunteers'));
        const volData = volunteersSnap.docs
          .map((documentSnapshot) => ({
            id: documentSnapshot.id,
            ...documentSnapshot.data(),
          }))
          .filter(
            (volunteer) =>
              volunteer.groupId === groupId ||
              volunteer.groupName === groupName,
          );

        setVolunteers(volData);
      } catch (error) {
        console.error('שגיאה בשליפת נתוני הקבוצה המלאים:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchAllGroupData();
  }, [groupId]);

  // While loading, show a placeholder.
  if (loading) {
    return <div className="admin-container centered-state">טוען נתוני קבוצה...</div>;
  }

  // Group missing / failed to load.
  if (!group) {
    return (
      <div className="admin-container">
        {typeof onBack === 'function' && <button className="btn btn-outline" onClick={onBack}>חזרה</button>}
        <div className="empty-state">שגיאה: הקבוצה לא נמצאה.</div>
      </div>
    );
  }

  // The group's display name.
  const groupName = group.groupName || group.name || 'קבוצה ללא שם';

  return (
    <div className="admin-container">

      {/* Title bar + back button. */}
      <div className="action-bar spaced-action-bar">
        <h2 className="admin-title inline-title">ניהול קבוצה: {groupName}</h2>
        {typeof onBack === 'function' && (
          <button className="btn btn-outline" onClick={onBack}>חזרה לרשימת הקבוצות</button>
        )}
      </div>

      <div className="details-grid">

        {/* Assigned guide card. */}
        <div className="table-container details-card">
          <h3>מדריך אחראי</h3>
          {guide ? (
            <div className="details-list">
              <p><strong>שם:</strong> {getPersonName(guide)}</p>
              <p><strong>אימייל:</strong> {guide.email || 'לא הוזן'}</p>
              <p><strong>טלפון:</strong> {guide.phone || 'לא הוזן'}</p>
            </div>
          ) : (
            <div className="empty-state">
              אין מדריך משויך לקבוצה זו כרגע.
              <br />
              <span className="muted-text">ניתן לשייך מדריך דרך מסך ניהול הקבוצות.</span>
            </div>
          )}
        </div>

        {/* Attendance summary placeholder. */}
        <div className="table-container details-card dashed-card">
          <h3>סיכום נוכחות</h3>
          <div className="empty-state">
            סימון הנוכחות זמין מלוח המדריך וממסך ניהול הנוכחות.
          </div>
        </div>

        {/* Group members table. */}
        <div className="table-container details-card full-grid-row">
          <h3>חברי הקבוצה - {volunteers.length} רשומים</h3>
          {volunteers.length > 0 ? (
            <table className="styled-table details-table">
              <thead>
                <tr>
                  <th>שם המתנדב</th>
                  <th>גיל</th>
                  <th>בי״ס / מוסד לימודים</th>
                  <th>ניסיון קודם</th>
                </tr>
              </thead>
              <tbody>
                {volunteers.map((volunteer) => (
                  <tr key={volunteer.id}>
                    <td><strong>{getPersonName(volunteer)}</strong></td>
                    <td>{volunteer.age || '-'}</td>
                    <td>{volunteer.school || '-'}</td>
                    <td>{volunteer.experience || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="empty-state">אין מתנדבים בקבוצה זו.</div>
          )}
        </div>

        {/* Group events placeholder. */}
        <div className="table-container details-card dashed-card full-grid-row">
          <h3>אירועי הקבוצה</h3>
          <div className="empty-state">אירועים מנוהלים במסך ניהול האירועים.</div>
        </div>
      </div>
    </div>
  );
};

export default GroupDetails;
