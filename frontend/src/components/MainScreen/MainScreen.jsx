// MainScreen — the public landing page (shown to logged-out visitors).
// A "קהילת שלווה" hero with login + volunteer-signup calls to action, and a
// card grid previewing the active community groups loaded from Firestore.

// React hooks for state and side effects.
import { useEffect, useState } from 'react';

// Firestore helpers for reading collections.
import { collection, getDocs } from 'firebase/firestore';

// Our Firestore database instance.
import { db } from '../../firebase';

// The cinematic, auto-playing presentation of the groups.
import GroupShowcase from './GroupShowcase/GroupShowcase';

// Styles for this screen.
import './MainScreen.css';


function MainScreen({ onNavigateLogin }) {
  // The public groups to preview.
  const [groups, setGroups] = useState([]);

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
      } catch (error) {
        console.error('Error fetching public groups:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchGroups();
  }, []);

  return (
    <div className="main-container">

      {/* Top header: logo + login / signup actions. */}
      <header className="main-header">
        {/* Clicking the logo returns to the home page (the site root). */}
        <a href="/" className="main-logo-link" aria-label="לדף הבית">
          <img
            src="https://www.shalva.org/wp-content/uploads/2025/02/Logo-Hebrew-1024x488-1.png"
            alt="שלוה"
            className="main-logo"
          />
        </a>

        <div className="header-buttons">
          {/* Volunteer signup opens the public registration form (?register=1). */}
          <a className="btn-register" href="?register=1">הרשמה להתנדבות</a>

          {/* Login switches the public view to the sign-in card. */}
          <button className="btn-login" onClick={onNavigateLogin}>כניסה למערכת</button>
        </div>
      </header>

      {/* Hero section: headline, intro text and the main calls to action. */}
      <section className="main-hero" aria-label="באנר ראשי">
        <div className="hero-content">
          <span className="hero-badge">פורטל הקהילה</span>
          <h1>נותנים תקווה. משנים חיים.</h1>
          <p className="hero-text">
            ברוכים הבאים למערכת הקהילתית של שלוה. כאן אנו מחברים בין מתנדבים, מדריכים ורכזי פעילויות
            בכדי להעניק את הטיפול והשילוב המיטבי בקהילה.
          </p>
        </div>

        <div className="hero-visual">
          <div className="visual-card">
            <div className="visual-glow-purple"></div>
            <div className="visual-glow-cyan"></div>
            <div className="visual-text-overlay">
              <h3>קהילה.</h3>
              <h3>שילוב.</h3>
              <h3>שלווה.</h3>
            </div>
          </div>
        </div>
      </section>

      {/* Active groups, shown as a grid of cards. */}
      <section className="groups-section" aria-label="קבוצות פעילות">
        <h2>הקבוצות הפעילות שלנו</h2>

        {/* Short description under the heading. */}
        <p className="groups-intro">
          הצצה לקבוצות הפעילות בקהילה — בכל קבוצה מדריך/ה מסור/ה ומפגשים קבועים.
          בחרו את הקבוצה שמתאימה לכם והצטרפו אלינו.
        </p>

        {/* Loading, empty, or the cinematic group showcase. */}
        {loading ? (
          <p>טוען קבוצות...</p>
        ) : groups.length === 0 ? (
          <p>כרגע אין קבוצות פעילות להצגה.</p>
        ) : (
          <GroupShowcase groups={groups} />
        )}
      </section>
    </div>
  );
}

export default MainScreen;
