// AdminOverview — the admin home. A row of stat cards sits on top (pending
// registrations, volunteers, guides, groups — each links to its own screen).
// Below them a large events calendar is followed by the activity command center
// (חמ״ל); a today's-birthdays block spans the full width at the bottom.

// React hooks for state, effects, derived values and mutable refs.
import { useEffect, useMemo, useRef, useState } from 'react';

// Firestore helpers for reading collections and adding an event.
// serverTimestamp lets the server stamp createdAt/updatedAt (not the browser clock).
import { addDoc, collection, getDocs, serverTimestamp } from 'firebase/firestore';

// Our Firestore database instance.
import { db } from '../../firebase';

// Styles for this screen.
import './AdminOverview.css';

// Shared event date + status helpers.
import { computeEventStatus, parseEventDate } from '../../utils/eventStatus';

// Shared date formatter: render the selected calendar day as DD-MM-YYYY.
import { formatDateOnlyForDisplay } from '../../utils/dateDisplay';

// Shared people helpers (display name, birth-date parsing, age).
import { getDisplayName, parseBirthDate, computeAge } from '../../utils/people';

// Shared attendance helpers (count today's absentees consistently).
import { normalizeAttendanceStatus, getRecordStatus } from '../../utils/attendance';

// Saturday is not a permitted event date.
import { isSaturdayDateValue } from '../../utils/activityDays';

// WhatsApp helpers: build a greeting + link so a birthday name opens a chat.
import { birthdayMessage, buildWhatsAppUrl, hasValidPhone } from '../../utils/whatsapp';

// The activity command center, embedded beside the calendar.
import ActivityCommandCenter from '../ActivityCommandCenter/ActivityCommandCenter';

// Shared day / month / year date selector.
import BirthDatePicker from '../shared/BirthDatePicker/BirthDatePicker';

// Jewish-calendar engine — marks holidays (חגים) AND gives each Gregorian day
// its Hebrew date. gematriya turns a Hebrew number into letters (23 → כ״ג).
import { HebrewCalendar, HDate, gematriya } from '@hebcal/core';


// Full month names in Hebrew, indexed 0 (January) to 11 (December).
const HEBREW_MONTHS = [
  'ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני',
  'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר',
];

// Sunday-first weekday initials (the week starts on Sunday in Hebrew).
const WEEKDAYS = ['א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ש'];

// The status a registrant starts with (counted as "pending").
const PENDING_STATUS = 'ממתין לאישור';


// Hebrew month names, indexed by hebcal's month number (Nisan = 1 … Adar II = 13).
const HEBREW_MONTH_NAMES = [
  '', 'ניסן', 'אייר', 'סיון', 'תמוז', 'אב', 'אלול',
  'תשרי', 'חשוון', 'כסלו', 'טבת', 'שבט', 'אדר', 'אדר ב׳',
];


// The Hebrew name of an HDate's month (Adar splits into א׳/ב׳ in a leap year).
function hebrewMonthName(hebrewDate) {
  const month = hebrewDate.getMonth();

  if (HDate.isLeapYear(hebrewDate.getFullYear())) {
    if (month === 12) return 'אדר א׳';
    if (month === 13) return 'אדר ב׳';
  }

  return HEBREW_MONTH_NAMES[month] || '';
}


// A Hebrew "month(s) + year" label for the Gregorian month being viewed, e.g.
// "תמוז–אב תשפ״ו" (a Gregorian month usually spans two Hebrew months). The year
// is shown the common way, without the thousands (5786 → תשפ״ו).
function getHebrewMonthLabel(year, month, daysInMonth) {
  try {
    const firstHd = new HDate(new Date(year, month, 1));
    const lastHd = new HDate(new Date(year, month, daysInMonth));

    const firstMonth = hebrewMonthName(firstHd);
    const lastMonth = hebrewMonthName(lastHd);
    const firstYear = gematriya(firstHd.getFullYear() % 1000);
    const lastYear = gematriya(lastHd.getFullYear() % 1000);

    // Same Hebrew month across the whole Gregorian month.
    if (firstMonth === lastMonth) {
      return `${firstMonth} ${firstYear}`;
    }

    // Two Hebrew months, same Hebrew year.
    if (firstYear === lastYear) {
      return `${firstMonth}–${lastMonth} ${firstYear}`;
    }

    // Spans a Hebrew new year (around Rosh Hashana) — show both years.
    return `${firstMonth} ${firstYear} – ${lastMonth} ${lastYear}`;
  } catch (error) {
    console.error('שגיאה בחישוב חודש עברי:', error);
    return '';
  }
}


// Quick emoji a user can drop into a birthday message before sending it.
const BDAY_EMOJIS = ['🎉', '🎂', '🎈', '🥳', '❤️', '✨', '🎁', '😊'];


