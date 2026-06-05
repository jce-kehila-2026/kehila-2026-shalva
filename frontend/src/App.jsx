// App — root component and top-level router. Tracks the Firebase auth session
// and the user's role, then renders the matching experience (public pages /
// admin / guide / viewer). The shared signed-in header is rendered once here.

// React hooks for state and side effects.
import { useEffect, useState } from 'react';

// Firebase auth helpers.
import { onAuthStateChanged, signOut } from 'firebase/auth';

// Firestore helpers for reading the user's profile.
import { doc, getDoc } from 'firebase/firestore';

// Our Firebase auth + database instances.
import { auth, db } from './firebase';

// App-level styles.
import './App.css';

// Screen components (signed-in dashboards, viewer screens and public pages).
import AdminDashboard from './components/AdminDashboard/AdminDashboard';
import EventDetails from './components/EventDetails/EventDetails';
import EventManagement from './components/EventManagement/EventManagement';
import GuideDashboard from './components/GuideDashboard/GuideDashboard';
import Login from './components/Login/Login';
import MainScreen from './components/MainScreen/MainScreen';
import RegistrationScreen from './components/RegistrationScreen/RegistrationScreen';
import Reports from './components/Reports/Reports';
import UserList from './components/UserList/UserList';
import VolunteerDetails from './components/VolunteerDetails/VolunteerDetails';


// Hebrew labels for the system roles shown in the header.
const ROLE_LABELS = {
  admin: 'מנהל',
  guide: 'מדריך',
  viewer: 'צופה',
};


