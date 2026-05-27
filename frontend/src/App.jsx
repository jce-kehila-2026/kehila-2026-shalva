import { useState, useEffect } from 'react'
import { onAuthStateChanged, signOut } from 'firebase/auth'
import { auth, db } from './firebase' // Ensure 'db' is exported from your firebase.js
import { doc, getDoc } from 'firebase/firestore'
import './App.css'

import Login from './components/Login'
import UserList from './components/UserList'
import AdminDashboard from './components/AdminDashboard'
import EventManagement from './components/EventManagement/EventManagement'
import EventDetails from './components/EventDetails/EventDetails'
import Reports from './components/Reports/Reports'
import VolunteerDetails from './components/VolunteerDetails/VolunteerDetails'

function App() {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)
  const [activeScreen, setActiveScreen] = useState('users')
  const [selectedEvent, setSelectedEvent] = useState(null)
  const [selectedVolunteer, setSelectedVolunteer] = useState(null)

  useEffect(() => {
    // This is the listener for the Auth state
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      try {
        if (currentUser) {
          // 1. Reference the specific document in the 'users' collection
          const userDocRef = doc(db, 'users', currentUser.uid);
          
          // 2. Fetch the document
          const userDocSnap = await getDoc(userDocRef);

          if (userDocSnap.exists()) {
            const userData = userDocSnap.data();
            // 3. Merge Auth data + Firestore data
            setUser({
              ...currentUser,
              role: userData.role // This pulls 'admin', 'guide', etc.
            });
          } else {
            console.warn("No user document found in Firestore!");
            setUser({ ...currentUser, role: 'viewer' }); // Fallback
          }
        } else {
          setUser(null);
        }
      } catch (error) {
        console.error("Error fetching user role:", error);
        setUser(null);
      } finally {
        setLoading(false);
      }
    });

    return () => unsubscribe();
  }, []);

  const handleLogout = async () => {
    try {
      await signOut(auth)
    } catch (error) {
      console.error('Error logging out:', error)
    }
  }

  const renderScreens = () => {
    if (selectedEvent) {
      return (
        <EventDetails
          event={selectedEvent}
          onBack={() => { setSelectedEvent(null); setActiveScreen('events'); }}
        />
      );
    }
    if (selectedVolunteer) {
      return (
        <VolunteerDetails
          volunteer={selectedVolunteer}
          onBack={() => { setSelectedVolunteer(null); setActiveScreen('users'); }}
        />
      );
    }
    switch (activeScreen) {
      case 'events':
        return <EventManagement onOpenEventDetails={(ev) => setSelectedEvent(ev)} />;
      case 'reports':
        return <Reports />;
      case 'users':
      default:
        return <UserList onOpenVolunteerDetails={(v) => setSelectedVolunteer(v)} />;
    }
  }

  const renderRoleContent = () => {
    if (!user) return <Login />;

    // Use the role we just fetched, defaulting to 'viewer'
    const role = user.role || 'viewer'; 

    switch (role) {
      case 'admin':
        return <AdminDashboard />;
      case 'guide':
        return <div>Guide Panel (Coming Soon)</div>;
      default:
        return (
          <>
            {!selectedEvent && !selectedVolunteer && (
              <nav style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                <button className="counter" onClick={() => setActiveScreen('users')}>רשימת מתנדבים</button>
                <button className="counter" onClick={() => setActiveScreen('events')}>ניהול אירועים</button>
                <button className="counter" onClick={() => setActiveScreen('reports')}>דוחות</button>
              </nav>
            )}
            {renderScreens()}
          </>
        );
    }
  }

  if (loading) {
    return (
      <div id="center">
        <div className="counter">Loading Profile...</div>
      </div>
    )
  }

  return (
    <div style={{ width: '100%', padding: '20px', boxSizing: 'border-box' }}>
      {user ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingBottom: '20px', borderBottom: '1px solid var(--border)' }}>
            <div>
              <h2 style={{ margin: 0 }}>Welcome, {user.email}</h2>
              <p style={{ margin: 0, color: 'gray', fontSize: '0.9rem' }}>
                Role: <strong>{user.role || 'User'}</strong>
              </p>
            </div>
            <button className="counter" onClick={handleLogout}>Logout</button>
          </header>
          
          {renderRoleContent()}
          
        </div>
      ) : (
        <div id="center">
          <Login />
        </div>
      )}
    </div>
  )
}

export default App