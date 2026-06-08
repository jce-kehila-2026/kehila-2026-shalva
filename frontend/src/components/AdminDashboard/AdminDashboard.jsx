// AdminDashboard — the admin area shell. A persistent sidebar (סרגל ניהול)
// lists every management area; the chosen area renders in the content pane.
// The home/overview also hosts the activity command center (חמ״ל), so חמ״ל is
// no longer a separate menu entry.

// React hooks for state and side effects.
import { useEffect, useState } from 'react';

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
import RegistrationsManagement from '../RegistrationsManagement/RegistrationsManagement';
import Reports from '../Reports/Reports';
import VolunteersManagement from '../VolunteersManagement/VolunteersManagement';

// Styles for the admin shell + sidebar.
import './AdminDashboard.css';


// Sidebar navigation entries (id matches the view switch below).
// Text-only labels — no emoji icons, for a clean professional look.
const NAV_ITEMS = [
  { id: 'overview', label: 'דף הבית' },
  { id: 'groups', label: 'ניהול קבוצות' },
  { id: 'volunteers', label: 'ניהול מתנדבים' },
  { id: 'registrations', label: 'הרשמות להתנדבות' },
  { id: 'guides', label: 'ניהול מדריכים' },
  { id: 'events', label: 'ניהול אירועים' },
  { id: 'attendance', label: 'מעקב נוכחות' },
  { id: 'reports', label: 'דוחות' },
  { id: 'charts', label: 'תרשימים' },
  { id: 'birthdays', label: 'ימי הולדת' },
];


// currentView / setCurrentView are lifted to App so navigation state survives
// across the shared header.
function AdminDashboard({ currentView, setCurrentView }) {
  // The event opened from the events area (null when none is open).
  const [selectedEvent, setSelectedEvent] = useState(null);

  // Whether the mobile navigation drawer is open.
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

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
        return <GroupManagement />;

      // Volunteer management.
      case 'volunteers':
        return <VolunteersManagement />;

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
          <EventManagement onOpenEventDetails={(eventItem) => setSelectedEvent(eventItem)} />
        );

      // Read-only attendance history.
      case 'attendance':
        return <AdminAttendance />;

      // Reports.
      case 'reports':
        return <Reports />;

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

      {/* Mobile-only button that opens the navigation drawer. */}
      <button type="button" className="admin-nav-toggle" onClick={() => setMobileNavOpen(true)}>
        <span aria-hidden="true">☰</span> מרכז ניהול
      </button>

      {/* Dim backdrop behind the open mobile drawer (click to close). */}
      {mobileNavOpen && (
        <div className="admin-nav-backdrop" onClick={() => setMobileNavOpen(false)} />
      )}

      {/* Navigation: a persistent sidebar on desktop, a slide-in drawer on mobile. */}
      <aside className={`admin-sidebar ${mobileNavOpen ? 'is-open' : ''}`} aria-label="ניווט ניהול">

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
                // Switch the view and close the mobile drawer.
                setCurrentView(item.id);
                setMobileNavOpen(false);
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
        {renderContent()}
      </div>
    </div>
  );
}

export default AdminDashboard;
