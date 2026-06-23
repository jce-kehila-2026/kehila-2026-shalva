// Birthdays — upcoming-birthdays screen: lists everyone (volunteers + guides)
// with a birth date, sorted by how soon their birthday is, with a one-tap
// WhatsApp greeting. With `editable` (admin) a birth date can be fixed inline.

// React hooks used by this screen.
import { useCallback, useEffect, useRef, useState } from 'react';

// Firestore helpers for reading and updating documents.
import { collection, doc, getDocs, updateDoc } from 'firebase/firestore';

// Our Firestore database instance.
import { db } from '../../firebase';

// Date picker used inside the edit form.
import BirthDatePicker from '../shared/BirthDatePicker/BirthDatePicker';

// Button that opens a pre-filled WhatsApp message.
import WhatsAppButton from '../shared/WhatsAppButton/WhatsAppButton';

// Builds the birthday greeting text for WhatsApp.
import { birthdayMessage } from '../../utils/whatsapp';

// Shared people helpers (one definition for every screen). getDisplayName's
// default fallback is the same 'חבר/ת קהילה' this screen used locally.
import { getDisplayName as getName, parseBirthDate, computeAge } from '../../utils/people';

// Styles for this screen.
import './Birthdays.css';


// Month labels in Hebrew, indexed 0 (January) to 11 (December).
const HEBREW_MONTHS = [
  'ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני',
  'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר',
];


// Where to read people from: all volunteers, plus users who are guides.
// Registrants who only filled the sign-up form are left out on purpose.
const PEOPLE_SOURCES = [
  { collectionName: 'volunteers' },
  { collectionName: 'users', includeDoc: (data) => data.role === 'guide' && !data.disabled },
];


// Colour palette for the falling confetti pieces.
const CONFETTI_COLORS = [
  '#f43f5e', '#fb923c', '#facc15', '#34d399',
  '#60a5fa', '#a78bfa', '#f472b6', '#22d3ee',
];


// Build 44 confetti pieces once at load, each with a random look and motion.
const CONFETTI_PIECES = Array.from({ length: 44 }, (_, index) => ({
  // Stable key for React.
  id: index,

  // Horizontal start position (percent across the hero).
  left: Math.random() * 100,

  // Stagger when each piece starts falling.
  delay: Math.random() * 5,

  // How long one fall takes.
  duration: 4 + Math.random() * 4,

  // Piece size in pixels.
  size: 7 + Math.random() * 9,

  // Initial rotation.
  rotate: Math.random() * 360,

  // Pick a colour, cycling through the palette.
  color: CONFETTI_COLORS[index % CONFETTI_COLORS.length],
}));


// Format a Date into a "YYYY-MM-DD" string for the date input.
function toInputDate(date) {
  // Four-digit year.
  const year = date.getFullYear();

  // Month is zero-based, so add 1 and pad to two digits.
  const month = String(date.getMonth() + 1).padStart(2, '0');

  // Day of the month, padded to two digits.
  const day = String(date.getDate()).padStart(2, '0');

  return `${year}-${month}-${day}`;
}


