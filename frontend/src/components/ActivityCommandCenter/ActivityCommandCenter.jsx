// ActivityCommandCenter — daily operations hub: today's & tomorrow's events,
// fast attendance marking, WhatsApp reminders and smart alert cards.

// React hooks for state, effects and memoization.
import { useEffect, useMemo, useState } from 'react';

// Firestore helpers for reading collections and writing attendance.
import { collection, doc, getDocs, serverTimestamp, setDoc } from 'firebase/firestore';

// Our Firestore database instance.
import { db } from '../../firebase';

// Shared event-date helper (local "YYYY-MM-DD" parsing).
import { parseEventDate } from '../../utils/eventStatus';

// WhatsApp message template + the one-tap button.
import { eventReminderMessage } from '../../utils/whatsapp';
import WhatsAppButton from '../shared/WhatsAppButton/WhatsAppButton';

// Styles for this screen.
import './ActivityCommandCenter.css';


// The three attendance states stored on each record.
const STATUS = {
  present: 'נוכח',
  late: 'איחר',
  absent: 'נעדר',
};

// Label used when an event has no assigned group.
const NO_GROUP = 'ללא שיוך';

// The status registrants start with (used to count "new" ones).
const PENDING_STATUS = 'ממתין לאישור';

// Field names that might hold a birth date across the collections.
const BIRTH_DATE_FIELDS = ['birthDate', 'birthday', 'dob', 'dateOfBirth', 'birth_date'];

// One day in milliseconds.
const DAY_MS = 86400000;


// Midnight of a date, so day comparisons ignore the time of day.
function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

// Best available display name, with graceful fallbacks.
function getName(person) {
  return (
    person.name ||
    [person.firstName, person.lastName].filter(Boolean).join(' ').trim() ||
    person.email ||
    'חבר/ת קהילה'
  );
}

// Parse a birth date from any supported field name / value shape.
function parseBirthDate(person) {
  for (const field of BIRTH_DATE_FIELDS) {
    const value = person[field];
    if (!value) continue;

    let date = null;

    if (typeof value === 'string') {
      const parsed = new Date(value);
      if (!Number.isNaN(parsed.getTime())) date = parsed;
    } else if (typeof value.toDate === 'function') {
      date = value.toDate();
    } else if (value instanceof Date) {
      date = value;
    } else if (typeof value.seconds === 'number') {
      date = new Date(value.seconds * 1000);
    }

    if (date && !Number.isNaN(date.getTime())) return date;
  }

  return null;
}

// True when the person's birthday falls within the next `days` days.
function birthdaySoon(person, today, days) {
  const birth = parseBirthDate(person);
  if (!birth) return false;

  // This year's birthday (roll to next year if it already passed).
  let next = new Date(today.getFullYear(), birth.getMonth(), birth.getDate());
  if (startOfDay(next) < startOfDay(today)) {
    next = new Date(today.getFullYear() + 1, birth.getMonth(), birth.getDate());
  }

  // Whole-day difference from today.
  const diff = Math.round((startOfDay(next) - startOfDay(today)) / DAY_MS);
  return diff >= 0 && diff <= days;
}

// Format an event date as a readable Hebrew date.
function formatHebrewDate(value) {
  const date = parseEventDate(value);
  if (!date) return value || 'ללא תאריך';
  return date.toLocaleDateString('he-IL', { day: 'numeric', month: 'long', year: 'numeric' });
}


