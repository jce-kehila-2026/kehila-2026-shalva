// GuideManagement — admin screen to add, edit and remove guides. Creating a
// guide makes a Firebase Auth account (via a secondary app so the admin stays
// signed in) plus matching "users" and "guides" documents.

// React hooks for state, effects, memoization and refs.
import { useState, useEffect, useMemo, useRef } from 'react';

// Secondary Firebase app helpers (used to create/delete guide auth accounts).
import { initializeApp, deleteApp } from 'firebase/app';

// Auth helpers for creating (and, on failure, cleaning up) a guide's account
// on a secondary app.
import { getAuth, createUserWithEmailAndPassword, deleteUser } from 'firebase/auth';

// Firestore helpers for reading and writing documents (writeBatch keeps the
// multi-document guide operations atomic).
import { collection, query, where, getDocs, doc, getDoc, updateDoc, writeBatch } from 'firebase/firestore';

// Our Firestore database instance.
import { db } from '../../firebase';

// Date picker for the guide's birth date.
import BirthDatePicker from '../shared/BirthDatePicker/BirthDatePicker';

// Downloads the ready-to-fill Excel template for bulk guide import.
import { downloadGuidesTemplate } from '../../utils/excelTemplates';

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

  // The live groups list (for the Excel template + matching imported rows).
  const [groupsList, setGroupsList] = useState([]);

  // Excel import state: in-flight flag + the per-row results to show after.
  const [isImporting, setIsImporting] = useState(false);
  const [importResults, setImportResults] = useState(null);

  // The hidden file input behind the "ייבוא מאקסל" button.
  const importFileRef = useRef(null);

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
      // Declared out here so the finally block can always tear it down — even
      // if account creation or the writes throw (otherwise the leftover app
      // also breaks the NEXT attempt with an "already exists" error).
      let secondaryApp = null;
      // The just-created Auth user — tracked so we can remove it if the
      // following Firestore writes fail (otherwise an orphan account is left
      // that has no users/{uid} doc and blocks re-using that email).
      let createdUser = null;

      try {
        // Use a secondary app so creating the user doesn't sign the admin out.
        secondaryApp = initializeApp(firebaseConfig, "SecondaryApp");
        const secondaryAuth = getAuth(secondaryApp);

        // Create the auth account.
        const userCredential = await createUserWithEmailAndPassword(
          secondaryAuth,
          newGuide.email,
          newGuide.password
        );

        createdUser = userCredential.user;
        const newGuideUid = createdUser.uid;

        // Write the user profile (role = guide) and the group mapping together,
        // atomically. The password is NOT stored — Firebase Authentication keeps
        // it securely (hashed). Removing a guide just disables this record; the
        // app's access gate then blocks the leftover login.
        const batch = writeBatch(db);
        batch.set(doc(db, 'users', newGuideUid), {
          firstName: newGuide.firstName,
          lastName: newGuide.lastName,
          email: newGuide.email,
          birthDate: newGuide.birthDate,
          role: 'guide',
        });
        batch.set(doc(db, 'guides', newGuideUid), {
          groupName: 'Unassigned',
        });
        await batch.commit();

        await fetchAllGuidesData();

        alert('המדריך נוסף בהצלחה!');

        // Reset the form and close it.
        setNewGuide({ firstName: '', lastName: '', email: '', birthDate: '', password: '' });
        setShowAddForm(false);

      } catch (error) {
        // If the Auth account was created but the Firestore writes failed,
        // delete the orphan account (best-effort) so it doesn't linger.
        if (createdUser) {
          try {
            await deleteUser(createdUser);
          } catch (cleanupError) {
            console.error('Failed to remove orphan auth account:', cleanupError);
          }
        }

        console.error("Database initialization fault:", error);
        alert(`ההוספה נכשלה: ${error.message}`);
      } finally {
        // Always tear down the secondary app, success or failure. (Runs after
        // the catch, so any orphan-user cleanup above still had a live app.)
        if (secondaryApp) {
          await deleteApp(secondaryApp);
        }
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

  // Load the groups once (used by the Excel template and row matching).
  useEffect(() => {
    const fetchGroups = async () => {
      try {
        const snapshot = await getDocs(collection(db, 'groups'));
        setGroupsList(snapshot.docs.map((groupDoc) => ({ id: groupDoc.id, ...groupDoc.data() })));
      } catch (error) {
        console.error('שגיאה בטעינת קבוצות:', error);
      }
    };

    fetchGroups();
  }, []);

  // A random temporary password for an imported guide (letters + digits, 10
  // chars + a symbol so Firebase's strength rules pass). Shown once after the
  // import; the guide should change it via "שכחתי סיסמה".
  const generateTempPassword = () => {
    const characters = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
    let password = '';
    for (let index = 0; index < 10; index += 1) {
      password += characters[Math.floor(Math.random() * characters.length)];
    }
    return `${password}!`;
  };

  // Bulk-import guides from an Excel file. Each valid row gets an Auth
  // account (temporary password), a users/{uid} profile and a guides/{uid}
  // mapping; a matched group also gets its guideId/guideName updated.
  const handleGuidesFileUpload = async (event) => {
    const file = event.target.files[0];
    if (!file) return;

    setIsImporting(true);

    // One secondary app for the whole import, torn down at the end.
    let secondaryApp = null;
    const results = [];

    try {
      // Parse the workbook (the Excel library loads on demand).
      const XLSX = await import('xlsx');
      const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array' });
      const rows = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]]);

      secondaryApp = initializeApp(firebaseConfig, 'SecondaryImportApp');
      const secondaryAuth = getAuth(secondaryApp);

      for (const row of rows) {
        const firstName = String(row['שם פרטי *'] || row['שם פרטי'] || row['firstName'] || '').trim();
        const lastName = String(row['שם משפחה *'] || row['שם משפחה'] || row['lastName'] || '').trim();
        const email = String(row['אימייל *'] || row['אימייל'] || row['email'] || '').trim().toLowerCase();

        // Restore the leading 0 if Excel stored the phone as a number.
        let phone = String(row['טלפון'] || row['phone'] || '').trim();
        if (/^5\d{8}$/.test(phone)) {
          phone = `0${phone}`;
        }
        const birthDate = String(row['תאריך לידה'] || row['birthDate'] || '').trim();
        const groupNameRaw = String(row['קבוצה'] || row['group'] || '').trim();
        const activityTime = String(row['זמן פעילות'] || row['activityTime'] || '').trim();

        const displayName = `${firstName} ${lastName}`.trim() || email;

        // An email is required — it's the login identifier.
        if (!email) {
          if (firstName || lastName) {
            results.push({ name: displayName, email: '', password: '', error: 'חסר אימייל' });
          }
          continue;
        }

        // Match the group column against the live groups list.
        const matchedGroup = groupsList.find(
          (group) => (group.groupName || group.name || '').trim() === groupNameRaw,
        );

        // A guide with this email already exists — skip with a clear note.
        if (guidesList.some((existing) => (existing.email || '').toLowerCase() === email)) {
          results.push({ name: displayName, email, password: '', error: 'מדריך עם אימייל זה כבר קיים במערכת' });
          continue;
        }

        const tempPassword = generateTempPassword();

        try {
          // Create the login account on the secondary app.
          const credential = await createUserWithEmailAndPassword(secondaryAuth, email, tempPassword);
          const newUid = credential.user.uid;

          // Profile + group mapping (+ group back-reference), one atomic batch.
          const batch = writeBatch(db);

          batch.set(doc(db, 'users', newUid), {
            firstName,
            lastName,
            email,
            phone,
            birthDate,
            role: 'guide',
          });

          batch.set(doc(db, 'guides', newUid), {
            groupId: matchedGroup?.id || '',
            groupName: matchedGroup?.groupName || matchedGroup?.name || 'Unassigned',
            activityTime,
          });

          if (matchedGroup) {
            batch.update(doc(db, 'groups', matchedGroup.id), {
              guideId: newUid,
              guideName: displayName,
            });
          }

          await batch.commit();

          results.push({ name: displayName, email, password: tempPassword, error: '' });
        } catch (rowError) {
          // Translate the common Firebase codes into actionable Hebrew.
          console.error('שגיאה בייבוא מדריך:', email, rowError);

          const friendlyErrors = {
            'auth/email-already-in-use':
              'האימייל כבר רשום (כנראה מניסיון ייבוא קודם) — השתמשו באימייל אחר, או בקשו מהמנהל למחוק את החשבון הישן',
            'auth/invalid-email': 'כתובת האימייל אינה תקינה',
            'auth/weak-password': 'הסיסמה שנוצרה נדחתה — נסו שוב',
          };

          results.push({
            name: displayName,
            email,
            password: '',
            error: friendlyErrors[rowError.code] || rowError.message,
          });
        }
      }

      if (results.length === 0) {
        alert('לא נמצאו שורות תקינות בקובץ. ודאו שקיימת עמודת "אימייל".');
      } else {
        // Show the results modal (with the temporary passwords to hand out).
        setImportResults(results);
        await fetchAllGuidesData();
      }
    } catch (error) {
      console.error('שגיאה בייבוא קובץ מדריכים:', error);
      alert('אירעה שגיאה בייבוא הקובץ. ודאו שזהו קובץ אקסל תקין.');
    } finally {
      if (secondaryApp) {
        await deleteApp(secondaryApp);
      }
      setIsImporting(false);
      if (importFileRef.current) {
        importFileRef.current.value = null;
      }
    }
  };

  // Copy all the imported credentials to the clipboard, one line per guide.
  const handleCopyImportResults = async () => {
    const created = (importResults || []).filter((result) => !result.error);

    const text = created
      .map((result) => `${result.name} — ${result.email} — סיסמה זמנית: ${result.password}`)
      .join('\n');

    try {
      await navigator.clipboard.writeText(text);
      alert('פרטי ההתחברות הועתקו!');
    } catch {
      alert('ההעתקה נכשלה — העתיקו ידנית מהטבלה.');
    }
  };

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

      // Disable + free groups + clear mapping, all in one atomic batch.
      const batch = writeBatch(db);

      // Disable the account (blocks login via the app gate).
      batch.update(doc(db, 'users', guideId), { disabled: true });

      // Free any group this guide was assigned to.
      const assignedGroups = await getDocs(query(collection(db, 'groups'), where('guideId', '==', guideId)));
      assignedGroups.docs.forEach((groupDoc) => {
        batch.update(doc(db, 'groups', groupDoc.id), { guideId: '', guideName: '' });
      });

      // Clear the guide's own group mapping.
      batch.set(doc(db, 'guides', guideId), { groupId: '', groupName: 'Unassigned' }, { merge: true });

      await batch.commit();

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

            {/* Hidden file input + the Excel import / template buttons. */}
            <input
              type="file"
              accept=".xlsx, .xls, .csv"
              style={{ display: 'none' }}
              ref={importFileRef}
              onChange={handleGuidesFileUpload}
            />
            <button
              className="mgmt-secondary-btn"
              onClick={() => importFileRef.current?.click()}
              disabled={isImporting}
            >
              {isImporting ? '⏳ מייבא...' : '📥 ייבוא מאקסל'}
            </button>
            <button
              className="mgmt-secondary-btn"
              onClick={async () => {
                // Pull the groups fresh so the template matches the system NOW.
                const snapshot = await getDocs(collection(db, 'groups'));
                downloadGuidesTemplate(snapshot.docs.map((groupDoc) => groupDoc.data()));
              }}
            >
              ⬇️ הורדת תבנית אקסל
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

        {/* Import results modal — shows each guide's temporary password. */}
        {importResults && (
          <div className="modal-overlay" role="dialog" aria-modal="true">
            <div className="modal-content" style={{ maxWidth: '640px' }}>
              <div className="modal-header">תוצאות ייבוא מדריכים</div>

              <p>
                אלו הסיסמאות הזמניות שנוצרו — העתיקו ושלחו לכל מדריך.
                מומלץ שכל מדריך יחליף סיסמה דרך "שכחתי סיסמה" בכניסה הראשונה.
              </p>

              <div className="mgmt-table-wrap">
                <table className="mgmt-table">
                  <thead>
                    <tr>
                      <th>שם</th>
                      <th>אימייל</th>
                      <th>סיסמה זמנית / שגיאה</th>
                    </tr>
                  </thead>
                  <tbody>
                    {importResults.map((result, index) => (
                      <tr key={index}>
                        <td data-label="שם">{result.name}</td>
                        <td data-label="אימייל" dir="ltr">{result.email}</td>
                        <td data-label="סיסמה זמנית / שגיאה">
                          {result.error
                            ? <span style={{ color: '#dc2626' }}>{result.error}</span>
                            : <code dir="ltr">{result.password}</code>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="modal-actions" style={{ marginTop: '16px' }}>
                <button type="button" className="btn btn-success" onClick={handleCopyImportResults}>
                  📋 העתקת כל פרטי ההתחברות
                </button>
                <button type="button" className="btn btn-outline" onClick={() => setImportResults(null)}>
                  סגירה
                </button>
              </div>
            </div>
          </div>
        )}

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