function Birthdays({ onBack, editable = false }) {
  const isMountedRef = useRef(true);

  // The list of people (with parsed birthday info) to display.
  const [people, setPeople] = useState([]);

  // True while the first load is in progress.
  const [loading, setLoading] = useState(true);

  // Holds an error message if loading failed and produced nothing.
  const [loadError, setLoadError] = useState(null);

  // The person currently being edited (null when the modal is closed).
  const [editing, setEditing] = useState(null);

  // Working copy of the edit form fields.
  const [form, setForm] = useState({ name: '', birthDate: '' });

  // True while a save is being written to Firestore.
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);


  // Load everyone's birthdays from Firestore and prepare them for display.
  const loadBirthdays = useCallback(async () => {
    if (!isMountedRef.current) {
      return false;
    }

    // Show the loading state.
    setLoading(true);

    // Reference point for computing ages.
    const today = new Date();

    // Collects every valid person across all sources.
    const collected = [];

    // Remembers the last read error (used only if nothing loads).
    let lastError = null;

    // Read each source collection one by one.
    for (const source of PEOPLE_SOURCES) {
      try {
        // Fetch all documents in this collection.
        const snapshot = await getDocs(collection(db, source.collectionName));

        // Turn each document into a person entry.
        snapshot.docs.forEach((documentSnapshot) => {
          // The raw document data.
          const data = documentSnapshot.data();

          // Skip documents that don't match the source filter (e.g. non-guides).
          if (source.includeDoc && !source.includeDoc(data)) return;

          // Skip people without a usable birth date.
          const birthDate = parseBirthDate(data);
          if (!birthDate) return;

          // Build the display-ready person record.
          collected.push({
            id: `${source.collectionName}-${documentSnapshot.id}`,
            collectionName: source.collectionName,
            docId: documentSnapshot.id,
            name: getName(data),
            phone: data.phone || data.phoneNumber || '',
            birthInput: toInputDate(birthDate),
            month: birthDate.getMonth(),
            day: birthDate.getDate(),
            age: computeAge(birthDate, today),
          });
        });
      } catch (error) {
        // A blocked or missing collection shouldn't break the screen.
        lastError = error.message;
      }
    }

    // The same person can appear in more than one collection — keep one copy.
    const seen = new Set();
    const unique = collected.filter((person) => {
      // Identity = name + birthday.
      const key = `${person.name}|${person.month}|${person.day}`;

      // Drop a person we've already kept.
      if (seen.has(key)) return false;

      // Otherwise remember and keep them.
      seen.add(key);
      return true;
    });

    if (!isMountedRef.current) {
      return false;
    }

    // Publish the results to state.
    setPeople(unique);

    // Only surface an error if we ended up with nothing to show.
    setLoadError(unique.length === 0 ? lastError : null);

    // Loading is done.
    setLoading(false);
    return true;
  }, []);


  // Load birthdays once when the screen first mounts.
  useEffect(() => {
    loadBirthdays();
  }, [loadBirthdays]);


  // Open the edit modal pre-filled with the chosen person's details.
  const openEdit = (person) => {
    setEditing(person);
    setForm({ name: person.name, birthDate: person.birthInput });
  };


  // Validate the form and save the changes back to Firestore.
  const handleSave = async (event) => {
    // Don't let the form reload the page.
    event.preventDefault();

    // Name is required.
    const name = form.name.trim();
    if (!name) {
      alert('יש להזין שם');
      return;
    }

    // Birth date is required.
    if (!form.birthDate) {
      alert('יש להזין תאריך לידה');
      return;
    }

    // The chosen birth date.
    const birthDate = form.birthDate;

    // Show the saving state.
    setSaving(true);
    try {
      // Reference to the exact document being edited.
      const ref = doc(db, editing.collectionName, editing.docId);

      if (editing.collectionName === 'users') {
        // Guides store their name split into first and last name.
        const parts = name.split(/\s+/);
        const firstName = parts.shift() || '';
        const lastName = parts.join(' ');
        await updateDoc(ref, { firstName, lastName, birthDate });
      } else {
        // Volunteers store a single name field.
        await updateDoc(ref, { name, birthDate });
      }
      if (!isMountedRef.current) {
        return;
      }

      // Close the modal and refresh the list.
      setEditing(null);
      await loadBirthdays();
    } catch (error) {
      if (!isMountedRef.current) {
        return;
      }
      // Report a failed save to the user.
      console.error('שגיאה בעדכון יום הולדת:', error);
      alert(`העדכון נכשל: ${error.message}`);
    } finally {
      // Always clear the saving state.
      if (isMountedRef.current) {
        setSaving(false);
      }
    }
  };


  // Group people by month, sort each month by day, and drop empty months.
  const monthGroups = HEBREW_MONTHS
    .map((label, index) => ({
      index,
      label,
      people: people
        .filter((person) => person.month === index)
        .sort((first, second) => first.day - second.day),
    }))
    .filter((group) => group.people.length > 0);

  // True once loading finished and there is at least one birthday.
  const hasBirthdays = !loading && people.length > 0;


  return (
    <section className="birthdays" dir="rtl" aria-label="ימי הולדת">

      {/* Festive header with confetti, decorations, the cake, and a title. */}
      <div className="bday-hero">

        {/* Falling confetti pieces (decorative only). */}
        <div className="bday-confetti" aria-hidden="true">
          {CONFETTI_PIECES.map((piece) => (
            <i
              key={piece.id}
              style={{
                left: `${piece.left}%`,
                '--s': `${piece.size}px`,
                '--c': piece.color,
                '--d': `${piece.duration}s`,
                '--delay': `${piece.delay}s`,
                '--r': `${piece.rotate}deg`,
              }}
            />
          ))}
        </div>

        {/* Optional back button (only when a handler was passed in). */}
        {typeof onBack === 'function' && (
          <button type="button" className="birthdays-back" onClick={onBack}>
            ← הקבוצות שלנו
          </button>
        )}

        {/* Floating balloons / gift / party decorations. */}
        <span className="bday-deco bday-deco-1" aria-hidden="true">🎈</span>
        <span className="bday-deco bday-deco-2" aria-hidden="true">🎈</span>
        <span className="bday-deco bday-deco-3" aria-hidden="true">🎁</span>
        <span className="bday-deco bday-deco-4" aria-hidden="true">🎉</span>

        {/* Big cake centerpiece with twinkling sparkles. */}
        <div className="bday-cake-wrap" aria-hidden="true">
          <span className="bday-spark bday-spark-1">✨</span>
          <span className="bday-spark bday-spark-2">✨</span>
          <span className="bday-spark bday-spark-3">✨</span>
          <span className="bday-cake">🎂</span>
        </div>

        {/* Title and a count of how many birthdays we're celebrating. */}
        <div className="bday-hero-text">
          <div className="birthdays-eyebrow">קהילה</div>
          <h2>יום הולדת שמח! 🎉</h2>
          <p>
            {hasBirthdays
              ? `חוגגים יחד עם ${people.length} ${people.length === 1 ? 'חבר/ת קהילה' : 'חברי קהילה'} 🎈`
              : 'כאן נחגוג יחד את ימי ההולדת של חברי הקהילה 🎈'}
          </p>

          {/* Admin-only hint that cards are clickable. */}
          {editable && hasBirthdays && (
            <p className="bday-edit-tip">💡 אפשר ללחוץ על כל שם כדי לערוך שם או תאריך לידה</p>
          )}
        </div>
      </div>

      {/* Body: loading state, empty state, or the month-by-month list. */}
      {loading ? (

        // Still fetching data.
        <div className="birthdays-state">טוען ימי הולדת...</div>

      ) : people.length === 0 ? (

        // Nothing to show — explain why (permissions vs. simply empty).
        <div className="birthdays-state">
          {loadError
            ? 'לא ניתן לטעון ימי הולדת כרגע. ייתכן שאין הרשאת קריאה לנתונים.'
            : 'עדיין אין ימי הולדת להצגה.'}
        </div>

      ) : (

        // One block per month that has birthdays.
        <div className="birthday-months">
          {monthGroups.map((group) => (
            <div className="birthday-month" key={group.index}>

              {/* Month name plus how many birthdays it holds. */}
              <h3 className="birthday-month-title">
                <span>{group.label}</span>
                <span className="birthday-month-count">{group.people.length}</span>
              </h3>

              {/* Grid of birthday cards for this month. */}
              <ul className="birthday-grid">
                {group.people.map((person) => (
                  <li key={person.id}>

                    {/* Editable view shows a clickable card; otherwise a static one. */}
                    {editable ? (

                      // Clickable card that opens the edit modal.
                      <button
                        type="button"
                        className="birthday-card birthday-card--editable"
                        onClick={() => openEdit(person)}
                        title="לחצו לעריכה"
                      >
                        <span className="birthday-emoji" aria-hidden="true">🎂</span>

                        {/* Name and the day of the birthday. */}
                        <div className="birthday-card-info">
                          <span className="birthday-name">{person.name}</span>
                          <span className="birthday-date">{person.day} ב{group.label}</span>
                        </div>

                        {/* Show the age when we could compute it. */}
                        {person.age >= 0 && (
                          <span className="birthday-age">🎈 גיל {person.age}</span>
                        )}

                        {/* Little pencil hint that the card is editable. */}
                        <span className="birthday-edit-hint" aria-hidden="true">✏️</span>
                      </button>

                    ) : (

                      // Read-only card (same content, not clickable).
                      <div className="birthday-card">
                        <span className="birthday-emoji" aria-hidden="true">🎂</span>

                        {/* Name and the day of the birthday. */}
                        <div className="birthday-card-info">
                          <span className="birthday-name">{person.name}</span>
                          <span className="birthday-date">{person.day} ב{group.label}</span>
                        </div>

                        {/* Show the age when we could compute it. */}
                        {person.age >= 0 && (
                          <span className="birthday-age">🎈 גיל {person.age}</span>
                        )}
                      </div>
                    )}

                    {/* Admins with the person's phone get a "send a wish" button. */}
                    {editable && person.phone && (
                      <div className="birthday-card-wa">
                        <WhatsAppButton
                          phone={person.phone}
                          message={birthdayMessage(person.name)}
                          label="שלחו ברכה"
                          title={`ברכת יום הולדת ל${person.name}`}
                          compact
                        />
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}

      {/* Edit modal — only mounted while a person is being edited. */}
      {editing && (

        // Dark overlay; clicking it closes the modal (unless a save is running).
        <div
          className="bday-modal-overlay"
          onClick={() => { if (!saving) setEditing(null); }}
        >

          {/* The dialog itself; stop clicks here from closing the overlay. */}
          <div
            className="bday-modal"
            dir="rtl"
            role="dialog"
            aria-modal="true"
            aria-label="עריכת יום הולדת"
            onClick={(event) => event.stopPropagation()}
          >

            {/* Modal header with a cake icon and title. */}
            <div className="bday-modal-head">
              <span className="bday-modal-cake" aria-hidden="true">🎂</span>
              <h3>עריכת יום הולדת</h3>
            </div>

            {/* The edit form. */}
            <form className="bday-modal-body" onSubmit={handleSave}>

              {/* Name field. */}
              <div className="bday-field">
                <label htmlFor="bday-name">שם</label>
                <input
                  id="bday-name"
                  type="text"
                  value={form.name}
                  onChange={(event) => setForm({ ...form, name: event.target.value })}
                  required
                />
              </div>

              {/* Birth date field (custom picker). */}
              <div className="bday-field">
                <BirthDatePicker
                  key={editing.docId}
                  value={form.birthDate}
                  onChange={(birthDate) => setForm((prev) => ({ ...prev, birthDate }))}
                  label="תאריך לידה"
                  required
                  showPreview
                />
              </div>

              {/* Save / cancel buttons. */}
              <div className="bday-modal-actions">
                <button type="submit" className="bday-btn bday-btn-primary" disabled={saving}>
                  {saving ? 'שומר...' : 'שמירה'}
                </button>
                <button
                  type="button"
                  className="bday-btn bday-btn-ghost"
                  onClick={() => setEditing(null)}
                  disabled={saving}
                >
                  ביטול
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </section>
  );
}

export default Birthdays;
