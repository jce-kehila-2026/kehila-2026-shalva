import { useEffect, useState } from 'react';
import { collection, getDocs } from 'firebase/firestore';

import { db } from '../firebase';
import './UserList.css';

const getUserName = (user) => (
  user.name ||
  [user.firstName, user.lastName].filter(Boolean).join(' ').trim() ||
  user.email ||
  'משתמש ללא שם'
);

const UserList = ({ onOpenVolunteerDetails }) => {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const handleOpenDetails = (user) => {
    if (typeof onOpenVolunteerDetails === 'function') {
      onOpenVolunteerDetails(user);
    }
  };

  useEffect(() => {
    const fetchUsers = async () => {
      try {
        const querySnapshot = await getDocs(collection(db, 'users'));
        const userList = querySnapshot.docs.map((documentSnapshot) => ({ id: documentSnapshot.id, ...documentSnapshot.data() }));
        setUsers(userList);
      } catch (err) {
        console.error('Error fetching users:', err);
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    fetchUsers();
  }, []);

  if (loading) {
    return (
      <div className="loading-container">
        <div className="spinner"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="user-list-container">
        <div className="empty-state error-state">
          <strong>שגיאה בטעינת המשתמשים:</strong><br />
          {error}
          <br /><br />
          <small>בדקו את הרשאות Firebase Security Rules ואת קונסול הדפדפן.</small>
        </div>
      </div>
    );
  }

  return (
    <div className="user-list-container">
      <div className="user-list-header">
        <h3>רשימת משתמשים / מתנדבים</h3>
        <span className="user-badge">{users.length} רשומות</span>
      </div>

      {users.length === 0 ? (
        <div className="empty-state">לא נמצאו משתמשים.</div>
      ) : (
        <ul className="user-list">
          {users.map((user) => {
            const userName = getUserName(user);

            return (
              <li key={user.id} className="user-item">
                <div className="user-info">
                  <div className="user-avatar">{userName.charAt(0).toUpperCase()}</div>
                  <div className="user-details">
                    <div className="user-name">{userName}</div>
                    <div className="user-email">{user.email || user.id}</div>
                  </div>
                </div>
                <button
                  type="button"
                  className="user-details-button"
                  onClick={() => handleOpenDetails(user)}
                >
                  פרטים
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};

export default UserList;
