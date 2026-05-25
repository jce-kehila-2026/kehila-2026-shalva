import { useState, useEffect } from 'react'
import { onAuthStateChanged, signOut } from 'firebase/auth'
import { auth } from './firebase'
import './App.css'
import Login from './components/Login'
import UserList from './components/UserList'
import RegistrationScreen from "./components/shoval/RegistrationScreen"
import AttendanceScreen from "./components/shoval/AttendanceScreen"
import VolunteerRegistrationScreen from "./components/shoval/VolunteerRegistrationScreen";
import GuideManagementScreen from "./components/shoval/GuideManagementScreen";
import GroupManagementScreen from "./components/shoval/GroupManagementScreen";

function App() {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)
  const [activeScreen, setActiveScreen] = useState("users")

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser)
      setLoading(false)
    })
    return () => unsubscribe()
  }, [])

  const handleLogout = async () => {
    try {
      await signOut(auth)
    } catch (error) {
      console.error('Error logging out:', error)
    }
  }

  if (loading) {
    return (
      <div id="center">
        <div className="counter">Loading...</div>
      </div>
    )
  }

  return (
    <div style={{ width: '100%', padding: '20px', boxSizing: 'border-box' }}>
      {user ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingBottom: '20px', borderBottom: '1px solid var(--border)' }}>
            <h2 style={{ margin: 0 }}>Welcome, {user.email}</h2>
            <button className="counter" onClick={handleLogout} style={{ margin: 0 }}>
              Logout
            </button>
          </header>

          <nav style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
            <button className="counter" onClick={() => setActiveScreen("users")}>
              Users
            </button>

            <button className="counter" onClick={() => setActiveScreen("registration")}>
              Registration Screen
            </button>

            <button className="counter" onClick={() => setActiveScreen("attendance")}>
              Attendance Screen
            </button>

            <button className="counter" onClick={() => setActiveScreen("volunteers")}>
  Volunteer Registration
</button>

<button className="counter" onClick={() => setActiveScreen("guides")}>
  Guide Management
</button>

<button className="counter" onClick={() => setActiveScreen("groups")}>
  Group Management
</button>
          </nav>

          {activeScreen === "users" && <UserList />}
          {activeScreen === "registration" && <RegistrationScreen />}
          {activeScreen === "attendance" && <AttendanceScreen />}
          {activeScreen === "volunteers" && <VolunteerRegistrationScreen />}
          {activeScreen === "guides" && <GuideManagementScreen />}
          {activeScreen === "groups" && <GroupManagementScreen />}
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