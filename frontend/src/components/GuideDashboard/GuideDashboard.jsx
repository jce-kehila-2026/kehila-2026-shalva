// GuideDashboard — home screen for users with the "guide" role. Loads the
// guide's assigned group and offers three actions (view group, mark
// attendance, manage volunteers). "menu" is the default landing view.

// React hooks for state and side effects.
import { useEffect, useState } from 'react';

// Firestore helpers: read a single document + query the groups collection.
import { doc, getDoc, collection, getDocs, query, where } from 'firebase/firestore';

// Our Firebase auth + database instances.
import { auth, db } from '../../firebase';

// The screens this dashboard can swap to. (Volunteer management and the
// activity command center were removed from the guide flow.)
import AttendanceScreen from '../AttendanceScreen/AttendanceScreen';
import GroupDetails from '../GroupManagement/GroupDetails';

// Styles for this screen.
import './GuideDashboard.css';


// First character of a name, for the avatar circle.
const getInitial = (name) => {
  const trimmed = (name || '').trim();
  return trimmed ? trimmed[0].toUpperCase() : '';
};


const GuideDashboard = ({ user, currentView, setCurrentView }) => {
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
    let isActive = true;

    const fetchGuideData = async () => {
      // The current guide (from props or Firebase auth).
      const currentUser = user || auth.currentUser;

      // No signed-in user: nothing to load.
      if (!currentUser?.uid) {
        if (isActive) {
          setGuideData(null);
          setLoading(false);
        }
        return;
      }

      setLoading(true);

      try {
        // Read the guide's mapping document.
        const guideRef = doc(db, 'guides', currentUser.uid);
        const guideSnap = await getDoc(guideRef);

        if (!isActive) {
          return;
        }

        const guideFields = guideSnap.exists() ? guideSnap.data() : {};

        // The assignment may live only on the GROUP side (groups/{}.guideId) and
        // not be copied back to guides/{uid}. So if the guide doc has no real
        // group, look up the group that points to this guide — the guide then
        // sees their group no matter which side saved the link.
        let resolvedGroupId = guideFields.groupId || '';
        let resolvedGroupName = (guideFields.groupName || '').trim();
        const noGroupYet =
          !resolvedGroupId ||
          !resolvedGroupName ||
          resolvedGroupName.toLowerCase() === 'unassigned';

        if (noGroupYet) {
          const ownedGroups = await getDocs(
            query(collection(db, 'groups'), where('guideId', '==', currentUser.uid)),
          );

          if (!isActive) {
            return;
          }

          if (!ownedGroups.empty) {
            const groupDoc = ownedGroups.docs[0];
            const groupData = groupDoc.data();
            resolvedGroupId = resolvedGroupId || groupDoc.id;
            const foundName = (groupData.groupName || groupData.name || '').trim();
            if (foundName) {
              resolvedGroupName = foundName;
            }
          }
        }

        // Merge the auth user with the stored guide fields + the resolved group.
        if (!isActive) {
          return;
        }

        setGuideData({
          id: currentUser.uid,
          email: currentUser.email,
          firstName: currentUser.firstName || guideFields.firstName || '',
          lastName: currentUser.lastName || guideFields.lastName || '',
          ...guideFields,
          groupId: resolvedGroupId,
          groupName: resolvedGroupName,
        });
      } catch (error) {
        if (!isActive) {
          return;
        }

        // On error, fall back to just the auth user's basics.
        console.error('שגיאה בשליפת נתוני המדריך:', error);
        setGuideData({
          id: currentUser.uid,
          email: currentUser.email,
          firstName: currentUser.firstName || '',
          lastName: currentUser.lastName || '',
        });
      } finally {
        if (isActive) {
          setLoading(false);
        }
      }
    };

    fetchGuideData();

    return () => {
      isActive = false;
    };
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

  // The signed-in guide's EFFECTIVE Auth uid — the single, stable identity
  // source, using the same fallback the rest of the component uses (the user
  // prop, then auth.currentUser). Never derived from a Firestore document.
  const authenticatedGuideUid = user?.uid || auth.currentUser?.uid || '';

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
      // guideScopedRead: force the group-scoped read strategy on the guide path.
      // currentGuideUid comes from the effective Firebase Auth user (user prop or
      // auth.currentUser fallback) — never a Firestore-loaded guides document or
      // state — so the guide's contact card is read by their OWN identity. When it
      // is empty, GroupDetails stays fail-closed on guide metadata (no fallback to
      // the group document's guideId).
      <GroupDetails
        groupId={guideGroup.id}
        guideScopedRead
        currentGuideUid={authenticatedGuideUid}
        onBack={backToMenu}
      />
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
  const guideName = guideData?.firstName || guideData?.email || 'מדריך';

  // Today's date, written out in Hebrew (e.g. "יום ראשון, 14 ביוני").
  // Shown in the hero so the screen feels current and personal.
  const todayLabel = new Date().toLocaleDateString('he-IL', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });

  return (
    <div className="guide-dashboard-container" dir="rtl">

      {/* Hero header: avatar + greeting + the assigned group as a pill. */}
      <header className="guide-hero">
        <span className="guide-hero-glow guide-hero-glow-1" aria-hidden="true" />
        <span className="guide-hero-glow guide-hero-glow-2" aria-hidden="true" />

        <div className="guide-hero-content">
          <span className="guide-avatar">{getInitial(guideName)}</span>
          <div className="guide-hero-text">
            <span className="guide-role-badge">מדריך/ה</span>
            <h1 className="guide-hello">שלום, {guideName}</h1>
            <p className="guide-group-pill">
              {guideGroup.groupName
                ? <>הקבוצה שלך: <strong>{guideGroup.groupName}</strong></>
                : 'טרם שויכה לך קבוצה'}
            </p>
            {/* Today's date — keeps the screen feeling live. */}
            <p className="guide-hero-date">{todayLabel}</p>
          </div>
        </div>
      </header>

      {/* Action cards (group details + attendance marking).
          Both cards share the same white surface; the colour and energy come
          from the icon badge, the hover lift and the chevron — not from filling
          one card, so they stay visually consistent. */}
      <main className="guide-actions">

        {/* Card 1: the guide's group. */}
        <button
          className="guide-action-card"
          onClick={() => updateActiveView('group')}
        >
          {/* Brand-tinted icon badge: a small group of people. */}
          <span className="guide-action-icon guide-action-icon--group" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
              <circle cx="9" cy="7" r="4" />
              <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
              <path d="M16 3.13a4 4 0 0 1 0 7.75" />
            </svg>
          </span>

          <span className="guide-action-text">
            <span className="guide-action-title">הקבוצה שלי</span>
            <span className="guide-action-sub">פרטי הקבוצה ורשימת המתנדבים</span>
          </span>

          {/* Chevron hints the card is tappable; it nudges on hover. */}
          <span className="guide-action-chevron" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M15 18l-6-6 6-6" />
            </svg>
          </span>
        </button>

        {/* Card 2: mark attendance for today. */}
        <button
          className="guide-action-card"
          onClick={() => updateActiveView('attendance')}
        >
          {/* Accent icon badge: a clipboard with a check. */}
          <span className="guide-action-icon guide-action-icon--attendance" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 2h6a1 1 0 0 1 1 1v2H8V3a1 1 0 0 1 1-1z" />
              <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
              <path d="M9 14l2 2 4-4" />
            </svg>
          </span>

          <span className="guide-action-text">
            <span className="guide-action-title">סימון נוכחות</span>
            <span className="guide-action-sub">מי הגיע/ה היום למפגש</span>
          </span>

          <span className="guide-action-chevron" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M15 18l-6-6 6-6" />
            </svg>
          </span>
        </button>
      </main>
    </div>
  );
};

export default GuideDashboard;
