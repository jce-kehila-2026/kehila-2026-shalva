import { useState, useEffect } from 'react';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '../firebase'; 
import './MainScreen.css'; // 👈 Import the new minimal CSS

function MainScreen({ onNavigateLogin, onNavigateRegister }) {
  const [groups, setGroups] = useState([]);
  const [activeTabId, setActiveTabId] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchGroups = async () => {
      try {
        const querySnapshot = await getDocs(collection(db, 'groups'));
        const groupsData = [];
        
        querySnapshot.forEach((doc) => {
          groupsData.push({ id: doc.id, ...doc.data() });
        });

        setGroups(groupsData);
        
        if (groupsData.length > 0) {
          setActiveTabId(groupsData[0].id);
        }
      } catch (error) {
        console.error("Error fetching public groups:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchGroups();
  }, []);

  const activeGroup = groups.find((g) => g.id === activeTabId);

  return (
    <div className="main-container">
      
      <header className="main-header">
        <div>
          <h1>Kehila Hub</h1>
          <p>Community Management System</p>
        </div>

        <div className="header-buttons">
          <button className="btn-login" onClick={onNavigateLogin}>
            Log In
          </button>
          <button className="btn-register" onClick={onNavigateRegister}>
            Register
          </button>
        </div>
      </header>

      <div className="groups-section">
        <h2>Our Active Groups</h2>
        
        {loading ? (
          <p>Loading group schedules...</p>
        ) : groups.length === 0 ? (
          <p>No active groups are currently available.</p>
        ) : (
          <div>
            <div className="tabs-header">
              {groups.map((group) => (
                <button
                  key={group.id}
                  onClick={() => setActiveTabId(group.id)}
                  // Dynamically apply the 'active' class if this tab is clicked
                  className={`tab-btn ${activeTabId === group.id ? 'active' : ''}`}
                >
                  {group.groupName || 'Unnamed Group'}
                </button>
              ))}
            </div>

            {activeGroup && (
              <div className="tab-content">
                <h3>{activeGroup.groupName || 'Unnamed Group'}</h3>
                
                <div className="tab-details">
                  <p><strong>👨‍🏫 Lead Guide:</strong> {activeGroup.guideName || 'Pending Assignment'}</p>
                  <p><strong>🕒 Meeting Time:</strong> {activeGroup.time || 'TBD'}</p>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

    </div>
  );
}

export default MainScreen;