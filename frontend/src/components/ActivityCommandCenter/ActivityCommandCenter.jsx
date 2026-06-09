// ActivityCommandCenter — daily operations hub: today's & tomorrow's events,
// an attendance summary (it links to the attendance screen, where marking
// actually happens), WhatsApp reminders and smart alert cards.

// React hooks for state, effects and memoization.
import { useEffect, useMemo, useState } from 'react';

// Firestore helpers for reading collections and writing attendance.
import { collection, getDocs } from 'firebase/firestore';

// Our Firestore database instance.
import { db } from '../../firebase';

// Shared event-date helper (local "YYYY-MM-DD" parsing).
import { parseEventDate } from '../../utils/eventStatus';

// Shared birth-date parsing (kept in one place across screens).
import { parseBirthDate } from '../../utils/people';

// WhatsApp message template (used for the copy-to-group message).
import { eventReminderMessage } from '../../utils/whatsapp';

// Styles for this screen.
import './ActivityCommandCenter.css';

// Shared attendance normalization helpers.
import { normalizeAttendanceStatus, getRecordStatus } from '../../utils/attendance';


// The three attendance states a record's status may use (older Hebrew strings).
const STATUS = {
  present: 'נוכח',
  late: 'איחר',
  absent: 'חסר',
};

// Label used when an event has no assigned group.
const NO_GROUP = 'ללא שיוך';

// One day in milliseconds.
const DAY_MS = 86400000;


// Midnight of a date, so day comparisons ignore the time of day.
function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

