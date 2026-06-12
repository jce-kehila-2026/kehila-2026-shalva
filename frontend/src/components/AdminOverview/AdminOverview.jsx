// AdminOverview — the admin home. The activity command center (חמ״ל) is the
// main content; a compact events calendar and today's birthdays sit in a small
// side column. A "pending volunteers" chip (registrations awaiting approval)
// replaces the old drawer button and links to the registrations screen.

// React hooks for state, effects and derived values.
import { useEffect, useMemo, useState } from 'react';

// Firestore helpers for reading collections and adding an event.
import { addDoc, collection, getDocs } from 'firebase/firestore';

// Our Firestore database instance.
import { db } from '../../firebase';

// Styles for this screen.
import './AdminOverview.css';

// Shared event date + status helpers.
import { computeEventStatus, parseEventDate } from '../../utils/eventStatus';

// Shared people helpers (display name, birth-date parsing, age).
import { getDisplayName, parseBirthDate, computeAge } from '../../utils/people';

// The activity command center, embedded as the home's main content.
import ActivityCommandCenter from '../ActivityCommandCenter/ActivityCommandCenter';


// Full month names in Hebrew, indexed 0 (January) to 11 (December).
const HEBREW_MONTHS = [
  'ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני',
  'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר',
];

// Sunday-first weekday initials (the week starts on Sunday in Hebrew).
const WEEKDAYS = ['א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ש'];

// The status a registrant starts with (counted as "pending").
const PENDING_STATUS = 'ממתין לאישור';


// Event status -> CSS class (used to colour the small status badge).
function statusClass(status) {
  switch (status) {
    case 'פעיל':
      return 'ao-status-active';
    case 'מתוכנן':
      return 'ao-status-planned';
    case 'הסתיים':
      return 'ao-status-finished';
    case 'בוטל':
      return 'ao-status-cancelled';
    default:
      return '';
  }
}


