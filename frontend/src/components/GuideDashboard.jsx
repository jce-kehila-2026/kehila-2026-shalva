import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { auth, db } from '../firebase'; 
import { signOut } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import './GuideDashboard.css';  

const GuideDashboard = () => {
  const navigate = useNavigate();
  const [guideData, setGuideData] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const fetchGuideData = async () => {
      // 1. אימות משתמש מול Firebase Auth
      const user = auth.currentUser;
      
      if (!user) {
        navigate('/login');
        return;
      }

      try {
        // 2. משיכת נתוני העומק ממסד הנתונים
        const guideRef = doc(db, 'guides', user.uid);
        const guideSnap = await getDoc(guideRef);

        if (guideSnap.exists()) {
          setGuideData({ id: guideSnap.id, ...guideSnap.data() });
        } else {
          console.error("שגיאה: משתמש מחובר אך לא קיים עבורו מסמך בטבלת guides");
        }
      } catch (error) {
        console.error("שגיאה בשליפת נתוני המדריך:", error);
      } finally {
        // 3. סיום מצב הטעינה
        setLoading(false);
      }
    };

    fetchGuideData();
  }, [navigate]);

  const handleLogout = async () => {
    try {
      // ניתוק מאובטח
      await signOut(auth);
      navigate('/login'); 
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
      </header>

      <main className="guide-actions">
        <button 
          className="action-button secondary" 
          // 4. העברת ה-ID של הקבוצה למסך הבא דרך הראוטר
          onClick={() => navigate('/group-details', { state: { groupId: guideData?.groupId } })}
        >
          👤 הקבוצה שלי (My Group)
        </button>

        <button 
          className="action-button primary" 
          onClick={() => navigate('/attendance', { state: { groupId: guideData?.groupId } })}
        >
          📝 סימון נוכחות (Attendance)
        </button>

        <button 
          className="action-button secondary" 
          onClick={() => navigate('/volunteers', { state: { groupId: guideData?.groupId } })}
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