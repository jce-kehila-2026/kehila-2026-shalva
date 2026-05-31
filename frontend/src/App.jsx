import { useState, useEffect } from 'react';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import { auth, db } from './firebase'; // Ensure these are exported correctly from your firebase.js
import { doc, getDoc } from 'firebase/firestore';
import './App.css';

// 👇 1. ADDED THE MISSING MAIN SCREEN IMPORT HERE
import MainScreen from './components/MainScreen'; 

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

  // 👇 2. ADDED THE MISSING PUBLIC VIEW STATE HERE
  const [publicView, setPublicView] = useState('main')

  useEffect(() => {
    // 3. Global Authentication Listener
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      try {
        if (currentUser) {
          // Fetch the user's specific role from the 'users' collection
          const userDocRef = doc(db, 'users', currentUser.uid);
          const userDocSnap = await getDoc(userDocRef);

          if (userDocSnap.exists()) {
            const userData = userDocSnap.data();
            
            // Merge Auth data with Firestore data (so user.role is accessible everywhere)
            setUser({
              ...currentUser,
              role: userData.role 
            });
          } else {
            console.warn("No user document found in Firestore!");
            setUser({ ...currentUser, role: 'viewer' }); // Fallback role
          }
        } else {
          // No user is logged in
          setUser(null);
          // Reset public view back to the landing page upon logout
          setPublicView('main'); 
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

  // 4. Secure Logout Handler
  const handleLogout = async () => {
    try {
      await signOut(auth);
    } catch (error) {
      console.error('Error logging out:', error);
    }
  };

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
    const role = user.role || 'viewer'; 

    switch (role) {
      case 'admin':
        return <AdminDashboard />;
      case 'guide':
        // Replace this placeholder with <GuideDashboard user={user} /> when you build it
        return (
          <div style={{ padding: '20px', backgroundColor: '#e0f7fa', borderRadius: '8px' }}>
            <h3>Guide Operational Workspace</h3>
            <p>Welcome to your control panel. Attendance schedules and routing tools will render here.</p>
          </div>
        );
      case 'viewer':
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
  };

  // --- UI RENDERING ---

  // Show a loading screen while Firebase checks the user's tokens
  if (loading) {
    return (
      <div id="center" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
        <div className="counter" style={{ fontSize: '1.2rem', color: '#555' }}>
          Loading System Profiles...
        </div>
      </div>
    );
  }

  return (
    <div style={{ width: '100%', padding: '20px', boxSizing: 'border-box' }}>
      
      {/* SCENARIO A: SOMEONE IS LOGGED IN */}
      {user ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', maxWidth: '1200px', margin: '0 auto' }}>
          
          {/* Universal Authenticated Header */}
          <header style={{ 
            display: 'flex', 
            justifyContent: 'space-between', 
            alignItems: 'center', 
            paddingBottom: '20px', 
            borderBottom: '2px solid #eee' 
          }}>
            <div>
              <h2 style={{ margin: 0, color: '#2c3e50' }}>Welcome, {user.email}</h2>
              <p style={{ margin: 0, color: '#7f8c8d', fontSize: '0.9rem', marginTop: '5px' }}>
                System Clearance: <strong style={{ textTransform: 'capitalize' }}>{user.role || 'User'}</strong>
              </p>
            </div>
            <button 
              onClick={handleLogout}
              style={{ padding: '8px 16px', backgroundColor: '#e74c3c', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}
            >
              Sign Out
            </button>
          </header>
          
          {/* Inject the correct dashboard based on their role */}
          {renderRoleContent()}
          
        </div>
      ) : (
        
      /* SCENARIO B: NO ONE IS LOGGED IN (Public Navigation) */
        <div>
          {/* Main Landing Page (Tabs and Groups) */}
          {publicView === 'main' && (
            <MainScreen 
              onNavigateLogin={() => setPublicView('login')} 
              onNavigateRegister={() => setPublicView('register')} 
            />
          )}
          
          {/* Login Screen Overlay */}
          {publicView === 'login' && (
            <div style={{ maxWidth: '400px', margin: '40px auto' }}>
              <button 
                onClick={() => setPublicView('main')}
                style={{ marginBottom: '20px', background: 'none', border: 'none', color: '#3498db', cursor: 'pointer', padding: 0 }}
              >
                ← Back to Home
              </button>
              <Login />
            </div>
          )}

          {/* Registration Screen Overlay */}
          {publicView === 'register' && (
            <div style={{ maxWidth: '400px', margin: '40px auto' }}>
              <button 
                onClick={() => setPublicView('main')}
                style={{ marginBottom: '20px', background: 'none', border: 'none', color: '#3498db', cursor: 'pointer', padding: 0 }}
              >
                ← Back to Home
              </button>
              {/* <Register /> Component goes here! */}
              <div style={{ padding: '20px', border: '1px solid #ccc', borderRadius: '8px', textAlign: 'center' }}>
                <h3>Registration Portal</h3>
                <p>Build your Register.jsx component and place it here.</p>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default App;