// onNavigate lets the pending chip jump to another admin view (registrations).
function AdminOverview({ onNavigate }) {
  // The loaded data (null until the first fetch finishes).
  const [data, setData] = useState(null);

  // True while loading; flips an error flag if any collection failed.
  const [loading, setLoading] = useState(true);
  const [hadError, setHadError] = useState(false);

  // Whether the birthdays card is expanded.
  const [bdayOpen, setBdayOpen] = useState(false);

  // The month/day the compact calendar is currently showing.
  const now = new Date();
  const [calYear, setCalYear] = useState(now.getFullYear());
  const [calMonth, setCalMonth] = useState(now.getMonth());
  const [selectedDay, setSelectedDay] = useState(now.getDate());

  // "Add event" quick action: modal visibility + form fields.
  const [isAddEventOpen, setIsAddEventOpen] = useState(false);

  // True while an event is being saved (guards against double-submit).
  const [savingEvent, setSavingEvent] = useState(false);

  // Bumped after adding an event, to make the embedded command center reload.
  const [accReloadToken, setAccReloadToken] = useState(0);
  const [eventForm, setEventForm] = useState({
    name: '',
    date: '',
    location: '',
    description: '',
    assignedGroup: 'ללא שיוך',
    status: 'מתוכנן',
    contactName: '',
    contactPhone: '',
    contactEmail: '',
  });

  // Load every collection once when the screen opens.
  useEffect(() => {
    // Guards against state updates after unmount.
    let isMounted = true;

    // Read one collection, returning null on failure (so it can be flagged).
    const fetchDocs = async (collectionName) => {
      try {
        const snapshot = await getDocs(collection(db, collectionName));
        return snapshot.docs.map((documentSnapshot) => ({ id: documentSnapshot.id, ...documentSnapshot.data() }));
      } catch (error) {
        console.error(`שגיאה בטעינת ${collectionName}:`, error);
        return null;
      }
    };

    // Load everything in parallel and shape it for the UI.
    const load = async () => {
      // Fetch all five collections at once.
      const [volunteersRaw, groupsRaw, usersRaw, eventsRaw, registrantsRaw] = await Promise.all([
        fetchDocs('volunteers'),
        fetchDocs('groups'),
        fetchDocs('users'),
        fetchDocs('events'),
        fetchDocs('registrants'),
      ]);

      // Bail out if we unmounted while waiting.
      if (!isMounted) return;

      // Flag an error if any collection came back null.
      const anyError = [volunteersRaw, groupsRaw, usersRaw, eventsRaw, registrantsRaw].some((value) => value === null);

      // Shape the volunteers (keep the raw doc for birthday parsing).
      const volunteers = (volunteersRaw || []).map((person) => ({
        id: person.id,
        name: getDisplayName(person),
        raw: person,
      }));

      // Shape the groups (needed by the add-event group dropdown).
      const groups = (groupsRaw || []).map((group) => ({
        id: group.id,
        groupName: group.groupName || group.name || 'קבוצה ללא שם',
      }));

      // Guides are users whose role is "guide" (removed/disabled ones excluded).
      const guides = (usersRaw || [])
        .filter((person) => person.role === 'guide' && !person.disabled)
        .map((person) => ({ id: person.id, name: getDisplayName(person), raw: person }));

      // Shape the events (status derived from the date).
      const events = (eventsRaw || []).map((event) => ({
        id: event.id,
        name: event.name || event.title || 'אירוע ללא שם',
        date: event.date || '',
        status: computeEventStatus(event),
        location: event.location || '',
      }));

      // Count registrants still awaiting approval (missing status counts as pending).
      const pendingCount = (registrantsRaw || []).filter(
        (registrant) => !registrant.status || registrant.status === PENDING_STATUS,
      ).length;

      // Find everyone whose birthday is today.
      const today = new Date();
      const todayMonth = today.getMonth();
      const todayDate = today.getDate();

      const birthdaysToday = [...volunteers, ...guides]
        .map((person) => {
          // Parse the person's birth date.
          const birthDate = parseBirthDate(person.raw);
          if (!birthDate) return null;

          // Keep only people whose birthday falls on today's month + day.
          if (birthDate.getMonth() !== todayMonth || birthDate.getDate() !== todayDate) return null;

          return { id: person.id, name: person.name, age: computeAge(birthDate, today) };
        })
        .filter(Boolean);

      // Publish everything to state (counts feed the top stats row).
      setData({
        groups,
        events,
        pendingCount,
        birthdaysToday,
        volunteerCount: volunteers.length,
        guideCount: guides.length,
      });
      setHadError(anyError);
      setLoading(false);
    };

    load();

    // Cleanup: mark as unmounted.
    return () => {
      isMounted = false;
    };
  }, []);

  // Select a calendar day.
  const selectDay = (day) => setSelectedDay(day);

  // Move the calendar by one month and reset the day selection.
  const changeMonth = (delta) => {
    const next = new Date(calYear, calMonth + delta, 1);
    setCalYear(next.getFullYear());
    setCalMonth(next.getMonth());
    setSelectedDay(null);
  };

  // Save a new event from the quick "add event" modal.
  const handleSaveEvent = async (e) => {
    // Don't let the form reload the page.
    e.preventDefault();

    // Ignore extra clicks while a save is already running.
    if (savingEvent) {
      return;
    }

    // Require the three essential fields before saving.
    if (!eventForm.name.trim() || !eventForm.date || !eventForm.location.trim()) {
      alert('נא למלא שם אירוע, תאריך ומיקום.');
      return;
    }

    setSavingEvent(true);

    try {
      // The event document to save.
      const payload = {
        name: eventForm.name.trim(),
        date: eventForm.date,
        location: eventForm.location.trim(),
        description: eventForm.description.trim(),
        assignedGroup: eventForm.assignedGroup,
        status: eventForm.status,
        contact: {
          name: eventForm.contactName.trim(),
          phone: eventForm.contactPhone.trim(),
          email: eventForm.contactEmail.trim(),
        },
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      // Add the event document to the "events" collection.
      const docRef = await addDoc(collection(db, 'events'), payload);

      // Close the modal and reset the form.
      setIsAddEventOpen(false);
      setEventForm({
        name: '',
        date: '',
        location: '',
        description: '',
        assignedGroup: 'ללא שיוך',
        status: 'מתוכנן',
        contactName: '',
        contactPhone: '',
        contactEmail: '',
      });

      // Reflect the new event in the calendar by updating state in place —
      // no jarring full-page reload (which used to throw away all view state).
      setData((current) => (current
        ? {
            ...current,
            events: [
              ...current.events,
              {
                id: docRef.id,
                name: payload.name,
                date: payload.date,
                status: computeEventStatus(payload),
                location: payload.location,
              },
            ],
          }
        : current));

      // Tell the embedded command center to reload so it sees the new event.
      setAccReloadToken((token) => token + 1);
    } catch (err) {
      // Surface failures to the user and log the details.
      console.error('Error saving event:', err);
      alert('אירעה שגיאה בשמירת האירוע.');
    } finally {
      setSavingEvent(false);
    }
  };

  // Group the viewed month's events by their day-of-month (for the calendar dots
  // and the selected-day list). Recomputed only when the data or month changes.
  const eventsByDay = useMemo(() => {
    // Empty until data loads.
    const map = {};
    if (!data) return map;

    data.events.forEach((event) => {
      const date = parseEventDate(event.date);
      if (date && date.getFullYear() === calYear && date.getMonth() === calMonth) {
        const day = date.getDate();
        if (!map[day]) map[day] = [];
        map[day].push(event);
      }
    });

    return map;
  }, [data, calYear, calMonth]);

  // While loading, show a placeholder.
  if (loading) {
    return (
      <section className="admin-overview" dir="rtl" aria-label="דף הבית">
        <div className="ao-empty">טוען נתונים...</div>
      </section>
    );
  }

  // ----- Build the calendar grid for the viewed month -----

  // Which weekday the 1st falls on, and how many days the month has.
  const firstWeekday = new Date(calYear, calMonth, 1).getDay();
  const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();

  // Is the viewed month the real current month? (used to mark "today").
  const todayObj = new Date();
  const isCurrentMonth = todayObj.getFullYear() === calYear && todayObj.getMonth() === calMonth;

  // Build the grid cells: leading blanks for the first week, then the days.
  const cells = [];
  for (let i = 0; i < firstWeekday; i += 1) {
    cells.push(null);
  }
  for (let day = 1; day <= daysInMonth; day += 1) {
    cells.push(day);
  }

  // Events on the currently selected day.
  const selectedEvents = selectedDay ? (eventsByDay[selectedDay] || []) : [];

  return (
    <section className="admin-overview" dir="rtl" aria-label="דף הבית">

      {/* Warning shown when some data failed to load. */}
      {hadError && (
        <div className="ao-note" role="status">
          חלק מהנתונים לא נטענו (ייתכן שאין הרשאת קריאה). המידע עשוי להיות חלקי.
        </div>
      )}

      {/* Admin home: the data cards on top; calendar + חמ״ל below them, and
          the birthdays block at the bottom. */}
      <div className="ao-home">

        {/* ---------- Top stats row: every data card, side by side ---------- */}
        <div className="ao-stats-row">

          {/* Pending registrations — opens the registrations screen. */}
          <button
            type="button"
            className="ao-stat-card is-pending"
            onClick={() => onNavigate && onNavigate('registrations')}
          >
            <span className="ao-stat-num">{data.pendingCount}</span>
            <span className="ao-stat-label">ממתינים לאישור</span>
          </button>

          {/* Volunteer count — opens volunteer management. */}
          <button
            type="button"
            className="ao-stat-card"
            onClick={() => onNavigate && onNavigate('volunteers')}
          >
            <span className="ao-stat-num">{data.volunteerCount}</span>
            <span className="ao-stat-label">מתנדבים</span>
          </button>

          {/* Guide count — opens guide management. */}
          <button
            type="button"
            className="ao-stat-card"
            onClick={() => onNavigate && onNavigate('guides')}
          >
            <span className="ao-stat-num">{data.guideCount}</span>
            <span className="ao-stat-label">מדריכים</span>
          </button>

          {/* Group count — opens group management. */}
          <button
            type="button"
            className="ao-stat-card"
            onClick={() => onNavigate && onNavigate('groups')}
          >
            <span className="ao-stat-num">{data.groups.length}</span>
            <span className="ao-stat-label">קבוצות</span>
          </button>
        </div>

        {/* Below the cards: the big events calendar, then the חמ״ל beside it. */}
        <div className="ao-home-top">

          {/* ---------- Events calendar (large) ---------- */}
          <div className="ao-cal-card">

            {/* Calendar header: month label + prev/next arrows. */}
            <div className="ao-cal-header">
              <div className="ao-cal-header-text">
                <span className="ao-cal-eyebrow">📅 לוח אירועים</span>
                <span className="ao-cal-month">{HEBREW_MONTHS[calMonth]} {calYear}</span>
              </div>
              <div className="ao-cal-arrows">
                {/* Add a new event (replaces the old separate "add event" button). */}
                <button
                  type="button"
                  className="ao-cal-add"
                  onClick={() => setIsAddEventOpen(true)}
                  aria-label="הוספת אירוע"
                  title="הוספת אירוע"
                >
                  +
                </button>
                <button type="button" onClick={() => changeMonth(-1)} aria-label="חודש קודם">‹</button>
                <button type="button" onClick={() => changeMonth(1)} aria-label="חודש הבא">›</button>
              </div>
            </div>

            {/* The day grid. */}
            <div className="ao-cal-body">
              <div className="ao-cal-grid">

                {/* Weekday header row. */}
                {WEEKDAYS.map((weekday) => (
                  <div className="ao-cal-weekday" key={weekday}>{weekday}</div>
                ))}

                {/* One cell per grid slot (blank or a day button). */}
                {cells.map((day, index) => {
                  // Leading blank before the 1st.
                  if (day === null) return <div className="ao-cal-empty" key={`empty-${index}`} />;

                  // This day's events and weekday.
                  const dayEvents = eventsByDay[day];
                  const weekday = new Date(calYear, calMonth, day).getDay();

                  // Build the day button's classes (shabbat / today / selected).
                  const classes = [
                    'ao-cal-day',
                    weekday === 6 ? 'is-shabbat' : '',
                    isCurrentMonth && day === todayObj.getDate() ? 'is-today' : '',
                    day === selectedDay ? 'is-selected' : '',
                  ].filter(Boolean).join(' ');

                  return (
                    <button type="button" className={classes} key={day} onClick={() => selectDay(day)}>
                      <span className="ao-cal-num">{day}</span>
                      {dayEvents && <span className="ao-cal-mark" aria-hidden="true" />}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Compact list of the selected day's events (name + status badge). */}
            <div className="ao-cal-events">
              <h4 className="ao-cal-events-title">
                {selectedDay ? `אירועים — ${selectedDay} ב${HEBREW_MONTHS[calMonth]}` : 'בחרו יום בלוח'}
              </h4>

              {selectedDay && (
                selectedEvents.length > 0 ? (
                  <ul className="ao-cal-event-list">
                    {selectedEvents.map((event) => (
                      <li className="ao-cal-event-row" key={event.id}>
                        <span className="ao-cal-event-name">{event.name}</span>
                        {event.status && (
                          <span className={`ao-status-badge ${statusClass(event.status)}`}>{event.status}</span>
                        )}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className="ao-empty-inline">אין אירועים בתאריך הזה</div>
                )
              )}
            </div>
          </div>

          {/* חמ״ל activity — the left column beside the calendar. The pending
              count is passed in as the first stat card with the other counters. */}
          <div className="ao-home-acc">
            {/* The pending-registrations card moved to the top stats row. */}
            <ActivityCommandCenter
              reloadToken={accReloadToken}
              onNavigate={onNavigate}
            />
          </div>
        </div>

          {/* ---------- Today's birthdays (full width, at the bottom) ---------- */}
          <div className="ao-bday-block">

            {/* Tap the cake to reveal today's birthdays. */}
            <button type="button" className="ao-cake" onClick={() => setBdayOpen((open) => !open)} aria-expanded={bdayOpen}>
              <span className="ao-cake-emoji" aria-hidden="true">🎂</span>
              <span className="ao-cake-text">
                <span className="ao-cake-title">ימי הולדת</span>
                <span className="ao-cake-sub">
                  {data.birthdaysToday.length > 0
                    ? `${data.birthdaysToday.length} חוגגים היום! 🎉`
                    : 'אין ימי הולדת היום'}
                </span>
              </span>
              <span className="ao-cake-chevron" aria-hidden="true">{bdayOpen ? '▲' : '▼'}</span>
            </button>

            {/* Revealed list of today's birthdays. */}
            {bdayOpen && (
              <div className="ao-bday-reveal">
                {data.birthdaysToday.length > 0 ? (
                  <div className="ao-today-grid">
                    {data.birthdaysToday.map((person) => (
                      <div className="ao-today-card" key={person.id}>
                        <span className="ao-today-emoji" aria-hidden="true">🎂</span>
                        <span className="ao-today-info">
                          <span className="ao-today-name">{person.name}</span>
                          <span className="ao-today-sub">חוגג/ת היום! 🎉</span>
                        </span>
                        <span className="ao-today-age">גיל {person.age}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="ao-empty-inline">אין ימי הולדת היום 🎈</div>
                )}
              </div>
            )}
          </div>
      </div>

      {/* Modal: Add Event. */}
      {isAddEventOpen && (
        <div className="ao-modal-overlay" role="dialog" aria-modal="true">
          <div className="ao-modal-content">
            <div className="ao-modal-header">הוספת אירוע חדש</div>
            <form onSubmit={handleSaveEvent} className="ao-modal-form">

              {/* Event name. */}
              <div className="ao-form-group">
                <label>שם האירוע:</label>
                <input
                  type="text"
                  value={eventForm.name}
                  onChange={(e) => setEventForm({ ...eventForm, name: e.target.value })}
                  placeholder="לדוגמה: יום כיף בבריכה"
                  required
                />
              </div>

              {/* Event date. */}
              <div className="ao-form-group">
                <label>תאריך:</label>
                <input
                  type="date"
                  value={eventForm.date}
                  onChange={(e) => setEventForm({ ...eventForm, date: e.target.value })}
                  required
                />
              </div>

              {/* Event location. */}
              <div className="ao-form-group">
                <label>מיקום:</label>
                <input
                  type="text"
                  value={eventForm.location}
                  onChange={(e) => setEventForm({ ...eventForm, location: e.target.value })}
                  placeholder="מיקום האירוע"
                  required
                />
              </div>

              {/* Assigned group. */}
              <div className="ao-form-group">
                <label>קבוצה משויכת:</label>
                <select
                  value={eventForm.assignedGroup}
                  onChange={(e) => setEventForm({ ...eventForm, assignedGroup: e.target.value })}
                >
                  <option value="ללא שיוך">ללא שיוך</option>
                  {data.groups.map((group) => (
                    <option key={group.id} value={group.groupName}>{group.groupName}</option>
                  ))}
                </select>
              </div>

              {/* Status. */}
              <div className="ao-form-group">
                <label>סטטוס:</label>
                <select
                  value={eventForm.status}
                  onChange={(e) => setEventForm({ ...eventForm, status: e.target.value })}
                >
                  <option value="מתוכנן">מתוכנן</option>
                  <option value="פעיל">פעיל</option>
                  <option value="הסתיים">הסתיים</option>
                  <option value="בוטל">בוטל</option>
                </select>
              </div>

              {/* Contact name. */}
              <div className="ao-form-group">
                <label>שם איש קשר:</label>
                <input
                  type="text"
                  value={eventForm.contactName}
                  onChange={(e) => setEventForm({ ...eventForm, contactName: e.target.value })}
                  placeholder="שם איש קשר"
                />
              </div>

              {/* Free-text description (spans both columns). */}
              <div className="ao-form-group" style={{ gridColumn: '1 / -1' }}>
                <label>תיאור האירוע:</label>
                <textarea
                  value={eventForm.description}
                  onChange={(e) => setEventForm({ ...eventForm, description: e.target.value })}
                  placeholder="תיאור קצר..."
                  rows="3"
                />
              </div>

              {/* Modal actions. */}
              <div className="ao-modal-actions" style={{ gridColumn: '1 / -1' }}>
                <button type="button" className="ao-btn-outline" onClick={() => setIsAddEventOpen(false)}>ביטול</button>
                <button type="submit" className="ao-btn-success" disabled={savingEvent}>{savingEvent ? 'שומר...' : 'הוסף אירוע'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </section>
  );
}

export default AdminOverview;