// A day-level key (YYYY-MM-DD) from any shape: a Date, a Firestore Timestamp,
// a { seconds } object, or a date string. Used to line attendance records
// (stored per group + day) up with the day an event falls on.
function toDateKey(value) {
  if (!value) return '';

  let date = null;
  if (value instanceof Date) date = value;
  else if (typeof value.toDate === 'function') date = value.toDate();
  else if (typeof value.seconds === 'number') date = new Date(value.seconds * 1000);
  else if (typeof value === 'string') date = parseEventDate(value);

  if (!date || Number.isNaN(date.getTime())) return '';

  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
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
// `leadingCard` is an optional node shown as the first alert card (the admin
// home uses it for the "pending registrations" card). `onNavigate(view)` lets
// the other stat cards jump to their related admin screen.
function ActivityCommandCenter({ groupFilter = null, onBack, leadingCard = null, onNavigate, reloadToken = 0 }) {
  // Raw collections (each degrades to [] if its read is blocked).
  const [events, setEvents] = useState([]);
  const [groups, setGroups] = useState([]);
  const [volunteers, setVolunteers] = useState([]);
  const [users, setUsers] = useState([]);
  const [attendance, setAttendance] = useState([]);

  // True while the first load runs.
  const [loading, setLoading] = useState(true);

  // The event expanded into the attendance panel (null when none).
  const [selectedEventId, setSelectedEventId] = useState(null);

  // Whether the today/tomorrow schedule card is expanded (starts collapsed).
  const [scheduleOpen, setScheduleOpen] = useState(false);


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
      const [eventsRaw, groupsRaw, volunteersRaw, usersRaw, attendanceRaw] =
        await Promise.all([
          fetchDocs('events'),
          fetchDocs('groups'),
          fetchDocs('volunteers'),
          fetchDocs('users'),
          fetchDocs('attendance'),
        ]);

      if (!isMounted) return;

      setEvents(eventsRaw);
      setGroups(groupsRaw);
      setVolunteers(volunteersRaw);
      setUsers(usersRaw);
      setAttendance(attendanceRaw);
      setLoading(false);
    };

    load();

    return () => {
      isMounted = false;
    };
    // Reloads when the parent bumps reloadToken (e.g. after adding an event).
  }, [reloadToken]);

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

  // Index attendance by `${dateKey}_${volunteerId}`. The attendance screen
  // saves one record per volunteer, per group, per DAY (not per event), so we
  // match on the day an event falls on rather than an event id.
  const attendanceByKey = useMemo(() => {
    const map = new Map();
    attendance.forEach((record) => {
      const dateKey = record.dateKey || toDateKey(record.date);
      if (dateKey && record.volunteerId) {
        map.set(`${dateKey}_${record.volunteerId}`, record);
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

      // A volunteer is "marked" if attendance for their group was saved on the
      // day this event falls on. `status === true` means they were present.
      const eventDateKey = toDateKey(event.date);
      let present = 0;
      let absent = 0;
      let marked = 0;
      roster.forEach((volunteer) => {
        const record = attendanceByKey.get(`${eventDateKey}_${volunteer.id}`);
        if (!record) return;
        marked += 1;
        // Accept the boolean model the attendance screen writes, and tolerate
        // the older Hebrew string statuses too.
        if (record.status === true || record.status === STATUS.present || record.status === STATUS.late) {
          present += 1;
        } else {
          absent += 1;
        }
      });

      const expected = roster.length;

      return {
        ...event,
        assignedGroup,
        groupId: group?.id || '',
        guideName: group?.guideName || '',
        time: group?.time || '',
        roster,
        expected,
        present,
        absent,
        arrived: present,
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


  // People (volunteers + active guides) with a birthday in the next 7 days.
  const birthdaysThisWeek = useMemo(() => {
    const today = new Date();
    const guideUsers = users.filter((person) => person.role === 'guide' && !person.disabled);
    return [...volunteers, ...guideUsers].filter((person) => birthdaySoon(person, today, 7)).length;
  }, [volunteers, users]);



  // Total volunteers marked absent today across all attendance records.
  const absentTodayCount = useMemo(() => {
    const todayKey = toDateKey(new Date());
    return attendance.filter((rec) => {
      const dateKey = rec.dateKey || toDateKey(rec.date);
      const isToday = dateKey === todayKey;
      const isAbsent = normalizeAttendanceStatus(getRecordStatus(rec)) === 'absent';
      return isToday && isAbsent;
    }).length;
  }, [attendance]);


  // Copy a ready-to-paste broadcast message for the event's group, with all
  // the details (name, when, location) plus the event description.
  const copyGroupMessage = async (event) => {
    let message = eventReminderMessage({
      eventName: event.name,
      date: formatHebrewDate(event.date),
      time: event.time,
      location: event.location,
    });

    // Append the description when there is one.
    if (event.description) {
      message += `\nפרטים: ${event.description}`;
    }

    try {
      await navigator.clipboard.writeText(message);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      console.error('העתקת ההודעה נכשלה:', error);
    }
  };

  // Render the opened event's panel: its description + a button that copies a
  // ready-to-send group message (with all the details) to the clipboard.
  const renderRosterPanel = (event) => (
    <div className="acc-roster">

      {/* Event description (or a friendly note when there is none). */}
      {event.description ? (
        <div className="acc-event-desc">
          <h4>תיאור האירוע</h4>
          <p>{event.description}</p>
        </div>
      ) : (
        <div className="acc-empty-inline">אין תיאור לאירוע.</div>
      )}

      {/* Copy a group broadcast message (with all the details) to the clipboard. */}
      <div className="acc-roster-actions">
        <button type="button" className="acc-copy-btn" onClick={() => copyGroupMessage(event)}>
          {copied ? 'ההודעה הועתקה ✓' : 'העתקת הודעה לקבוצה'}
        </button>
      </div>
    </div>
  );

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
      {/* Day header with an inline event count (replaces the old "today" card). */}
      <h3 className="acc-day-title">
        <span>{title}</span>
        <span className="acc-day-count">{list.length}</span>
      </h3>
      {list.length > 0
        ? <div className="acc-events">{list.map(renderEventCard)}</div>
        : <div className="acc-empty-inline">{emptyText}</div>}
    </div>
  );

  return (
    <section className="acc" dir="rtl" aria-label="חמ״ל פעילות">

      {/* Optional back button (only when used as a standalone screen). No
          title/subtitle — the admin home embeds this without a heading. */}
      {typeof onBack === 'function' && (
        <header className="acc-head">
          <button type="button" className="acc-back" onClick={onBack}>חזרה</button>
        </header>
      )}

      {/* Loading placeholder, otherwise the alert cards + event lists. */}
      {loading ? (
        <div className="acc-empty">טוען נתונים...</div>
      ) : (
        <>
          {/* Alert cards: quick at-a-glance counters. The optional leading card
              (pending registrations, from the admin home) sits first. */}
          <div className="acc-cards">
            {leadingCard}

            {/* Absent-attendance count — opens the attendance tracking screen. */}
            <button
              type="button"
              className="acc-card acc-card--missing"
              onClick={() => onNavigate && onNavigate('attendance')}
            >
              <span className="acc-card-num">{absentTodayCount}</span>
              <span className="acc-card-label">חסרים בנוכחות</span>
            </button>

            {/* Birthdays this week — opens the birthdays screen. */}
            <button
              type="button"
              className="acc-card acc-card--bday"
              onClick={() => onNavigate && onNavigate('birthdays')}
            >
              <span className="acc-card-num">{birthdaysThisWeek}</span>
              <span className="acc-card-label">ימי הולדת השבוע</span>
            </button>
          </div>

          {/* Today's + tomorrow's events grouped in one collapsible card
              (starts hidden; click the header to show / hide). */}
          <div className={`acc-schedule ${scheduleOpen ? 'is-open' : ''}`}>

            {/* Header toggles the whole schedule open / closed. */}
            <button
              type="button"
              className="acc-schedule-head"
              onClick={() => setScheduleOpen((open) => !open)}
              aria-expanded={scheduleOpen}
            >
              <span className="acc-schedule-title">אירועי היום ומחר</span>
              <span className="acc-schedule-count">
                {upcoming.today.length + upcoming.tomorrow.length}
              </span>
              <span className="acc-schedule-chevron" aria-hidden="true">{scheduleOpen ? '▲' : '▼'}</span>
            </button>

            {/* Both day sections live inside the card (only when open). */}
            {scheduleOpen && (
              <div className="acc-schedule-body">
                {renderDay('היום', upcoming.today, 'אין אירועים היום')}
                {renderDay('מחר', upcoming.tomorrow, 'אין אירועים מחר')}
              </div>
            )}
          </div>
        </>
      )}
    </section>
  );
}

export default ActivityCommandCenter;
