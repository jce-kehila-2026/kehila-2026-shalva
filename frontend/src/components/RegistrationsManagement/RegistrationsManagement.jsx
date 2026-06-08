// RegistrationsManagement — admin screen for volunteer registrations. Share
// the public form (WhatsApp / email / copied link) and view every submission
// that came back, with all the details the volunteer filled in.

// React hooks for state and side effects.
import { useEffect, useState } from 'react';

// Firestore helpers for reading, adding and deleting documents.
import { addDoc, collection, deleteDoc, doc, getDocs } from 'firebase/firestore';

// Our Firestore database instance.
import { db } from '../../firebase';

// Shared management-screen styles + this screen's own styles.
import '../shared/ManagementScreen.css';
import './RegistrationsManagement.css';


// Turn a Firestore document snapshot into a plain object that keeps its id.
const toRecord = (documentSnapshot) => ({
  id: documentSnapshot.id,
  ...documentSnapshot.data(),
});


// Best available display name for a registrant, with graceful fallbacks.
const getFullName = (registrant) =>
  registrant.name ||
  [registrant.firstName, registrant.lastName].filter(Boolean).join(' ').trim() ||
  registrant.email ||
  'מתנדב/ת';


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
];


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
    // A group must be chosen first.
    const groupId = groupChoice[registrant.id] || '';
    if (!groupId) {
      alert('בחרו קבוצה לשיוך לפני אישור ההרשמה.');
      return;
    }

    // Resolve the chosen group's name.
    const group = groups.find((item) => item.id === groupId);
    const groupName = group ? (group.groupName || group.name || '') : '';

    try {
      // Create the volunteer from the registration details.
      await addDoc(collection(db, 'volunteers'), {
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
        createdAt: new Date(),
      });

      // Remove the now-approved registration and drop it from the list.
      await deleteDoc(doc(db, 'registrants', registrant.id));
      setRegistrants((current) => current.filter((item) => item.id !== registrant.id));

      alert(`${getFullName(registrant)} אושר/ה ושויך/ה לקבוצת "${groupName}".`);
    } catch (approveError) {
      console.error('שגיאה באישור ההרשמה:', approveError);
      alert(`האישור נכשל: ${approveError.message}`);
    }
  };

  // Delete a registration after confirmation.
  const handleDelete = async (id, name) => {
    // Confirm first (irreversible).
    if (!window.confirm(`למחוק את ההרשמה של ${name}? הפעולה אינה הפיכה.`)) return;

    try {
      // Remove the document and drop it from the list.
      await deleteDoc(doc(db, 'registrants', id));
      setRegistrants((current) => current.filter((registrant) => registrant.id !== id));
    } catch (deleteError) {
      console.error('שגיאה במחיקת הרשמה:', deleteError);
      alert(`המחיקה נכשלה: ${deleteError.message}`);
    }
  };

  return (
    <main className="mgmt-container" dir="rtl">
      <section className="mgmt-card">

        {/* Header: just the registrations count (the sidebar labels the screen). */}
        <header className="mgmt-header">
          <div className="mgmt-count">
            <span>{registrants.length}</span>
            <small>הרשמות</small>
          </div>
        </header>

        {/* Share the public form via WhatsApp / email / copied link. */}
        <section className="mgmt-section">
          <h2>שליחת טופס הרשמה</h2>
          <p className="mgmt-subtitle-inline">
            שלחו את הקישור לטופס למי שתרצו. לאחר שהמועמד/ת ימלא וישלח — ההרשמה תופיע למטה עם כל הפרטים.
          </p>
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
        </section>

        {/* The list of received registrations. */}
        <section className="mgmt-section">
          <div className="mgmt-list-header">
            <h2>הרשמות שהתקבלו</h2>
          </div>

          {/* Loading / error / empty states, otherwise the cards. */}
          {loading ? (
            <div className="mgmt-loading">טוען הרשמות...</div>
          ) : error ? (
            <div className="mgmt-empty">לא ניתן לטעון הרשמות כרגע.</div>
          ) : registrants.length === 0 ? (
            <div className="mgmt-empty">עדיין לא התקבלו הרשמות. שלחו את הטופס כדי להתחיל.</div>
          ) : (
            <div className="reg-list">
              {registrants.map((registrant) => (
                <article className="reg-card" key={registrant.id}>

                  {/* Card header: avatar, name, date, status badge. */}
                  <header className="reg-card-head">
                    <span className="reg-card-avatar">{getFullName(registrant).charAt(0)}</span>
                    <div className="reg-card-title">
                      <h3>{getFullName(registrant)}</h3>
                      <span className="reg-card-date">נרשם/ה: {formatCreatedAt(registrant.createdAt)}</span>
                    </div>
                    <span className="reg-card-status">{registrant.status || 'ממתין לאישור'}</span>
                  </header>

                  {/* All the registrant's detail fields. */}
                  <dl className="reg-card-fields">
                    {DETAIL_FIELDS.map(([key, label]) => (
                      <div className="reg-field" key={key}>
                        <dt>{label}</dt>
                        <dd>{registrant[key] ? String(registrant[key]) : '—'}</dd>
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
                    >
                      ✓ אישור ושיוך לקבוצה
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
    </main>
  );
}

export default RegistrationsManagement;
