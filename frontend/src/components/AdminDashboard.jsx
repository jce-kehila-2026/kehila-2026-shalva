import { useState } from 'react';
// Import your sub-screens here as you build them:
// import GroupManagement from './GroupManagement';
// import VolunteerManagement from './VolunteerManagement';

function AdminDashboard() {
  // 'menu' means we show the main 5 option buttons
  const [currentView, setCurrentView] = useState('menu');

  // Switch between views inside the Admin domain
  switch (currentView) {
    case 'groups':
      return (
        <div>
          <button onClick={() => setCurrentView('menu')}>← Back to Menu</button>
          <h3>Group Management Screen (Screen 6)</h3>
          {/* <GroupManagement /> */}
        </div>
      );
    case 'volunteers':
      return (
        <div>
          <button onClick={() => setCurrentView('menu')}>← Back to Menu</button>
          <h3>Volunteer Management Screen (Screen 8)</h3>
          {/* <VolunteerManagement /> */}
        </div>
      );
    case 'guides':
      return (
        <div>
          <button onClick={() => setCurrentView('menu')}>← Back to Menu</button>
          <h3>Guide Management Screen (Screen 9)</h3>
        </div>
      );
    case 'events':
      return (
        <div>
          <button onClick={() => setCurrentView('menu')}>← Back to Menu</button>
          <h3>Event Management Screen (Screen 11)</h3>
        </div>
      );
    case 'reports':
      return (
        <div>
          <button onClick={() => setCurrentView('menu')}>← Back to Menu</button>
          <h3>Reports Screen (Screen 13)</h3>
        </div>
      );
    
    // Default case is the Main Dashboard Menu (Screen 4)
    case 'menu':
    default:
      return (
        <div>
          <h3>Admin Control Center</h3>
          <div>
            <button onClick={() => setCurrentView('groups')}>Groups Management</button>
            <button onClick={() => setCurrentView('volunteers')}>Volunteers Management</button>
            <button onClick={() => setCurrentView('guides')}>Guides Management</button>
            <button onClick={() => setCurrentView('events')}>Events Management</button>
            <button onClick={() => setCurrentView('reports')}>Reports</button>
          </div>
        </div>
      );
  }
}

export default AdminDashboard;