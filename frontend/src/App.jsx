import { useEffect, useState } from 'react';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';

import { auth, db } from './firebase';
import './App.css';

import AdminDashboard from './components/AdminDashboard';
import EventDetails from './components/EventDetails/EventDetails';
import EventManagement from './components/EventManagement/EventManagement';
import GuideDashboard from './components/GuideDashboard';
import Login from './components/Login';
import MainScreen from './components/MainScreen';
import RegistrationScreen from './components/RegistrationScreen';
import Reports from './components/Reports/Reports';
import UserList from './components/UserList';
import VolunteerDetails from './components/VolunteerDetails/VolunteerDetails';

function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeScreen, setActiveScreen] = useState('users');
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [selectedVolunteer, setSelectedVolunteer] = useState(null);
  const [publicView, setPublicView] = useState('main');

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setLoading(true);

      try {
        if (!currentUser) {
          setUser(null);
          setPublicView('main');
          return;
        }

        const userDocRef = doc(db, 'users', currentUser.uid);
        const userDocSnap = await getDoc(userDocRef);
        const userData = userDocSnap.exists() ? userDocSnap.data() : {};

        setUser({
          uid: currentUser.uid,
          email: currentUser.email,
          displayName: currentUser.displayName,
          ...userData,
          role: userData.role || 'viewer',
        });
      } catch (error) {
        console.error('Error fetching user role:', error);
        setUser(null);
      } finally {
        setLoading(false);
      }
    });

    return () => unsubscribe();
  }, []);

  const handleLogout = async () => {
    try {
      await signOut(auth);
      setSelectedEvent(null);
      setSelectedVolunteer(null);
      setActiveScreen('users');
      setPublicView('main');
    } catch (error) {
      console.error('Error logging out:', error);
    }
  };

  const renderViewerScreens = () => {
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

    switch (activeScreen) {
      case 'events':
        return <EventManagement onOpenEventDetails={(eventItem) => setSelectedEvent(eventItem)} />;
      case 'reports':
        return <Reports />;
      case 'users':
      default:
        return <UserList onOpenVolunteerDetails={(volunteer) => setSelectedVolunteer(volunteer)} />;
    }
  };

  const renderRoleContent = () => {
    const role = user?.role || 'viewer';

    if (role === 'admin') {
      return <AdminDashboard />;
    }

    if (role === 'guide') {
      return <GuideDashboard user={user} onLogout={handleLogout} />;
    }

    return (
      <>
        {!selectedEvent && !selectedVolunteer && (
          <nav className="app-tabs" aria-label="ניווט משתמש">
            <button className="counter" onClick={() => setActiveScreen('users')}>רשימת מתנדבים</button>
            <button className="counter" onClick={() => setActiveScreen('events')}>ניהול אירועים</button>
            <button className="counter" onClick={() => setActiveScreen('reports')}>דוחות</button>
          </nav>
        )}
        {renderViewerScreens()}
      </>
    );
  };

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
        <div className="authenticated-layout">
          <header className="authenticated-header">
            <div>
              <h2>שלום, {user.firstName || user.displayName || user.email}</h2>
              <p>
                הרשאה במערכת: <strong>{user.role || 'viewer'}</strong>
              </p>
            </div>
            <button className="logout-button" onClick={handleLogout}>התנתקות</button>
          </header>

          {renderRoleContent()}
        </div>
      ) : (
        <div className="public-layout">
          {publicView === 'main' && (
            <MainScreen
              onNavigateLogin={() => setPublicView('login')}
              onNavigateRegister={() => setPublicView('register')}
            />
          )}

          {publicView === 'login' && (
            <section className="public-card" aria-label="כניסה למערכת">
              <button className="link-button" onClick={() => setPublicView('main')}>חזרה לדף הבית</button>
              <Login />
            </section>
          )}

          {publicView === 'register' && (
            <section className="public-card public-card-wide" aria-label="הרשמה להתנדבות">
              <button className="link-button" onClick={() => setPublicView('main')}>חזרה לדף הבית</button>
              <RegistrationScreen />
            </section>
          )}
        </div>
      )}
    </div>
  );
}

export default App;