// Confetti pieces for the birthdays bar — only rendered on a day that actually
// has a birthday. Built once so each piece's look/motion stays stable.
const BDAY_CONFETTI_COLORS = ['#f43f5e', '#fb923c', '#facc15', '#34d399', '#60a5fa', '#a78bfa', '#f472b6'];

const BDAY_CONFETTI = Array.from({ length: 16 }, (_, index) => ({
  id: index,
  left: Math.random() * 100,       // horizontal start (% across the bar)
  delay: Math.random() * 4,        // stagger when each piece starts falling
  duration: 3.5 + Math.random() * 2.5,
  size: 6 + Math.random() * 6,     // piece size in px
  color: BDAY_CONFETTI_COLORS[index % BDAY_CONFETTI_COLORS.length],
}));


// Build a local YYYY-MM-DD key from an attendance record's date value (records
// store either a ready `dateKey` string or a `date` that can be a string, a
// Firestore Timestamp, a { seconds } object or a Date). Used to count today's
// absentees the same way the command center does.
function attendanceDateKey(value) {
  if (!value) {
    return '';
  }

  let date = null;

  if (typeof value === 'string') {
    date = parseEventDate(value);
  } else if (typeof value.toDate === 'function') {
    date = value.toDate();
  } else if (typeof value.seconds === 'number') {
    date = new Date(value.seconds * 1000);
  } else if (value instanceof Date) {
    date = value;
  }

  if (!date || Number.isNaN(date.getTime())) {
    return '';
  }

  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
}


// Blank add-event form — reused for the initial state and after a successful save.
const EMPTY_EVENT_FORM = {
  name: '',
  date: '',
  location: '',
  description: '',
  assignedGroup: 'ללא שיוך',
  status: 'מתוכנן',
  contactName: '',
  contactPhone: '',
  contactEmail: '',
};


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


