// GuideDashboard — home screen for users with the "guide" role. Loads the
// guide's assigned group and offers three actions (view group, mark
// attendance, manage volunteers). "menu" is the default landing view.

// React hooks for state and side effects.
import { useEffect, useState } from 'react';

// Firestore helpers for reading a single document.
import { doc, getDoc } from 'firebase/firestore';

// Our Firebase auth + database instances.
import { auth, db } from '../../firebase';

// The screens this dashboard can swap to. (Volunteer management and the
// activity command center were removed from the guide flow.)
import AttendanceScreen from '../AttendanceScreen/AttendanceScreen';
import GroupDetails from '../GroupManagement/GroupDetails';

// Styles for this screen.
import './GuideDashboard.css';


const GuideDashboard = ({ user, onLogout, currentView, setCurrentView }) => {
  // The loaded guide profile (null until fetched).
  const [guideData, setGuideData] = useState(null);

  // True while the guide's data loads.
  const [loading, setLoading] = useState(true);

  // Fallback view state when the parent doesn't control the view.
  const [internalActiveView, setInternalActiveView] = useState('menu');

  // The active view comes from the parent if provided, else local state.
  const activeView = currentView || internalActiveView;

  // Switch view via the parent handler, or locally as a fallback.
  const updateActiveView = (nextView) => {
    if (typeof setCurrentView === 'function') {
      setCurrentView(nextView);
      return;
    }

    setInternalActiveView(nextView);
  };

  // Load the signed-in guide's profile + group mapping.
  useEffect(() => {
    const fetchGuideData = async () => {
      // The current guide (from props or Firebase auth).
      const currentUser = user || auth.currentUser;

      // No signed-in user: nothing to load.
      if (!currentUser?.uid) {
        setGuideData(null);
        setLoading(false);
        return;
      }

      try {
        // Read the guide's mapping document.
        const guideRef = doc(db, 'guides', currentUser.uid);
        const guideSnap = await getDoc(guideRef);
        const guideFields = guideSnap.exists() ? guideSnap.data() : {};

        // Merge the auth user with the stored guide fields.
        setGuideData({
          id: currentUser.uid,
          email: currentUser.email,
          firstName: currentUser.firstName || guideFields.firstName || '',
          lastName: currentUser.lastName || guideFields.lastName || '',
          ...guideFields,
        });
      } catch (error) {
        // On error, fall back to just the auth user's basics.
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

  // A freshly-created guide is stored with the literal group name "Unassigned"
  // (see GuideManagement) and no groupId. Treat that — and an empty name — as
  // "no group yet" so the UI never shows the raw English placeholder and the
  // group-only screens degrade to a friendly message instead of looking broken.
  const rawGroupName = (guideData?.groupName || '').trim();
  const isUnassigned = !guideData?.groupId && (!rawGroupName || rawGroupName.toLowerCase() === 'unassigned');

  // The guide's effective group (id + name), blanked when unassigned.
  const guideGroup = {
    id: guideData?.groupId || '',
    groupName: isUnassigned ? '' : rawGroupName,
  };

  // Return to the action menu.
  const backToMenu = () => updateActiveView('menu');

  // Shared "no group assigned" screen.
  const renderNoGroup = () => (
    <div className="guide-dashboard-container" dir="rtl">
      <button className="btn btn-outline" onClick={backToMenu}>חזרה</button>
      <p className="guide-empty-state">עדיין לא שויכה לך קבוצה. פנה/י למנהל המערכת לשיוך קבוצה.</p>
    </div>
  );

  // While loading, show a placeholder.
  if (loading) {
    return (
      <div className="guide-dashboard-container" dir="rtl">
        <div className="guide-loading">טוען נתונים...</div>
      </div>
    );
  }

  // View: the guide's group details (or "no group").
  if (activeView === 'group') {
    return guideGroup.id ? (
      <GroupDetails groupId={guideGroup.id} onBack={backToMenu} />
    ) : renderNoGroup();
  }

  // View: mark attendance (locked to the guide's group).
  if (activeView === 'attendance') {
    if (isUnassigned) return renderNoGroup();
    return (
      <AttendanceScreen
        initialGroupId={guideGroup.id}
        initialGroupName={guideGroup.groupName}
        lockGroup={Boolean(guideGroup.id || guideGroup.groupName)}
        onBack={backToMenu}
      />
    );
  }

  // Default view: the action menu.
  return (
    <div className="guide-dashboard-container" dir="rtl">

      {/* Greeting + assigned group. */}
      <header className="guide-header">
        <h1>לוח בקרה - מדריך</h1>
        <p>
          ברוך הבא {guideData?.firstName || guideData?.email || 'מדריך'}.
        </p>
        <p className="guide-group-label">
          קבוצה משויכת: <strong>{guideGroup.groupName || 'טרם שויכה קבוצה'}</strong>
        </p>
      </header>

      {/* The guide's action buttons (group details + attendance marking). */}
      <main className="guide-actions">
        <button className="action-button secondary" onClick={() => updateActiveView('group')}>👤 הקבוצה שלי</button>
        <button className="action-button primary" onClick={() => updateActiveView('attendance')}>📝 סימון נוכחות</button>
      </main>

      {/* Optional logout footer. */}
      {typeof onLogout === 'function' && (
        <footer className="guide-footer">
          <button className="logout-button" onClick={onLogout}>התנתקות</button>
        </footer>
      )}
    </div>
  );
};

export default GuideDashboard;
