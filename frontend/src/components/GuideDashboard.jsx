import { useNavigate } from 'react-router-dom';
import './GuideDashboard.css';  

const GuideDashboard = () => {
  const navigate = useNavigate();

  const handleLogout = () => {
    console.log('מבצע התנתקות מהמערכת...');
    navigate('/login'); 
  };

  return (
    <div className="guide-dashboard-container" dir="rtl">
      <header className="guide-header">
        <h1>לוח בקרה - מדריך</h1>
        <p>ברוך הבא, בחר את הפעולה הרצויה:</p>
      </header>

      <main className="guide-actions">
        <button 
          className="action-button secondary" 
          onClick={() => navigate('/group-details')}
        >
          👤 הקבוצה שלי (My Group)
        </button>

        <button 
          className="action-button primary" 
          onClick={() => navigate('/attendance')}
        >
          📝 סימון נוכחות (Attendance)
        </button>

        <button 
          className="action-button secondary" 
          onClick={() => navigate('/volunteers')}
        >
          👥 רשימת מתנדבים (Volunteers List)
        </button>
      </main>

      <footer className="guide-footer">
        <button className="logout-button" onClick={handleLogout}>
          התנתק (Logout)
        </button>
      </footer>
    </div>
  );
};

export default GuideDashboard;