import  { useEffect, useState } from 'react';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '../firebase';
import './UserList.css';

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
        const userList = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
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
        <div className="empty-state" style={{ color: '#e74c3c' }}>
          <strong>Error loading users:</strong><br />
          {error}
          <br /><br />
          <small>Check your browser console for more details. (Usually this is a Firebase Security Rules issue)</small>
        </div>
      </div>
    );
  }

  return (
    <div className="user-list-container">
      <div className="user-list-header">
        <h3>User Directory</h3>
        <span className="user-badge">
          {users.length} Users
        </span>
      </div>

      {users.length === 0 ? (
        <div className="empty-state">
          No users found in the directory.
        </div>
      ) : (
        <ul className="user-list">
          {users.map((user) => (
            <li key={user.id} className="user-item">
              <div className="user-info">
                <div className="user-avatar">
                  {(user.name || user.email || 'U').charAt(0).toUpperCase()}
                </div>
                <div className="user-details">
                  <div className="user-name">
                    {user.firstName +" "+ user.lastName || 'Unnamed User'}
                  </div>
                  <div className="user-email">
                    {user.id}
                  </div>
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
          ))}
        </ul>
      )}
    </div>
  );
};

export default UserList;
