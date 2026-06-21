// RegistrationsManagement — admin screen for volunteer registrations. Share
// the public form (WhatsApp / email / copied link) and view every submission
// that came back, with all the details the volunteer filled in.

// React hooks for state, memoized derivations and side effects.
import { useEffect, useMemo, useState } from 'react';

// Firestore helpers. A writeBatch makes "approve" atomic — the new volunteer
// and the registration removal succeed or fail together.
import { collection, doc, getDocs, writeBatch } from 'firebase/firestore';

// Storage helpers for opening and deleting files.
import { getDownloadURL, ref as storageRef, deleteObject } from 'firebase/storage';

// Our Firebase instances.
import { db, storage } from '../../firebase';

// Shared display-name helper.
import { getDisplayName } from '../../utils/people';

// Shared collapsible advanced-search bar (free text + per-field filters).
import SearchFilters from '../shared/SearchFilters/SearchFilters';

// Shared management-screen styles + this screen's own styles.
import '../shared/ManagementScreen.css';
import './RegistrationsManagement.css';


// Turn a Firestore document snapshot into a plain object that keeps its id.
const toRecord = (documentSnapshot) => ({
  id: documentSnapshot.id,
  ...documentSnapshot.data(),
});


// A registrant's display name (this screen's fallback wording).
const getFullName = (registrant) => getDisplayName(registrant, 'מתנדב/ת');


// Format the Firestore creation time into a readable Hebrew date + time.
function formatCreatedAt(value) {
  // Nothing to format.
  if (!value) return '—';

  try {
    // Handle the supported timestamp shapes.
    if (typeof value.toDate === 'function') return value.toDate().toLocaleString('he-IL');
    if (value instanceof Date) return value.toLocaleString('he-IL');
    if (typeof value.seconds === 'number') return new Date(value.seconds * 1000).toLocaleString('he-IL');
    return String(value);
  } catch {
    return '—';
  }
}


// Build a WhatsApp link from an Israeli phone number (0xx → 972xx).
function whatsappLink(phone) {
  // Keep digits only.
  let digits = String(phone || '').replace(/\D/g, '');

  // Convert a leading 0 to the country code.
  if (digits.startsWith('0')) digits = `972${digits.slice(1)}`;

  return `https://wa.me/${digits}`;
}


// Fields shown for each registrant (status is shown separately as a badge).
const DETAIL_FIELDS = [
  ['email', 'אימייל'],
  ['phone', 'טלפון'],
  ['age', 'גיל'],
  ['birthDate', 'תאריך לידה'],
  ['address', 'כתובת'],
  ['school', 'בית ספר / מוסד'],
  ['experience', 'ניסיון קודם'],
  ['day', 'יום פעילות'],
  ['programName', 'תוכנית מבוקשת'],
];


// Birth dates are stored ISO (YYYY-MM-DD), which reads "backwards" in Hebrew.
// Flip them to the day-first form (e.g. "2000-01-05" → "05/01/2000"). Anything
// that isn't a plain ISO date is returned untouched, so odd values aren't mangled.
function formatBirthDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value).trim());

  if (!match) {
    return String(value);
  }

  const [, year, month, day] = match;
  return `${day}/${month}/${year}`;
}


// Show a detail field's value: a dash for empties, the day-first form for the
// birth date, and the plain text for everything else.
function formatFieldValue(key, value) {
  if (value === '' || value === null || value === undefined) {
    return '—';
  }

  if (key === 'birthDate') {
    return formatBirthDate(value);
  }

  return String(value);
}


