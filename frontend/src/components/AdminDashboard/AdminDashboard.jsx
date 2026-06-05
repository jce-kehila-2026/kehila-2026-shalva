// React hooks for state and side effects.
import { useEffect, useState } from 'react';

// The admin home / overview screen.
import AdminOverview from '../AdminOverview/AdminOverview';

// Feature screens reachable from the admin menu.
import ActivityCommandCenter from '../ActivityCommandCenter/ActivityCommandCenter';
import Birthdays from '../Birthdays/Birthdays';
import Charts from '../Charts/Charts';
import EventDetails from '../EventDetails/EventDetails';
import EventManagement from '../EventManagement/EventManagement';
import GroupManagement from '../GroupManagement/GroupManagement';
import GuideManagement from '../GuideManagement/GuideManagement';
import RegistrationsManagement from '../RegistrationsManagement/RegistrationsManagement';
import Reports from '../Reports/Reports';
import VolunteersManagement from '../VolunteersManagement/VolunteersManagement';


// The menu tiles shown on the admin landing screen (id + Hebrew label).
const MENU_ITEMS = [
  { id: 'activity', label: 'חמ״ל פעילות' },
  { id: 'groups', label: 'ניהול קבוצות' },
  { id: 'volunteers', label: 'ניהול מתנדבים' },
  { id: 'registrations', label: 'הרשמות להתנדבות' },
  { id: 'guides', label: 'ניהול מדריכים' },
  { id: 'events', label: 'ניהול אירועים' },
  { id: 'reports', label: 'דוחות' },
  { id: 'charts', label: 'תרשימים' },
  { id: 'birthdays', label: 'ימי הולדת' },
];


// currentView / setCurrentView are lifted to App so the "back to menu"
// action can live in the top header next to the logout button.
function AdminDashboard({ currentView, setCurrentView }) {
  // The event opened from the events area (null when none is open).
  const [selectedEvent, setSelectedEvent] = useState(null);

  // When the user leaves the events area (e.g. via the header button or by
  // going home / to the menu), make sure a previously opened event is cleared.
  useEffect(() => {
    if (currentView !== 'events') {
      setSelectedEvent(null);
    }
  }, [currentView]);

  // Render the screen that matches the current view.
  switch (currentView) {

    // Daily operations hub (events today/tomorrow + quick attendance).
    case 'activity':
      return <ActivityCommandCenter />;

    // Group management (can jump to volunteers).
    case 'groups':
      return <GroupManagement onOpenVolunteers={() => setCurrentView('volunteers')} />;

    // Volunteer management.
    case 'volunteers':
      return <VolunteersManagement />;

    // Incoming registration submissions.
    case 'registrations':
      return <RegistrationsManagement />;

    // Guide management.
    case 'guides':
      return <GuideManagement />;

    // Events: show the details of an opened event, otherwise the list/form.
    case 'events':
      return selectedEvent ? (
        <EventDetails event={selectedEvent} onBack={() => setSelectedEvent(null)} />
      ) : (
        <EventManagement onOpenEventDetails={(eventItem) => setSelectedEvent(eventItem)} />
      );

    // Reports.
    case 'reports':
      return <Reports />;

    // Charts / statistics.
    case 'charts':
      return <Charts />;

    // Birthdays (editable for admins).
    case 'birthdays':
      return <Birthdays editable />;

    // The landing menu of management tiles.
    case 'menu':
      return (
        <section className="admin-dashboard" aria-label="תפריט מנהל">
          <h2>מרכז ניהול</h2>
          <p>בחרו את האזור שתרצו לנהל.</p>

          {/* One button per menu item. */}
          <div className="admin-menu-grid">
            {MENU_ITEMS.map((item) => (
              <button key={item.id} className="admin-menu-button" onClick={() => setCurrentView(item.id)}>
                {item.label}
              </button>
            ))}
          </div>
        </section>
      );

    // Default landing view: the read-only overview.
    case 'overview':
    default:
      return <AdminOverview />;
  }
}

export default AdminDashboard;
