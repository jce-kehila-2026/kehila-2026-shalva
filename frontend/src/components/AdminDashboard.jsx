import { useState } from 'react';

import EventDetails from './EventDetails/EventDetails';
import EventManagement from './EventManagement/EventManagement';
import GroupManagement from './GroupManagement';
import GuideManagement from './GuideManagement';
import Reports from './Reports/Reports';
import VolunteersManagement from './VolunteersManagement';

const MENU_ITEMS = [
  { id: 'groups', label: 'ניהול קבוצות' },
  { id: 'volunteers', label: 'ניהול מתנדבים' },
  { id: 'guides', label: 'ניהול מדריכים' },
  { id: 'events', label: 'ניהול אירועים' },
  { id: 'reports', label: 'דוחות' },
];

function AdminDashboard() {
  const [currentView, setCurrentView] = useState('menu');
  const [selectedEvent, setSelectedEvent] = useState(null);

  const backToMenu = () => {
    setSelectedEvent(null);
    setCurrentView('menu');
  };

  const renderHeader = (title) => (
    <div className="action-bar dashboard-bar">
      <h2 className="admin-title dashboard-title">{title}</h2>
      <button className="btn btn-outline" onClick={backToMenu}>חזרה לתפריט</button>
    </div>
  );

  switch (currentView) {
    case 'groups':
      return (
        <div>
          {renderHeader('ניהול קבוצות')}
          <GroupManagement onOpenVolunteers={() => setCurrentView('volunteers')} />
        </div>
      );

    case 'volunteers':
      return (
        <div>
          {renderHeader('ניהול מתנדבים')}
          <VolunteersManagement onBack={backToMenu} />
        </div>
      );

    case 'guides':
      return (
        <div className="admin-container">
          {renderHeader('ניהול מדריכים')}
          <GuideManagement />
        </div>
      );

    case 'events':
      return selectedEvent ? (
        <EventDetails event={selectedEvent} onBack={() => setSelectedEvent(null)} />
      ) : (
        <div>
          {renderHeader('ניהול אירועים')}
          <EventManagement onOpenEventDetails={(eventItem) => setSelectedEvent(eventItem)} />
        </div>
      );

    case 'reports':
      return (
        <div>
          {renderHeader('דוחות')}
          <Reports />
        </div>
      );

    case 'menu':
    default:
      return (
        <section className="admin-dashboard" aria-label="תפריט מנהל">
          <h2>מרכז ניהול</h2>
          <p>בחרו את האזור שתרצו לנהל.</p>
          <div className="admin-menu-grid">
            {MENU_ITEMS.map((item) => (
              <button key={item.id} className="admin-menu-button" onClick={() => setCurrentView(item.id)}>
                {item.label}
              </button>
            ))}
          </div>
        </section>
      );
  }
}

export default AdminDashboard;
