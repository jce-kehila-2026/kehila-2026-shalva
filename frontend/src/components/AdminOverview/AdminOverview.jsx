// AdminOverview — the admin home / dashboard. Read-only: a monthly events
// calendar and today's birthdays up top, with volunteers / groups / guides
// in a side drawer. Event status is derived from the date; each Firestore
// read is wrapped on its own so a blocked collection just shows as empty.

// React hooks for state and side effects.
import { useEffect, useState } from 'react';

// Firestore helpers for reading collections.
import { collection, getDocs } from 'firebase/firestore';

// Our Firestore database instance.
import { db } from '../../firebase';

// Styles for this screen.
import './AdminOverview.css';

// Shared event date + status helpers.
import { computeEventStatus, parseEventDate } from '../../utils/eventStatus';


// Full month names in Hebrew, indexed 0 (January) to 11 (December).
const HEBREW_MONTHS = [
  'ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני',
  'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר',
];

// Sunday-first weekday initials (the week starts on Sunday in Hebrew).
const WEEKDAYS = ['א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ש'];

// Field names that might hold a birth date across the different collections.
const BIRTH_DATE_FIELDS = ['birthDate', 'birthday', 'dob', 'dateOfBirth', 'birth_date'];

// The collapsible lists shown in the side drawer (key + label + icon + accent).
const SECONDARY_SECTIONS = [
  { key: 'volunteers', label: 'מתנדבים', icon: '🧑‍🤝‍🧑', accent: 'a' },
  { key: 'groups', label: 'קבוצות', icon: '👥', accent: 'b' },
  { key: 'guides', label: 'מדריכים', icon: '🧑‍🏫', accent: 'c' },
];

// Fallback text for missing event fields.
const CONTACT_FALLBACK = 'לא צוין';


// Best available display name, with graceful fallbacks.
function getName(person) {
  return (
    person.name ||
    [person.firstName, person.lastName].filter(Boolean).join(' ').trim() ||
    person.email ||
    'חבר/ת קהילה'
  );
}


// Parse a birth date from any of the supported field names / value shapes.
function parseBirthDate(person) {
  // Try each possible field name in order.
  for (const field of BIRTH_DATE_FIELDS) {
    const value = person[field];

    // Skip empty fields.
    if (!value) continue;

    // Resolve the value into a Date depending on its shape.
    let date = null;

    if (typeof value === 'string') {
      // Text date string.
      const parsed = new Date(value);
      if (!Number.isNaN(parsed.getTime())) date = parsed;
    } else if (typeof value.toDate === 'function') {
      // Firestore Timestamp.
      date = value.toDate();
    } else if (value instanceof Date) {
      // Native Date.
      date = value;
    } else if (typeof value.seconds === 'number') {
      // Plain { seconds } shape.
      date = new Date(value.seconds * 1000);
    }

    // Return the first valid date we manage to build.
    if (date && !Number.isNaN(date.getTime())) return date;
  }

  // No usable birth date.
  return null;
}


// Current age in whole years, accounting for whether the birthday already passed.
function computeAge(birthDate, today) {
  // Rough age from the year difference.
  let age = today.getFullYear() - birthDate.getFullYear();

  // Subtract one if this year's birthday hasn't happened yet.
  const monthDiff = today.getMonth() - birthDate.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) age -= 1;

  return age;
}


// Event status -> CSS class.
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


// Event status -> short key used in the card's modifier class.
function statusKey(status) {
  switch (status) {
    case 'פעיל':
      return 'active';
    case 'מתוכנן':
      return 'planned';
    case 'הסתיים':
      return 'finished';
    case 'בוטל':
      return 'cancelled';
    default:
      return '';
  }
}


// Format an event date as a readable Hebrew date string.
function formatEventDate(value) {
  const date = parseEventDate(value);
  if (!date) return value || 'ללא תאריך';
  return date.toLocaleDateString('he-IL', { day: 'numeric', month: 'long', year: 'numeric' });
}


// Does the event have any contact details worth showing?
function hasContact(contact) {
  return Boolean(contact && (contact.name || contact.phone || contact.email));
}


