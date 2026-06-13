/* MainScreen — the public landing page (shown to logged-out visitors). */

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


// Kept out of the component so they aren't recreated on every render, and so
// the "magic strings" all sit in one obvious place.
const GROUPS_COLLECTION = 'groups';
const REGISTER_URL = '?register=1';
const LOGO_URL =
  'https://www.shalva.org/wp-content/uploads/2025/02/Logo-Hebrew-1024x488-1.png';

// Shown if the groups fail to load (a real failure, not an empty list).
const GROUPS_LOAD_ERROR_MESSAGE =
  'לא ניתן לטעון את הקבוצות כרגע. נסו לרענן את הדף.';


function MainScreen({ onNavigateLogin }) {
  // The public groups to preview.
  const [groups, setGroups] = useState([]);

  // True while the groups are loading.
  const [isLoadingGroups, setIsLoadingGroups] = useState(true);

  // Keep a failed load separate from a real "no groups" state.
  const [groupsErrorMessage, setGroupsErrorMessage] = useState('');

  // Load the public groups once, on mount.
  useEffect(() => {
    // Guards against updating state after the component unmounts mid-request.
    let isComponentMounted = true;

    const fetchGroups = async () => {
      try {
        // Read the groups collection.
        const groupsSnapshot = await getDocs(collection(db, GROUPS_COLLECTION));

        // Spread the document data first, then set the id last — so a stray
        // "id" field inside a document can never overwrite the real one.
        const groupsData = groupsSnapshot.docs.map((groupDoc) => ({
          ...groupDoc.data(),
          id: groupDoc.id,
        }));

        if (isComponentMounted) {
          setGroups(groupsData);
          setGroupsErrorMessage('');
        }
      } catch (fetchError) {
        console.error('Error fetching public groups:', fetchError);

        if (isComponentMounted) {
          setGroupsErrorMessage(GROUPS_LOAD_ERROR_MESSAGE);
        }
      } finally {
        if (isComponentMounted) {
          setIsLoadingGroups(false);
        }
      }
    };

    fetchGroups();

    // Cleanup: flip the flag so a late response is ignored.
    return () => {
      isComponentMounted = false;
    };
  }, []);

  // Decide what fills the groups panel: loading, error, empty, or the showcase.
  const renderGroupsContent = () => {
    // Still loading — announce it politely to screen readers (role="status").
    if (isLoadingGroups) {
      return (
        <p className="groups-message" role="status">
          טוען קבוצות...
        </p>
      );
    }

    // The load failed — announce it assertively (role="alert").
    if (groupsErrorMessage) {
      return (
        <p className="groups-error" role="alert">
          {groupsErrorMessage}
        </p>
      );
    }

    // Loaded fine, but there are simply no groups to show.
    if (groups.length === 0) {
      return (
        <p className="groups-message">
          כרגע אין קבוצות פעילות להצגה.
        </p>
      );
    }

    // We have groups — hand them to the cinematic showcase.
    return <GroupShowcase groups={groups} />;
  };

  return (
    <div className="main-container">

      {/* Top header: logo + login / signup actions. */}
      <header className="main-header">
        {/* Clicking the logo returns to the home page (the site root). */}
        <a href="/" className="main-logo-link" aria-label="לדף הבית">
          <img
            src={LOGO_URL}
            alt="שלוה"
            className="main-logo"
            width="101"
            height="48"
            decoding="async"
          />
        </a>

        <div className="header-buttons">
          {/* Volunteer signup opens the public registration form (?register=1). */}
          <a className="btn-register" href={REGISTER_URL}>הרשמה להתנדבות</a>

          {/* Login switches the public view to the sign-in card.
              type="button" stops it ever submitting a surrounding <form>. */}
          <button type="button" className="btn-login" onClick={onNavigateLogin}>
            כניסה למערכת
          </button>
        </div>
      </header>

      {/* Everything below the header is the page's main landmark. */}
      <main>

        {/* Hero section: headline, intro text and a decorative visual.
            aria-labelledby reuses the visible <h1> as this section's name. */}
        <section className="main-hero" aria-labelledby="main-hero-title">
          <div className="hero-content">
            <span className="hero-badge">פורטל הקהילה</span>
            <h1 id="main-hero-title">נותנים תקווה. משנים חיים.</h1>
            <p className="hero-text">
              ברוכים הבאים למערכת הקהילתית של שלוה. כאן אנו מחברים בין מתנדבים, מדריכים ורכזי פעילויות
              בכדי להעניק את הטיפול והשילוב המיטבי בקהילה.
            </p>
          </div>

          {/* Purely decorative: aria-hidden so screen readers skip it, and the
              words are <span>s (not headings) so they don't pollute the outline. */}
          <div className="hero-visual" aria-hidden="true">
            <div className="visual-card">
              <div className="visual-glow-purple"></div>
              <div className="visual-glow-cyan"></div>
              <div className="visual-text-overlay">
                <span>קהילה.</span>
                <span>שילוב.</span>
                <span>שלוה.</span>
              </div>
            </div>
          </div>
        </section>

        {/* Active groups. aria-busy tells assistive tech the region is loading. */}
        <section
          className="groups-section"
          aria-labelledby="groups-section-title"
          aria-busy={isLoadingGroups}
        >
          <h2 id="groups-section-title">הקבוצות הפעילות שלנו</h2>

          {/* Short description under the heading. */}
          <p className="groups-intro">
            הצצה לקבוצות הפעילות בקהילה — בכל קבוצה מדריך/ה מסור/ה ומפגשים קבועים.
            בחרו את הקבוצה שמתאימה לכם והצטרפו אלינו.
          </p>

          {/* Loading, an error, empty, or the cinematic group showcase. */}
          {renderGroupsContent()}
        </section>
      </main>
    </div>
  );
}

export default MainScreen;