function RegistrationsManagement() {
  // The loaded registrants.
  const [registrants, setRegistrants] = useState([]);

  // The groups a registrant can be assigned to on approval.
  const [groups, setGroups] = useState([]);

  // The chosen group per registrant id (for the approve action).
  const [groupChoice, setGroupChoice] = useState({});

  // True while loading; holds an error message on failure.
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Whether the "link copied" confirmation is showing.
  const [copied, setCopied] = useState(false);

  // The registrant currently being approved (guards against double-clicks).
  const [approvingId, setApprovingId] = useState(null);

  // Signed forms that came back, and the one currently open in the view modal.
  const [signedForms, setSignedForms] = useState([]);
  const [policeForms, setPoliceForms] = useState([]);
  const [medicalForms, setMedicalForms] = useState([]);
  const [viewingForm, setViewingForm] = useState(null);

  // On phones each card collapses to its name; this is the one tapped open.
  const [expandedId, setExpandedId] = useState(null);
  const toggleExpand = (id) => setExpandedId((current) => (current === id ? null : id));

  // Free-text search + structured "advanced filters" for the registrations list.
  const [searchQuery, setSearchQuery] = useState('');
  const [filters, setFilters] = useState({ ageMin: '', ageMax: '' });

  // Update one structured filter by name.
  const updateFilter = (name, value) => {
    setFilters((current) => ({ ...current, [name]: value }));
  };

  // Reset every structured filter.
  const clearFilters = () => {
    setFilters({ ageMin: '', ageMax: '' });
  };

  // Registrants narrowed by the free-text search AND the age range.
  const filteredRegistrants = useMemo(() => {
    const search = searchQuery.trim().toLowerCase();
    const ageMin = filters.ageMin !== '' ? Number(filters.ageMin) : null;
    const ageMax = filters.ageMax !== '' ? Number(filters.ageMax) : null;

    return registrants.filter((registrant) => {
      // Advanced filter — age range (a registrant with no age is excluded
      // once any bound is set, since we can't tell if they qualify).
      if (ageMin !== null || ageMax !== null) {
        const age = Number(registrant.age);
        if (!Number.isFinite(age)) return false;
        if (ageMin !== null && age < ageMin) return false;
        if (ageMax !== null && age > ageMax) return false;
      }

      // Free-text search — across the name and every detail field.
      if (search) {
        const text = [
          getFullName(registrant),
          registrant.firstName,
          registrant.lastName,
          registrant.email,
          registrant.phone,
          registrant.address,
          registrant.school,
          registrant.experience,
          registrant.age,
          registrant.status,
        ].filter(Boolean).join(' ').toLowerCase();

        if (!text.includes(search)) return false;
      }

      return true;
    });
  }, [registrants, searchQuery, filters]);

  // Signed forms indexed by the registrant they belong to (for the "signed"
  // badge + the view modal).
  const signedByRegistrant = useMemo(() => {
    const map = {};
    signedForms.forEach((signed) => {
      if (signed.registrantId) {
        map[signed.registrantId] = signed;
      }
    });
    return map;
  }, [signedForms]);

  const policeByRegistrant = useMemo(() => {
    const map = {};
    policeForms.forEach((doc) => {
      const rid = doc.registrantId || doc.id;
      if (rid) map[rid] = doc;
    });
    return map;
  }, [policeForms]);

  const medicalByRegistrant = useMemo(() => {
    const map = {};
    medicalForms.forEach((doc) => {
      const rid = doc.registrantId || doc.id;
      if (rid) map[rid] = doc;
    });
    return map;
  }, [medicalForms]);

  // A public link that opens the digital signing form for this registrant.
  const buildSignLink = (registrant) => {
    const name = encodeURIComponent(getFullName(registrant));
    return `${window.location.origin}${window.location.pathname}?sign=1&rid=${registrant.id}&name=${name}`;
  };

  // A public link that opens the document upload form for this registrant.
  const buildUploadLink = (registrant, type) => {
    const name = encodeURIComponent(getFullName(registrant));
    return `${window.location.origin}${window.location.pathname}?uploadDoc=1&type=${type}&rid=${registrant.id}&name=${name}`;
  };

  // A WhatsApp link that sends the registrant their signing-form link.
  const signFormWhatsappHref = (registrant) => {
    const message = `שלום ${getFullName(registrant)},\nלפני אישור ההתנדבות בעמותת שלווה — נא למלא ולחתום על טופס המתנדב/ת בקישור:\n${buildSignLink(registrant)}`;

    // 0xx → 972xx so the chat opens with the right contact when there's a phone.
    let digits = String(registrant.phone || '').replace(/\D/g, '');
    if (digits.startsWith('0')) {
      digits = `972${digits.slice(1)}`;
    }

    return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
  };

  // A WhatsApp link that sends the registrant their police form upload link.
  const policeFormWhatsappHref = (registrant) => {
    const message = `שלום ${getFullName(registrant)},\nלפני אישור ההתנדבות בעמותת שלווה — נא למלא ולהעלות טופס משטרתי בקישור:\n${buildUploadLink(registrant, 'police')}`;
    let digits = String(registrant.phone || '').replace(/\D/g, '');
    if (digits.startsWith('0')) {
      digits = `972${digits.slice(1)}`;
    }
    return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
  };

  // A WhatsApp link that sends the registrant their medical form upload link.
  const medicalFormWhatsappHref = (registrant) => {
    const message = `שלום ${getFullName(registrant)},\nלפני אישור ההתנדבות בעמותת שלווה — נא למלא ולהעלות טופס רפואי בקישור:\n${buildUploadLink(registrant, 'medical')}`;
    let digits = String(registrant.phone || '').replace(/\D/g, '');
    if (digits.startsWith('0')) {
      digits = `972${digits.slice(1)}`;
    }
    return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
  };

  // Open the completed signed form PDF uploaded by the public signing form.
  const openSignedPdf = async (signedForm) => {
    const path = signedForm?.pdfStoragePath || signedForm?.fileStoragePath;
    if (!path) {
      alert('לטופס הזה עדיין אין קובץ שמור.');
      return;
    }

    // Open the window immediately to capture the user gesture (prevents popup blockers).
    const pdfWindow = window.open('', '_blank');

    try {
      const url = await getDownloadURL(storageRef(storage, path));

      if (pdfWindow) {
        pdfWindow.location.href = url;
      } else {
        window.open(url, '_blank');
      }
    } catch (pdfError) {
      if (pdfWindow) {
        pdfWindow.close();
      }

      console.error('פתיחת קובץ נכשלה:', pdfError);
      alert('לא ניתן לפתוח את הקובץ כרגע.');
    }
  };

  // The advanced-panel fields: a minimum / maximum age range.
  const registrantFilterFields = [
    { name: 'ageMin', label: 'גיל מינימום', type: 'number', placeholder: 'מ-' },
    { name: 'ageMax', label: 'גיל מקסימום', type: 'number', placeholder: 'עד' },
  ];

  // Load the registrants once on mount.
  useEffect(() => {
    // Guards against state updates after unmount.
    let isMounted = true;

    const loadData = async () => {
      try {
        // Read the registrants + groups in parallel.
        const [registrantsSnapshot, groupsSnapshot] = await Promise.all([
          getDocs(collection(db, 'registrants')),
          getDocs(collection(db, 'groups')),
        ]);
        if (!isMounted) return;

        // Newest registrations first.
        const list = registrantsSnapshot.docs
          .map(toRecord)
          .sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));

        setRegistrants(list);
        setGroups(groupsSnapshot.docs.map(toRecord));

        // Signed forms, police forms, and medical forms (best-effort)
        const [signedSnapshot, policeSnapshot, medicalSnapshot] = await Promise.all([
          getDocs(collection(db, 'signedForms')).catch(() => null),
          getDocs(collection(db, 'policeForms')).catch(() => null),
          getDocs(collection(db, 'medicalForms')).catch(() => null),
        ]);
        if (isMounted) {
          if (signedSnapshot) setSignedForms(signedSnapshot.docs.map(toRecord));
          if (policeSnapshot) setPoliceForms(policeSnapshot.docs.map(toRecord));
          if (medicalSnapshot) setMedicalForms(medicalSnapshot.docs.map(toRecord));
        }
      } catch (loadError) {
        if (isMounted) setError(loadError.message);
      } finally {
        if (isMounted) setLoading(false);
      }
    };

    loadData();

    // Cleanup: mark as unmounted.
    return () => {
      isMounted = false;
    };
  }, []);

  // Shareable link that opens the public registration form for anyone.
  const formLink = `${window.location.origin}${window.location.pathname}?register=1`;

  // The share message + the WhatsApp / email links built from it.
  const shareMessage = `מוזמן/ת למלא טופס הרשמה להתנדבות לעמותת שלווה:\n${formLink}`;
  const whatsappHref = `https://wa.me/?text=${encodeURIComponent(shareMessage)}`;
  const emailHref = `mailto:?subject=${encodeURIComponent(
    'הרשמה להתנדבות — עמותת שלווה',
  )}&body=${encodeURIComponent(shareMessage)}`;

  // Copy the form link to the clipboard, flashing a confirmation.
  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(formLink);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard may be unavailable; the WhatsApp / email options still work.
    }
  };

  // Approve a registration: create a volunteer in the chosen group from the
  // registrant's details, then remove the registration from the pending list.
  const handleApprove = async (registrant) => {
    // Ignore extra clicks while an approval is already running.
    if (approvingId) {
      return;
    }

    // A group must be chosen first.
    const groupId = groupChoice[registrant.id] || '';
    if (!groupId) {
      alert('בחרו קבוצה לשיוך לפני אישור ההרשמה.');
      return;
    }

    // Resolve the chosen group's name.
    const group = groups.find((item) => item.id === groupId);
    const groupName = group ? (group.groupName || group.name || '') : '';

    setApprovingId(registrant.id);

    try {
      // Do both writes in one batch so we never end up with a volunteer
      // created but the registration left behind (or vice versa).
      const batch = writeBatch(db);

      // Create the volunteer using the registrant's id as the document id, so
      // a fast double-click can't create the same volunteer twice (the second
      // write just overwrites the same document).
      const volunteerRef = doc(db, 'volunteers', registrant.id);
      batch.set(volunteerRef, {
        name: getFullName(registrant),
        firstName: registrant.firstName || '',
        lastName: registrant.lastName || '',
        email: registrant.email || '',
        phone: registrant.phone || '',
        birthDate: registrant.birthDate || '',
        age: registrant.age ?? '',
        address: registrant.address || '',
        school: registrant.school || '',
        experience: registrant.experience || '',
        groupId,
        groupName,
        day: registrant.day || '',
        programId: registrant.programId || '',
        programName: registrant.programName || '',
        createdAt: new Date(),
      });

      // Remove the now-approved registration in the same atomic batch.
      batch.delete(doc(db, 'registrants', registrant.id));

      await batch.commit();

      // Drop it from the visible list.
      setRegistrants((current) => current.filter((item) => item.id !== registrant.id));

      alert(`${getFullName(registrant)} אושר/ה ושויך/ה לקבוצת "${groupName}".`);
    } catch (approveError) {
      console.error('שגיאה באישור ההרשמה:', approveError);
      alert(`האישור נכשל: ${approveError.message}`);
    } finally {
      setApprovingId(null);
    }
  };

  // Delete a registration after confirmation.
  const handleDelete = async (id, name) => {
    if (!window.confirm(`למחוק את ההרשמה של ${name}? כל הטפסים והקבצים שלו (טופס דיגיטלי, רפואי ומשטרתי) יימחקו גם הם. הפעולה אינה הפיכה.`)) return;

    try {
      const batch = writeBatch(db);

      const signedDoc = signedByRegistrant[id];
      const policeDoc = policeByRegistrant[id];
      const medicalDoc = medicalByRegistrant[id];

      if (signedDoc) {
        batch.delete(doc(db, 'signedForms', signedDoc.id));
      }
      if (policeDoc) {
        batch.delete(doc(db, 'policeForms', policeDoc.id));
      }
      if (medicalDoc) {
        batch.delete(doc(db, 'medicalForms', medicalDoc.id));
      }

      batch.delete(doc(db, 'registrants', id));

      await batch.commit();

      // Delete files from Firebase Storage asynchronously (best-effort)
      const storageDeletes = [];
      if (signedDoc?.pdfStoragePath) {
        storageDeletes.push(deleteObject(storageRef(storage, signedDoc.pdfStoragePath)).catch(err => console.warn("Failed to delete signed PDF:", err)));
      }
      if (policeDoc?.fileStoragePath) {
        storageDeletes.push(deleteObject(storageRef(storage, policeDoc.fileStoragePath)).catch(err => console.warn("Failed to delete police file:", err)));
      }
      if (medicalDoc?.fileStoragePath) {
        storageDeletes.push(deleteObject(storageRef(storage, medicalDoc.fileStoragePath)).catch(err => console.warn("Failed to delete medical file:", err)));
      }

      if (storageDeletes.length > 0) {
        await Promise.all(storageDeletes);
      }

      setRegistrants((current) => current.filter((registrant) => registrant.id !== id));
    } catch (deleteError) {
      console.error('שגיאה במחיקת הרשמה:', deleteError);
      alert(`המחיקה נכשלה: ${deleteError.message}`);
    }
  };

  return (
    <main className="mgmt-container" dir="rtl">
      <section className="mgmt-card">

        {/* Header: the registrations count on the right + the "share the form"
            buttons raised up onto the same row (left side). */}
        <header className="mgmt-header">
          <div className="mgmt-count">
            <span>{registrants.length}</span>
            <small>הרשמות</small>
          </div>

          <div className="mgmt-toolbar mgmt-share-toolbar">
            <a className="mgmt-primary-btn" href={whatsappHref} target="_blank" rel="noreferrer">
              שליחה בוואטסאפ
            </a>
            <a className="mgmt-secondary-btn" href={emailHref}>
              שליחה במייל
            </a>
            <button type="button" className="mgmt-secondary-btn" onClick={handleCopyLink}>
              {copied ? 'הקישור הועתק ✓' : 'העתקת קישור'}
            </button>
          </div>
        </header>

        {/* The list of received registrations. */}
        <section className="mgmt-section">
          <div className="mgmt-list-header">
            <h2>הרשמות שהתקבלו</h2>
          </div>

          {/* Free-text search (all fields) + collapsible age-range filter —
              only worth showing once at least one registration exists. */}
          {!loading && !error && registrants.length > 0 && (
            <div className="mgmt-filters-row reg-filters-row">
              <SearchFilters
                searchValue={searchQuery}
                onSearchChange={setSearchQuery}
                searchPlaceholder="🔍 חיפוש לפי שם, אימייל, טלפון, כתובת..."
                fields={registrantFilterFields}
                values={filters}
                onChange={updateFilter}
                onClear={clearFilters}
              />
            </div>
          )}

          {/* Loading / error / empty states, otherwise the cards. */}
          {loading ? (
            <div className="mgmt-loading">טוען הרשמות...</div>
          ) : error ? (
            <div className="mgmt-empty">לא ניתן לטעון הרשמות כרגע.</div>
          ) : registrants.length === 0 ? (
            <div className="mgmt-empty">עדיין לא התקבלו הרשמות. שלחו את הטופס כדי להתחיל.</div>
          ) : filteredRegistrants.length === 0 ? (
            <div className="mgmt-empty">אין הרשמות התואמות לחיפוש.</div>
          ) : (
            <div className="reg-list">
              {filteredRegistrants.map((registrant) => (
                <article className={`reg-card ${expandedId === registrant.id ? 'is-expanded' : ''}`} key={registrant.id}>

                  {/* Card header: avatar, name, date, status badge. On phones it
                      doubles as the tap target that expands the card. */}
                  <header className="reg-card-head" onClick={() => toggleExpand(registrant.id)}>
                    <span className="reg-card-avatar">{getFullName(registrant).charAt(0)}</span>
                    <div className="reg-card-info">
                      <div className="reg-card-title">
                        <h3>{getFullName(registrant)}</h3>
                        <span className="reg-card-date">נרשם/ה: {formatCreatedAt(registrant.createdAt)}</span>
                      </div>
                      <div className="reg-card-badges">
                        <span className="reg-card-status">{registrant.status || 'ממתין לאישור'}</span>
                        {signedByRegistrant[registrant.id] && (
                          <span
                            className="reg-card-status status-signed"
                            title="טופס החתימה התקבל"
                          >
                            ✓ נחתם
                          </span>
                        )}
                        {policeByRegistrant[registrant.id] && (
                          <span
                            className="reg-card-status status-police"
                            title="טופס משטרתי התקבל"
                          >
                            ✓ טופס משטרתי
                          </span>
                        )}
                        {medicalByRegistrant[registrant.id] && (
                          <span
                            className="reg-card-status status-medical"
                            title="טופס רפואי התקבל"
                          >
                            ✓ טופס רפואי
                          </span>
                        )}
                      </div>
                    </div>
                  </header>

                  {/* All the registrant's detail fields. */}
                  <dl className="reg-card-fields">
                    {DETAIL_FIELDS.map(([key, label]) => (
                      <div className="reg-field" key={key}>
                        <dt>{label}</dt>
                        <dd>{formatFieldValue(key, registrant[key])}</dd>
                      </div>
                    ))}
                  </dl>

                  {/* Approve: pick a group, then confirm → creates a volunteer. */}
                  <div className="reg-card-approve">
                    <select
                      className="reg-group-select"
                      value={groupChoice[registrant.id] || ''}
                      onChange={(event) => setGroupChoice((current) => ({
                        ...current,
                        [registrant.id]: event.target.value,
                      }))}
                    >
                      <option value="">בחרו קבוצה לשיוך...</option>
                      {groups.map((group) => (
                        <option key={group.id} value={group.id}>
                          {group.groupName || group.name || group.id}
                        </option>
                      ))}
                    </select>

                    <button
                      type="button"
                      className="reg-approve-btn"
                      onClick={() => handleApprove(registrant)}
                      disabled={approvingId !== null}
                    >
                      {approvingId === registrant.id ? 'מאשר...' : '✓ אישור ושיוך לקבוצה'}
                    </button>
                  </div>

                  {/* Card actions: contact via WhatsApp/email, or delete. */}
                  <div className="reg-card-foot">
                    {registrant.phone && (
                      <a className="reg-foot-btn" href={whatsappLink(registrant.phone)} target="_blank" rel="noreferrer">
                        💬 וואטסאפ
                      </a>
                    )}
                    {registrant.email && (
                      <a className="reg-foot-btn" href={`mailto:${registrant.email}`}>
                        ✉️ מייל
                      </a>
                    )}

                    <a
                      className="reg-foot-btn"
                      href={signFormWhatsappHref(registrant)}
                      target="_blank"
                      rel="noreferrer"
                    >
                      📝 שליחת טופס לחתימה
                    </a>
                    <a
                      className="reg-foot-btn"
                      href={policeFormWhatsappHref(registrant)}
                      target="_blank"
                      rel="noreferrer"
                    >
                      📝 שליחת טופס משטרתי
                    </a>
                    <a
                      className="reg-foot-btn"
                      href={medicalFormWhatsappHref(registrant)}
                      target="_blank"
                      rel="noreferrer"
                    >
                      📝 שליחת טופס רפואי
                    </a>
 
                    {/* View the signed form once it has come back. */}
                    {signedByRegistrant[registrant.id]?.pdfStoragePath && (
                      <button
                        type="button"
                        className="reg-foot-btn"
                        onClick={() => openSignedPdf(signedByRegistrant[registrant.id])}
                      >
                        📄 פתיחת PDF
                      </button>
                    )}

                    {/* View the police form once it has come back. */}
                    {policeByRegistrant[registrant.id] && (
                      <button
                        type="button"
                        className="reg-foot-btn"
                        style={{ color: '#0369a1' }}
                        onClick={() => openSignedPdf(policeByRegistrant[registrant.id])}
                      >
                        📄 צפייה בטופס משטרתי
                      </button>
                    )}

                    {/* View the medical form once it has come back. */}
                    {medicalByRegistrant[registrant.id] && (
                      <button
                        type="button"
                        className="reg-foot-btn"
                        style={{ color: '#b45309' }}
                        onClick={() => openSignedPdf(medicalByRegistrant[registrant.id])}
                      >
                        📄 צפייה בטופס רפואי
                      </button>
                    )}

                    <button
                      type="button"
                      className="reg-foot-btn reg-foot-delete"
                      onClick={() => handleDelete(registrant.id, getFullName(registrant))}
                    >
                      🗑 מחיקה
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      </section>

      {/* View a signed form (details + the drawn signature). */}
      {viewingForm && (
        <div className="modal-overlay" role="dialog" aria-modal="true" onClick={() => setViewingForm(null)}>
          <div className="modal-content" style={{ maxWidth: '620px' }} onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">טופס חתום — {viewingForm.fullName}</div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px', lineHeight: 1.6, marginBottom: '16px' }}>
              <div><strong>שם מלא:</strong> {viewingForm.fullName || '—'}</div>
              <div><strong>תעודת זהות:</strong> {viewingForm.idNumber || '—'}</div>
              <div><strong>גיל:</strong> {viewingForm.age || '—'}</div>
              <div><strong>תאריך לידה (לועזי):</strong> {viewingForm.birthDateGreg || '—'}</div>
              <div><strong>תאריך לידה (עברי):</strong> {viewingForm.birthDateHeb || '—'}</div>
              <div><strong>טלפון:</strong> <span dir="ltr">{viewingForm.phone || '—'}</span></div>
              <div><strong>מייל:</strong> <span dir="ltr">{viewingForm.email || '—'}</span></div>
              <div><strong>כתובת:</strong> {viewingForm.address || '—'}</div>
              <div><strong>בית ספר / עיסוק:</strong> {viewingForm.school || '—'}</div>
              <div><strong>מידה בחולצה:</strong> {viewingForm.shirtSize || '—'}</div>
              <div><strong>קבוצה:</strong> {viewingForm.groupName || '—'}</div>
              <div><strong>ימי התנדבות:</strong> {(viewingForm.activityDays || []).join(', ') || '—'}</div>
            </div>

            <div style={{ marginBottom: '16px' }}>
              <strong>חתימה:</strong>
              {viewingForm.signature ? (
                <img
                  src={viewingForm.signature}
                  alt="חתימת המתנדב"
                  style={{ display: 'block', marginTop: '8px', maxWidth: '100%', border: '1px solid var(--border)', borderRadius: '10px', background: '#fff' }}
                />
              ) : <span> —</span>}
            </div>

            <div className="modal-actions">
              {viewingForm.pdfStoragePath && (
                <button type="button" className="btn btn-outline" onClick={() => openSignedPdf(viewingForm)}>
                  פתיחת PDF
                </button>
              )}
              <button type="button" className="btn btn-outline" onClick={() => setViewingForm(null)}>סגירה</button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

export default RegistrationsManagement;
