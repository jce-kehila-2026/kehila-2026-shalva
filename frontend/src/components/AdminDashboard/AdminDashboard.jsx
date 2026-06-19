// AdminDashboard — the admin area shell. A persistent sidebar (סרגל ניהול)
// lists every management area; the chosen area renders in the content pane.
// The home/overview also hosts the activity command center (חמ״ל), so חמ״ל is
// no longer a separate menu entry.

// React hooks for state and side effects.
import { useCallback, useEffect, useRef, useState } from 'react';

// The admin home / overview screen (now includes the חמ״ל).
import AdminOverview from '../AdminOverview/AdminOverview';

// Read-only attendance history screen.
import AdminAttendance from '../AdminAttendance/AdminAttendance';

// Feature screens reachable from the sidebar.
import Birthdays from '../Birthdays/Birthdays';
import Charts from '../Charts/Charts';
import EventDetails from '../EventDetails/EventDetails';
import EventManagement from '../EventManagement/EventManagement';
import GroupManagement from '../GroupManagement/GroupManagement';
import GuideManagement from '../GuideManagement/GuideManagement';
import Messages from '../Messages/Messages';
import RegistrationsManagement from '../RegistrationsManagement/RegistrationsManagement';
import Reports from '../Reports/Reports';
import VolunteersManagement from '../VolunteersManagement/VolunteersManagement';
import ProgramManagement from '../ProgramManagement/ProgramManagement';

// Styles for the admin shell + sidebar.
import './AdminDashboard.css';


// Sidebar navigation entries (id matches the view switch below).
// Text-only labels — no emoji icons, for a clean professional look.
const NAV_ITEMS = [
  { id: 'overview', label: 'דף הבית' },
  { id: 'groups', label: 'ניהול קבוצות' },
  { id: 'volunteers', label: 'ניהול מתנדבים' },
  { id: 'registrations', label: 'ניהול נרשמים' },
  { id: 'guides', label: 'ניהול מדריכים' },
  { id: 'events', label: 'ניהול אירועים' },
  { id: 'programs', label: 'ניהול תוכניות' },
  { id: 'attendance', label: 'מעקב נוכחות' },
  { id: 'messages', label: 'הודעות' },
  { id: 'reports', label: 'דוחות' },
  { id: 'charts', label: 'סטטיסטיקה' },
  { id: 'birthdays', label: 'ימי הולדת' },
];



// currentView / setCurrentView are lifted to App so navigation state survives
// across the shared header; navOpen / setNavOpen too, because the hamburger
// button itself renders inside App's shared header bar.
function AdminDashboard({ currentView, setCurrentView, navOpen = false, setNavOpen }) {
  // The event opened from the events area (null when none is open).
  const [selectedEvent, setSelectedEvent] = useState(null);

  // The screens visited before the current one (for the back button).
  const viewHistory = useRef([]);

  // A screen with internal levels (an open form, a chosen report…) registers
  // a handler here; it returns true when it consumed the back press by
  // stepping back INSIDE the module.
  const internalBackRef = useRef(null);
  const registerBack = useCallback((handler) => {
    internalBackRef.current = handler;
  }, []);

  // Back priority: 1) close an open event detail, 2) let the active screen
  // step back internally, 3) the previous module, 4) the dashboard home.
  const handleBack = () => {
    if (selectedEvent) {
      setSelectedEvent(null);
      return;
    }

    if (internalBackRef.current && internalBackRef.current()) {
      return;
    }

    internalBackRef.current = null;
    setCurrentView(viewHistory.current.pop() || 'overview');
  };

  // Default to the home view when nothing is selected yet.
  const activeView = currentView || 'overview';

  // Leaving the events area clears any previously opened event.
  useEffect(() => {
    if (activeView !== 'events') {
      setSelectedEvent(null);
    }
  }, [activeView]);

  // Render the screen that matches the active view.
  const renderContent = () => {
    switch (activeView) {

      // Group management.
      case 'groups':
        return <GroupManagement registerBack={registerBack} />;

      // Volunteer management.
      case 'volunteers':
        return <VolunteersManagement registerBack={registerBack} />;

      // Incoming registration submissions.
      case 'registrations':
        return <RegistrationsManagement />;

      // Guide management.
      case 'guides':
        return <GuideManagement />;

      // Events: show an opened event's details, otherwise the list/form.
      case 'events':
        return selectedEvent ? (
          <EventDetails event={selectedEvent} onBack={() => setSelectedEvent(null)} />
        ) : (
          <EventManagement registerBack={registerBack} onOpenEventDetails={(eventItem) => setSelectedEvent(eventItem)} />
        );

      // Program management.
      case 'programs':
        return <ProgramManagement registerBack={registerBack} />;


      // Read-only attendance history.
      case 'attendance':
        return <AdminAttendance registerBack={registerBack} />;

      // WhatsApp-based messaging hub.
      case 'messages':
        return <Messages />;

      // Reports.
      case 'reports':
        return <Reports registerBack={registerBack} />;

      // Charts / statistics.
      case 'charts':
        return <Charts />;

      // Birthdays (editable for admins).
      case 'birthdays':
        return <Birthdays editable />;

      // Default landing view: the home overview (with the חמ״ל inside it).
      // onNavigate lets the home's pending-volunteers chip open registrations.
      case 'overview':
      default:
        return <AdminOverview onNavigate={setCurrentView} />;
    }
  };

  return (
    <div className="admin-shell" dir="rtl">

      {/* The hamburger button lives in App's shared header; this screen only
          renders the drawer it opens. Dim backdrop closes on click. */}
      {navOpen && (
        <div className="admin-nav-backdrop" onClick={() => setNavOpen(false)} />
      )}

      {/* Navigation drawer, slides in from the right. */}
      <aside className={`admin-sidebar ${navOpen ? 'is-open' : ''}`} aria-label="ניווט ניהול">

        {/* Sidebar title. */}
        <div className="admin-sidebar-title">מרכז ניהול</div>

        {/* One nav button per area; the active one is highlighted. */}
        <nav className="admin-nav">
          {NAV_ITEMS.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`admin-nav-item ${activeView === item.id ? 'is-active' : ''}`}
              aria-current={activeView === item.id ? 'page' : undefined}
              onClick={() => {
                // Remember where we were, switch the view, close the drawer.
                if (item.id !== activeView) {
                  viewHistory.current.push(activeView);
                }
                internalBackRef.current = null;
                setCurrentView(item.id);
                setNavOpen(false);
              }}
            >
              {/* Area label (text only). */}
              <span className="admin-nav-label">{item.label}</span>
            </button>
          ))}
        </nav>
      </aside>

      {/* The selected area renders here. */}
      <div className="admin-content">

        {/* Breadcrumb + back — hidden on the home view. */}
        {activeView !== 'overview' && (
          <div className="admin-nav-row">
            <button type="button" className="admin-back-btn" onClick={handleBack}>
              → חזור
            </button>

            {/* Where am I: ראשי > current module (ראשי is clickable). */}
            <nav className="admin-breadcrumb" aria-label="מיקום במערכת">
              <button
                type="button"
                className="admin-crumb-link"
                onClick={() => {
                  internalBackRef.current = null;
                  viewHistory.current = [];
                  setCurrentView('overview');
                }}
              >
                ראשי
              </button>
              <span className="admin-crumb-sep">‹</span>
              <span className="admin-crumb-here">
                {NAV_ITEMS.find((item) => item.id === activeView)?.label || ''}
              </span>
            </nav>
          </div>
        )}

        {renderContent()}
      </div>
    </div>
  );
}

export default AdminDashboard;