// onNavigate lets the stat cards (and the embedded חמ״ל) switch to another admin view.
function AdminOverview({ onNavigate }) {
  // The loaded data (null until the first fetch finishes).
  const [data, setData] = useState(null);

  // True while loading; flips an error flag if any collection failed.
  const [loading, setLoading] = useState(true);
  const [hadError, setHadError] = useState(false);

  // The month/day the calendar is currently showing.
  const now = new Date();
  const [calYear, setCalYear] = useState(now.getFullYear());
  const [calMonth, setCalMonth] = useState(now.getMonth());
  const [selectedDay, setSelectedDay] = useState(now.getDate());

  // On the desktop "compact home" the inline per-day events list is hidden (the
  // page is locked to one screen). So clicking a day with events opens a popup
  // instead; this flag controls it. On phones the inline list already shows the
  // events, and the popup is hidden by CSS there.
  const [dayPopupOpen, setDayPopupOpen] = useState(false);

  // Birthday greeting editor: the person being greeted (null when closed) and
  // the editable message text. Lets the admin tweak the wording + add emojis
  // before the message is sent on WhatsApp.
  const [birthdayEditor, setBirthdayEditor] = useState(null);
  const [birthdayText, setBirthdayText] = useState('');

  // Open the editor for a person, pre-filled with the standard greeting.
  const openBirthdayEditor = (person) => {
    setBirthdayEditor(person);
    setBirthdayText(birthdayMessage(person.name));
  };

  // Append an emoji to the end of the current message.
  const addBirthdayEmoji = (emoji) => {
    setBirthdayText((text) => `${text} ${emoji}`);
  };

  // "Add event" quick action: modal visibility + form fields.
  const [isAddEventOpen, setIsAddEventOpen] = useState(false);

  // True while an event is being saved (guards against double-submit).
  const [savingEvent, setSavingEvent] = useState(false);

  // Inline error shown inside the add-event modal (empty when none).
  const [eventError, setEventError] = useState('');

  // Bumped after adding an event, to make the embedded command center reload.
  const [accReloadToken, setAccReloadToken] = useState(0);
  const [eventForm, setEventForm] = useState(EMPTY_EVENT_FORM);

  // Stays true while mounted (blocks state updates after unmount) and a
  // synchronous "save in progress" flag (a hard guard against double-submit).
  const isMountedRef = useRef(true);
  const savingEventRef = useRef(false);

  // Load every collection once when the screen opens.
  useEffect(() => {
    let isMounted = true;

    // Read one collection, returning null on failure (so it can be flagged).
    const fetchDocs = async (collectionName) => {
      try {
        const snapshot = await getDocs(collection(db, collectionName));
        // Spread the data first, then set id last — so a stray "id" field inside
        // the document can never overwrite Firestore's real document id.
        return snapshot.docs.map((documentSnapshot) => ({
          ...documentSnapshot.data(),
          id: documentSnapshot.id,
        }));
      } catch (error) {
        console.error(`שגיאה בטעינת ${collectionName}:`, error);
        return null;
      }
    };

    // Load everything in parallel and shape it for the UI.
    const load = async () => {
      // Fetch all six collections at once.
      const [volunteersRaw, groupsRaw, usersRaw, eventsRaw, registrantsRaw, attendanceRaw] = await Promise.all([
        fetchDocs('volunteers'),
        fetchDocs('groups'),
        fetchDocs('users'),
        fetchDocs('events'),
        fetchDocs('registrants'),
        fetchDocs('attendance'),
      ]);

      // Bail out if we unmounted while waiting.
      if (!isMounted) return;

      // Flag an error if any collection came back null.
      const anyError = [volunteersRaw, groupsRaw, usersRaw, eventsRaw, registrantsRaw, attendanceRaw].some((value) => value === null);

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

          // Keep the phone too, so the top-bar name can open a WhatsApp greeting.
          const phone = person.raw?.phone || person.raw?.phoneNumber || '';

          return { id: person.id, name: person.name, age: computeAge(birthDate, today), phone };
        })
        .filter(Boolean);

      // Count volunteers marked absent in today's attendance records.
      const todayKey = attendanceDateKey(today);
      const absentTodayCount = (attendanceRaw || []).filter((record) => {
        const dateKey = record.dateKey || attendanceDateKey(record.date);
        return dateKey === todayKey
          && normalizeAttendanceStatus(getRecordStatus(record)) === 'absent';
      }).length;

      // Publish everything to state (counts feed the top stats row).
      setData({
        groups,
        events,
        pendingCount,
        birthdaysToday,
        absentTodayCount,
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

    // Run once on mount: the effect reads only stable imports, module-level
    // constants and state setters — no props, state or callbacks — so the
    // dependency list is intentionally empty.
  }, []);

  // Track mount status so the async save never sets state after unmount.
  // Re-arm to true on every setup, so StrictMode's setup→cleanup→setup leaves
  // the flag correct while the component is still mounted.
  useEffect(() => {
    isMountedRef.current = true;

    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Close the add-event modal on Escape — but not mid-save, so a save error
  // can't be hidden by the modal disappearing under it.
  useEffect(() => {
    if (!isAddEventOpen) {
      return undefined;
    }

    const onKeyDown = (event) => {
      if (event.key === 'Escape' && !savingEvent) {
        setEventError('');
        setIsAddEventOpen(false);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isAddEventOpen, savingEvent]);

  // Select a calendar day. `hasEvents` (passed by the day button, which already
  // knows it) opens the day-events popup — that's what surfaces the events on
  // the desktop home, where the inline list is hidden. Empty days just select.
  const selectDay = (day, hasEvents) => {
    setSelectedDay(day);
    setDayPopupOpen(Boolean(hasEvents));
  };

  // Close the add-event modal and clear any error (used by the cancel button).
  const closeAddEventModal = () => {
    setEventError('');
    setIsAddEventOpen(false);
  };

  // Update one add-event field by its name attribute (shared by every field).
  const handleEventFormChange = (event) => {
    const { name, value } = event.target;

    setEventForm((previous) => ({
      ...previous,
      [name]: value,
    }));
  };

  // Move the calendar by one month and reset the day selection.
  const changeMonth = (delta) => {
    const next = new Date(calYear, calMonth + delta, 1);
    setCalYear(next.getFullYear());
    setCalMonth(next.getMonth());
    setSelectedDay(null);
    setDayPopupOpen(false);
  };

  // Jump back to the current month and select today — a one-tap "return to now"
  // after browsing other months.
  const goToToday = () => {
    const today = new Date();
    setCalYear(today.getFullYear());
    setCalMonth(today.getMonth());
    setSelectedDay(today.getDate());
    setDayPopupOpen(false);
  };

  // Save a new event from the quick "add event" modal.
  const handleSaveEvent = async (e) => {
    // Don't let the form reload the page.
    e.preventDefault();

    // Hard guard against a fast double-submit: the ref flips synchronously,
    // before React re-renders the disabled button, so two quick clicks can't
    // both create an event (each addDoc would create a separate document).
    if (savingEventRef.current) {
      return;
    }

    // Saturday is not a permitted event date — re-check before any addDoc/write.
    if (isSaturdayDateValue(eventForm.date)) {
      setEventError('לא ניתן לקבוע אירוע ליום שבת.');
      return;
    }

    // Require the three essential fields before saving.
    if (!eventForm.name.trim() || !eventForm.date || !eventForm.location.trim()) {
      setEventError('נא למלא שם אירוע, תאריך ומיקום.');
      return;
    }

    savingEventRef.current = true;
    setEventError('');
    setSavingEvent(true);

    // The event document to save. createdAt/updatedAt are stamped by the
    // server, not the browser clock, so they stay consistent across devices.
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
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };

    try {
      // Add the event document to the "events" collection.
      const docRef = await addDoc(collection(db, 'events'), payload);

      // Bail out if we unmounted while the write was in flight.
      if (!isMountedRef.current) {
        return;
      }

      // Close the modal and reset the form.
      setIsAddEventOpen(false);
      setEventForm(EMPTY_EVENT_FORM);

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
      // Surface failures inline (instead of a blocking alert) and log them.
      console.error('Error saving event:', err);

      if (isMountedRef.current) {
        setEventError('אירעה שגיאה בשמירת האירוע. נסו שוב.');
      }
    } finally {
      // Always release the synchronous guard; only touch state if still mounted.
      savingEventRef.current = false;

      if (isMountedRef.current) {
        setSavingEvent(false);
      }
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

  // Jewish holidays that fall in the viewed month, keyed by day-of-month →
  // Hebrew name. Uses the Israeli holiday schedule; weekly Torah portions, Rosh
  // Chodesh and special Shabbatot are excluded so only real חגים are marked.
  const holidaysByDay = useMemo(() => {
    const byDay = {};

    try {
      // Ask for everything in the viewed Gregorian month (start..end of month).
      const events = HebrewCalendar.calendar({
        start: new Date(calYear, calMonth, 1),
        end: new Date(calYear, calMonth + 1, 0),
        il: true,                 // Israeli holiday schedule
        sedrot: false,            // no weekly Torah portion
        noRoshChodesh: true,      // skip Rosh Chodesh
        noSpecialShabbat: true,   // skip special Shabbatot
      });

      events.forEach((event) => {
        // Keep real holidays (incl. modern Israeli ones); skip the rest.
        const categories = event.getCategories();
        if (!categories.includes('holiday') && !categories.includes('modern')) {
          return;
        }

        // The holiday's Gregorian date → day-of-month in the viewed month.
        const gregDate = event.getDate().greg();
        if (gregDate.getFullYear() !== calYear || gregDate.getMonth() !== calMonth) {
          return;
        }

        // Keep the first holiday name we see for that day (Hebrew rendering).
        const day = gregDate.getDate();
        if (!byDay[day]) {
          byDay[day] = event.render('he');
        }
      });
    } catch (error) {
      // A failure here must never break the dashboard — just show no holidays.
      console.error('שגיאה בחישוב חגים:', error);
    }

    return byDay;
  }, [calYear, calMonth]);

  // The Hebrew date for each day in the viewed month, keyed by day-of-month →
  // Hebrew letters (e.g. 23 → "כ״ג"). Shown as a small second line in each cell.
  const hebrewByDay = useMemo(() => {
    const byDay = {};

    try {
      for (let day = 1; day <= 31; day += 1) {
        const gregDate = new Date(calYear, calMonth, day);

        // Stop once we roll past the end of the month (e.g. Feb 30 → March).
        if (gregDate.getMonth() !== calMonth) {
          break;
        }

        // Convert to a Hebrew date and render just the day number as letters.
        const hebrewDate = new HDate(gregDate);
        byDay[day] = gematriya(hebrewDate.getDate());
      }
    } catch (error) {
      // Never let a calendar-engine hiccup break the dashboard.
      console.error('שגיאה בחישוב תאריכים עבריים:', error);
    }

    return byDay;
  }, [calYear, calMonth]);

  // While loading, show a placeholder.
  if (loading) {
    return (
      <section className="admin-overview" dir="rtl" aria-label="דף הבית">
        <div className="ao-empty" role="status">טוען נתונים...</div>
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

  // Tidy a Hebrew holiday name for the banner: drop "(חו״מ)" parentheticals, a
  // trailing Hebrew year (e.g. "ראש השנה 5787" → "ראש השנה") and a trailing day
  // ordinal ("סוכות א׳" → "סוכות"), so the banner stays short and clean.
  const cleanHolidayName = (name) => name
    .replace(/\s*\([^)]*\)\s*/g, ' ')
    .replace(/\s+\d{3,4}$/, '')
    .replace(/\s+[א-ת]׳$/, '')
    .trim();

  // Holiday names we might feature in the banner.
  const sortedHolidayDays = Object.keys(holidaysByDay).map(Number).sort((a, b) => a - b);

  // The holiday on the day the user CLICKED (selected), if it has one.
  const selectedHolidayName = selectedDay && holidaysByDay[selectedDay]
    ? cleanHolidayName(holidaysByDay[selectedDay])
    : '';
  const selectedIsToday = isCurrentMonth && selectedDay === todayObj.getDate();

  // Canonical YYYY-MM-DD for the clicked day, composed arithmetically (no Date)
  // from the calendar's year / month / day. calMonth is 0-based, so add 1; both
  // the month and day are zero-padded. Used only for the heading's DD-MM-YYYY.
  const selectedDayKey = selectedDay
    ? `${calYear}-${String(calMonth + 1).padStart(2, '0')}-${String(selectedDay).padStart(2, '0')}`
    : '';

  // Today's holiday (only meaningful while viewing the current month).
  const todayHolidayName = isCurrentMonth && holidaysByDay[todayObj.getDate()]
    ? cleanHolidayName(holidaysByDay[todayObj.getDate()])
    : '';

  // The first holiday on or after "today" (this month) / the 1st (other months).
  const fromDay = isCurrentMonth ? todayObj.getDate() : 1;
  const nextHolidayDay = sortedHolidayDays.find((day) => day >= fromDay);
  const nextHolidayName = nextHolidayDay ? cleanHolidayName(holidaysByDay[nextHolidayDay]) : '';

  // Canonical YYYY-MM-DD for the upcoming-holiday day, composed arithmetically
  // (no Date) from the displayed year / month. Used only for the banner label.
  const nextHolidayDayKey = nextHolidayDay
    ? `${calYear}-${String(calMonth + 1).padStart(2, '0')}-${String(nextHolidayDay).padStart(2, '0')}`
    : '';

  // Decide what the calendar's holiday banner shows. Priority: the clicked
  // day's holiday → today's holiday → the next holiday this month. When the
  // featured holiday IS today, it becomes a festive "חג שמח" greeting.
  let holidayBanner = null;

  if (selectedHolidayName) {
    holidayBanner = selectedIsToday
      ? { text: `חג שמח! ${selectedHolidayName}`, greeting: true }
      : { text: `${selectedHolidayName} · ${formatDateOnlyForDisplay(selectedDayKey, { fallback: '' })}`, greeting: false };
  } else if (todayHolidayName) {
    holidayBanner = { text: `חג שמח! ${todayHolidayName}`, greeting: true };
  } else if (nextHolidayName) {
    holidayBanner = { text: `החג הקרוב: ${nextHolidayName} · ${formatDateOnlyForDisplay(nextHolidayDayKey, { fallback: '' })}`, greeting: false };
  }

  // Hebrew month(s) + year for the calendar header (e.g. "תמוז–אב תשפ״ו").
  const hebrewMonthLabel = getHebrewMonthLabel(calYear, calMonth, daysInMonth);

  return (
    <section className="admin-overview" dir="rtl" aria-label="דף הבית">

      {/* Warning shown when some data failed to load. */}
      {hadError && (
        <div className="ao-note" role="status">
          חלק מהנתונים לא נטענו (ייתכן שאין הרשאת קריאה). המידע עשוי להיות חלקי.
        </div>
      )}

      {/* Admin home: a slim birthdays bar on top, then the data cards, then the
          calendar with today's/tomorrow's events beside it. */}
      <div className="ao-home">

        {/* ---------- Top birthdays bar ---------- */}
        {/* Shows only birthdays: who is celebrating today (each name opens an
            editable WhatsApp greeting), or a clear "none today" message. The
            festive confetti animation runs ONLY on a day with a birthday. */}
        <div className={`ao-bday-bar ${data.birthdaysToday.length > 0 ? 'ao-bday-bar--celebrate' : ''}`}>

          {/* Confetti layer — only present when someone has a birthday today. */}
          {data.birthdaysToday.length > 0 && (
            <div className="ao-bday-bar-confetti" aria-hidden="true">
              {BDAY_CONFETTI.map((piece) => (
                <i
                  key={piece.id}
                  style={{
                    left: `${piece.left}%`,
                    '--s': `${piece.size}px`,
                    '--c': piece.color,
                    '--d': `${piece.duration}s`,
                    '--delay': `${piece.delay}s`,
                  }}
                />
              ))}
            </div>
          )}

          <span className="ao-bday-bar-cake" aria-hidden="true">🎂</span>

          {data.birthdaysToday.length > 0 ? (
            <div className="ao-bday-bar-people">
              <span className="ao-bday-bar-title">ימי הולדת היום:</span>

              {/* Each name opens the greeting editor (then sends on WhatsApp). */}
              {data.birthdaysToday.map((person) => (
                <button
                  key={person.id}
                  type="button"
                  className="ao-bday-chip"
                  onClick={() => openBirthdayEditor(person)}
                  title={`כתיבת ברכה ל${person.name} ושליחה בוואטסאפ`}
                >
                  <span className="ao-bday-chip-name">{person.name}</span>
                  <span className="ao-bday-chip-age">{person.age}</span>
                </button>
              ))}
            </div>
          ) : (
            <span className="ao-bday-bar-empty">אין ימי הולדת היום</span>
          )}
        </div>

        {/* ---------- Top stats row: every data card, side by side ---------- */}
        <div className="ao-stats-row">

          {/* Pending registrations — opens the registrations screen. */}
          <button
            type="button"
            className="ao-stat-card is-pending"
            onClick={() => onNavigate && onNavigate('registrations')}
            aria-label={`ממתינים לאישור: ${data.pendingCount} — מעבר לאישור הרשמות`}
          >
            <span className="ao-stat-num">{data.pendingCount}</span>
            <span className="ao-stat-label">ממתינים לאישור</span>
          </button>

          {/* Volunteer count — opens volunteer management. */}
          <button
            type="button"
            className="ao-stat-card"
            onClick={() => onNavigate && onNavigate('volunteers')}
            aria-label={`מתנדבים: ${data.volunteerCount} — מעבר לניהול מתנדבים`}
          >
            <span className="ao-stat-num">{data.volunteerCount}</span>
            <span className="ao-stat-label">מתנדבים</span>
          </button>

          {/* Guide count — opens guide management. */}
          <button
            type="button"
            className="ao-stat-card"
            onClick={() => onNavigate && onNavigate('guides')}
            aria-label={`מדריכים: ${data.guideCount} — מעבר לניהול מדריכים`}
          >
            <span className="ao-stat-num">{data.guideCount}</span>
            <span className="ao-stat-label">מדריכים</span>
          </button>

          {/* Group count — opens group management. */}
          <button
            type="button"
            className="ao-stat-card is-groups"
            onClick={() => onNavigate && onNavigate('groups')}
            aria-label={`קבוצות: ${data.groups.length} — מעבר לניהול קבוצות`}
          >
            <span className="ao-stat-num">{data.groups.length}</span>
            <span className="ao-stat-label">קבוצות</span>
          </button>

          {/* Today's absentees — opens the attendance screen. */}
          <button
            type="button"
            className="ao-stat-card is-absent"
            onClick={() => onNavigate && onNavigate('attendance')}
            aria-label={`חסרים בנוכחות: ${data.absentTodayCount} — מעבר למעקב נוכחות`}
          >
            <span className="ao-stat-num">{data.absentTodayCount}</span>
            <span className="ao-stat-label">חסרים בנוכחות</span>
          </button>
        </div>

          {/* ---------- Events calendar (large, full width) ---------- */}
          <div className="ao-cal-card">

            {/* Calendar header: month label + add-event / prev / next buttons. */}
            <div className="ao-cal-header">
              <div className="ao-cal-header-text">
                <span className="ao-cal-eyebrow">📅 לוח אירועים</span>
                <span className="ao-cal-month">{HEBREW_MONTHS[calMonth]} {calYear}</span>
                {/* The Hebrew month(s) + year for the same period. */}
                {hebrewMonthLabel && <span className="ao-cal-hebrew-month">{hebrewMonthLabel}</span>}
              </div>
              <div className="ao-cal-arrows">
                {/* Add a new event (replaces the old separate "add event" button). */}
                <button
                  type="button"
                  className="ao-cal-add"
                  onClick={() => { setEventError(''); setIsAddEventOpen(true); }}
                  aria-label="הוספת אירוע"
                  title="הוספת אירוע"
                >
                  +
                </button>
                {/* Jump back to the current month + today. */}
                <button
                  type="button"
                  className="ao-cal-today"
                  onClick={goToToday}
                  aria-label="חזרה ליום הנוכחי"
                  title="היום"
                >
                  היום
                </button>
                {/* Month navigation. The interface is right-to-left, so the
                    LEFT arrow moves the calendar FORWARD (e.g. ינואר → פברואר)
                    and the RIGHT arrow moves it back. The chevrons already
                    point that way (◄ next, ► previous); each button just calls
                    changeMonth with the matching direction. */}
                <button type="button" onClick={() => changeMonth(1)} aria-label="חודש הבא">
                  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M15 18l-6-6 6-6" />
                  </svg>
                </button>
                <button type="button" onClick={() => changeMonth(-1)} aria-label="חודש קודם">
                  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M9 18l6-6-6-6" />
                  </svg>
                </button>
              </div>
            </div>

            {/* Festive holiday banner — clicking a holiday day shows it here; on
                the holiday itself it becomes a "חג שמח" greeting. */}
            {holidayBanner && (
              <div className={`ao-cal-holiday-banner ${holidayBanner.greeting ? 'is-today' : ''}`}>
                <span>{holidayBanner.text}</span>
              </div>
            )}

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

                  // This day's events, holiday (if any) and weekday.
                  const dayEvents = eventsByDay[day];
                  const holiday = holidaysByDay[day];
                  const weekday = new Date(calYear, calMonth, day).getDay();

                  // Canonical YYYY-MM-DD for this cell, composed arithmetically
                  // (no Date) — only for the accessible label's DD-MM-YYYY date.
                  const dayKey = `${calYear}-${String(calMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

                  // Build the day button's classes (event / shabbat / holiday /
                  // today / selected).
                  const classes = [
                    'ao-cal-day',
                    dayEvents ? 'has-event' : '',
                    weekday === 6 ? 'is-shabbat' : '',
                    holiday ? 'is-holiday' : '',
                    isCurrentMonth && day === todayObj.getDate() ? 'is-today' : '',
                    day === selectedDay ? 'is-selected' : '',
                  ].filter(Boolean).join(' ');

                  return (
                    <button
                      type="button"
                      className={classes}
                      key={day}
                      onClick={() => selectDay(day, Boolean(dayEvents))}
                      aria-pressed={day === selectedDay}
                      title={holiday || undefined}
                      aria-label={`${formatDateOnlyForDisplay(dayKey, { fallback: '' })}${holiday ? ` — ${holiday}` : ''}${dayEvents ? ` — ${dayEvents.length} אירועים` : ''}`}
                    >
                      <span className="ao-cal-num">{day}</span>
                      {/* The Hebrew date, in letters, under the Gregorian number. */}
                      {hebrewByDay[day] && (
                        <span className="ao-cal-heb" aria-hidden="true">{hebrewByDay[day]}</span>
                      )}
                      {dayEvents && <span className="ao-cal-mark" aria-hidden="true" />}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Compact list of the selected day's events (name + status badge). */}
            <div className="ao-cal-events">
              <h4 className="ao-cal-events-title">
                {selectedDay ? `אירועים — ${formatDateOnlyForDisplay(selectedDayKey, { fallback: '' })}` : 'בחרו יום בלוח'}
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

          {/* "אירועי היום ומחר" — sits in the left column beside the calendar.
              It loads its own data; bumping reloadToken makes it refetch after
              we add an event. */}
          <div className="ao-home-acc ao-home-acc-schedule">
            <ActivityCommandCenter
              sections="schedule"
              reloadToken={accReloadToken}
              onNavigate={onNavigate}
            />
          </div>
      </div>

      {/* Popup: the clicked day's events. This is how the desktop home surfaces
          a day's events (its inline list is hidden to keep the page one screen
          tall); CSS hides this popup on phones, where the inline list shows. */}
      {dayPopupOpen && selectedDay && selectedEvents.length > 0 && (
        <div className="ao-day-popup-overlay" onClick={() => setDayPopupOpen(false)}>
          <div
            className="ao-day-popup"
            role="dialog"
            aria-modal="true"
            aria-label={`אירועים — ${formatDateOnlyForDisplay(selectedDayKey, { fallback: '' })}`}
            dir="rtl"
            onClick={(event) => event.stopPropagation()}
          >
            {/* Header: the date + a close button. */}
            <div className="ao-day-popup-head">
              <h4 className="ao-day-popup-title">
                אירועים — {formatDateOnlyForDisplay(selectedDayKey, { fallback: '' })}
              </h4>
              <button
                type="button"
                className="ao-day-popup-close"
                onClick={() => setDayPopupOpen(false)}
                aria-label="סגירה"
              >
                ✕
              </button>
            </div>

            {/* The day's events (name + status badge), reusing the list styles. */}
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
          </div>
        </div>
      )}

      {/* Modal: edit a birthday greeting, then send it on WhatsApp. */}
      {birthdayEditor && (
        <div className="ao-modal-overlay" onClick={() => setBirthdayEditor(null)}>
          <div
            className="ao-modal-content ao-bday-modal"
            role="dialog"
            aria-modal="true"
            aria-label="ברכת יום הולדת"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="ao-modal-header">ברכת יום הולדת ל{birthdayEditor.name}</div>

            {/* Editable message — pre-filled with the standard greeting. */}
            <label className="ao-bday-modal-label" htmlFor="ao-bday-text">
              אפשר לערוך את ההודעה לפני השליחה:
            </label>
            <textarea
              id="ao-bday-text"
              className="ao-bday-modal-text"
              value={birthdayText}
              onChange={(event) => setBirthdayText(event.target.value)}
              rows="5"
            />

            {/* Quick emoji to drop into the message. */}
            <div className="ao-bday-emojis">
              {BDAY_EMOJIS.map((emoji) => (
                <button
                  type="button"
                  key={emoji}
                  className="ao-bday-emoji"
                  onClick={() => addBirthdayEmoji(emoji)}
                  aria-label={`הוספת ${emoji} להודעה`}
                >
                  {emoji}
                </button>
              ))}
            </div>

            {/* Note when there's no saved phone (WhatsApp opens the picker). */}
            {!hasValidPhone(birthdayEditor.phone) && (
              <p className="ao-bday-modal-note">אין מספר טלפון שמור — וואטסאפ ייפתח לבחירת איש קשר.</p>
            )}

            {/* Close · send. */}
            <div className="ao-modal-actions">
              <button type="button" className="ao-btn-outline" onClick={() => setBirthdayEditor(null)}>
                סגירה
              </button>
              <a
                className="ao-btn-success ao-bday-send"
                href={buildWhatsAppUrl(birthdayEditor.phone, birthdayText)}
                target="_blank"
                rel="noreferrer"
                onClick={() => setBirthdayEditor(null)}
              >
                שליחה בוואטסאפ
              </a>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Add Event. */}
      {isAddEventOpen && (
        <div className="ao-modal-overlay">
          <div
            className="ao-modal-content"
            role="dialog"
            aria-modal="true"
            aria-labelledby="ao-add-event-title"
          >
            <div className="ao-modal-header" id="ao-add-event-title">הוספת אירוע חדש</div>
            <form
              onSubmit={handleSaveEvent}
              className="ao-modal-form"
              aria-busy={savingEvent}
              aria-describedby={eventError ? 'ao-event-error' : undefined}
            >

              {/* Event name. */}
              <div className="ao-form-group">
                <label htmlFor="ao-ev-name">שם האירוע:</label>
                <input
                  id="ao-ev-name"
                  name="name"
                  type="text"
                  value={eventForm.name}
                  onChange={handleEventFormChange}
                  placeholder="לדוגמה: יום כיף בבריכה"
                  autoFocus
                  required
                />
              </div>

              {/* Event date. */}
              <div className="ao-form-group">
                <BirthDatePicker
                  id="ao-ev-date"
                  value={eventForm.date}
                  onChange={(date) => {
                    setEventForm((previous) => ({ ...previous, date }));
                    // Saturday is not a permitted event date: flag it on
                    // selection; clear only this specific error on Sunday–Friday.
                    setEventError((previous) =>
                      isSaturdayDateValue(date)
                        ? 'לא ניתן לקבוע אירוע ליום שבת.'
                        : (previous === 'לא ניתן לקבוע אירוע ליום שבת.' ? '' : previous),
                    );
                  }}
                  label="תאריך"
                  pastYears={3}
                  futureYears={6}
                  required
                />
              </div>

              {/* Event location. */}
              <div className="ao-form-group">
                <label htmlFor="ao-ev-location">מיקום:</label>
                <input
                  id="ao-ev-location"
                  name="location"
                  type="text"
                  value={eventForm.location}
                  onChange={handleEventFormChange}
                  placeholder="מיקום האירוע"
                  required
                />
              </div>

              {/* Assigned group. */}
              <div className="ao-form-group">
                <label htmlFor="ao-ev-group">קבוצה משויכת:</label>
                <select
                  id="ao-ev-group"
                  name="assignedGroup"
                  value={eventForm.assignedGroup}
                  onChange={handleEventFormChange}
                >
                  <option value="ללא שיוך">ללא שיוך</option>
                  {data.groups.map((group) => (
                    <option key={group.id} value={group.groupName}>{group.groupName}</option>
                  ))}
                </select>
              </div>

              {/* Status. */}
              <div className="ao-form-group">
                <label htmlFor="ao-ev-status">סטטוס:</label>
                <select
                  id="ao-ev-status"
                  name="status"
                  value={eventForm.status}
                  onChange={handleEventFormChange}
                >
                  <option value="מתוכנן">מתוכנן</option>
                  <option value="פעיל">פעיל</option>
                  <option value="הסתיים">הסתיים</option>
                  <option value="בוטל">בוטל</option>
                </select>
              </div>

              {/* Contact name. */}
              <div className="ao-form-group">
                <label htmlFor="ao-ev-contact">שם איש קשר:</label>
                <input
                  id="ao-ev-contact"
                  name="contactName"
                  type="text"
                  value={eventForm.contactName}
                  onChange={handleEventFormChange}
                  placeholder="שם איש קשר"
                />
              </div>

              {/* Contact phone (LTR — it's a number). */}
              <div className="ao-form-group">
                <label htmlFor="ao-ev-contact-phone">טלפון איש קשר:</label>
                <input
                  id="ao-ev-contact-phone"
                  name="contactPhone"
                  type="tel"
                  value={eventForm.contactPhone}
                  onChange={handleEventFormChange}
                  placeholder="050-0000000"
                  autoComplete="tel"
                  inputMode="tel"
                  dir="ltr"
                />
              </div>

              {/* Contact email (LTR). */}
              <div className="ao-form-group">
                <label htmlFor="ao-ev-contact-email">אימייל איש קשר:</label>
                <input
                  id="ao-ev-contact-email"
                  name="contactEmail"
                  type="email"
                  value={eventForm.contactEmail}
                  onChange={handleEventFormChange}
                  placeholder="name@example.com"
                  autoComplete="email"
                  autoCapitalize="none"
                  spellCheck="false"
                  inputMode="email"
                  dir="ltr"
                />
              </div>

              {/* Free-text description (spans both columns). */}
              <div className="ao-form-group ao-form-wide">
                <label htmlFor="ao-ev-desc">תיאור האירוע:</label>
                <textarea
                  id="ao-ev-desc"
                  name="description"
                  value={eventForm.description}
                  onChange={handleEventFormChange}
                  placeholder="תיאור קצר..."
                  rows="3"
                />
              </div>

              {/* Inline error (replaces the old blocking alert). */}
              {eventError && (
                <div id="ao-event-error" className="ao-form-error ao-form-wide" role="alert">
                  {eventError}
                </div>
              )}

              {/* Modal actions. */}
              <div className="ao-modal-actions">
                <button
                  type="button"
                  className="ao-btn-outline"
                  onClick={closeAddEventModal}
                  disabled={savingEvent}
                >
                  ביטול
                </button>
                <button type="submit" className="ao-btn-success" disabled={savingEvent}>
                  {savingEvent ? 'שומר...' : 'הוסף אירוע'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </section>
  );
}

export default AdminOverview;
