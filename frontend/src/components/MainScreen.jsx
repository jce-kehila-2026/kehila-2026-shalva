import { useEffect, useState } from 'react';
import { collection, getDocs } from 'firebase/firestore';

import { db } from '../firebase';
import './MainScreen.css';

function MainScreen({ onNavigateLogin, onNavigateRegister }) {
  const [groups, setGroups] = useState([]);
  const [activeTabId, setActiveTabId] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchGroups = async () => {
      try {
        const querySnapshot = await getDocs(collection(db, 'groups'));
        const groupsData = querySnapshot.docs.map((documentSnapshot) => ({
          id: documentSnapshot.id,
          ...documentSnapshot.data(),
        }));

        setGroups(groupsData);
        setActiveTabId((currentTabId) => currentTabId || groupsData[0]?.id || null);
      } catch (error) {
        console.error('Error fetching public groups:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchGroups();
  }, []);

  const activeGroup = groups.find((group) => group.id === activeTabId);
  const activeGroupName = activeGroup?.groupName || activeGroup?.name || 'קבוצה ללא שם';

  return (
    <div className="main-container">
      <header className="main-header">
        <div>
          <h1>Kehila Hub</h1>
          <p>מערכת קהילתית לניהול מתנדבים, קבוצות ואירועים</p>
        </div>

        <div className="header-buttons">
          <button className="btn-login" onClick={onNavigateLogin}>כניסה</button>
          <button className="btn-register" onClick={onNavigateRegister}>הרשמה להתנדבות</button>
        </div>
      </header>

      <section className="groups-section" aria-label="קבוצות פעילות">
        <h2>הקבוצות הפעילות שלנו</h2>

        {loading ? (
          <p>טוען קבוצות...</p>
        ) : groups.length === 0 ? (
          <p>כרגע אין קבוצות פעילות להצגה.</p>
        ) : (
          <div>
            <div className="tabs-header">
              {groups.map((group) => (
                <button
                  key={group.id}
                  onClick={() => setActiveTabId(group.id)}
                  className={`tab-btn ${activeTabId === group.id ? 'active' : ''}`}
                >
                  {group.groupName || group.name || 'קבוצה ללא שם'}
                </button>
              ))}
            </div>

            {activeGroup && (
              <article className="tab-content">
                <h3>{activeGroupName}</h3>
                <div className="tab-details">
                  <p><strong>מדריך/ה:</strong> {activeGroup.guideName || activeGroup.guide || 'טרם שובץ מדריך'}</p>
                  <p><strong>שעת מפגש:</strong> {activeGroup.time || 'טרם נקבעה שעה'}</p>
                </div>
              </article>
            )}
          </div>
        )}
      </section>
    </div>
  );
}

export default MainScreen;
