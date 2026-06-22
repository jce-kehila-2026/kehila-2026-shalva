// ActivityCommandCenter — the admin's daily operations hub ("חמ״ל"). It is
// embedded in the admin home (AdminOverview), below the calendar. It surfaces
// what needs attention right now: how many volunteers are missing from today's
// attendance, whose birthday is this week, and today's + tomorrow's events
// (each with a one-tap "copy a WhatsApp reminder" action). It does NOT mark
// attendance itself — the cards link out to the screens where that happens.

// React hooks for state, derived values, effects, callbacks and mutable refs.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

// Firestore helpers for reading the collections this hub summarises.
import { collection, getDocs } from 'firebase/firestore';

// Our Firestore database instance.
import { db } from '../../firebase';

// Shared event-date helper (local "YYYY-MM-DD" parsing).
import { parseEventDate } from '../../utils/eventStatus';

// Shared date formatter: render date-only event dates as DD-MM-YYYY.
import { formatDateOnlyForDisplay } from '../../utils/dateDisplay';

// Shared birth-date parsing (kept in one place across screens).
import { parseBirthDate } from '../../utils/people';

// WhatsApp reminder template + the editable "send on WhatsApp" button.
import { eventReminderMessage } from '../../utils/whatsapp';
import WhatsAppButton from '../shared/WhatsAppButton/WhatsAppButton';

// Shared attendance status normalisation (tolerates the older Hebrew strings).
import { normalizeAttendanceStatus, getRecordStatus } from '../../utils/attendance';

// Styles for this screen.
import './ActivityCommandCenter.css';


// Label used when an event has no assigned group.
const NO_GROUP = 'ללא שיוך';

// One day in milliseconds (for whole-day date math).
const DAY_MS = 86400000;

// Midnight of a date, so day comparisons ignore the time of day.
function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}


// Add calendar days in local time — safer than adding DAY_MS, because a
// daylight-saving transition can make a local day shorter or longer than 24h.
function addDays(date, days) {
  const next = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  next.setDate(next.getDate() + days);
  return next;
}


// A day-level key (YYYY-MM-DD) from any shape: a Date, a Firestore Timestamp,
// a { seconds } object, or a date string. Used to line attendance records
// (stored per group + day) up with the day an event falls on.
function toDateKey(value) {
  if (!value) {
    return '';
  }

  // Coerce every supported shape into a Date.
  let date = null;

  if (value instanceof Date) {
    date = value;
  } else if (typeof value.toDate === 'function') {
    date = value.toDate();
  } else if (typeof value.seconds === 'number') {
    date = new Date(value.seconds * 1000);
  } else if (typeof value === 'string') {
    date = parseEventDate(value);
  }

  if (!date || Number.isNaN(date.getTime())) {
    return '';
  }

  // Zero-pad the month + day so keys match consistently.
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
}


// True when the person's birthday falls within the next `days` days.
function birthdaySoon(person, today, days) {
  const birth = parseBirthDate(person);

  if (!birth) {
    return false;
  }

  // This year's birthday (roll to next year if it already passed).
  let next = new Date(today.getFullYear(), birth.getMonth(), birth.getDate());

  if (startOfDay(next) < startOfDay(today)) {
    next = new Date(today.getFullYear() + 1, birth.getMonth(), birth.getDate());
  }

  // Whole-day difference from today.
  const diff = Math.round((startOfDay(next) - startOfDay(today)) / DAY_MS);

  return diff >= 0 && diff <= days;
}