function AdminOverview() {
  // The loaded data (null until the first fetch finishes).
  const [data, setData] = useState(null);

  // True while loading; flips an error flag if any collection failed.
  const [loading, setLoading] = useState(true);
  const [hadError, setHadError] = useState(false);

  // The event currently expanded in the day list (null when none).
  const [openEventId, setOpenEventId] = useState(null);

  // The drawer section currently expanded (null when none).
  const [openSection, setOpenSection] = useState(null);

  // Whether the birthdays cake is expanded.
  const [bdayOpen, setBdayOpen] = useState(false);

  // Whether the side drawer is open.
  const [drawerOpen, setDrawerOpen] = useState(false);

  // The month/day the calendar is currently showing.
  const now = new Date();
  const [calYear, setCalYear] = useState(now.getFullYear());
  const [calMonth, setCalMonth] = useState(now.getMonth());
  const [selectedDay, setSelectedDay] = useState(now.getDate());

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
      // Fetch all four collections at once.
      const [volunteersRaw, groupsRaw, usersRaw, eventsRaw] = await Promise.all([
        fetchDocs('volunteers'),
        fetchDocs('groups'),
        fetchDocs('users'),
        fetchDocs('events'),
      ]);

      // Bail out if we unmounted while waiting.
      if (!isMounted) return;

      // Flag an error if any collection came back null.
      const anyError = [volunteersRaw, groupsRaw, usersRaw, eventsRaw].some((value) => value === null);

      // Shape the volunteers (keep the raw doc for birthday parsing).
      const volunteers = (volunteersRaw || []).map((person) => ({
        id: person.id,
        name: getName(person),
        groupName: person.groupName || '',
        raw: person,
      }));

      // Shape the groups.
      const groups = (groupsRaw || []).map((group) => ({
        id: group.id,
        groupName: group.groupName || group.name || 'קבוצה ללא שם',
        guideName: group.guideName || '',
        time: group.time || '',
      }));

      // Guides are users whose role is "guide" (removed/disabled ones excluded).
      const guides = (usersRaw || [])
        .filter((person) => person.role === 'guide' && !person.disabled)
        .map((person) => ({ id: person.id, name: getName(person), raw: person }));

      // Shape the events (status derived from the date).
      const events = (eventsRaw || []).map((event) => ({
        id: event.id,
        name: event.name || event.title || 'אירוע ללא שם',
        date: event.date || '',
        status: computeEventStatus(event),
        location: event.location || '',
        description: event.description || '',
        assignedGroup: event.assignedGroup || event.group || '',
        contact: event.contact || null,
      }));

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

      // Publish everything to state.
      setData({ volunteers, groups, guides, events, birthdaysToday });
      setHadError(anyError);
      setLoading(false);
    };

    load();

    // Cleanup: mark as unmounted.
    return () => {
      isMounted = false;
    };
  }, []);

  // Toggle an event card open/closed.
  const toggleEvent = (id) => setOpenEventId((current) => (current === id ? null : id));

  // Toggle a drawer section open/closed.
  const toggleSection = (key) => setOpenSection((current) => (current === key ? null : key));

  // Select a calendar day and collapse any open event.
  const selectDay = (day) => {
    setSelectedDay(day);
    setOpenEventId(null);
  };

  // Move the calendar by one month and reset the day selection.
  const changeMonth = (delta) => {
    const next = new Date(calYear, calMonth + delta, 1);
    setCalYear(next.getFullYear());
    setCalMonth(next.getMonth());
    setSelectedDay(null);
    setOpenEventId(null);
  };

  // Render an event's contact details (or a fallback note).
  const renderContact = (contact) => {
    // No contact info.
    if (!hasContact(contact)) return <span className="ao-detail-value">לא צוינו פרטי קשר</span>;

    return (
      <ul className="ao-contact">
        {contact.name && <li>{contact.name}</li>}
        {contact.phone && <li><a href={`tel:${String(contact.phone).replace(/[^\d+]/g, '')}`} dir="ltr">{contact.phone}</a></li>}
        {contact.email && <li><a href={`mailto:${contact.email}`} dir="ltr">{contact.email}</a></li>}
      </ul>
    );
  };

  // Render a single event card (collapsed header + expandable details).
  const renderEventCard = (event) => {
    const date = parseEventDate(event.date);
    const isOpen = openEventId === event.id;

    return (
      <div className={`ao-event ao-event--${statusKey(event.status)} ${isOpen ? 'is-open' : ''}`} key={event.id}>

        {/* Card header: date badge, name/meta, status, chevron. */}
        <button type="button" className="ao-event-head" onClick={() => toggleEvent(event.id)} aria-expanded={isOpen}>
          <span className="ao-event-date" aria-hidden="true">
            <span className="ao-event-day">{date ? date.getDate() : '–'}</span>
            <span className="ao-event-month">{date ? HEBREW_MONTHS[date.getMonth()] : ''}</span>
          </span>
          <span className="ao-event-info">
            <span className="ao-event-name">{event.name}</span>
            <span className="ao-event-meta">{formatEventDate(event.date)}{event.location ? ` · ${event.location}` : ''}</span>
          </span>
          {event.status && <span className={`ao-event-status ${statusClass(event.status)}`}>{event.status}</span>}
          <span className="ao-event-chevron" aria-hidden="true">{isOpen ? '▲' : '▼'}</span>
        </button>

        {/* Expanded details (only when open). */}
        {isOpen && (
          <div className="ao-event-detail">
            <div className="ao-detail-grid">
              <div className="ao-detail-item">
                <span className="ao-detail-label">תאריך</span>
                <span className="ao-detail-value">{formatEventDate(event.date)}</span>
              </div>
              <div className="ao-detail-item">
                <span className="ao-detail-label">מיקום</span>
                <span className="ao-detail-value">{event.location || CONTACT_FALLBACK}</span>
              </div>
              <div className="ao-detail-item">
                <span className="ao-detail-label">קבוצה משויכת</span>
                <span className="ao-detail-value">{event.assignedGroup || CONTACT_FALLBACK}</span>
              </div>
              <div className="ao-detail-item">
                <span className="ao-detail-label">סטטוס</span>
                <span className="ao-detail-value">
                  <span className={`ao-status-badge ${statusClass(event.status)}`}>{event.status}</span>
                </span>
              </div>
              <div className="ao-detail-item ao-detail-wide">
                <span className="ao-detail-label">איש קשר</span>
                {renderContact(event.contact)}
              </div>
            </div>

            {/* Optional free-text description. */}
            {event.description && (
              <div className="ao-event-desc">
                <h5>תיאור האירוע</h5>
                <p>{event.description}</p>
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  // Render the body of one drawer section (volunteers / groups / guides).
  const renderSecondaryBody = (key) => {
    const items = data[key];

    // Nothing to show.
    if (!items || items.length === 0) return <div className="ao-empty">אין מה להציג עדיין.</div>;

    return (
      <ul className="ao-list">
        {items.map((item) => {

          // Volunteers: name + optional group tag.
          if (key === 'volunteers') {
            return (
              <li className="ao-row" key={item.id}>
                <span className="ao-row-main">{item.name}</span>
                {item.groupName && <span className="ao-row-tag">{item.groupName}</span>}
              </li>
            );
          }

          // Groups: name + guide/time sub-line.
          if (key === 'groups') {
            const sub = [item.guideName ? `מדריך: ${item.guideName}` : 'ללא מדריך', item.time].filter(Boolean).join(' · ');
            return (
              <li className="ao-row" key={item.id}>
                <span className="ao-row-main">{item.groupName}</span>
                <span className="ao-row-sub">{sub}</span>
              </li>
            );
          }

          // Guides: just the name.
          return (
            <li className="ao-row" key={item.id}>
              <span className="ao-row-main">{item.name}</span>
            </li>
          );
        })}
      </ul>
    );
  };

  // While loading, show a placeholder.
  if (loading) {
    return (
      <section className="admin-overview" dir="rtl" aria-label="דף הבית">
        <div className="ao-empty">טוען נתונים...</div>
      </section>
    );
  }

  // ----- Build the calendar for the viewed month -----

  // Which weekday the 1st falls on, and how many days the month has.
  const firstWeekday = new Date(calYear, calMonth, 1).getDay();
  const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();

  // Is the viewed month the real current month? (used to mark "today").
  const todayObj = new Date();
  const isCurrentMonth = todayObj.getFullYear() === calYear && todayObj.getMonth() === calMonth;

  // Group this month's events by their day-of-month.
  const eventsByDay = {};
  data.events.forEach((event) => {
    const date = parseEventDate(event.date);
    if (date && date.getFullYear() === calYear && date.getMonth() === calMonth) {
      const day = date.getDate();
      if (!eventsByDay[day]) eventsByDay[day] = [];
      eventsByDay[day].push(event);
    }
  });

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

      {/* Page heading + "more info" button that opens the drawer. */}
      <header className="ao-head">
        <div className="ao-head-text">
          <div className="ao-eyebrow">דף הבית</div>
          <h2 className="ao-title">סקירת מערכת</h2>
          <p className="ao-subtitle">לוח האירועים של החודש וימי ההולדת של היום — במבט אחד.</p>
        </div>
        <button type="button" className="ao-more-btn" onClick={() => setDrawerOpen(true)}>
          <span aria-hidden="true">☰</span> מידע נוסף
        </button>
      </header>

      {/* Warning shown when some data failed to load. */}
      {hadError && (
        <div className="ao-note" role="status">
          חלק מהנתונים לא נטענו (ייתכן שאין הרשאת קריאה). המידע עשוי להיות חלקי.
        </div>
      )}

      {/* ---------- Featured: events calendar ---------- */}
      <div className="ao-cal-card">

        {/* Calendar header: month label + prev/next arrows. */}
        <div className="ao-cal-header">
          <div className="ao-cal-header-text">
            <span className="ao-cal-eyebrow">📅 לוח אירועים</span>
            <span className="ao-cal-month">{HEBREW_MONTHS[calMonth]} {calYear}</span>
          </div>
          <div className="ao-cal-arrows">
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

        {/* Events for the selected day, below the grid. */}
        <div className="ao-cal-events">
          <h4 className="ao-cal-events-title">
            {selectedDay ? `אירועים — ${selectedDay} ב${HEBREW_MONTHS[calMonth]}` : 'בחרו יום בלוח כדי לראות אירועים'}
          </h4>
          {selectedDay && (
            selectedEvents.length > 0
              ? <div className="ao-events">{selectedEvents.map(renderEventCard)}</div>
              : <div className="ao-empty-inline">אין אירועים בתאריך הזה</div>
          )}
        </div>
      </div>

      {/* ---------- Featured: birthdays cake ---------- */}
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

      {/* ---------- Side drawer: extra, less-used info ---------- */}
      {drawerOpen && (

        // Backdrop; clicking it closes the drawer.
        <div className="ao-drawer-backdrop" onClick={() => setDrawerOpen(false)}>

          {/* The drawer panel; stop clicks here from closing it. */}
          <aside
            className="ao-drawer"
            dir="rtl"
            role="dialog"
            aria-label="מידע נוסף"
            onClick={(event) => event.stopPropagation()}
          >
            {/* Drawer header with a close button. */}
            <div className="ao-drawer-head">
              <h3>מידע נוסף</h3>
              <button type="button" className="ao-drawer-close" onClick={() => setDrawerOpen(false)} aria-label="סגירה">✕</button>
            </div>

            {/* One collapsible section per secondary list. */}
            <div className="ao-drawer-body">
              {SECONDARY_SECTIONS.map((section) => {
                const isOpen = openSection === section.key;

                return (
                  <div className={`ao-section ao-accent-${section.accent} ${isOpen ? 'is-open' : ''}`} key={section.key}>

                    {/* Section header: icon, label, count, chevron. */}
                    <button type="button" className="ao-section-head" onClick={() => toggleSection(section.key)} aria-expanded={isOpen}>
                      <span className="ao-section-icon" aria-hidden="true">{section.icon}</span>
                      <span className="ao-section-label">{section.label}</span>
                      <span className="ao-section-count">{data[section.key].length}</span>
                      <span className="ao-section-chevron" aria-hidden="true">{isOpen ? '▲' : '▼'}</span>
                    </button>

                    {/* Section body (only when open). */}
                    {isOpen && <div className="ao-section-body">{renderSecondaryBody(section.key)}</div>}
                  </div>
                );
              })}
            </div>
          </aside>
        </div>
      )}
    </section>
  );
}

export default AdminOverview;