function App() {
  // The signed-in user (null when logged out).
  const [user, setUser] = useState(null);

  // True while the auth session is being resolved.
  const [loading, setLoading] = useState(true);

  // Which viewer tab is active.
  const [activeScreen, setActiveScreen] = useState('users');

  // The admin dashboard's current view.
  const [adminView, setAdminView] = useState('overview');

  // The guide dashboard's current view.
  const [guideView, setGuideView] = useState('menu');

  // The event / volunteer opened in the viewer (null when none).
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [selectedVolunteer, setSelectedVolunteer] = useState(null);

  // Which public page is showing when logged out.
  const [publicView, setPublicView] = useState('main');

  // Subscribe to Firebase auth changes and enrich the user with their
  // Firestore profile (role defaults to "viewer" when none is set).
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setLoading(true);

      try {
        // Logged out: clear the user and show the public home.
        if (!currentUser) {
          setUser(null);
          setPublicView('main');
          return;
        }

        // Read the user's profile document.
        const userDocRef = doc(db, 'users', currentUser.uid);
        const userDocSnap = await getDoc(userDocRef);

        // The profile record (if any).
        const userData = userDocSnap.exists() ? userDocSnap.data() : null;

        // No record, or a disabled one (a removed guide) → no access. Sign them
        // out so a leftover login can't use the app.
        if (!userData || userData.disabled) {
          await signOut(auth);
          setUser(null);
          setPublicView('main');
          window.alert('אין לחשבון זה הרשאת גישה למערכת. פנה/י למנהל המערכת.');
          return;
        }

        // Merge the auth user with the profile (defaulting the role).
        setUser({
          uid: currentUser.uid,
          email: currentUser.email,
          displayName: currentUser.displayName,
          ...userData,
          role: userData.role || 'viewer',
        });
      } catch (error) {
        // On error, treat the user as logged out.
        console.error('Error fetching user role:', error);
        setUser(null);
      } finally {
        setLoading(false);
      }
    });

    // Stop listening when the component unmounts.
    return () => unsubscribe();
  }, []);

  // Sign out and reset all view state back to defaults.
  const handleLogout = async () => {
    try {
      await signOut(auth);
      setSelectedEvent(null);
      setSelectedVolunteer(null);
      setActiveScreen('users');
      setAdminView('overview');
      setGuideView('menu');
      setPublicView('main');
    } catch (error) {
      console.error('Error logging out:', error);
    }
  };

  // Render the active viewer screen (or an opened event / volunteer).
  const renderViewerScreens = () => {
    // An opened event takes over the view.
    if (selectedEvent) {
      return (
        <EventDetails
          event={selectedEvent}
          onBack={() => {
            setSelectedEvent(null);
            setActiveScreen('events');
          }}
        />
      );
    }

    // An opened volunteer takes over the view.
    if (selectedVolunteer) {
      return (
        <VolunteerDetails
          volunteer={selectedVolunteer}
          onBack={() => {
            setSelectedVolunteer(null);
            setActiveScreen('users');
          }}
        />
      );
    }

    // Otherwise show the screen for the active tab.
    switch (activeScreen) {
      case 'events':
        return <EventManagement readOnly onOpenEventDetails={(eventItem) => setSelectedEvent(eventItem)} />;
      case 'reports':
        return <Reports />;
      case 'users':
      default:
        return <UserList onOpenVolunteerDetails={(volunteer) => setSelectedVolunteer(volunteer)} />;
    }
  };

  // Render the content for the signed-in user's role.
  const renderRoleContent = () => {
    const role = user?.role || 'viewer';

    // Admins get the admin dashboard.
    if (role === 'admin') {
      return <AdminDashboard currentView={adminView} setCurrentView={setAdminView} />;
    }

    // Guides get the guide dashboard.
    if (role === 'guide') {
      return <GuideDashboard user={user} onLogout={handleLogout} currentView={guideView} setCurrentView={setGuideView} />;
    }

    // Everyone else gets the tabbed viewer screens.
    return (
      <>
        {/* Tab nav (hidden while an event / volunteer is open). */}
        {!selectedEvent && !selectedVolunteer && (
          <nav className="app-tabs" aria-label="ניווט משתמש">
            <button
              className={activeScreen === 'users' ? 'active' : ''}
              aria-current={activeScreen === 'users' ? 'page' : undefined}
              onClick={() => setActiveScreen('users')}
            >
              רשימת מתנדבים
            </button>
            <button
              className={activeScreen === 'events' ? 'active' : ''}
              aria-current={activeScreen === 'events' ? 'page' : undefined}
              onClick={() => setActiveScreen('events')}
            >
              ניהול אירועים
            </button>
            <button
              className={activeScreen === 'reports' ? 'active' : ''}
              aria-current={activeScreen === 'reports' ? 'page' : undefined}
              onClick={() => setActiveScreen('reports')}
            >
              דוחות
            </button>
          </nav>
        )}
        {renderViewerScreens()}
      </>
    );
  };

  // A shared registration-form link (?register=1) opens the public volunteer
  // form for anyone, regardless of sign-in. Admins send this link by WhatsApp
  // or email; once it is filled, the submission shows up in the admin screen.
  const isRegistrationForm =
    new URLSearchParams(window.location.search).get('register') === '1';

  // The public registration form, shown straight from the share link.
  if (isRegistrationForm) {
    return (
      <div className="app-shell" dir="rtl">
        <div className="public-layout">
          <section className="public-card public-card-wide" aria-label="הרשמה להתנדבות">
            <RegistrationScreen />
          </section>
        </div>
      </div>
    );
  }

  // While the auth session resolves, show a loading message.
  if (loading) {
    return (
      <div id="center">
        <div className="counter loading-message">טוען פרופיל מערכת...</div>
      </div>
    );
  }

  return (
    <div className="app-shell" dir="rtl">
      {user ? (

        // ----- Signed-in layout -----
        <div className="authenticated-layout">

          {/* Shared top header: actions + greeting/role. */}
          <header className="authenticated-header">

            {/* Action buttons (admin menu shortcuts + logout). */}
            <div className="auth-actions">
              {user.role === 'admin' && adminView === 'overview' && (
                <button type="button" className="auth-btn" onClick={() => setAdminView('menu')}>
                  ⚙️ מרכז ניהול
                </button>
              )}
              {user.role === 'admin' && adminView !== 'overview' && (
                <button
                  type="button"
                  className="auth-btn"
                  onClick={() => setAdminView(adminView === 'menu' ? 'overview' : 'menu')}
                >
                  {adminView === 'menu' ? 'חזרה לדף הבית' : 'חזרה לתפריט'}
                </button>
              )}
              <button type="button" className="auth-btn auth-btn-danger" onClick={handleLogout}>
                התנתקות
              </button>
            </div>

            {/* Greeting + role badge. */}
            <div className="auth-user">
              <h2 className="auth-greeting">שלום, {user.firstName || user.displayName || user.email}</h2>
              <span className="auth-role-badge">הרשאה: {ROLE_LABELS[user.role] || user.role || 'צופה'}</span>
            </div>
          </header>

          {/* The role-specific content. */}
          {renderRoleContent()}
        </div>
      ) : (

        // ----- Public (logged-out) layout -----
        <div className="public-layout">

          {/* Home page. */}
          {publicView === 'main' && (
            <MainScreen onNavigateLogin={() => setPublicView('login')} />
          )}

          {/* Login page. */}
          {publicView === 'login' && (
            <section className="public-card" aria-label="כניסה למערכת">
              <button className="link-button" onClick={() => setPublicView('main')}>חזרה לדף הבית</button>
              <Login />
            </section>
          )}
        </div>
      )}
    </div>
  );
}

export default App;
