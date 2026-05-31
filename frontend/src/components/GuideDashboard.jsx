import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { auth, db } from '../firebase'; 
import { signOut } from 'firebase/auth';
import { doc, getDoc, collection, query, where, getDocs } from 'firebase/firestore';
import './GuideDashboard.css';  

const GuideDashboard = () => {
  const navigate = useNavigate();
  const [guideData, setGuideData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchGuideData = async () => {
      const user = auth.currentUser;
      
      if (!user) {
        navigate('/login');
        return;
      }

      try {
        // 1. Fetch personal details from users
        const userRef = doc(db, 'users', user.uid);
        const userSnap = await getDoc(userRef);
        let firstName = 'מדריך';
        
        if (userSnap.exists()) {
          firstName = userSnap.data().firstName || firstName;
        }

        // 2. Query groups to find which one is assigned to this guide
        const groupsRef = collection(db, 'groups');
        const q = query(groupsRef, where('guideId', '==', user.uid));
        const groupsSnap = await getDocs(q);
        
        let groupId = null;
        let groupName = 'טרם שויך';

        if (!groupsSnap.empty) {
          const groupDoc = groupsSnap.docs[0];
          groupId = groupDoc.id;
          groupName = groupDoc.data().groupName;
        }

        setGuideData({
          id: user.uid,
          firstName,
          groupId,
          groupName
        });
      } catch (error) {
        console.error("שגיאה בשליפת נתוני המדריך והקבוצה:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchGuideData();
  }, [navigate]);

  const handleLogout = async () => {
    try {
      await signOut(auth);
      navigate('/'); 
    } catch (error) {
      console.error("שגיאה בתהליך ההתנתקות:", error);
    }
  };

  if (loading) {
    return (
      <div className="guide-dashboard-container" dir="rtl" style={{ textAlign: 'center', paddingTop: '50px' }}>
        טוען נתונים...
      </div>
    );
  }

  return (
    <div className="guide-dashboard-container" dir="rtl">
      <header className="guide-header">
        <h1>לוח בקרה - מדריך</h1>
        <p>ברוך הבא {guideData?.firstName || 'מדריך'}, בחר את הפעולה הרצויה:</p>
        {guideData?.groupId ? (
          <p style={{ color: '#0f766e', fontWeight: 'bold' }}>משויך לקבוצה: {guideData.groupName}</p>
        ) : (
          <p style={{ color: '#b91c1c', fontWeight: 'bold' }}>טרם שויכת לקבוצה במערכת</p>
        )}
      </header>

      <main className="guide-actions">
        <button 
          className="action-button secondary" 
          onClick={() => {
            if (guideData?.groupId) {
              navigate(`/group-details/${guideData.groupId}`);
            } else {
              alert('טרם שויכת לקבוצה');
            }
          }}
        >
          👤 הקבוצה שלי (My Group)
        </button>

        <button 
          className="action-button primary" 
          onClick={() => {
            if (guideData?.groupId) {
              navigate('/attendance', { state: { groupId: guideData.groupId } });
            } else {
              alert('טרם שויכת לקבוצה');
            }
          }}
        >
          📝 סימון נוכחות (Attendance)
        </button>

        <button 
          className="action-button secondary" 
          onClick={() => {
            if (guideData?.groupId) {
              navigate(`/group-details/${guideData.groupId}`);
            } else {
              alert('טרם שויכת לקבוצה');
            }
          }}
        >
          👥 רשימת מתנדבים (Volunteers List)
        </button>
      </main>

      <footer className="guide-footer">
        <button className="logout-button" onClick={handleLogout}>
          התנתק (Logout)
        </button>
      </footer>
    </div>
  );
};

export default GuideDashboard;