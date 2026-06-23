// App — root component and top-level router. Tracks the Firebase auth session
// and the user's role, then renders the matching experience (public pages /
// admin / guide / viewer). The shared signed-in header is rendered once here.

// React hooks for state, side effects and refs.
import { useEffect, useRef, useState } from 'react';

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
import AdminsManagement from './components/AdminsManagement/AdminsManagement';
import EventDetails from './components/EventDetails/EventDetails';
import EventManagement from './components/EventManagement/EventManagement';
import GuideDashboard from './components/GuideDashboard/GuideDashboard';
import Login from './components/Login/Login';
import MainScreen from './components/MainScreen/MainScreen';
import RegistrationScreen from './components/RegistrationScreen/RegistrationScreen';
import Reports from './components/Reports/Reports';
import SignatureForm from './components/SignatureForm/SignatureForm';
import DocumentUploadForm from './components/DocumentUploadForm/DocumentUploadForm';
import ResetPassword from './components/ResetPassword/ResetPassword';
import UserList from './components/UserList/UserList';
import VolunteerDetails from './components/VolunteerDetails/VolunteerDetails';


const PUBLIC_HOME_URL = '/?public=1';
const PUBLIC_LOGIN_URL = '/?login=1';

// Hebrew labels for the system roles shown in the header.
const ROLE_LABELS = {
  owner: 'בעלים',
  admin: 'מנהל',
  guide: 'מדריך',
  viewer: 'צופה',
};


// Restore a saved view from sessionStorage (so an unexpected page reload —
// e.g. the dev server reconnecting after the tab slept — puts the user back
// on the exact screen they were on instead of the home view).
function restoreView(storageKey, fallback) {
  try {
    return sessionStorage.getItem(storageKey) || fallback;
  } catch {
    return fallback;
  }
}

// Auto sign-out after this much time with no user activity.
const IDLE_LIMIT_MS = 5 * 60 * 1000;


