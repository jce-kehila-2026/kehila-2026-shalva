// GuideManagement — admin screen to add, edit and remove guides. Creating a
// guide makes a Firebase Auth account (via a secondary app so the admin stays
// signed in) plus matching "users" and "guides" documents.

// React hooks for state, effects, memoization and refs.
import { useState, useEffect, useMemo, useRef } from 'react';

// Secondary Firebase app cleanup (the app itself is created via the centralized,
// emulator-safe createSecondaryAuth helper below).
import { deleteApp } from 'firebase/app';

// Auth helpers for creating (and, on failure, cleaning up) a guide's account
// on a secondary app.
import { createUserWithEmailAndPassword, deleteUser } from 'firebase/auth';

// Phone validator — a new guide must have a valid Israeli phone number.
import { isValidIsraeliPhone } from '../../utils/validators';

// Firestore helpers for reading and writing documents (writeBatch keeps the
// multi-document guide operations atomic).
import { collection, query, where, getDocs, doc, getDoc, updateDoc, writeBatch } from 'firebase/firestore';

// Our Firestore database instance + the centralized secondary-Auth factory
// (emulator-safe: in emulator mode it connects the local Auth emulator so a
// guide-account create can never reach live Firebase).
import { db, createSecondaryAuth } from '../../firebase';

// Date picker for the guide's birth date.
import BirthDatePicker from '../shared/BirthDatePicker/BirthDatePicker';

// Button that opens a pre-filled WhatsApp message to the guide.
import WhatsAppButton from '../shared/WhatsAppButton/WhatsAppButton';

// Builds the greeting text for WhatsApp.
import { greetingMessage } from '../../utils/whatsapp';

// Downloads the ready-to-fill Excel template for bulk guide import.
import { downloadGuidesTemplate } from '../../utils/excelTemplates';

// Shared collapsible advanced-search bar (free text + per-field filters).
import SearchFilters from '../shared/SearchFilters/SearchFilters';

// Shared management-screen styles + the volunteers screen styles.
import '../shared/ManagementScreen.css';
import '../VolunteersManagement/VolunteersManagement.css';



