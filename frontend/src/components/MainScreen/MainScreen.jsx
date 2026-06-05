// MainScreen — the public landing page (shown to logged-out visitors).
// A "קהילת שלווה" hero with a login button and a tabbed preview of the
// active community groups loaded from Firestore.

// React hooks for state and side effects.
import { useEffect, useState } from 'react';

// Firestore helpers for reading collections.
import { collection, getDocs } from 'firebase/firestore';

// Our Firestore database instance.
import { db } from '../../firebase';

// Styles for this screen.
import './MainScreen.css';


function MainScreen({ onNavigateLogin }) {
  // The public groups to preview.
  const [groups, setGroups] = useState([]);

  // The currently selected tab (group id).
  const [activeTabId, setActiveTabId] = useState(null);

  // True while groups load.
  const [loading, setLoading] = useState(true);

  // Load the public groups once, on mount.
  useEffect(() => {
    const fetchGroups = async () => {
      try {
        // Read the groups collection.
        const querySnapshot = await getDocs(collection(db, 'groups'));
        const groupsData = querySnapshot.docs.map((documentSnapshot) => ({
          id: documentSnapshot.id,
          ...documentSnapshot.data(),
        }));

        setGroups(groupsData);

        // Default to the first group's tab if none is selected yet.
        setActiveTabId((currentTabId) => currentTabId || groupsData[0]?.id || null);
      } catch (error) {
        console.error('Error fetching public groups:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchGroups();
  }, []);

  // The group whose tab is currently open, with a safe display name.
  const activeGroup = groups.find((group) => group.id === activeTabId);
  const activeGroupName =
    activeGroup?.groupName || activeGroup?.name || 'קבוצה ללא שם';

  return (
    <div className="main-container">

      {/* Hero header: title + login button. */}
      <header className="main-header">
        <div>
          <h1>קהילת שלווה</h1>
          <p>מערכת קהילתית לניהול מתנדבים, קבוצות ואירועים</p>
        </div>

        <div className="header-buttons">
          <button className="btn-login" onClick={onNavigateLogin}>כניסה</button>
        </div>
      </header>

      {/* Preview of the active groups. */}
      <section className="groups-section" aria-label="קבוצות פעילות">
        <h2>הקבוצות הפעילות שלנו</h2>

        {/* Loading, empty, or the tabbed group preview. */}
        {loading ? (
          <p>טוען קבוצות...</p>
        ) : groups.length === 0 ? (
          <p>כרגע אין קבוצות פעילות להצגה.</p>
        ) : (
          <div>

            {/* One tab button per group. */}
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

            {/* Details of the selected group. */}
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