// `groupFilter` ({ id, name }) scopes the view to one group (guides); admins
// pass nothing. `onBack` renders a back button (guide flow) when provided.
function ActivityCommandCenter({ groupFilter = null, onBack }) {
  // Raw collections (each degrades to [] if its read is blocked).
  const [events, setEvents] = useState([]);
  const [groups, setGroups] = useState([]);
  const [volunteers, setVolunteers] = useState([]);
  const [users, setUsers] = useState([]);
  const [attendance, setAttendance] = useState([]);
  const [registrants, setRegistrants] = useState([]);

  // True while the first load runs.
  const [loading, setLoading] = useState(true);

  // The event expanded into the attendance panel (null when none).
  const [selectedEventId, setSelectedEventId] = useState(null);

  // Per-volunteer note drafts, keyed by `${eventId}_${volunteerId}`.
  const [noteDrafts, setNoteDrafts] = useState({});

  // True for ~2s after the group message is copied.
  const [copied, setCopied] = useState(false);

  // Load every collection once when the screen opens.
  useEffect(() => {
    let isMounted = true;

    // Read one collection, returning [] on failure so a block just shows empty.
    const fetchDocs = async (name) => {
      try {
        const snapshot = await getDocs(collection(db, name));
        return snapshot.docs.map((document) => ({ id: document.id, ...document.data() }));
      } catch (error) {
        console.error(`שגיאה בטעינת ${name}:`, error);
        return [];
      }
    };

    // Load all collections in parallel and publish them to state.
    const load = async () => {
      const [eventsRaw, groupsRaw, volunteersRaw, usersRaw, attendanceRaw, registrantsRaw] =
        await Promise.all([
          fetchDocs('events'),
          fetchDocs('groups'),
          fetchDocs('volunteers'),
          fetchDocs('users'),
          fetchDocs('attendance'),
          fetchDocs('registrants'),
        ]);

      if (!isMounted) return;

      setEvents(eventsRaw);
      setGroups(groupsRaw);
      setVolunteers(volunteersRaw);
      setUsers(usersRaw);
      setAttendance(attendanceRaw);
      setRegistrants(registrantsRaw);
      setLoading(false);
    };

    load();

    return () => {
      isMounted = false;
    };
  }, []);

  // Index groups by name (events reference their group by name, not id).
  const groupByName = useMemo(() => {
    const map = new Map();
    groups.forEach((group) => {
      const name = group.groupName || group.name || '';
      if (name) map.set(name, group);
    });
    return map;
  }, [groups]);

  // Bucket the volunteers by group name (for per-event rosters + counts).
  const volunteersByGroup = useMemo(() => {
    const map = new Map();
    volunteers.forEach((volunteer) => {
      const name = volunteer.groupName || volunteer.group || '';
      if (!name) return;
      if (!map.has(name)) map.set(name, []);
      map.get(name).push(volunteer);
    });
    return map;
  }, [volunteers]);

  // Index event-scoped attendance by `${eventId}_${volunteerId}`.
  const attendanceByKey = useMemo(() => {
    const map = new Map();
    attendance.forEach((record) => {
      if (record.eventId && record.volunteerId) {
        map.set(`${record.eventId}_${record.volunteerId}`, record);
      }
    });
    return map;
  }, [attendance]);

  // Today and tomorrow at midnight, used to bucket the upcoming events.
  const todayTime = startOfDay(new Date()).getTime();
  const tomorrowTime = todayTime + DAY_MS;

  // Build today's + tomorrow's events, enriched with group / guide / counts.
  const upcoming = useMemo(() => {
    // Decorate one event with its group, roster and attendance tallies.
    const decorate = (event) => {
      const assignedGroup = event.assignedGroup || NO_GROUP;
      const group = groupByName.get(assignedGroup) || null;
      const roster = volunteersByGroup.get(assignedGroup) || [];

      // Tally the three attendance states for this event.
      let present = 0;
      let late = 0;
      let absent = 0;
      roster.forEach((volunteer) => {
        const record = attendanceByKey.get(`${event.id}_${volunteer.id}`);
        if (!record) return;
        if (record.status === STATUS.present) present += 1;
        else if (record.status === STATUS.late) late += 1;
        else if (record.status === STATUS.absent) absent += 1;
      });

      const expected = roster.length;
      const marked = present + late + absent;

      return {
        ...event,
        assignedGroup,
        groupId: group?.id || '',
        guideName: group?.guideName || '',
        time: group?.time || '',
        roster,
        expected,
        present,
        late,
        absent,
        arrived: present + late,
        unmarked: Math.max(expected - marked, 0),
      };
    };

    // Keep only events that match the optional group filter.
    const matchesFilter = (event) =>
      !groupFilter?.name || (event.assignedGroup || NO_GROUP) === groupFilter.name;

    const today = [];
    const tomorrow = [];

    events.forEach((event) => {
      if (!matchesFilter(event)) return;

      const date = parseEventDate(event.date);
      if (!date) return;

      const day = startOfDay(date).getTime();
      if (day === todayTime) today.push(decorate(event));
      else if (day === tomorrowTime) tomorrow.push(decorate(event));
    });

    return { today, tomorrow };
  }, [events, groupByName, volunteersByGroup, attendanceByKey, groupFilter, todayTime, tomorrowTime]);

  // Pending registrations (status defaults to "ממתין לאישור").
  const pendingRegistrations = useMemo(
    () => registrants.filter((registrant) => (registrant.status || PENDING_STATUS) === PENDING_STATUS).length,
    [registrants],
  );

  // People (volunteers + active guides) with a birthday in the next 7 days.
  const birthdaysThisWeek = useMemo(() => {
    const today = new Date();
    const guideUsers = users.filter((person) => person.role === 'guide' && !person.disabled);
    return [...volunteers, ...guideUsers].filter((person) => birthdaySoon(person, today, 7)).length;
  }, [volunteers, users]);

  // Total volunteers not yet marked across today's events (alert card).
  const unmarkedToday = useMemo(
    () => upcoming.today.reduce((sum, event) => sum + event.unmarked, 0),
    [upcoming],
  );

  // Update a volunteer's note draft for the selected event.
  const updateNote = (key, value) => {
    setNoteDrafts((current) => ({ ...current, [key]: value }));
  };

  // Mark one volunteer's attendance for an event (idempotent keyed write).
  const markAttendance = async (event, volunteer, status) => {
    const key = `${event.id}_${volunteer.id}`;
    const note = noteDrafts[key] ?? attendanceByKey.get(key)?.note ?? '';

    // The record we write (deterministic id → re-marking updates in place).
    const record = {
      eventId: event.id,
      eventName: event.name || '',
      volunteerId: volunteer.id,
      volunteerName: getName(volunteer),
      groupId: event.groupId || volunteer.groupId || '',
      group: event.assignedGroup,
      groupName: event.assignedGroup,
      date: event.date || '',
      status,
      note,
      updatedAt: serverTimestamp(),
    };

    // Update local state first so the UI responds immediately.
    setAttendance((current) => {
      const without = current.filter(
        (item) => !(item.eventId === event.id && item.volunteerId === volunteer.id),
      );
      return [...without, { id: key, ...record }];
    });

    // Persist to Firestore.
    try {
      await setDoc(doc(db, 'attendance', key), record, { merge: true });
    } catch (error) {
      console.error('שגיאה בשמירת נוכחות:', error);
      window.alert('שמירת הנוכחות נכשלה. נסה/י שוב.');
    }
  };

  // Persist a note edit (keeps the current status; waits for a first mark).
  const saveNote = async (event, volunteer) => {
    const key = `${event.id}_${volunteer.id}`;
    const existing = attendanceByKey.get(key);

    // No status yet: the note will save together with the first status click.
    if (!existing) return;

    // Skip when the note didn't actually change.
    const note = noteDrafts[key] ?? existing.note ?? '';
    if (note === (existing.note ?? '')) return;

    await markAttendance(event, volunteer, existing.status);
  };

  // Copy a ready-to-paste broadcast message for the event's group.
  const copyGroupMessage = async (event) => {
    const message = eventReminderMessage({
      eventName: event.name,
      date: formatHebrewDate(event.date),
      time: event.time,
      location: event.location,
    });

    try {
      await navigator.clipboard.writeText(message);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      console.error('העתקת ההודעה נכשלה:', error);
    }
  };

  // Render one volunteer row: status buttons, note and WhatsApp reminder.
  const renderVolunteerRow = (event, volunteer) => {
    const key = `${event.id}_${volunteer.id}`;
    const record = attendanceByKey.get(key);
    const status = record?.status || '';
    const note = noteDrafts[key] ?? record?.note ?? '';
    const name = getName(volunteer);

    // The pre-filled reminder for this volunteer.
    const reminder = eventReminderMessage({
      name,
      eventName: event.name,
      date: formatHebrewDate(event.date),
      time: event.time,
      location: event.location,
    });

    return (
      <li className="acc-vol" key={volunteer.id}>

        {/* Name + phone. */}
        <div className="acc-vol-id">
          <span className="acc-vol-name">{name}</span>
          {volunteer.phone && <span className="acc-vol-phone" dir="ltr">{volunteer.phone}</span>}
        </div>

        {/* Three attendance buttons (the active one is highlighted). */}
        <div className="acc-vol-status">
          <button
            type="button"
            className={`acc-pill acc-pill--present ${status === STATUS.present ? 'is-active' : ''}`}
            onClick={() => markAttendance(event, volunteer, STATUS.present)}
          >
            הגיע
          </button>
          <button
            type="button"
            className={`acc-pill acc-pill--late ${status === STATUS.late ? 'is-active' : ''}`}
            onClick={() => markAttendance(event, volunteer, STATUS.late)}
          >
            איחר
          </button>
          <button
            type="button"
            className={`acc-pill acc-pill--absent ${status === STATUS.absent ? 'is-active' : ''}`}
            onClick={() => markAttendance(event, volunteer, STATUS.absent)}
          >
            לא הגיע
          </button>
        </div>

        {/* Short free-text note (saved on blur once a status exists). */}
        <input
          type="text"
          className="acc-vol-note"
          value={note}
          placeholder="הערה קצרה"
          onChange={(changeEvent) => updateNote(key, changeEvent.target.value)}
          onBlur={() => saveNote(event, volunteer)}
        />

        {/* One-tap WhatsApp reminder. */}
        <WhatsAppButton phone={volunteer.phone} message={reminder} label="תזכורת" compact />
      </li>
    );
  };

  // Render the roster + quick-mark controls for the opened event.
  const renderRosterPanel = (event) => {
    // No group / empty roster: show a friendly note.
    if (event.assignedGroup === NO_GROUP || event.roster.length === 0) {
      return (
        <div className="acc-roster">
          <div className="acc-empty-inline">אין מתנדבים משויכים לאירוע הזה.</div>
        </div>
      );
    }

    return (
      <div className="acc-roster">

        {/* Copy a group broadcast message to the clipboard. */}
        <div className="acc-roster-actions">
          <button type="button" className="acc-copy-btn" onClick={() => copyGroupMessage(event)}>
            {copied ? 'ההודעה הועתקה ✓' : 'העתק הודעה לקבוצה'}
          </button>
        </div>

        {/* One row per volunteer. */}
        <ul className="acc-vol-list">
          {event.roster.map((volunteer) => renderVolunteerRow(event, volunteer))}
        </ul>
      </div>
    );
  };

  // Render one event card (summary header + counters; opens the roster panel).
  const renderEventCard = (event) => {
    const isOpen = selectedEventId === event.id;

    return (
      <div className={`acc-event ${isOpen ? 'is-open' : ''}`} key={event.id}>

        {/* Card header: toggles the attendance panel. */}
        <button
          type="button"
          className="acc-event-head"
          onClick={() => setSelectedEventId(isOpen ? null : event.id)}
          aria-expanded={isOpen}
        >
          {/* Name + date/time + group/guide. */}
          <span className="acc-event-info">
            <span className="acc-event-name">{event.name || 'אירוע ללא שם'}</span>
            <span className="acc-event-meta">
              {formatHebrewDate(event.date)}{event.time ? ` · ${event.time}` : ''}
            </span>
            <span className="acc-event-sub">
              {event.assignedGroup}{event.guideName ? ` · מדריך: ${event.guideName}` : ''}
            </span>
          </span>

          {/* Attendance counters. */}
          <span className="acc-event-stats">
            <span className="acc-stat acc-stat--expected">{event.expected} צפויים</span>
            <span className="acc-stat acc-stat--present">{event.arrived} הגיעו</span>
            <span className="acc-stat acc-stat--missing">{event.unmarked} טרם סומנו</span>
          </span>

          {/* Open/closed chevron. */}
          <span className="acc-event-chevron" aria-hidden="true">{isOpen ? '▲' : '▼'}</span>
        </button>

        {/* Expanded roster + actions (only when open). */}
        {isOpen && renderRosterPanel(event)}
      </div>
    );
  };

  // Render a day section (today / tomorrow) with its events or an empty note.
  const renderDay = (title, list, emptyText) => (
    <div className="acc-day">
      <h3 className="acc-day-title">{title}</h3>
      {list.length > 0
        ? <div className="acc-events">{list.map(renderEventCard)}</div>
        : <div className="acc-empty-inline">{emptyText}</div>}
    </div>
  );

  return (
    <section className="acc" dir="rtl" aria-label="חמ״ל פעילות">

      {/* Header: optional back button, title and subtitle. */}
      <header className="acc-head">
        {typeof onBack === 'function' && (
          <button type="button" className="acc-back" onClick={onBack}>חזרה</button>
        )}
        <div className="acc-head-text">
          <span className="acc-eyebrow">🎖️ חמ״ל</span>
          <h2 className="acc-title">חמ״ל פעילות</h2>
          <p className="acc-subtitle">אירועי היום ומחר, נוכחות מהירה ותזכורות וואטסאפ — במקום אחד.</p>
        </div>
      </header>

      {/* Loading placeholder, otherwise the alert cards + event lists. */}
      {loading ? (
        <div className="acc-empty">טוען נתונים...</div>
      ) : (
        <>
          {/* Alert cards: quick at-a-glance counters. */}
          <div className="acc-cards">
            <article className="acc-card acc-card--reg">
              <span className="acc-card-num">{pendingRegistrations}</span>
              <span className="acc-card-label">הרשמות חדשות</span>
            </article>
            <article className="acc-card acc-card--today">
              <span className="acc-card-num">{upcoming.today.length}</span>
              <span className="acc-card-label">אירועים היום</span>
            </article>
            <article className="acc-card acc-card--missing">
              <span className="acc-card-num">{unmarkedToday}</span>
              <span className="acc-card-label">חסרים בנוכחות</span>
            </article>
            <article className="acc-card acc-card--bday">
              <span className="acc-card-num">{birthdaysThisWeek}</span>
              <span className="acc-card-label">ימי הולדת השבוע</span>
            </article>
          </div>

          {/* Today's and tomorrow's events. */}
          {renderDay('היום', upcoming.today, 'אין אירועים היום')}
          {renderDay('מחר', upcoming.tomorrow, 'אין אירועים מחר')}
        </>
      )}
    </section>
  );
}

export default ActivityCommandCenter;