// `groupFilter` ({ id, name }) scopes the WHOLE hub (events, birthdays and the
// absent count) to one group; admins pass nothing. `onBack` renders a back
// button when this is used as a standalone screen. `leadingCard` is an optional
// node shown as the first alert card. `onNavigate` lets the alert cards jump to
// their related screen. `reloadToken` makes the hub refetch when bumped.
// `sections` chooses which parts to render: 'all' (default), 'cards' (just the
// at-a-glance alert counters) or 'schedule' (just the today/tomorrow card). This
// lets the admin home place the two parts in different spots on the screen.
function ActivityCommandCenter({ groupFilter = null, onBack, leadingCard = null, onNavigate, reloadToken = 0, sections = 'all' }) {
  // Which parts to show (derived from the `sections` prop).
  const showCards = sections === 'all' || sections === 'cards';
  const showSchedule = sections === 'all' || sections === 'schedule';

  // Raw collections (each degrades to [] if its read is blocked).
  const [events, setEvents] = useState([]);
  const [groups, setGroups] = useState([]);
  const [volunteers, setVolunteers] = useState([]);
  const [users, setUsers] = useState([]);
  const [attendance, setAttendance] = useState([]);

  // True while the first load runs.
  const [loading, setLoading] = useState(true);

  // True when at least one collection failed to load (numbers may be partial).
  const [hadLoadError, setHadLoadError] = useState(false);

  // The event expanded into its panel (null when none).
  const [selectedEventId, setSelectedEventId] = useState(null);

  // On phones the "today + tomorrow" events card can be collapsed to save
  // space; on desktop it stays open. `isMobile` tracks the phone breakpoint
  // (the same 640px used in the CSS). The lazy initialiser reads the current
  // width up front, so the card renders in the right mode with no flicker.
  const [isMobile, setIsMobile] = useState(
    () => window.matchMedia('(max-width: 640px)').matches,
  );

  // Whether the events card is expanded. Only matters on phones — on desktop
  // the card is always shown regardless of this flag. Starts CLOSED so the
  // phone view opens compact; the visitor taps the header to reveal the events.
  const [isScheduleOpen, setIsScheduleOpen] = useState(false);

  // Stays true while mounted, so async callbacks don't set state after unmount.
  const isMountedRef = useRef(true);

  // Whether navigation is wired up (the cards only act when it is).
  const canNavigate = typeof onNavigate === 'function';

  // Track mount status.
  useEffect(() => {
    isMountedRef.current = true;

    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Keep `isMobile` in sync with the viewport width, so the events card switches
  // between "collapsible" (phone) and "always open" (desktop) when the window is
  // resized or rotated.
  useEffect(() => {
    const query = window.matchMedia('(max-width: 640px)');

    const sync = () => setIsMobile(query.matches);
    sync();

    query.addEventListener('change', sync);
    return () => query.removeEventListener('change', sync);
  }, []);

  // Load every collection once (and again whenever reloadToken changes).
  useEffect(() => {
    let isMounted = true;

    // Read one collection. Returns the items plus a `failed` flag, so the caller
    // can warn the user when some data is missing (instead of showing a fake 0).
    const fetchDocs = async (name) => {
      try {
        const snapshot = await getDocs(collection(db, name));

        // Spread the data first, then set id last — so a stray "id" field inside
        // the document can never overwrite Firestore's real document id.
        return {
          items: snapshot.docs.map((documentSnapshot) => ({
            ...documentSnapshot.data(),
            id: documentSnapshot.id,
          })),
          failed: false,
        };
      } catch (error) {
        console.error(`שגיאה בטעינת ${name}:`, error);
        return { items: [], failed: true };
      }
    };

    // Load all collections in parallel and publish them to state.
    const load = async () => {
      const [eventsResult, groupsResult, volunteersResult, usersResult, attendanceResult] = await Promise.all([
        fetchDocs('events'),
        fetchDocs('groups'),
        fetchDocs('volunteers'),
        fetchDocs('users'),
        fetchDocs('attendance'),
      ]);

      // Bail out if we unmounted while waiting.
      if (!isMounted) {
        return;
      }

      setEvents(eventsResult.items);
      setGroups(groupsResult.items);
      setVolunteers(volunteersResult.items);
      setUsers(usersResult.items);
      setAttendance(attendanceResult.items);

      // Flag a partial load if any single collection failed.
      setHadLoadError(
        [eventsResult, groupsResult, volunteersResult, usersResult, attendanceResult]
          .some((result) => result.failed),
      );

      setLoading(false);
    };

    load();

    return () => {
      isMounted = false;
    };
    // Reloads when the parent bumps reloadToken (e.g. after adding an event).
  }, [reloadToken]);

  // True when an item (event / volunteer / attendance record) belongs to the
  // filtered group. With no filter, everything passes. Groups are referenced by
  // id or by name across the data model, so we accept either.
  const matchesGroupFilter = useCallback((item) => {
    if (!groupFilter) {
      return true;
    }

    // Normalise values (tolerate stray whitespace or a non-string id).
    const normalize = (value) => (value === undefined || value === null ? '' : String(value).trim());

    const wantedId = normalize(groupFilter.id);
    const wantedName = normalize(groupFilter.name);

    // Items reference their group by id or by name across the data model.
    const itemIds = [item.groupId].map(normalize).filter(Boolean);
    const itemNames = [item.groupName, item.group, item.assignedGroup].map(normalize).filter(Boolean);

    return (
      (wantedId !== '' && itemIds.includes(wantedId))
      || (wantedName !== '' && itemNames.includes(wantedName))
    );
  }, [groupFilter]);

  // Index groups by name (events reference their group by name, not id).
  const groupByName = useMemo(() => {
    const map = new Map();

    groups.forEach((group) => {
      const name = group.groupName || group.name || '';

      if (name) {
        map.set(name, group);
      }
    });

    return map;
  }, [groups]);

  // Today and tomorrow at local midnight, used to bucket the upcoming events.
  const todayStart = startOfDay(new Date());
  const todayTime = todayStart.getTime();
  const tomorrowTime = addDays(todayStart, 1).getTime();

  // Build today's + tomorrow's events, enriched with their group's guide + time
  // and sorted by time of day (a chronological ops board).
  const upcoming = useMemo(() => {
    // Enrich one event with its group's guide name and meeting time.
    const decorate = (event) => {
      const assignedGroup = event.assignedGroup || NO_GROUP;
      const group = groupByName.get(assignedGroup) || null;

      return {
        ...event,
        assignedGroup,
        guideName: group?.guideName || '',
        time: group?.time || '',
      };
    };

    const today = [];
    const tomorrow = [];

    events.forEach((event) => {
      if (!matchesGroupFilter(event)) {
        return;
      }

      const date = parseEventDate(event.date);

      if (!date) {
        return;
      }

      // Bucket into today / tomorrow by whole day.
      const day = startOfDay(date).getTime();

      if (day === todayTime) {
        today.push(decorate(event));
      } else if (day === tomorrowTime) {
        tomorrow.push(decorate(event));
      }
    });

    // Show each day's events in chronological order (events with no time last).
    const sortByTime = (a, b) => (a.time || '~').localeCompare(b.time || '~', 'he');

    today.sort(sortByTime);
    tomorrow.sort(sortByTime);

    return { today, tomorrow };
  }, [events, groupByName, matchesGroupFilter, todayTime, tomorrowTime]);

  // People (volunteers + active guides) with a birthday in the next 7 days,
  // scoped to the filtered group when one is set.
  const birthdaysThisWeek = useMemo(() => {
    const today = new Date();
    const guideUsers = users.filter((person) => person.role === 'guide' && !person.disabled);

    return [...volunteers, ...guideUsers]
      .filter(matchesGroupFilter)
      .filter((person) => birthdaySoon(person, today, 7))
      .length;
  }, [volunteers, users, matchesGroupFilter]);

  // Volunteers marked absent today, scoped to the filtered group when one is set.
  const absentTodayCount = useMemo(() => {
    const todayKey = toDateKey(new Date());

    return attendance.filter((record) => {
      if (!matchesGroupFilter(record)) {
        return false;
      }

      const dateKey = record.dateKey || toDateKey(record.date);
      const isToday = dateKey === todayKey;
      const isAbsent = normalizeAttendanceStatus(getRecordStatus(record)) === 'absent';

      return isToday && isAbsent;
    }).length;
  }, [attendance, matchesGroupFilter]);

  // Build a ready-to-send broadcast message for the event's group (name, when,
  // location, plus the description).
  const buildEventMessage = (event) => {
    let message = eventReminderMessage({
      eventName: event.name,
      date: formatDateOnlyForDisplay(event.date, { fallback: 'ללא תאריך' }),
      time: event.time,
      location: event.location,
    });

    // Append the description when there is one.
    if (event.description) {
      message += `\nפרטים: ${event.description}`;
    }

    return message;
  };

  // Render the opened event's panel: its description + a "send on WhatsApp" button.
  const renderEventPanel = (event, panelId) => (
    <div id={panelId} className="acc-roster">

      {/* Event description (or a friendly note when there is none). */}
      {event.description ? (
        <div className="acc-event-desc">
          <h4>תיאור האירוע</h4>
          <p>{event.description}</p>
        </div>
      ) : (
        <div className="acc-empty-inline">אין תיאור לאירוע.</div>
      )}

      {/* Send a WhatsApp message for THIS event's group. The message is editable
          before sending; with no fixed number, WhatsApp opens the chat picker so
          the admin chooses the group's chat (group + participants). */}
      <div className="acc-roster-actions">
        <WhatsAppButton
          message={buildEventMessage(event)}
          requirePhone={false}
          label="שליחה בוואטסאפ לקבוצה"
        />
      </div>
    </div>
  );

  // Render one event card (summary header that opens the description panel).
  const renderEventCard = (event) => {
    const isOpen = selectedEventId === event.id;
    const panelId = `acc-event-panel-${event.id}`;

    return (
      <div className={`acc-event ${isOpen ? 'is-open' : ''}`} key={event.id}>

        {/* Card header: toggles the panel open / closed. */}
        <button
          type="button"
          className="acc-event-head"
          onClick={() => setSelectedEventId(isOpen ? null : event.id)}
          aria-expanded={isOpen}
          aria-controls={panelId}
        >
          {/* Name + date/time + group/guide. */}
          <span className="acc-event-info">
            <span className="acc-event-name">{event.name || 'אירוע ללא שם'}</span>
            <span className="acc-event-meta">
              {formatDateOnlyForDisplay(event.date, { fallback: 'ללא תאריך' })}{event.time ? ` · ${event.time}` : ''}
            </span>
            <span className="acc-event-sub">
              {event.assignedGroup}{event.guideName ? ` · מדריך: ${event.guideName}` : ''}
            </span>
          </span>

          {/* Open/closed chevron. */}
          <span className="acc-event-chevron" aria-hidden="true">{isOpen ? '▲' : '▼'}</span>
        </button>

        {/* Expanded description + actions (only when open). */}
        {isOpen && renderEventPanel(event, panelId)}
      </div>
    );
  };

  // Render a day section (today / tomorrow) with its events or an empty note.
  const renderDay = (title, list, emptyText) => (
    <div className="acc-day">

      {/* Day header with an inline event count. */}
      <h3 className="acc-day-title">
        <span>{title}</span>
        <span className="acc-day-count">{list.length}</span>
      </h3>

      {list.length > 0 ? (
        <div className="acc-events">{list.map(renderEventCard)}</div>
      ) : (
        <div className="acc-empty-inline">{emptyText}</div>
      )}
    </div>
  );

  return (
    <section className="acc" dir="rtl" aria-label="חמ״ל פעילות">

      {/* Optional back button (only when used as a standalone screen). The admin
          home embeds this without a heading. */}
      {typeof onBack === 'function' && (
        <header className="acc-head">
          <button type="button" className="acc-back" onClick={onBack}>חזרה</button>
        </header>
      )}

      {/* Loading placeholder, otherwise the alert cards + the schedule. */}
      {loading ? (
        <div className="acc-empty" role="status">טוען נתונים...</div>
      ) : (
        <>
          {/* Warn when some data didn't load, so a "0" isn't mistaken for "none". */}
          {hadLoadError && (
            <div className="acc-warning" role="status">
              חלק מנתוני החמ״ל לא נטענו. המספרים עשויים להיות חלקיים.
            </div>
          )}

          {/* Alert cards: quick at-a-glance counters. The optional leading card
              (e.g. pending registrations) sits first when one is provided. */}
          {showCards && (
          <div className="acc-cards">
            {leadingCard}

            {/* Absent-attendance count — opens the attendance screen. */}
            <button
              type="button"
              className="acc-card acc-card--missing"
              onClick={() => onNavigate('attendance')}
              disabled={!canNavigate}
              aria-label={canNavigate
                ? `חסרים בנוכחות: ${absentTodayCount} — מעבר למסך הנוכחות`
                : `חסרים בנוכחות: ${absentTodayCount}`}
            >
              <span className="acc-card-num">{absentTodayCount}</span>
              <span className="acc-card-label">חסרים בנוכחות</span>
            </button>

            {/* Birthdays this week — opens the birthdays screen. */}
            <button
              type="button"
              className="acc-card acc-card--bday"
              onClick={() => onNavigate('birthdays')}
              disabled={!canNavigate}
              aria-label={canNavigate
                ? `ימי הולדת השבוע: ${birthdaysThisWeek} — מעבר למסך ימי ההולדת`
                : `ימי הולדת השבוע: ${birthdaysThisWeek}`}
            >
              <span className="acc-card-num">{birthdaysThisWeek}</span>
              <span className="acc-card-label">ימי הולדת השבוע</span>
            </button>
          </div>
          )}

          {/* Today's + tomorrow's events. On phones this is a collapsible card
              (tap the header to open/close); on desktop it stays static and
              always open. `isExpanded` decides whether the body is shown. */}
          {showSchedule && (() => {
            // On desktop the card is always open; on phones it follows the toggle.
            const isExpanded = !isMobile || isScheduleOpen;

            // The total event count, reused in both header variants.
            const eventCount = upcoming.today.length + upcoming.tomorrow.length;

            return (
              <div className={`acc-schedule ${isExpanded ? 'is-open' : 'is-closed'}`}>

                {/* Phone: the header is a button that opens/closes the card.
                    Desktop: a plain, non-interactive header. */}
                {isMobile ? (
                  <button
                    type="button"
                    className="acc-schedule-head acc-schedule-head--toggle"
                    onClick={() => setIsScheduleOpen((open) => !open)}
                    aria-expanded={isScheduleOpen}
                    aria-controls="acc-schedule-body"
                  >
                    <span className="acc-schedule-title">אירועי היום ומחר</span>
                    <span className="acc-schedule-count">{eventCount}</span>

                    {/* Chevron points down when open, sideways when collapsed. */}
                    <span
                      className={`acc-schedule-chevron ${isScheduleOpen ? 'is-open' : ''}`}
                      aria-hidden="true"
                    >
                      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M6 9l6 6 6-6" />
                      </svg>
                    </span>
                  </button>
                ) : (
                  <div className="acc-schedule-head acc-schedule-head--static">
                    <span className="acc-schedule-title">אירועי היום ומחר</span>
                    <span className="acc-schedule-count">{eventCount}</span>
                  </div>
                )}

                {/* Both day sections live inside the card — shown when expanded. */}
                {isExpanded && (
                  <div className="acc-schedule-body" id="acc-schedule-body">
                    {renderDay('היום', upcoming.today, 'אין אירועים היום')}
                    {renderDay('מחר', upcoming.tomorrow, 'אין אירועים מחר')}
                  </div>
                )}
              </div>
            );
          })()}
        </>
      )}
    </section>
  );
}

export default ActivityCommandCenter;
