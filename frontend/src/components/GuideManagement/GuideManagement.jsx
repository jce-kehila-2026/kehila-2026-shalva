// GuideManagement — admin screen to add, edit and remove guides. Creating a
// guide makes a Firebase Auth account (via a secondary app so the admin stays
// signed in) plus matching "users" and "guides" documents.

// React hooks for state, effects and memoization.
import { useState, useEffect, useMemo } from 'react';

// Secondary Firebase app helpers (used to create/delete guide auth accounts).
import { initializeApp, deleteApp } from 'firebase/app';

// Auth helpers for creating a guide's account (on a secondary app).
import { getAuth, createUserWithEmailAndPassword } from 'firebase/auth';

// Firestore helpers for reading and writing documents.
import { collection, query, where, getDocs, doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';

// Our Firestore database instance.
import { db } from '../../firebase';

// Date picker for the guide's birth date.
import BirthDatePicker from '../shared/BirthDatePicker/BirthDatePicker';

// Shared management-screen styles + the volunteers screen styles.
import '../shared/ManagementScreen.css';
import '../VolunteersManagement/VolunteersManagement.css';


// Firebase config (read from the local .env.local), used for the secondary app.
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID
};


function GuideManagement() {
  // Whether the add/edit form modal is open.
  const [showAddForm, setShowAddForm] = useState(false);

  // True while a create/update request is in flight.
  const [loading, setLoading] = useState(false);

  // The loaded guides + whether the table is still loading.
  const [guidesList, setGuidesList] = useState([]);
  const [tableLoading, setTableLoading] = useState(true);

  // Edit mode + which guide is being edited.
  const [isEditing, setIsEditing] = useState(false);
  const [editingGuideId, setEditingGuideId] = useState(null);

  // Search text for filtering the table.
  const [searchQuery, setSearchQuery] = useState('');

  // The form fields for the new / edited guide.
  const [newGuide, setNewGuide] = useState({
    firstName: '',
    lastName: '',
    email: '',
    birthDate: '',
    password: '',
  });

  // Open the form in edit mode, pre-filled with a guide's data.
  const startEditing = (guide) => {
    setEditingGuideId(guide.id);
    setIsEditing(true);

    // Fill the inputs with the guide's existing data (password stays empty).
    setNewGuide({
      firstName: guide.firstName,
      lastName: guide.lastName,
      email: guide.email,
      birthDate: guide.birthDate || '',
      password: ''
    });

    // Open the form modal.
    setShowAddForm(true);
  };

  // Form submit handler — decides whether to update or create.
  const handleSubmitForm = async (e) => {
    e.preventDefault();
    setLoading(true);

    if (isEditing) {
      // Mode 1: update the existing guide's profile fields.
      try {
        await updateDoc(doc(db, 'users', editingGuideId), {
          firstName: newGuide.firstName,
          lastName: newGuide.lastName,
          email: newGuide.email,
          birthDate: newGuide.birthDate
        });

        alert('פרטי המדריך עודכנו בהצלחה!');

        // Reset edit state, close the form and refresh.
        setIsEditing(false);
        setEditingGuideId(null);
        setNewGuide({ firstName: '', lastName: '', email: '', birthDate: '', password: '' });
        setShowAddForm(false);
        await fetchAllGuidesData();

      } catch (error) {
        console.error("Error updating guide:", error);
        alert(`העדכון נכשל: ${error.message}`);
      } finally {
        setLoading(false);
      }
    } else {
      // Mode 2: create a new guide account + documents.
      try {
        // Use a secondary app so creating the user doesn't sign the admin out.
        const secondaryApp = initializeApp(firebaseConfig, "SecondaryApp");
        const secondaryAuth = getAuth(secondaryApp);

        // Create the auth account.
        const userCredential = await createUserWithEmailAndPassword(
          secondaryAuth,
          newGuide.email,
          newGuide.password
        );

        const newGuideUid = userCredential.user.uid;

        // Write the user profile (role = guide). The password is NOT stored —
        // Firebase Authentication already keeps it securely (hashed). Removing a
        // guide just deletes this record; the app's access gate then blocks the
        // leftover login.
        await setDoc(doc(db, 'users', newGuideUid), {
          firstName: newGuide.firstName,
          lastName: newGuide.lastName,
          email: newGuide.email,
          birthDate: newGuide.birthDate,
          role: 'guide',
        });

        // Write the guide mapping (unassigned until a group is given).
        await setDoc(doc(db, 'guides', newGuideUid), {
          groupName: 'Unassigned',
        });

        // Tear down the secondary app and refresh the table.
        await deleteApp(secondaryApp);
        await fetchAllGuidesData();

        alert('המדריך נוסף בהצלחה!');

        // Reset the form and close it.
        setNewGuide({ firstName: '', lastName: '', email: '', birthDate: '', password: '' });
        setShowAddForm(false);

      } catch (error) {
        console.error("Database initialization fault:", error);
        alert(`ההוספה נכשלה: ${error.message}`);
      } finally {
        setLoading(false);
      }
    }
  };

  // Load all guides, merging the "users" profile with the "guides" group mapping.
  const fetchAllGuidesData = async () => {
    try {
      setTableLoading(true);

      // Query users whose role is "guide".
      const usersRef = collection(db, 'users');
      const q = query(usersRef, where('role', '==', 'guide'));
      const querySnapshot = await getDocs(q);

      const combinedGuides = [];

      // For each guide user, also read their group mapping.
      for (const userDoc of querySnapshot.docs) {
        const userData = userDoc.data();
        const userId = userDoc.id;

        // Read the matching guides document.
        const guideDocRef = doc(db, 'guides', userId);
        const guideDocSnap = await getDoc(guideDocRef);

        // Default to "Unassigned" when there's no group.
        let groupName = 'Unassigned';

        if (guideDocSnap.exists()) {
          groupName = guideDocSnap.data().groupName || 'Unassigned';
        }

        // Build the combined guide record (disabled = removed but restorable).
        combinedGuides.push({
          id: userId,
          firstName: userData.firstName,
          lastName: userData.lastName,
          email: userData.email,
          birthDate: userData.birthDate || '',
          disabled: userData.disabled || false,
          groupName: groupName
        });
      }

      setGuidesList(combinedGuides);
    } catch (error) {
      console.error("Error aggregating guide collections:", error);
    } finally {
      setTableLoading(false);
    }
  };

  // Load the guides once on mount.
  useEffect(() => {
    fetchAllGuidesData();
  }, []);

  // Update one form field by its input name.
  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setNewGuide((prev) => ({ ...prev, [name]: value }));
  };

  // Open the form in "add" mode with empty fields.
  const handleOpenAdd = () => {
    setIsEditing(false);
    setEditingGuideId(null);
    setNewGuide({ firstName: '', lastName: '', email: '', birthDate: '', password: '' });
    setShowAddForm(true);
  };

  // Close the form and clear it.
  const handleCloseForm = () => {
    setIsEditing(false);
    setEditingGuideId(null);
    setNewGuide({ firstName: '', lastName: '', email: '', birthDate: '', password: '' });
    setShowAddForm(false);
  };

  // Remove a guide — a "soft delete": mark the account disabled (the app's
  // access gate then blocks their login) and free any group they led. The
  // record is kept so the guide can be restored later with the same email and
  // password, with no "email already in use" conflict.
  const handleRemoveGuide = async (guideId, guideName) => {
    // Confirm first.
    if (!window.confirm(`האם להסיר את ${guideName}? הוא לא יוכל להתחבר עד שתחזיר אותו.`)) return;

    try {
      setTableLoading(true);

      // Disable the account (blocks login via the app gate).
      await updateDoc(doc(db, 'users', guideId), { disabled: true });

      // Free any group this guide was assigned to.
      const assignedGroups = await getDocs(query(collection(db, 'groups'), where('guideId', '==', guideId)));
      for (const groupDoc of assignedGroups.docs) {
        await updateDoc(doc(db, 'groups', groupDoc.id), { guideId: '', guideName: '' });
      }

      // Clear the guide's own group mapping.
      await setDoc(doc(db, 'guides', guideId), { groupId: '', groupName: 'Unassigned' }, { merge: true });

      alert('המדריך הוסר. אפשר להחזיר אותו בכל עת דרך "שחזר".');
      await fetchAllGuidesData();
    } catch (error) {
      console.error('Error removing guide:', error);
      alert(`ההסרה נכשלה: ${error.message}`);
    } finally {
      setTableLoading(false);
    }
  };

  // Restore a previously removed guide — re-enable the account so they can log
  // in again (same email and password). They start unassigned to a group.
  const handleRestoreGuide = async (guideId, guideName) => {
    // Confirm first.
    if (!window.confirm(`להחזיר את ${guideName} למערכת?`)) return;

    try {
      setTableLoading(true);

      // Re-enable the account.
      await updateDoc(doc(db, 'users', guideId), { disabled: false });

      alert('המדריך הוחזר ויכול להתחבר שוב עם אותם אימייל וסיסמה.');
      await fetchAllGuidesData();
    } catch (error) {
      console.error('Error restoring guide:', error);
      alert(`השחזור נכשל: ${error.message}`);
    } finally {
      setTableLoading(false);
    }
  };

  // Guides filtered by the search box.
  const filteredGuides = useMemo(() => {
    const search = searchQuery.trim().toLowerCase();
    if (!search) return guidesList;
    return guidesList.filter((guide) => {
      const text = [guide.firstName, guide.lastName, guide.email].filter(Boolean).join(' ').toLowerCase();
      return text.includes(search);
    });
  }, [guidesList, searchQuery]);

  return (
    <main className="mgmt-container" dir="rtl">
      <section className="mgmt-card">

        {/* Header: just the guide count (the sidebar labels the screen). */}
        <header className="mgmt-header">
          <div className="mgmt-count">
            <span>{filteredGuides.length}</span>
            <small>מדריכים</small>
          </div>
        </header>

        {/* Toolbar: add button + search. */}
        <section className="mgmt-section">
          <div className="mgmt-toolbar">
            <button className="mgmt-primary-btn" onClick={handleOpenAdd}>
              + הוסף מדריך חדש
            </button>
            <input
              type="search"
              className="mgmt-search"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="🔍 חפש מדריך לפי שם..."
            />
          </div>

        </section>

        {/* Add / edit guide modal — same style as the volunteers screen. */}
        {showAddForm && (
          <div className="modal-overlay" role="dialog" aria-modal="true">
            <div className="modal-content">
              <div className="modal-header">{isEditing ? 'עריכת פרטי מדריך' : 'רישום מדריך חדש'}</div>
              <form onSubmit={handleSubmitForm} className="volunteer-form">

                {/* First name. */}
                <div className="form-group">
                  <label>שם פרטי:</label>
                  <input className="styled-input full-width-input" type="text" name="firstName" value={newGuide.firstName} onChange={handleInputChange} required />
                </div>

                {/* Last name. */}
                <div className="form-group">
                  <label>שם משפחה:</label>
                  <input className="styled-input full-width-input" type="text" name="lastName" value={newGuide.lastName} onChange={handleInputChange} required />
                </div>

                {/* Email — locked while editing: changing the login email needs a
                    backend (Admin SDK), so we don't allow editing it from here. */}
                <div className="form-group">
                  <label>אימייל:</label>
                  <input
                    className="styled-input full-width-input"
                    type="email"
                    name="email"
                    value={newGuide.email}
                    onChange={handleInputChange}
                    dir="ltr"
                    required
                    readOnly={isEditing}
                  />
                  {isEditing && (
                    <small style={{ color: 'var(--text-muted)' }}>
                      לא ניתן לשנות אימייל מכאן — שינוי אימייל ההתחברות דורש backend.
                    </small>
                  )}
                </div>

                {/* Birth date. */}
                <div className="form-group">
                  <label>תאריך לידה:</label>
                  <BirthDatePicker
                    key={editingGuideId || 'new'}
                    value={newGuide.birthDate}
                    onChange={(birthDate) => setNewGuide((prev) => ({ ...prev, birthDate }))}
                    required
                    showPreview
                  />
                </div>

                {/* Password (only when creating a new guide). */}
                {!isEditing && (
                  <div className="form-group">
                    <label>סיסמה:</label>
                    <input className="styled-input full-width-input" type="password" name="password" value={newGuide.password} onChange={handleInputChange} required />
                  </div>
                )}

                {/* Cancel / submit. */}
                <div className="modal-actions">
                  <button type="button" className="btn btn-outline" onClick={handleCloseForm}>ביטול</button>
                  <button type="submit" className="btn btn-success" disabled={loading}>
                    {loading ? 'מעבד...' : isEditing ? 'שמור שינויים' : 'הוסף מדריך'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* The guides table. */}
        <section className="mgmt-section">
          <div className="mgmt-list-header">
            <h2>רשימת מדריכים</h2>
          </div>

          <div className="mgmt-table-wrap">
            <table className="mgmt-table">

              {/* Column headers. */}
              <thead>
                <tr>
                  <th>שם מלא</th>
                  <th>אימייל</th>
                  <th>קבוצה משויכת</th>
                  <th>פעולות</th>
                </tr>
              </thead>

              <tbody>
                {/* Loading row, empty-state row, or a row per guide. */}
                {tableLoading ? (
                  <tr>
                    <td colSpan="4" className="mgmt-loading">טוען רשימת מדריכים...</td>
                  </tr>
                ) : filteredGuides.length === 0 ? (
                  <tr>
                    <td colSpan="4" className="mgmt-empty">
                      {guidesList.length === 0 ? 'לא נמצאו מדריכים רשומים.' : 'לא נמצאו מדריכים התואמים לחיפוש.'}
                    </td>
                  </tr>
                ) : (
                  filteredGuides.map((guide) => (
                    <tr key={guide.id}>
                      {/* Name + a "removed" badge for disabled guides. */}
                      <td data-label="שם מלא">
                        <strong>{guide.firstName} {guide.lastName}</strong>
                        {guide.disabled && <span className="mgmt-badge muted" style={{ marginInlineStart: '8px' }}>הוסר</span>}
                      </td>
                      <td data-label="אימייל">{guide.email}</td>

                      {/* Assigned group badge (or "not assigned"). */}
                      <td data-label="קבוצה משויכת">
                        {!guide.groupName || guide.groupName === 'Unassigned'
                          ? <span className="mgmt-badge muted">לא משויך</span>
                          : <span className="mgmt-badge">{guide.groupName}</span>}
                      </td>

                      {/* Row actions: restore a removed guide, else edit / remove. */}
                      <td data-label="פעולות" className="mgmt-actions-cell">
                        <div className="mgmt-row-actions">
                          {guide.disabled ? (
                            <button
                              className="primary"
                              onClick={() => handleRestoreGuide(guide.id, `${guide.firstName} ${guide.lastName}`)}
                            >
                              שחזר
                            </button>
                          ) : (
                            <>
                              <button onClick={() => startEditing(guide)}>עריכה</button>
                              <button
                                className="danger"
                                onClick={() => handleRemoveGuide(guide.id, `${guide.firstName} ${guide.lastName}`)}
                              >
                                הסרה
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      </section>
    </main>
  );
}

export default GuideManagement;
