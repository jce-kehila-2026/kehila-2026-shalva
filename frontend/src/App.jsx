import { useState, useEffect } from 'react';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import { auth, db } from './firebase'; 
import { doc, getDoc } from 'firebase/firestore';
import { Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import './App.css';

// Import Screens
import MainScreen from './components/MainScreen'; 
import Login from './components/login'; // Casing fixed to lowercase
import RegistrationScreen from './components/RegistrationScreen';
import AdminDashboard from './components/AdminDashboard';
import GuideDashboard from './components/GuideDashboard';
import GroupManagement from './components/GroupManagement';
import GroupDetails from './components/GroupDetails';
import VolunteersManagement from './components/VolunteersManagement';
import GuideManagement from './components/GuideManagement';
import AttendanceScreen from './components/AttendanceScreen';
import EventManagement from './components/EventManagement/EventManagement';
import EventDetails from './components/EventDetails/EventDetails';
import Reports from './components/Reports/Reports';
import VolunteerDetails from './components/VolunteerDetails/VolunteerDetails';

// Route Guard Component
const ProtectedRoute = ({ user, requiredRole, allowedRoles, children }) => {
  if (!user) {
    return <Navigate to="/login" replace />;
  }
  
  if (requiredRole && user.role !== requiredRole) {
    return <Navigate to="/" replace />;
  }

  if (allowedRoles && !allowedRoles.includes(user.role)) {
    return <Navigate to="/" replace />;
  }

  return children;
};

// Layout for Logged In Users
const AuthenticatedLayout = ({ user, handleLogout, children }) => (
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
    
    {children}
  </div>
);

function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    // Global Authentication Listener
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

  // Secure Logout Handler
  const handleLogout = async () => {
    try {
      await signOut(auth);
      navigate('/');
    } catch (error) {
      console.error('Error logging out:', error);
    }
  };

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
      <Routes>
        {/* Public Routes (Only if not logged in) */}
        <Route path="/" element={
          user ? <Navigate to={user.role === 'admin' ? "/admin" : "/guide"} replace /> : (
            <MainScreen 
              onNavigateLogin={() => navigate('/login')} 
              onNavigateRegister={() => navigate('/register')} 
            />
          )
        } />
        
        <Route path="/login" element={
          user ? <Navigate to={user.role === 'admin' ? "/admin" : "/guide"} replace /> : (
            <div style={{ maxWidth: '400px', margin: '40px auto' }}>
              <button 
                onClick={() => navigate('/')}
                style={{ marginBottom: '20px', background: 'none', border: 'none', color: '#3498db', cursor: 'pointer', padding: 0 }}
              >
                ← Back to Home
              </button>
              <Login />
            </div>
          )
        } />

        <Route path="/register" element={
          user ? <Navigate to={user.role === 'admin' ? "/admin" : "/guide"} replace /> : (
            <div style={{ maxWidth: '600px', margin: '40px auto' }}>
              <button 
                onClick={() => navigate('/')}
                style={{ marginBottom: '20px', background: 'none', border: 'none', color: '#3498db', cursor: 'pointer', padding: 0 }}
              >
                ← Back to Home
              </button>
              <RegistrationScreen />
            </div>
          )
        } />

        {/* Admin Routes (Required role: admin) */}
        <Route path="/admin" element={
          <ProtectedRoute user={user} requiredRole="admin">
            <AuthenticatedLayout user={user} handleLogout={handleLogout}>
              <AdminDashboard />
            </AuthenticatedLayout>
          </ProtectedRoute>
        } />

        <Route path="/admin/groups" element={
          <ProtectedRoute user={user} requiredRole="admin">
            <AuthenticatedLayout user={user} handleLogout={handleLogout}>
              <GroupManagement />
            </AuthenticatedLayout>
          </ProtectedRoute>
        } />

        <Route path="/admin/volunteers" element={
          <ProtectedRoute user={user} requiredRole="admin">
            <AuthenticatedLayout user={user} handleLogout={handleLogout}>
              <VolunteersManagement />
            </AuthenticatedLayout>
          </ProtectedRoute>
        } />

        <Route path="/admin/guides" element={
          <ProtectedRoute user={user} requiredRole="admin">
            <AuthenticatedLayout user={user} handleLogout={handleLogout}>
              <GuideManagement />
            </AuthenticatedLayout>
          </ProtectedRoute>
        } />

        <Route path="/admin/events" element={
          <ProtectedRoute user={user} requiredRole="admin">
            <AuthenticatedLayout user={user} handleLogout={handleLogout}>
              <EventManagement />
            </AuthenticatedLayout>
          </ProtectedRoute>
        } />

        <Route path="/admin/reports" element={
          <ProtectedRoute user={user} requiredRole="admin">
            <AuthenticatedLayout user={user} handleLogout={handleLogout}>
              <Reports />
            </AuthenticatedLayout>
          </ProtectedRoute>
        } />

        {/* Guide Routes (Required role: guide) */}
        <Route path="/guide" element={
          <ProtectedRoute user={user} requiredRole="guide">
            <AuthenticatedLayout user={user} handleLogout={handleLogout}>
              <GuideDashboard />
            </AuthenticatedLayout>
          </ProtectedRoute>
        } />

        <Route path="/attendance" element={
          <ProtectedRoute user={user} allowedRoles={['admin', 'guide']}>
            <AuthenticatedLayout user={user} handleLogout={handleLogout}>
              <AttendanceScreen />
            </AuthenticatedLayout>
          </ProtectedRoute>
        } />

        {/* Shared Authenticated Routes */}
        <Route path="/group-details/:groupId" element={
          <ProtectedRoute user={user} allowedRoles={['admin', 'guide']}>
            <AuthenticatedLayout user={user} handleLogout={handleLogout}>
              <GroupDetails />
            </AuthenticatedLayout>
          </ProtectedRoute>
        } />

        <Route path="/group-details" element={
          <ProtectedRoute user={user} allowedRoles={['admin', 'guide']}>
            <AuthenticatedLayout user={user} handleLogout={handleLogout}>
              <GroupDetails />
            </AuthenticatedLayout>
          </ProtectedRoute>
        } />

        <Route path="/volunteer-details/:volunteerId" element={
          <ProtectedRoute user={user} allowedRoles={['admin', 'guide']}>
            <AuthenticatedLayout user={user} handleLogout={handleLogout}>
              <VolunteerDetails />
            </AuthenticatedLayout>
          </ProtectedRoute>
        } />

        <Route path="/volunteer-details" element={
          <ProtectedRoute user={user} allowedRoles={['admin', 'guide']}>
            <AuthenticatedLayout user={user} handleLogout={handleLogout}>
              <VolunteerDetails />
            </AuthenticatedLayout>
          </ProtectedRoute>
        } />

        <Route path="/event-details/:eventId" element={
          <ProtectedRoute user={user} allowedRoles={['admin', 'guide']}>
            <AuthenticatedLayout user={user} handleLogout={handleLogout}>
              <EventDetails />
            </AuthenticatedLayout>
          </ProtectedRoute>
        } />

        <Route path="/event-details" element={
          <ProtectedRoute user={user} allowedRoles={['admin', 'guide']}>
            <AuthenticatedLayout user={user} handleLogout={handleLogout}>
              <EventDetails />
            </AuthenticatedLayout>
          </ProtectedRoute>
        } />

        {/* Fallback Route */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </div>
  );
}

export default App;
