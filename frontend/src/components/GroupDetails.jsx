import { useState, useEffect } from 'react';
import { doc, getDoc, collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '../firebase';
import { useParams, useNavigate } from 'react-router-dom';
import './GroupManagement.css'; 

const GroupDetails = ({ groupId: propGroupId, onBack }) => {
  const { groupId: paramGroupId } = useParams();
  const groupId = propGroupId || paramGroupId;
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [group, setGroup] = useState(null);
  const [guide, setGuide] = useState(null);
  const [volunteers, setVolunteers] = useState([]);
  const [events, setEvents] = useState([]);
  const [attendanceSummary, setAttendanceSummary] = useState({ present: 0, absent: 0 });

  useEffect(() => {
    if (!groupId) return;

    const fetchAllGroupData = async () => {
      setLoading(true);
      try {
        // 1. שליפת פרטי הקבוצה
        const groupRef = doc(db, 'groups', groupId);
        const groupSnap = await getDoc(groupRef);
        
        if (!groupSnap.exists()) {
          console.error("קבוצה לא נמצאה");
          setLoading(false);
          return;
        }
        
        const groupData = { id: groupSnap.id, ...groupSnap.data() };
        setGroup(groupData);

        // 2. שליפת פרטי המדריך (מטבלת 'users' כדי לקבל פרטים אישיים)
        if (groupData.guideId) {
          const guideRef = doc(db, 'users', groupData.guideId);
          const guideSnap = await getDoc(guideRef);
          if (guideSnap.exists()) {
            setGuide({ id: guideSnap.id, ...guideSnap.data() });
          }
        }

        // 3. שליפת מתנדבים ששייכים רק לקבוצה הזו
        const volunteersRef = collection(db, 'volunteers');
        const q = query(volunteersRef, where('groupId', '==', groupId));
        const volSnap = await getDocs(q);
        const volData = volSnap.docs.map(d => ({ id: d.id, ...d.data() }));
        setVolunteers(volData);

        // 4. שליפת אירועים המשויכים לקבוצה זו
        const eventsRef = collection(db, 'events');
        const eventsSnap = await getDocs(eventsRef);
        const allEvents = eventsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
        const groupEvents = allEvents.filter(e => 
          e.assignedGroup === groupData.groupName || 
          e.group === groupData.groupName
        );
        setEvents(groupEvents);

        // 5. שליפת סיכום נוכחות עבור הקבוצה
        const attendanceRef = collection(db, 'attendance');
        const attQuery = query(attendanceRef, where('group', '==', groupData.groupName));
        const attSnap = await getDocs(attQuery);
        let present = 0;
        let absent = 0;
        attSnap.docs.forEach(docSnap => {
          const data = docSnap.data();
          if (data.status === true || data.status === "present") {
            present += 1;
          } else {
            absent += 1;
          }
        });
        setAttendanceSummary({ present, absent });

      } catch (error) {
        console.error("שגיאה בשליפת נתוני הקבוצה המלאים:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchAllGroupData();
  }, [groupId]);

  const handleBack = () => {
    if (typeof onBack === 'function') {
      onBack();
    } else {
      navigate(-1);
    }
  };

  if (loading) {
    return <div className="admin-container" style={{ textAlign: 'center', marginTop: '50px' }}>טוען נתוני קבוצה...</div>;
  }

  if (!group) {
    return <div className="admin-container">שגיאה: הקבוצה לא נמצאה.</div>;
  }

  return (
    <div className="admin-container" dir="rtl">
      {/* כותרת המסך ופעולות עליונות */}
      <div className="action-bar" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2 className="admin-title" style={{ margin: 0, border: 'none', padding: 0 }}>
          ניהול קבוצה: {group.groupName}
        </h2>
        <button className="btn btn-outline" onClick={handleBack}>
          חזור ↩
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
        
        {/* כרטיסייה 1: פרטי מדריך */}
        <div className="table-container" style={{ padding: '20px' }}>
          <h3 style={{ marginTop: 0, color: '#3b82f6', borderBottom: '2px solid #e2e8f0', paddingBottom: '10px' }}>
            👨‍🏫 מדריך אחראי
          </h3>
          {guide ? (
            <div>
              <p><strong>שם:</strong> {guide.firstName} {guide.lastName}</p>
              <p><strong>אימייל:</strong> {guide.email || 'לא הוזן'}</p>
              <p><strong>טלפון:</strong> {guide.phone || 'לא הוזן'}</p>
            </div>
          ) : (
            <div className="empty-state">
              אין מדריך משויך לקבוצה זו כרגע.
            </div>
          )}
        </div>

        {/* כרטיסייה 2: נוכחות */}
        <div className="table-container" style={{ padding: '20px' }}>
          <h3 style={{ marginTop: 0, color: '#10b981', borderBottom: '2px solid #e2e8f0', paddingBottom: '10px' }}>
            ✅ סיכום נוכחות
          </h3>
          <div>
            <p><strong>מפגשים נוכח:</strong> {attendanceSummary.present}</p>
            <p><strong>מפגשים נעדר:</strong> {attendanceSummary.absent}</p>
            <button 
              className="btn btn-primary" 
              style={{ width: '100%', marginTop: '10px' }}
              onClick={() => navigate('/attendance', { state: { groupId: groupId } })}
            >
              הזן נוכחות חדשה 📝
            </button>
          </div>
        </div>

        {/* כרטיסייה 3: רשימת מתנדבים */}
        <div className="table-container" style={{ padding: '20px', gridColumn: '1 / -1' }}>
          <h3 style={{ marginTop: 0, color: '#64748b', borderBottom: '2px solid #e2e8f0', paddingBottom: '10px' }}>
            🤝 חברי הקבוצה (מתנדבים) - {volunteers.length} רשומים
          </h3>
          {volunteers.length > 0 ? (
            <table className="styled-table" style={{ marginTop: '10px' }}>
              <thead>
                <tr>
                  <th>שם המתנדב</th>
                  <th>גיל</th>
                  <th>בי"ס / מוסד לימודים</th>
                  <th>ניסיון קודם</th>
                  <th>פעולות</th>
                </tr>
              </thead>
              <tbody>
                {volunteers.map(vol => (
                  <tr key={vol.id}>
                    <td><strong>{vol.name || `${vol.firstName || ''} ${vol.lastName || ''}`.trim() || 'ללא שם'}</strong></td>
                    <td>{vol.age || '-'}</td>
                    <td>{vol.school || '-'}</td>
                    <td>{vol.experience || '-'}</td>
                    <td>
                      <button 
                        className="btn btn-primary" 
                        onClick={() => navigate(`/volunteer-details/${vol.id}`, { state: { volunteer: vol } })}
                      >
                        פרטים
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="empty-state">אין מתנדבים בקבוצה זו.</div>
          )}
        </div>

        {/* כרטיסייה 4: אירועים */}
        <div className="table-container" style={{ padding: '20px', gridColumn: '1 / -1' }}>
          <h3 style={{ marginTop: 0, color: '#f59e0b', borderBottom: '2px solid #e2e8f0', paddingBottom: '10px' }}>
            📅 אירועי הקבוצה - {events.length} אירועים מתוכננים
          </h3>
          {events.length > 0 ? (
            <table className="styled-table" style={{ marginTop: '10px' }}>
              <thead>
                <tr>
                  <th>שם האירוע</th>
                  <th>תאריך</th>
                  <th>מיקום</th>
                  <th>סטטוס</th>
                  <th>פעולות</th>
                </tr>
              </thead>
              <tbody>
                {events.map(ev => (
                  <tr key={ev.id}>
                    <td><strong>{ev.name}</strong></td>
                    <td>{ev.date}</td>
                    <td>{ev.location}</td>
                    <td>{ev.status}</td>
                    <td>
                      <button 
                        className="btn btn-primary" 
                        onClick={() => navigate(`/event-details/${ev.id}`, { state: { event: ev } })}
                      >
                        פרטים
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="empty-state">אין אירועים קרובים לקבוצה זו.</div>
          )}
        </div>

      </div>
    </div>
  );
};

export default GroupDetails;