function GuideManagement() {
  const isMountedRef = useRef(true);

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

  // Structured "advanced filters" (empty string means "don't filter").
  const [filters, setFilters] = useState({ groupName: '' });

  // Update one filter by name (handed to the shared SearchFilters component).
  const updateFilter = (name, value) => {
    setFilters((current) => ({ ...current, [name]: value }));
  };

  // Reset every structured filter.
  const clearFilters = () => {
    setFilters({ groupName: '' });
  };

  // Which column the table is sorted by ('name' or 'group') and its direction
  // (defaults to the guide's name, A→Z).
  const [sortBy, setSortBy] = useState('name');
  const [sortDir, setSortDir] = useState('asc');

  // Click a header: toggle direction if it's the sort column, else switch to it.
  const handleSort = (column) => {
    if (sortBy === column) {
      setSortDir((dir) => (dir === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortBy(column);
      setSortDir('asc');
    }
  };

  // On phones the list collapses to names only; this is the row tapped open.
  const [expandedId, setExpandedId] = useState(null);
  const toggleExpand = (id) => setExpandedId((current) => (current === id ? null : id));

  // The live groups list (for the Excel template + matching imported rows).
  const [groupsList, setGroupsList] = useState([]);

  // Excel import state: in-flight flag + the per-row results to show after.
  const [isImporting, setIsImporting] = useState(false);
  const [importResults, setImportResults] = useState(null);

  // The hidden file input behind the "ייבוא מאקסל" button.
  const importFileRef = useRef(null);

  // Lets the header button scroll straight down to the removed-guides section.
  const removedGuidesRef = useRef(null);

  // The form fields for the new / edited guide.
  const [newGuide, setNewGuide] = useState({
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    birthDate: '',
    password: '',
  });

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Open the form in edit mode, pre-filled with a guide's data.
  const startEditing = (guide) => {
    setEditingGuideId(guide.id);
    setIsEditing(true);

    // Fill the inputs with the guide's existing data (password stays empty).
    setNewGuide({
      firstName: guide.firstName,
      lastName: guide.lastName,
      email: guide.email,
      phone: guide.phone || '',
      birthDate: guide.birthDate || '',
      password: ''
    });

    // Open the form modal.
    setShowAddForm(true);
  };

  // Form submit handler — decides whether to update or create.
  const handleSubmitForm = async (e) => {
    e.preventDefault();

    // Phone is required when ADDING a guide, and must be a valid Israeli number
    // whenever one is entered.
    const phone = (newGuide.phone || '').trim();
    if (!isEditing && !phone) {
      alert('יש להזין מספר טלפון.');
      return;
    }
    if (phone && !isValidIsraeliPhone(phone)) {
      alert('מספר הטלפון אינו תקין. הזינו מספר ישראלי תקין (לדוגמה: 052-1234567).');
      return;
    }

    setLoading(true);

    if (isEditing) {
      // Mode 1: update the existing guide's profile fields.
      try {
        await updateDoc(doc(db, 'users', editingGuideId), {
          firstName: newGuide.firstName,
          lastName: newGuide.lastName,
          email: newGuide.email,
          phone: newGuide.phone || '',
          birthDate: newGuide.birthDate
        });
        if (!isMountedRef.current) {
          return;
        }

        alert('פרטי המדריך עודכנו בהצלחה!');

        // Reset edit state, close the form and refresh.
        setIsEditing(false);
        setEditingGuideId(null);
        setNewGuide({ firstName: '', lastName: '', email: '', phone: '', birthDate: '', password: '' });
        setShowAddForm(false);
        await fetchAllGuidesData();
        if (!isMountedRef.current) {
          return;
        }

      } catch (error) {
        if (!isMountedRef.current) {
          return;
        }
        console.error("Error updating guide:", error);
        alert(`העדכון נכשל: ${error.message}`);
      } finally {
        if (isMountedRef.current) {
          setLoading(false);
        }
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
        const secondary = createSecondaryAuth("SecondaryApp");
        secondaryApp = secondary.secondaryApp;
        const secondaryAuth = secondary.secondaryAuth;

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
          phone: newGuide.phone || '',
          birthDate: newGuide.birthDate,
          role: 'guide',
        });
        batch.set(doc(db, 'guides', newGuideUid), {
          groupName: 'Unassigned',
        });
        await batch.commit();

        await fetchAllGuidesData();
        if (!isMountedRef.current) {
          return;
        }

        alert('המדריך נוסף בהצלחה!');

        // Reset the form and close it.
        setNewGuide({ firstName: '', lastName: '', email: '', phone: '', birthDate: '', password: '' });
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

        if (!isMountedRef.current) {
          return;
        }
        console.error("Database initialization fault:", error);
        alert(`ההוספה נכשלה: ${error.message}`);
      } finally {
        // Always tear down the secondary app, success or failure. (Runs after
        // the catch, so any orphan-user cleanup above still had a live app.)
        if (secondaryApp) {
          await deleteApp(secondaryApp);
        }
        if (isMountedRef.current) {
          setLoading(false);
        }
      }
    }
  };

  // Load all guides, merging the "users" profile with the "guides" group mapping.
  const fetchAllGuidesData = async () => {
    if (!isMountedRef.current) {
      return false;
    }

    try {
      setTableLoading(true);

      // Query users whose role is "guide".
      const usersRef = collection(db, 'users');
      const q = query(usersRef, where('role', '==', 'guide'));
      const querySnapshot = await getDocs(q);
      if (!isMountedRef.current) {
        return false;
      }

      const combinedGuides = [];

      // For each guide user, also read their group mapping.
      for (const userDoc of querySnapshot.docs) {
        const userData = userDoc.data();
        const userId = userDoc.id;

        // Read the matching guides document.
        const guideDocRef = doc(db, 'guides', userId);
        const guideDocSnap = await getDoc(guideDocRef);
        if (!isMountedRef.current) {
          return false;
        }

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
          phone: userData.phone || '',
          birthDate: userData.birthDate || '',
          disabled: userData.disabled || false,
          groupName: groupName
        });
      }

      setGuidesList(combinedGuides);
      return true;
    } catch (error) {
      console.error("Error aggregating guide collections:", error);
      return false;
    } finally {
      if (isMountedRef.current) {
        setTableLoading(false);
      }
    }
  };

  // Load the guides once on mount.
  useEffect(() => {
    fetchAllGuidesData();
  }, []);

  // Load the groups once (used by the Excel template and row matching).
  useEffect(() => {
    let isActive = true;

    const fetchGroups = async () => {
      try {
        const snapshot = await getDocs(collection(db, 'groups'));
        if (isActive && isMountedRef.current) {
          setGroupsList(snapshot.docs.map((groupDoc) => ({ id: groupDoc.id, ...groupDoc.data() })));
        }
      } catch (error) {
        console.error('שגיאה בטעינת קבוצות:', error);
      }
    };

    fetchGroups();
    return () => {
      isActive = false;
    };
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
      if (!isMountedRef.current) {
        return;
      }

      const secondary = createSecondaryAuth('SecondaryImportApp');
      secondaryApp = secondary.secondaryApp;
      const secondaryAuth = secondary.secondaryAuth;

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
          if (!isMountedRef.current) {
            return;
          }

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

      if (!isMountedRef.current) {
        return;
      }

      if (results.length === 0) {
        alert('לא נמצאו שורות תקינות בקובץ. ודאו שקיימת עמודת "אימייל".');
      } else {
        // Show the results modal (with the temporary passwords to hand out).
        setImportResults(results);
        await fetchAllGuidesData();
      }
    } catch (error) {
      if (!isMountedRef.current) {
        return;
      }
      console.error('שגיאה בייבוא קובץ מדריכים:', error);
      alert('אירעה שגיאה בייבוא הקובץ. ודאו שזהו קובץ אקסל תקין.');
    } finally {
      if (secondaryApp) {
        await deleteApp(secondaryApp);
      }
      if (isMountedRef.current) {
        setIsImporting(false);
        if (importFileRef.current) {
          importFileRef.current.value = null;
        }
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
    setNewGuide({ firstName: '', lastName: '', email: '', phone: '', birthDate: '', password: '' });
    setShowAddForm(true);
  };

  // Close the form and clear it.
  const handleCloseForm = () => {
    setIsEditing(false);
    setEditingGuideId(null);
    setNewGuide({ firstName: '', lastName: '', email: '', phone: '', birthDate: '', password: '' });
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
      if (!isMountedRef.current) {
        return;
      }
      assignedGroups.docs.forEach((groupDoc) => {
        batch.update(doc(db, 'groups', groupDoc.id), { guideId: '', guideName: '' });
      });

      // Clear the guide's own group mapping.
      batch.set(doc(db, 'guides', guideId), { groupId: '', groupName: 'Unassigned' }, { merge: true });

      await batch.commit();
      if (!isMountedRef.current) {
        return;
      }

      alert('המדריך הוסר. אפשר להחזיר אותו בכל עת דרך "שחזר".');
      await fetchAllGuidesData();
    } catch (error) {
      if (!isMountedRef.current) {
        return;
      }
      console.error('Error removing guide:', error);
      alert(`ההסרה נכשלה: ${error.message}`);
    } finally {
      if (isMountedRef.current) {
        setTableLoading(false);
      }
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
      if (!isMountedRef.current) {
        return;
      }

      alert('המדריך הוחזר ויכול להתחבר שוב עם אותם אימייל וסיסמה.');
      await fetchAllGuidesData();
    } catch (error) {
      if (!isMountedRef.current) {
        return;
      }
      console.error('Error restoring guide:', error);
      alert(`השחזור נכשל: ${error.message}`);
    } finally {
      if (isMountedRef.current) {
        setTableLoading(false);
      }
    }
  };

  // Guides filtered by the free-text search AND the structured filters, then
  // sorted by the chosen column (name / group).
  const filteredGuides = useMemo(() => {
    const search = searchQuery.trim().toLowerCase();

    const result = guidesList.filter((guide) => {
      // Advanced filter — assigned group ("__none__" matches the unassigned).
      if (filters.groupName) {
        const isUnassigned = !guide.groupName || guide.groupName === 'Unassigned';
        if (filters.groupName === '__none__') {
          if (!isUnassigned) return false;
        } else if (guide.groupName !== filters.groupName) {
          return false;
        }
      }

      // Free-text search — across every text column (name, email, group, DOB).
      if (search) {
        const text = [
          guide.firstName,
          guide.lastName,
          guide.email,
          guide.groupName,
          guide.birthDate,
        ].filter(Boolean).join(' ').toLowerCase();

        if (!text.includes(search)) return false;
      }

      return true;
    });

    // Sort by the chosen column — the guide's full name or their group —
    // honouring the direction the header toggles.
    return result.sort((a, b) => {
      const nameOf = (guide) => `${guide.firstName || ''} ${guide.lastName || ''}`.trim();
      const groupOf = (guide) => (!guide.groupName || guide.groupName === 'Unassigned' ? '' : guide.groupName);

      const valueA = sortBy === 'group' ? groupOf(a) : nameOf(a);
      const valueB = sortBy === 'group' ? groupOf(b) : nameOf(b);
      const comparison = valueA.localeCompare(valueB, 'he');
      return sortDir === 'asc' ? comparison : -comparison;
    });
  }, [guidesList, searchQuery, filters, sortBy, sortDir]);

  // The advanced-panel fields: filter by assigned group (built from the live
  // groups list, plus a sentinel for the unassigned).
  const guideFilterFields = [
    {
      name: 'groupName',
      label: 'קבוצה',
      type: 'select',
      placeholder: 'כל הקבוצות',
      options: [
        { value: '__none__', label: 'ללא שיוך' },
        ...groupsList.map((group) => {
          const name = group.groupName || group.name || 'קבוצה ללא שם';
          return { value: name, label: name };
        }),
      ],
    },
  ];

  // Two lists: active guides vs. removed (soft-deleted, disabled) ones.
  const activeGuides = filteredGuides.filter((guide) => !guide.disabled);
  const removedGuides = filteredGuides.filter((guide) => guide.disabled);

  return (
    <main className="mgmt-container" dir="rtl">
      <section className="mgmt-card">

        {/* Header: the active-guide count on the right + the action buttons
            raised up onto the same row (left side). */}
        <header className="mgmt-header">
          <div className="mgmt-count">
            <span>{activeGuides.length}</span>
            <small>מדריכים פעילים</small>
          </div>

          <div className="mgmt-toolbar guide-toolbar">
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
              {isImporting ? '⏳ מייבא...' : '📥 ייבוא מדריכים'}
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

            {/* Jumps down to the removed-guides list. Disabled when there are
                none (that section is hidden then), with the count shown so the
                admin knows how many removed guides exist before clicking. */}
            <button
              type="button"
              className="mgmt-secondary-btn"
              onClick={() => removedGuidesRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
              disabled={removedGuides.length === 0}
              title={removedGuides.length === 0 ? 'אין מדריכים שהוסרו' : 'מעבר לרשימת המדריכים שהוסרו'}
            >
              🗂 מדריכים שהוסרו{removedGuides.length > 0 ? ` (${removedGuides.length})` : ''}
            </button>
          </div>
        </header>

        {/* Free-text search (name / email / group / DOB) + collapsible
            advanced filter (assigned group). */}
        <section className="mgmt-section">
          <div className="mgmt-filters-row">
            <SearchFilters
              searchValue={searchQuery}
              onSearchChange={setSearchQuery}
              searchPlaceholder="🔍 חיפוש מדריך לפי שם, אימייל או קבוצה..."
              fields={guideFilterFields}
              values={filters}
              onChange={updateFilter}
              onClear={clearFilters}
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

                {/* Phone — used for the one-tap WhatsApp button in the table. */}
                <div className="form-group">
                  <label>טלפון (לשליחה בוואטסאפ):</label>
                  <input
                    className="styled-input full-width-input"
                    type="tel"
                    name="phone"
                    value={newGuide.phone}
                    onChange={handleInputChange}
                    placeholder="לדוגמה: 052-1234567"
                    dir="ltr"
                  />
                </div>

                {/* Birth date. */}
                <div className="form-group">
                  <BirthDatePicker
                    key={editingGuideId || 'new'}
                    value={newGuide.birthDate}
                    onChange={(birthDate) => setNewGuide((prev) => ({ ...prev, birthDate }))}
                    label="תאריך לידה"
                    required
                    showPreview
                  />
                </div>

                {/* Password (only when creating a new guide). The app has no
                    backend, so it cannot e-mail credentials — the admin shares
                    the email + this password manually with the guide. */}
                {!isEditing && (
                  <div className="form-group">
                    <label>סיסמה:</label>
                    <input className="styled-input full-width-input" type="password" name="password" value={newGuide.password} onChange={handleInputChange} required />
                    <small style={{ color: 'var(--text-muted)' }}>
                      💡 זו סיסמת הכניסה של המדריך. המערכת אינה שולחת מייל — מסרו לו את האימייל והסיסמה ידנית (וואטסאפ / בעל-פה). המדריך יוכל להחליף סיסמה דרך "שכחתי סיסמה".
                    </small>
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

        {/* List 1: active guides. */}
        <section className="mgmt-section">
          <div className="mgmt-list-header">
            <h2>מדריכים פעילים</h2>
          </div>

          <div className="mgmt-table-wrap">
            <table className="mgmt-table">
              {/* Name + group headers sort the list A↔Z. */}
              <thead>
                <tr>
                  <th>
                    <button
                      type="button"
                      className={`mgmt-sort ${sortBy === 'name' ? 'is-active' : ''}`}
                      onClick={() => handleSort('name')}
                    >
                      שם מלא
                      {sortBy === 'name' && (
                        <span className="mgmt-sort-arrow" aria-hidden="true">{sortDir === 'asc' ? '▲' : '▼'}</span>
                      )}
                    </button>
                  </th>
                  <th>אימייל</th>
                  <th>טלפון</th>
                  <th>
                    <button
                      type="button"
                      className={`mgmt-sort ${sortBy === 'group' ? 'is-active' : ''}`}
                      onClick={() => handleSort('group')}
                    >
                      קבוצה משויכת
                      {sortBy === 'group' && (
                        <span className="mgmt-sort-arrow" aria-hidden="true">{sortDir === 'asc' ? '▲' : '▼'}</span>
                      )}
                    </button>
                  </th>
                  <th>פעולות</th>
                </tr>
              </thead>

              <tbody>
                {/* Loading row, empty-state row, or a row per active guide. */}
                {tableLoading ? (
                  <tr>
                    <td colSpan="5" className="mgmt-loading">טוען רשימת מדריכים...</td>
                  </tr>
                ) : activeGuides.length === 0 ? (
                  <tr>
                    <td colSpan="5" className="mgmt-empty">
                      {guidesList.length === 0 ? 'לא נמצאו מדריכים רשומים.' : 'אין מדריכים פעילים התואמים לחיפוש.'}
                    </td>
                  </tr>
                ) : (
                  activeGuides.map((guide) => (
                    <tr key={guide.id} className={expandedId === guide.id ? 'is-expanded' : ''}>
                      <td
                        data-label="שם מלא"
                        className="mgmt-name-cell"
                        onClick={() => toggleExpand(guide.id)}
                      >
                        <strong>{guide.firstName} {guide.lastName}</strong>
                      </td>
                      <td data-label="אימייל">{guide.email}</td>

                      {/* Phone — a tap-to-call link, or a dash when none on file. */}
                      <td data-label="טלפון">
                        {guide.phone
                          ? <a href={`tel:${String(guide.phone).replace(/[^\d+]/g, '')}`} dir="ltr">{guide.phone}</a>
                          : <span className="mgmt-muted">—</span>}
                      </td>

                      {/* Assigned group badge (or "not assigned"). */}
                      <td data-label="קבוצה משויכת">
                        {!guide.groupName || guide.groupName === 'Unassigned'
                          ? <span className="mgmt-badge muted">לא משויך</span>
                          : <span className="mgmt-badge">{guide.groupName}</span>}
                      </td>

                      {/* WhatsApp / edit / remove. */}
                      <td data-label="פעולות" className="mgmt-actions-cell">
                        <div className="mgmt-row-actions">
                          <WhatsAppButton
                            phone={guide.phone}
                            message={greetingMessage(`${guide.firstName} ${guide.lastName}`.trim())}
                            label="וואטסאפ"
                            compact
                          />
                          <button onClick={() => startEditing(guide)}>עריכה</button>
                          <button
                            className="danger"
                            onClick={() => handleRemoveGuide(guide.id, `${guide.firstName} ${guide.lastName}`)}
                          >
                            הסרה
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>

        {/* List 2: removed (soft-deleted) guides — shown only when there are any.
            The ref is the scroll target for the header's "מדריכים שהוסרו" button. */}
        {removedGuides.length > 0 && (
          <section className="mgmt-section" ref={removedGuidesRef}>
            <div className="mgmt-list-header">
              <h2>מדריכים שהוסרו</h2>
            </div>

            <div className="mgmt-table-wrap">
              <table className="mgmt-table">
                <thead>
                  <tr>
                    <th>שם מלא</th>
                    <th>אימייל</th>
                    <th>קבוצה משויכת</th>
                    <th>פעולות</th>
                  </tr>
                </thead>

                <tbody>
                  {removedGuides.map((guide) => (
                    <tr key={guide.id} className={expandedId === guide.id ? 'is-expanded' : ''}>
                      <td
                        data-label="שם מלא"
                        className="mgmt-name-cell"
                        onClick={() => toggleExpand(guide.id)}
                      >
                        <strong>{guide.firstName} {guide.lastName}</strong>
                        <span className="mgmt-badge muted" style={{ marginInlineStart: '8px' }}>הוסר</span>
                      </td>
                      <td data-label="אימייל">{guide.email}</td>

                      {/* Assigned group badge (or "not assigned"). */}
                      <td data-label="קבוצה משויכת">
                        {!guide.groupName || guide.groupName === 'Unassigned'
                          ? <span className="mgmt-badge muted">לא משויך</span>
                          : <span className="mgmt-badge">{guide.groupName}</span>}
                      </td>

                      {/* Restore back to active. */}
                      <td data-label="פעולות" className="mgmt-actions-cell">
                        <div className="mgmt-row-actions">
                          <button
                            className="primary"
                            onClick={() => handleRestoreGuide(guide.id, `${guide.firstName} ${guide.lastName}`)}
                          >
                            שחזר
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </section>
    </main>
  );
}

export default GuideManagement;
