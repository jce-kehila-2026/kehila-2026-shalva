// UserList — the viewer-facing list of volunteers. Loads the "volunteers"
// collection and shows each entry as a row with a button to open details.

// React hooks for state and side effects.
import { useEffect, useState } from 'react';

// Firestore helpers for reading collections.
import { collection, getDocs } from 'firebase/firestore';

// Our Firestore database instance.
import { db } from '../../firebase';

// Styles for this screen.
import './UserList.css';


// Best available display name for a volunteer, with graceful fallbacks.
const getVolunteerName = (volunteer) => (
  volunteer.name ||
  [volunteer.firstName, volunteer.lastName].filter(Boolean).join(' ').trim() ||
  volunteer.email ||
  'מתנדב ללא שם'
);


const UserList = ({ onOpenVolunteerDetails }) => {
  // The loaded volunteers.
  const [volunteers, setVolunteers] = useState([]);

  // True while loading; holds an error message on failure.
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Open the details view for a volunteer (if a handler was provided).
  const handleOpenDetails = (volunteer) => {
    if (typeof onOpenVolunteerDetails === 'function') {
      onOpenVolunteerDetails(volunteer);
    }
  };

  // Load the volunteers once when the screen opens.
  useEffect(() => {
    const fetchVolunteers = async () => {
      try {
        // Read the volunteers collection.
        const querySnapshot = await getDocs(collection(db, 'volunteers'));

        // Convert each Firestore document into a plain object with its id.
        const volunteerList = querySnapshot.docs.map((documentSnapshot) => ({
          id: documentSnapshot.id,
          ...documentSnapshot.data(),
        }));

        setVolunteers(volunteerList);
      } catch (err) {
        // Record the error.
        console.error('Error fetching volunteers:', err);
        setError(err.message);
      } finally {
        // Clear the loading flag.
        setLoading(false);
      }
    };

    fetchVolunteers();
  }, []);

  // While loading, show a spinner.
  if (loading) {
    return (
      <div className="loading-container">
        <div className="spinner"></div>
      </div>
    );
  }

  // On error, explain what went wrong.
  if (error) {
    return (
      <div className="user-list-container">
        <div className="empty-state error-state">
          <strong>שגיאה בטעינת המתנדבים:</strong><br />
          {error}
          <br /><br />
          <small>בדקו את הרשאות Firebase Security Rules ואת קונסול הדפדפן.</small>
        </div>
      </div>
    );
  }

  return (
    <div className="user-list-container">

      {/* Header: title + a count badge. */}
      <div className="user-list-header">
        <h3>רשימת מתנדבים</h3>
        <span className="user-badge">{volunteers.length} רשומות</span>
      </div>

      {/* Empty state, otherwise the list of volunteers. */}
      {volunteers.length === 0 ? (
        <div className="empty-state">לא נמצאו מתנדבים.</div>
      ) : (
        <ul className="user-list">
          {volunteers.map((volunteer) => {
            // Resolve the volunteer's display name once.
            const volunteerName = getVolunteerName(volunteer);

            return (
              <li key={volunteer.id} className="user-item">

                {/* Avatar + name + email. */}
                <div className="user-info">
                  <div className="user-avatar">{volunteerName.charAt(0).toUpperCase()}</div>
                  <div className="user-details">
                    <div className="user-name">{volunteerName}</div>
                    <div className="user-email">{volunteer.email || volunteer.phone || volunteer.id}</div>
                  </div>
                </div>

                {/* Open the full details view. */}
                <button
                  type="button"
                  className="user-details-button"
                  onClick={() => handleOpenDetails(volunteer)}
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