function App() {
  // The signed-in user (null when logged out).
  const [user, setUser] = useState(null);

  // True while the auth session is being resolved.
  const [loading, setLoading] = useState(true);

  // Which viewer tab is active (restored across reloads).
  const [activeScreen, setActiveScreen] = useState(() => restoreView('kehila.activeScreen', 'users'));

  // The admin dashboard's current view (restored across reloads).
  const [adminView, setAdminView] = useState(() => restoreView('kehila.adminView', 'overview'));

  // Whether the admin navigation drawer is open (the hamburger lives in the
  // shared header, so the state is owned here).
  const [adminNavOpen, setAdminNavOpen] = useState(false);

  // The guide dashboard's current view (restored across reloads).
  const [guideView, setGuideView] = useState(() => restoreView('kehila.guideView', 'menu'));

  // The event / volunteer opened in the viewer (null when none).
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [selectedVolunteer, setSelectedVolunteer] = useState(null);

  // Which public page is showing when logged out.
  const [publicView, setPublicView] = useState('main');

  // True once the FIRST auth check finished (used to skip the full-page
  // loader on later re-emissions, so the screen never "jumps").
  const initialAuthResolved = useRef(false);

  // Save the current view on every change, so a reload restores it.
  useEffect(() => {
    try {
      sessionStorage.setItem('kehila.activeScreen', activeScreen);
      sessionStorage.setItem('kehila.adminView', adminView);
      sessionStorage.setItem('kehila.guideView', guideView);
    } catch {
      // Storage unavailable (private mode) — navigation simply won't persist.
    }
  }, [activeScreen, adminView, guideView]);

  // Subscribe to Firebase auth changes and enrich the user with their
  // Firestore profile (role defaults to "viewer" when none is set).
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      // Show the loader only for the very first session check; later
      // re-emissions (token refresh / reconnect) keep the current screen.
      if (!initialAuthResolved.current) {
        setLoading(true);
      }

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
        initialAuthResolved.current = true;
        setLoading(false);
      }
    });

    // Stop listening when the component unmounts.
    return () => unsubscribe();
  }, []);

  // Auto sign-out after 5 minutes with no activity at all (no clicks,
  // typing, scrolling or pointer movement), with a clear message.
  useEffect(() => {
    // Only track idleness while someone is signed in.
    if (!user) return undefined;

    let idleTimer;

    // (Re)start the countdown; fires the sign-out when it completes.
    const resetIdleTimer = () => {
      window.clearTimeout(idleTimer);
      idleTimer = window.setTimeout(async () => {
        try {
          await signOut(auth);
        } catch (error) {
          console.error('Idle sign-out failed:', error);
        }
        window.alert('נותקת מהמערכת עקב חוסר פעילות במשך 5 דקות.');
      }, IDLE_LIMIT_MS);
    };

    // capture:true also catches scrolling inside inner panels ('scroll'
    // doesn't bubble); passive keeps scrolling smooth.
    const activityEvents = ['mousemove', 'mousedown', 'keydown', 'wheel', 'touchstart', 'scroll'];
    activityEvents.forEach((eventName) =>
      window.addEventListener(eventName, resetIdleTimer, { capture: true, passive: true }));

    resetIdleTimer();

    return () => {
      window.clearTimeout(idleTimer);
      activityEvents.forEach((eventName) =>
        window.removeEventListener(eventName, resetIdleTimer, { capture: true }));
    };
  }, [user]);

  // ----- Device / browser back button -----
  // The app navigates by STATE (not the URL), so the phone's built-in back
  // button (notably on iPhone) would otherwise do nothing or leave the app. We
  // keep a history entry while the user is on any non-home screen; pressing the
  // device back then pops it and returns to the role's home view.

  // True when the signed-in user is on their role's home screen.
  const onHomeView = !user
    || (user.role === 'admin' && adminView === 'overview' && !selectedEvent && !selectedVolunteer)
    || (user.role === 'owner')
    || (user.role === 'guide' && guideView === 'menu')
    || (user.role !== 'admin' && user.role !== 'owner' && user.role !== 'guide'
        && activeScreen === 'users' && !selectedEvent && !selectedVolunteer);

  // The device back button steps back to the home view inside the app.
  useEffect(() => {
    if (!user) {
      return undefined;
    }

    const handlePopState = () => {
      setSelectedEvent(null);
      setSelectedVolunteer(null);
      setAdminView('overview');
      setGuideView('menu');
      setActiveScreen('users');
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [user]);

  // Add a history entry whenever the user moves onto a non-home screen, so the
  // device back button has something to pop.
  useEffect(() => {
    if (user && !onHomeView) {
      window.history.pushState({ kehilaDeep: true }, '');
    }
  }, [user, onHomeView]);

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

  // Return to the signed-in "home" view for the current role (admin overview /
  // guide menu / viewer list). Wired to the header logo, and it also closes any
  // open event / volunteer detail view.
  const handleNavigateHome = () => {
    setSelectedEvent(null);
    setSelectedVolunteer(null);
    setActiveScreen('users');
    setAdminView('overview');
    setGuideView('menu');
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

    // The owner gets ONLY the focused "manage admins" screen (add / remove
    // admins + transfer ownership) — none of the operational admin screens.
    if (role === 'owner') {
      return <AdminsManagement />;
    }

    // Admins get the full admin dashboard.
    if (role === 'admin') {
      return (
        <AdminDashboard
          currentView={adminView}
          setCurrentView={setAdminView}
          navOpen={adminNavOpen}
          setNavOpen={setAdminNavOpen}
        />
      );
    }

    // Guides get the guide dashboard.
    if (role === 'guide') {
      return <GuideDashboard user={user} currentView={guideView} setCurrentView={setGuideView} />;
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

  // Firebase password-reset links arrive as ?mode=resetPassword&oobCode=...
  // (Firebase's action URL is pointed at the app). Handle them with our own
  // Hebrew, styled reset page before any of the normal app rendering.
  const urlParams = new URLSearchParams(window.location.search);
  const isForcedPublicHome = urlParams.get('public') === '1';
  const isForcedPublicLogin = urlParams.get('login') === '1';

  if (urlParams.get('mode') === 'resetPassword' && urlParams.get('oobCode')) {
    return (
      <ResetPassword
        oobCode={urlParams.get('oobCode')}
        onDone={() => {
          // Leave the reset flow: drop the query string and return to the app.
          window.location.search = '';
        }}
      />
    );
  }

  // A shared registration-form link (?register=1) opens the public volunteer
  // form for anyone, regardless of sign-in. Admins send this link by WhatsApp
  // or email; once it is filled, the submission shows up in the admin screen.
  const isRegistrationForm = urlParams.get('register') === '1';

  // The public registration form, shown straight from the share link.
  if (isRegistrationForm) {
    return (
      <div className="app-shell" dir="rtl">
        <div className="public-layout">

          {/* Logo at the top — clicking it leaves the form and returns to the
              public home page (the site root clears the ?register=1 link). */}
          <a href={PUBLIC_HOME_URL} className="public-home-logo" aria-label="חזרה לדף הבית">
            <img
              src="https://www.shalva.org/wp-content/uploads/2025/02/Logo-Hebrew-1024x488-1.png"
              alt="שלוה"
            />
          </a>

          <section className="public-card public-card-wide" aria-label="הרשמה להתנדבות">
            <RegistrationScreen />
          </section>
        </div>
      </div>
    );
  }

  // A "sign this form" link (?sign=1&rid=...&name=...) opens the public digital
  // signing form for a volunteer — sent by the admin from the registrations
  // screen, filled in before the volunteer is approved.
  if (urlParams.get('sign') === '1') {
    return (
      <div className="app-shell" dir="rtl">
        <div className="public-layout">

          {/* Logo at the top — clicking it returns to the public home page. */}
          <a href={PUBLIC_HOME_URL} className="public-home-logo" aria-label="חזרה לדף הבית">
            <img
              src="https://www.shalva.org/wp-content/uploads/2025/02/Logo-Hebrew-1024x488-1.png"
              alt="שלוה"
            />
          </a>

          <section className="public-card public-card-wide" aria-label="טופס חתימה למתנדב/ת">
            <SignatureForm
              registrantId={urlParams.get('rid') || ''}
              prefillName={urlParams.get('name') || ''}
            />
          </section>
        </div>
      </div>
    );
  }

  // A "upload document" link (?uploadDoc=1&type=police|medical&rid=...&name=...) opens the public upload form
  if (urlParams.get('uploadDoc') === '1') {
    return (
      <div className="app-shell" dir="rtl">
        <div className="public-layout">
          <a href={PUBLIC_HOME_URL} className="public-home-logo" aria-label="חזרה לדף הבית">
            <img
              src="https://www.shalva.org/wp-content/uploads/2025/02/Logo-Hebrew-1024x488-1.png"
              alt="שלוה"
            />
          </a>

          <section className="public-card public-card-wide" aria-label="העלאת מסמך">
            <DocumentUploadForm
              registrantId={urlParams.get('rid') || ''}
              prefillName={urlParams.get('name') || ''}
              docType={urlParams.get('type') || ''}
            />
          </section>
        </div>
      </div>
    );
  }

  // A forced public home is used when leaving public forms via the logo. This
  // keeps that route public even on a browser that already has an admin session.
  if (isForcedPublicHome) {
    return (
      <div className="app-shell" dir="rtl">
        <div className="public-layout public-home">
          <MainScreen
            homeHref={PUBLIC_HOME_URL}
            registerHref="/?register=1"
            onNavigateLogin={() => {
              window.location.assign(PUBLIC_LOGIN_URL);
            }}
          />
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
        // On the admin HOME view we add `authenticated-layout--fit`, which locks
        // the admin area to the viewport height so the overview (stats, calendar,
        // חמ״ל, birthdays) fits with no page scroll. Other screens are untouched.
        <div
          className={[
            'authenticated-layout',
            user.role === 'admin' && adminView === 'overview' ? 'authenticated-layout--fit' : '',
          ].filter(Boolean).join(' ')}
        >

          {/* Shared top header: greeting on the right, actions on the left.
              (In RTL the first child sits on the right, so the greeting block
              comes first.) Admin navigation now lives in the sidebar, so the
              header only keeps the logout action. */}
          <header className="authenticated-header">

            {/* Admin hamburger — sits INSIDE the header bar (rightmost in
                RTL), scrolling together with it. */}
            {user.role === 'admin' && (
              <button
                type="button"
                className={`admin-nav-toggle ${adminNavOpen ? 'is-open' : ''}`}
                onClick={() => setAdminNavOpen((open) => !open)}
                aria-label={adminNavOpen ? 'סגירת תפריט ניהול' : 'פתיחת תפריט ניהול'}
                aria-expanded={adminNavOpen}
              >
                <span className="admin-nav-toggle-bar" aria-hidden="true" />
                <span className="admin-nav-toggle-bar" aria-hidden="true" />
                <span className="admin-nav-toggle-bar" aria-hidden="true" />
              </button>
            )}

            {/* Greeting + role badge + logo (right side). */}
            <div className="auth-user-block">
              {/* Clicking the logo returns to the dashboard home view. */}
              <button
                type="button"
                className="auth-logo-btn"
                onClick={handleNavigateHome}
                aria-label="חזרה לדף הבית"
              >
                <img
                  src="https://www.shalva.org/wp-content/uploads/2025/02/Logo-Hebrew-1024x488-1.png"
                  alt="שלוה"
                  className="auth-logo"
                />
              </button>
              <div className="auth-user">
                <h2 className="auth-greeting">שלום, {user.firstName || user.displayName || user.email}</h2>
                <span className="auth-role-badge">הרשאה: {ROLE_LABELS[user.role] || user.role || 'צופה'}</span>
              </div>
            </div>

            {/* Action buttons (left side) — just logout. */}
            <div className="auth-actions">
              <button type="button" className="auth-btn auth-btn-danger" onClick={handleLogout}>
                התנתקות
              </button>
            </div>
          </header>

          {/* The role-specific content. */}
          {renderRoleContent()}
        </div>
      ) : (

        // ----- Public (logged-out) layout -----
        // On the home page we add `public-home`, which lets the landing fill the
        // whole viewport (no outer padding) so it can fit with no page scroll.
        <div className={[
          'public-layout',
          publicView === 'main' && !isForcedPublicLogin ? 'public-home' : '',
          publicView === 'login' || isForcedPublicLogin ? 'public-login' : '',
        ].filter(Boolean).join(' ')}>

          {/* Home page. */}
          {publicView === 'main' && !isForcedPublicLogin && (
            <MainScreen onNavigateLogin={() => setPublicView('login')} />
          )}

          {/* Login page. */}
          {(publicView === 'login' || isForcedPublicLogin) && (
            <section className="public-card" aria-label="כניסה למערכת">
              <button
                className="link-button"
                onClick={() => {
                  window.location.assign(PUBLIC_HOME_URL);
                }}
              >
                חזרה לדף הבית
              </button>
              <Login />
            </section>
          )}
        </div>
      )}
    </div>
  );
}

export default App;
