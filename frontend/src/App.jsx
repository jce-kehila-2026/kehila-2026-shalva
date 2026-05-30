import { useState, useEffect } from 'react'
import { onAuthStateChanged, signOut } from 'firebase/auth'
import { auth } from './firebase'
import { BrowserRouter } from 'react-router-dom' // הוספנו את הראוטר
import './App.css'
import Login from './components/Login'
// import UserList from './components/UserList'
import GroupManagement from './components/GroupManagement'

function App() {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)

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
    // עטפנו את כל האפליקציה ב-BrowserRouter כדי ש-useNavigate יעבוד
    <BrowserRouter>
      <div style={{ width: '100%', padding: '20px', boxSizing: 'border-box' }}>
        {user ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingBottom: '20px', borderBottom: '1px solid var(--border)' }}>
              <h2 style={{ margin: 0 }}>Welcome, {user.email}</h2>
              <button className="counter" onClick={handleLogout} style={{ margin: 0 }}>Logout</button>
            </header>
            {/* <UserList /> */}
            <GroupManagement />
          </div>
        ) : (
          <div id="center">
            <Login />
          </div>
        )}
      </div>
    </BrowserRouter>
  )
}

export default App