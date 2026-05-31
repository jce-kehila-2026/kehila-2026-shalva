import { useEffect, useState } from 'react';
import { doc, getDoc } from 'firebase/firestore';

import { auth, db } from '../firebase';
import AttendanceScreen from './AttendanceScreen';
import GroupDetails from './GroupDetails';
import VolunteersManagement from './VolunteersManagement';
import './GuideDashboard.css';

const GuideDashboard = ({ user, onLogout }) => {
  const [guideData, setGuideData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeView, setActiveView] = useState('menu');

  useEffect(() => {
    const fetchGuideData = async () => {
      const currentUser = user || auth.currentUser;

      if (!currentUser?.uid) {
        setGuideData(null);
        setLoading(false);
        return;
      }

      try {
        const guideRef = doc(db, 'guides', currentUser.uid);
        const guideSnap = await getDoc(guideRef);
        const guideFields = guideSnap.exists() ? guideSnap.data() : {};

        setGuideData({
          id: currentUser.uid,
          email: currentUser.email,
          firstName: currentUser.firstName || guideFields.firstName || '',
          lastName: currentUser.lastName || guideFields.lastName || '',
          ...guideFields,
        });
      } catch (error) {
        console.error('שגיאה בשליפת נתוני המדריך:', error);
        setGuideData({
          id: currentUser.uid,
          email: currentUser.email,
          firstName: currentUser.firstName || '',
          lastName: currentUser.lastName || '',
        });
      } finally {
        setLoading(false);
      }
    };

    fetchGuideData();
  }, [user]);

  const guideGroup = {
    id: guideData?.groupId || '',
    groupName: guideData?.groupName || '',
  };

  const backToMenu = () => setActiveView('menu');

  if (loading) {
    return (
      <div className="guide-dashboard-container" dir="rtl">
        <div className="guide-loading">טוען נתונים...</div>
      </div>
    );
  }

  if (activeView === 'group') {
    return guideGroup.id ? (
      <GroupDetails groupId={guideGroup.id} onBack={backToMenu} />
    ) : (
      <div className="guide-dashboard-container" dir="rtl">
        <button className="btn btn-outline" onClick={backToMenu}>חזרה</button>
        <p className="guide-empty-state">עדיין לא שויכה לך קבוצה.</p>
      </div>
    );
  }

  if (activeView === 'attendance') {
    return (
      <AttendanceScreen
        initialGroupId={guideGroup.id}
        initialGroupName={guideGroup.groupName}
        lockGroup={Boolean(guideGroup.id || guideGroup.groupName)}
        onBack={backToMenu}
      />
    );
  }

  if (activeView === 'volunteers') {
    return (
      <VolunteersManagement
        initialGroup={guideGroup}
        onBack={backToMenu}
      />
    );
  }

  return (
    <div className="guide-dashboard-container" dir="rtl">
      <header className="guide-header">
        <h1>לוח בקרה - מדריך</h1>
        <p>
          ברוך הבא {guideData?.firstName || guideData?.email || 'מדריך'}, בחר את הפעולה הרצויה.
        </p>
        <p className="guide-group-label">
          קבוצה משויכת: <strong>{guideGroup.groupName || 'טרם שויכה קבוצה'}</strong>
        </p>
      </header>

      <main className="guide-actions">
        <button className="action-button secondary" onClick={() => setActiveView('group')}>👤 הקבוצה שלי</button>
        <button className="action-button primary" onClick={() => setActiveView('attendance')}>📝 סימון נוכחות</button>
        <button className="action-button secondary" onClick={() => setActiveView('volunteers')}>👥 רשימת מתנדבים</button>
      </main>

      {typeof onLogout === 'function' && (
        <footer className="guide-footer">
          <button className="logout-button" onClick={onLogout}>התנתקות</button>
        </footer>
      )}
    </div>
  );
};

export default GuideDashboard;
