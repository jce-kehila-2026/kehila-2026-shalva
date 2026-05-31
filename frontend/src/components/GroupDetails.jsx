import { useState, useEffect } from 'react';
import { doc, getDoc, collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '../firebase';
import './GroupManagement.css'; 

const GroupDetails = ({ groupId, onBack }) => {
  const [loading, setLoading] = useState(true);
  const [group, setGroup] = useState(null);
  const [guide, setGuide] = useState(null);
  const [volunteers, setVolunteers] = useState([]);

  useEffect(() => {
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

        // 2. שליפת פרטי המדריך (אם משויך לקבוצה)
        if (groupData.guideId) {
          // מניחים שיש קולקשן בשם 'guides' ב-Firebase
          const guideRef = doc(db, 'guides', groupData.guideId);
          const guideSnap = await getDoc(guideRef);
          if (guideSnap.exists()) {
            setGuide({ id: guideSnap.id, ...guideSnap.data() });
          }
        }

        // 3. שליפת מתנדבים ששייכים רק לקבוצה הזו
        const volunteersRef = collection(db, 'volunteers');
        // שימוש בשאילתה (Query) כדי לא למשוך את כל מסד הנתונים סתם
        const q = query(volunteersRef, where('groupId', '==', groupId));
        const volSnap = await getDocs(q);
        const volData = volSnap.docs.map(d => ({ id: d.id, ...d.data() }));
        
        setVolunteers(volData);

      } catch (error) {
        console.error("שגיאה בשליפת נתוני הקבוצה המלאים:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchAllGroupData();
  }, [groupId]);

  if (loading) {
    return <div className="admin-container" style={{ textAlign: 'center', marginTop: '50px' }}>טוען נתוני קבוצה...</div>;
  }

  if (!group) {
    return <div className="admin-container">שגיאה: הקבוצה לא נמצאה.</div>;
  }

  return (
    <div className="admin-container">
      {/* כותרת המסך ופעולות עליונות */}
      <div className="action-bar" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2 className="admin-title" style={{ margin: 0, border: 'none', padding: 0 }}>
          ניהול קבוצה: {group.groupName}
        </h2>
        <button className="btn btn-outline" onClick={onBack}>
          חזור לרשימת הקבוצות ↩
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
              {/* כאן אפשר להוסיף שדות נוספים מה-class diagram בהמשך */}
              <p><strong>מזהה מערכת:</strong> {guide.id}</p>
              <p><strong>שם:</strong> {guide.firstName} {guide.lastName}</p>
              <p><strong>אימייל:</strong> {guide.email || 'לא הוזן'}</p>
              <p><strong>טלפון:</strong> {guide.phone || 'לא הוזן'}</p>
            </div>
          ) : (
            <div className="empty-state">
              אין מדריך משויך לקבוצה זו כרגע.
              <br/>
              <span style={{ fontSize: '14px', color: '#94a3b8' }}>(ניתן לשייך מדריך דרך מסך ניהול הקבוצות)</span>
            </div>
          )}
        </div>

        {/* כרטיסייה 2: נוכחות (הכנה לאינטגרציה) */}
        <div className="table-container" style={{ padding: '20px', backgroundColor: '#f8fafc', border: '1px dashed #cbd5e1' }}>
          <h3 style={{ marginTop: 0, color: '#10b981', borderBottom: '2px solid #e2e8f0', paddingBottom: '10px' }}>
            ✅ סיכום נוכחות
          </h3>
          <div className="empty-state">
            <em>[אזור אינטגרציה]</em><br/>
            כאן תשולב קומפוננטת הנוכחות (Attendance).<br/>
            <strong>Props מתוכננים להעברה:</strong> <code>groupId={groupId}</code>
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
                </tr>
              </thead>
              <tbody>
                {volunteers.map(vol => (
                  <tr key={vol.id}>
                    <td><strong>{vol.name || `${vol.firstName} ${vol.lastName}`}</strong></td>
                    <td>{vol.age || '-'}</td>
                    <td>{vol.school || '-'}</td>
                    <td>{vol.experience || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="empty-state">אין מתנדבים בקבוצה זו.</div>
          )}
        </div>

        {/* כרטיסייה 4: אירועים (הכנה לאינטגרציה) */}
        <div className="table-container" style={{ padding: '20px', gridColumn: '1 / -1', backgroundColor: '#f8fafc', border: '1px dashed #cbd5e1' }}>
          <h3 style={{ marginTop: 0, color: '#f59e0b', borderBottom: '2px solid #e2e8f0', paddingBottom: '10px' }}>
            📅 אירועי הקבוצה
          </h3>
          <div className="empty-state">
            <em>[אזור אינטגרציה]</em><br/>
            כאן תשולב קומפוננטת האירועים (Events).<br/>
          </div>
        </div>

      </div>
    </div>
  );
};

export default GroupDetails;