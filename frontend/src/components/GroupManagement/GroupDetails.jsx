// GroupDetails — read-only overview of a single group: the assigned guide,
// the group's volunteers, and placeholders for attendance and events.

// React hooks for state and side effects.
import { useEffect, useState } from 'react';

// Firestore helpers for reading single docs and collections.
import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore';

// Our Firestore database instance.
import { db } from '../../firebase';

// Shared display-name helper.
import { getDisplayName } from '../../utils/people';

// Shared attendance status normalization (handles old string/boolean statuses).
import { normalizeAttendanceStatus, getRecordStatus } from '../../utils/attendance';

// Display-only date formatter: a 'YYYY-MM-DD' string -> 'DD-MM-YYYY'.
import { formatDateOnlyForDisplay } from '../../utils/dateDisplay';

// This screen's own modern, mobile-first styles.
import './GroupDetails.css';


// A person's display name (this screen's fallback wording).
const getPersonName = (person) => getDisplayName(person, 'לא הוזן שם');


const EMPTY_ATTENDANCE_SUMMARY = { present: 0, absent: 0, unmarked: 0 };
const EMPTY_WEEKLY_ATTENDANCE = { present: [], absent: [], byDay: [] };


// First character of a name, used for the round avatars.
const getInitial = (name) => {
  const trimmed = (name || '').trim();
  return trimmed ? trimmed[0] : '?';
};


// A clean "tel:" target from a free-text phone (digits + leading plus only).
const telHref = (phone) => `tel:${String(phone).replace(/[^\d+]/g, '')}`;


function getDayKey(date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
}


function getStartOfCurrentWeek() {
  const start = new Date();
  start.setDate(start.getDate() - start.getDay());
  start.setHours(0, 0, 0, 0);
  return start;
}


function getCurrentWeekStartKey() {
  return getDayKey(getStartOfCurrentWeek());
}


function getDateFromDayKey(dateKey) {
  const [year, month, day] = String(dateKey || '').split('-').map(Number);
  if (!year || !month || !day) {
    return getStartOfCurrentWeek();
  }

  return new Date(year, month - 1, day);
}


// This week's day keys (Sunday–Saturday), used for the attendance summary.
function getThisWeekDayKeys(weekStartKey = getCurrentWeekStartKey()) {
  const start = getDateFromDayKey(weekStartKey);
  const keys = [];

  for (let i = 0; i < 7; i += 1) {
    const day = new Date(start);
    day.setDate(start.getDate() + i);
    keys.push(getDayKey(day));
  }

  return keys;
}


function getThisWeekRangeLabel(weekStartKey = getCurrentWeekStartKey()) {
  // Keep BOTH endpoints as logical 'YYYY-MM-DD' keys (built by safe numeric date
  // math in getThisWeekDayKeys — never new Date('YYYY-MM-DD')); format ONLY the
  // two ends for display, as DD-MM-YYYY.
  const dayKeys = getThisWeekDayKeys(weekStartKey);
  const startKey = dayKeys[0];
  const endKey = dayKeys[dayKeys.length - 1];

  return `${formatDateOnlyForDisplay(startKey)} - ${formatDateOnlyForDisplay(endKey)}`;
}


function getDayLabel(dateKey) {
  const [year, month, day] = String(dateKey || '').split('-').map(Number);
  if (!year || !month || !day) {
    return 'תאריך לא ידוע';
  }

  return new Date(year, month - 1, day).toLocaleDateString('he-IL', {
    weekday: 'short',
    day: 'numeric',
    month: 'numeric',
  });
}


function getRecordTime(record) {
  const value = record.date || record.createdAt || record.updatedAt;
  if (value?.toDate) {
    return value.toDate().getTime();
  }

  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : 0;
}


function getRecordVolunteerKey(record) {
  return (
    record.volunteerId ||
    record.userId ||
    record.uid ||
    record.idNumber ||
    record.identityNumber ||
    record.volunteerName ||
    record.name ||
    ''
  );
}


function buildWeeklyAttendance(records, groupId, groupName, groupVolunteers, weekKeys) {
  const latestByVolunteerAndDay = new Map();
  const volunteersById = new Map(groupVolunteers.map((volunteer) => [volunteer.id, volunteer]));
  const dayGroups = weekKeys.map((dateKey) => ({
    dateKey,
    dayLabel: getDayLabel(dateKey),
    present: [],
    absent: [],
  }));
  const dayGroupsByKey = new Map(dayGroups.map((day) => [day.dateKey, day]));

  records.forEach((record) => {
    const belongsToGroup =
      record.groupId === groupId ||
      record.groupName === groupName ||
      record.group === groupName;

    if (!belongsToGroup || !weekKeys.includes(record.dateKey)) {
      return;
    }

    const volunteerKey = getRecordVolunteerKey(record);
    if (!volunteerKey) {
      return;
    }

    const mapKey = `${volunteerKey}_${record.dateKey}`;
    const current = latestByVolunteerAndDay.get(mapKey);
    if (!current || getRecordTime(record) > getRecordTime(current)) {
      latestByVolunteerAndDay.set(mapKey, record);
    }
  });

  const details = {
    present: [],
    absent: [],
  };

  latestByVolunteerAndDay.forEach((record) => {
    const status = normalizeAttendanceStatus(getRecordStatus(record));
    if (status !== 'present' && status !== 'absent') {
      return;
    }

    const volunteer = volunteersById.get(record.volunteerId);
    const name = volunteer
      ? getPersonName(volunteer)
      : (record.volunteerName || record.name || 'מתנדב ללא שם');

    const item = {
      key: `${getRecordVolunteerKey(record)}_${record.dateKey}_${status}`,
      name,
      dateKey: record.dateKey,
      dayLabel: getDayLabel(record.dateKey),
    };

    details[status].push(item);
    dayGroupsByKey.get(record.dateKey)?.[status].push(item);
  });

  [...Object.values(details), ...dayGroups.flatMap((day) => [day.present, day.absent])].forEach((items) => {
    items.sort((first, second) => (
      first.dateKey.localeCompare(second.dateKey) ||
      first.name.localeCompare(second.name, 'he')
    ));
  });

  return {
    ...details,
    byDay: dayGroups,
  };
}


// `guideScopedRead` is passed (true) ONLY by the guide dashboard. It selects the
// READ STRATEGY — guide-scoped (server-side groupId filter, no group-NAME
// fallback) vs the legacy admin/viewer behaviour that can also fold in records
// linked only by group name. It is NOT a security control: the Firestore Rules
// are the guard and would deny an unscoped guide query regardless of this flag.
//
// `currentGuideUid` is the SIGNED-IN guide's uid, passed by the guide dashboard.
// In the guide path the guide's own contact details are read by THIS uid — never
// by groups/{}.guideId, which may be stale or point at a different guide (the
// Rules let a guide read only their OWN guides/{uid}). It is ignored on the
// admin/viewer path.
const GroupDetails = ({ groupId, onBack, guideScopedRead = false, currentGuideUid = '' }) => {
  // True while the group's data loads.
  const [loading, setLoading] = useState(true);

  // The group, its guide, and its volunteers.
  const [group, setGroup] = useState(null);
  const [guide, setGuide] = useState(null);
  const [volunteers, setVolunteers] = useState([]);

  // This week's attendance summary + the group's events.
  const [attendanceSummary, setAttendanceSummary] = useState(EMPTY_ATTENDANCE_SUMMARY);
  const [weeklyAttendance, setWeeklyAttendance] = useState(EMPTY_WEEKLY_ATTENDANCE);
  const [openCards, setOpenCards] = useState({
    attendance: false,
    guide: false,
    members: false,
    events: false,
  });
  const [currentWeekStartKey, setCurrentWeekStartKey] = useState(() => getCurrentWeekStartKey());
  const [events, setEvents] = useState([]);

  const toggleCard = (cardName) => {
    setOpenCards((currentOpenCards) => ({
      ...currentOpenCards,
      [cardName]: !currentOpenCards[cardName],
    }));
  };

  useEffect(() => {
    const syncCurrentWeek = () => {
      const nextWeekStartKey = getCurrentWeekStartKey();
      setCurrentWeekStartKey((previousKey) => (
        previousKey === nextWeekStartKey ? previousKey : nextWeekStartKey
      ));
    };

    const intervalId = window.setInterval(syncCurrentWeek, 60 * 60 * 1000);
    window.addEventListener('focus', syncCurrentWeek);
    document.addEventListener('visibilitychange', syncCurrentWeek);

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener('focus', syncCurrentWeek);
      document.removeEventListener('visibilitychange', syncCurrentWeek);
    };
  }, []);

  // Load everything for the given group whenever the id changes.
  useEffect(() => {
    let isActive = true;

    const clearGroupData = () => {
      setGroup(null);
      setGuide(null);
      setVolunteers([]);
      setAttendanceSummary(EMPTY_ATTENDANCE_SUMMARY);
      setWeeklyAttendance(EMPTY_WEEKLY_ATTENDANCE);
      setEvents([]);
    };

    const fetchAllGroupData = async () => {
      // No group id: nothing to load.
      if (!groupId) {
        if (isActive) {
          clearGroupData();
          setLoading(false);
        }
        return;
      }

      setLoading(true);

      try {
        // Read the group document.
        const groupRef = doc(db, 'groups', groupId);
        const groupSnap = await getDoc(groupRef);

        if (!isActive) {
          return;
        }

        // Bail out if the group doesn't exist.
        if (!groupSnap.exists()) {
          console.error('קבוצה לא נמצאה');
          clearGroupData();
          return;
        }

        // Store the group and remember its name for matching volunteers.
        const groupData = { id: groupSnap.id, ...groupSnap.data() };
        const groupName = groupData.groupName || groupData.name || '';

        // Load the assigned guide's contact details (merging guides + users).
        // This is OPTIONAL metadata: a failure or a missing document must NOT
        // abort the group / volunteers / attendance load, so it lives in its OWN
        // try/catch and only ever clears the guide card.
        //   - GUIDE path (guideScopedRead): the guide IS the current user, so the
        //     identity is currentGuideUid — we read ONLY their OWN guides/{uid} +
        //     users/{uid}, never groups/{}.guideId (which may be stale or point at
        //     another guide; the Rules would deny reading another guide's docs).
        //     This mirrors the Rules contract where guides/{uid}.groupId wins.
        //   - ADMIN / VIEWER path: unchanged — groups/{}.guideId selects whose
        //     contact card to show (legacy behaviour preserved).
        const guideUid = guideScopedRead ? currentGuideUid : groupData.guideId;
        let nextGuide = null;

        if (guideUid) {
          try {
            const [guideSnap, guideUserSnap] = await Promise.all([
              getDoc(doc(db, 'guides', guideUid)),
              getDoc(doc(db, 'users', guideUid)),
            ]);

            if (!isActive) {
              return;
            }

            nextGuide = {
              id: guideUid,
              ...(guideSnap.exists() ? guideSnap.data() : {}),
              ...(guideUserSnap.exists() ? guideUserSnap.data() : {}),
            };
          } catch (guideError) {
            if (!isActive) {
              return;
            }

            // Metadata only — keep the screen working, just without the details.
            console.error('שגיאה בטעינת פרטי המדריך (לא חוסם את המסך):', guideError);
          }
        }

        // Load this group's volunteers.
        //   - GUIDE path (guideScopedRead): SCOPED on the server by canonical
        //     groupId — never the whole collection, never matched by group NAME.
        //     A keep-only-our-group client filter stays as defense-in-depth; the
        //     guide read Rules require the groupId scope.
        //   - ADMIN / VIEWER path: the legacy behaviour, which may also include
        //     records linked to this group only by group NAME (older data).
        let volData;

        if (guideScopedRead) {
          const volunteersSnap = await getDocs(
            query(collection(db, 'volunteers'), where('groupId', '==', groupId)),
          );
          volData = volunteersSnap.docs
            .map((documentSnapshot) => ({ id: documentSnapshot.id, ...documentSnapshot.data() }))
            .filter((volunteer) => volunteer.groupId === groupId);
        } else {
          const volunteersSnap = await getDocs(collection(db, 'volunteers'));
          volData = volunteersSnap.docs
            .map((documentSnapshot) => ({ id: documentSnapshot.id, ...documentSnapshot.data() }))
            .filter(
              (volunteer) =>
                volunteer.groupId === groupId ||
                volunteer.groupName === groupName,
            );
        }

        if (!isActive) {
          return;
        }

        // This week's attendance summary for the group (present / absent /
        // unmarked across the group's volunteers × 7 days).
        //   - GUIDE path: SCOPED by canonical groupId + this week's dateKeys, so
        //     the query satisfies the guide read Rules (a dateKey-only query
        //     would be denied).
        //   - ADMIN / VIEWER path: the legacy query by dateKey alone, so
        //     buildWeeklyAttendance can still fold in records matched by group
        //     NAME (older data).
        const weekKeys = getThisWeekDayKeys(currentWeekStartKey);
        const attendanceSnap = guideScopedRead
          ? await getDocs(
              query(
                collection(db, 'attendance'),
                where('groupId', '==', groupId),
                where('dateKey', 'in', weekKeys),
              ),
            )
          : await getDocs(
              query(collection(db, 'attendance'), where('dateKey', 'in', weekKeys)),
            );
        const attendanceDetails = buildWeeklyAttendance(
          attendanceSnap.docs.map((attendanceDoc) => attendanceDoc.data()),
          groupId,
          groupName,
          volData,
          weekKeys,
        );
        const present = attendanceDetails.present.length;
        const absent = attendanceDetails.absent.length;
        const unmarked = Math.max(0, volData.length * weekKeys.length - present - absent);

        if (!isActive) {
          return;
        }

        // The group's events (linked by the event's assignedGroup = group name).
        const eventsSnap = await getDocs(
          query(collection(db, 'events'), where('assignedGroup', '==', groupName)),
        );
        const eventsData = eventsSnap.docs
          .map((eventDoc) => ({ id: eventDoc.id, ...eventDoc.data() }))
          .sort((first, second) => (first.date || '').localeCompare(second.date || ''));

        if (!isActive) {
          return;
        }

        setGroup(groupData);
        setGuide(nextGuide);
        setVolunteers(volData);
        setAttendanceSummary({ present, absent, unmarked });
        setWeeklyAttendance(attendanceDetails);
        setEvents(eventsData);
      } catch (error) {
        if (!isActive) {
          return;
        }

        console.error('שגיאה בשליפת נתוני הקבוצה המלאים:', error);
        clearGroupData();
      } finally {
        if (isActive) {
          setLoading(false);
        }
      }
    };

    fetchAllGroupData();

    return () => {
      isActive = false;
    };
  }, [currentWeekStartKey, groupId, guideScopedRead, currentGuideUid]);

  // While loading, show a placeholder.
  if (loading) {
    return (
      <div className="gd-page" dir="rtl">
        <div className="gd-loading">טוען נתוני קבוצה...</div>
      </div>
    );
  }

  // Group missing / failed to load.
  if (!group) {
    return (
      <div className="gd-page" dir="rtl">
        {typeof onBack === 'function' && (
          <button className="gd-back" onClick={onBack}>חזרה</button>
        )}
        <div className="gd-empty">שגיאה: הקבוצה לא נמצאה.</div>
      </div>
    );
  }

  // The group's display name.
  const groupName = group.groupName || group.name || 'קבוצה ללא שם';
  const attendanceWeekLabel = getThisWeekRangeLabel(currentWeekStartKey);
  const hasWeeklyAttendance = weeklyAttendance.present.length > 0 || weeklyAttendance.absent.length > 0;
  const attendanceDays = (weeklyAttendance.byDay || []).filter((day) => (
    day.present.length > 0 || day.absent.length > 0
  ));

  return (
    <div className="gd-page" dir="rtl">

      {/* Hero: the group name, the guide, and the back button — all at the top. */}
      <header className="gd-hero">
        <span className="gd-hero-glow" aria-hidden="true" />

        <div className="gd-hero-content">
          <div className="gd-hero-text">
            <span className="gd-hero-eyebrow">הקבוצה שלי</span>
            <h1 className="gd-hero-title">{groupName}</h1>

            {/* Quick meta chips: who leads the group and when it meets. */}
            <div className="gd-hero-meta">
              {guide && <span className="gd-chip">👤 {getPersonName(guide)}</span>}
              {group.time && <span className="gd-chip">🕒 {group.time}</span>}
            </div>
          </div>

          {typeof onBack === 'function' && (
            <button className="gd-back" onClick={onBack}>חזרה</button>
          )}
        </div>
      </header>

      {/* Quick stats — the key numbers, right at the top. */}
      <div className="gd-stats">
        <div className="gd-stat">
          <span className="gd-stat-num">{volunteers.length}</span>
          <span className="gd-stat-label">מתנדבים</span>
        </div>
        <div className="gd-stat gd-stat--present">
          <span className="gd-stat-num">{attendanceSummary.present}</span>
          <span className="gd-stat-label">נוכחים השבוע</span>
        </div>
        <div className="gd-stat gd-stat--absent">
          <span className="gd-stat-num">{attendanceSummary.absent}</span>
          <span className="gd-stat-label">חסרים השבוע</span>
        </div>
        <div className="gd-stat">
          <span className="gd-stat-num">{events.length}</span>
          <span className="gd-stat-label">אירועים</span>
        </div>
      </div>

      {/* The main content cards. */}
      <div className="gd-grid">

        <section className={`gd-card gd-collapsible-card gd-attendance-card ${openCards.attendance ? 'is-open' : ''}`}>
          <button
            type="button"
            className="gd-card-heading-row gd-card-toggle"
            onClick={() => toggleCard('attendance')}
            aria-expanded={openCards.attendance}
            aria-controls="gd-weekly-attendance-details"
          >
            <div>
              <h2 className="gd-card-title">נוכחות השבוע</h2>
              <p className="gd-card-subtitle">{attendanceWeekLabel}</p>
            </div>
            <span className="gd-card-toggle-meta">
              <span className="gd-card-count">{attendanceSummary.present + attendanceSummary.absent}</span>
              <span className="gd-card-toggle-text">
                {openCards.attendance ? 'סגור' : 'פתח'}
              </span>
              <span className="gd-card-chevron" aria-hidden="true" />
            </span>
          </button>

          {openCards.attendance && (
            <div id="gd-weekly-attendance-details" className="gd-card-panel gd-attendance-details">
              {hasWeeklyAttendance ? (
                <div className="gd-attendance-days">
                  {attendanceDays.map((day) => (
                    <section className="gd-attendance-day-group" key={day.dateKey}>
                      <div className="gd-attendance-day-head">
                        <span>{day.dayLabel}</span>
                        <strong>{day.present.length + day.absent.length}</strong>
                      </div>

                      <div className="gd-attendance-day-columns">
                        <div className="gd-attendance-status-block gd-attendance-status-block--present">
                          <div className="gd-attendance-status-title">
                            <span>נוכחים</span>
                            <strong>{day.present.length}</strong>
                          </div>
                          {day.present.length > 0 ? (
                            <ul className="gd-attendance-list">
                              {day.present.map((item) => (
                                <li className="gd-attendance-item" key={item.key}>
                                  <span className="gd-attendance-name">{item.name}</span>
                                </li>
                              ))}
                            </ul>
                          ) : (
                            <div className="gd-attendance-empty">אין</div>
                          )}
                        </div>

                        <div className="gd-attendance-status-block gd-attendance-status-block--absent">
                          <div className="gd-attendance-status-title">
                            <span>חסרים</span>
                            <strong>{day.absent.length}</strong>
                          </div>
                          {day.absent.length > 0 ? (
                            <ul className="gd-attendance-list">
                              {day.absent.map((item) => (
                                <li className="gd-attendance-item" key={item.key}>
                                  <span className="gd-attendance-name">{item.name}</span>
                                </li>
                              ))}
                            </ul>
                          ) : (
                            <div className="gd-attendance-empty">אין</div>
                          )}
                        </div>
                      </div>
                    </section>
                  ))}
                </div>
              ) : (
                <div className="gd-attendance-empty gd-attendance-empty--card">
                  עדיין לא סומנה נוכחות השבוע.
                </div>
              )}
            </div>
          )}
        </section>

        {/* Guide contact — shown only when a guide is assigned. */}
        {guide && (
          <section className={`gd-card gd-collapsible-card ${openCards.guide ? 'is-open' : ''}`}>
            <button
              type="button"
              className="gd-card-heading-row gd-card-toggle"
              onClick={() => toggleCard('guide')}
              aria-expanded={openCards.guide}
              aria-controls="gd-guide-details"
            >
              <div>
                <h2 className="gd-card-title">מדריך אחראי</h2>
              </div>
              <span className="gd-card-toggle-meta">
                <span className="gd-card-toggle-text">
                  {openCards.guide ? 'סגור' : 'פתח'}
                </span>
                <span className="gd-card-chevron" aria-hidden="true" />
              </span>
            </button>

            {openCards.guide && (
              <div id="gd-guide-details" className="gd-card-panel">
                <div className="gd-guide">
                  <span className="gd-guide-avatar">{getInitial(getPersonName(guide))}</span>
                  <div className="gd-guide-info">
                    <span className="gd-guide-name">{getPersonName(guide)}</span>
                    {guide.email && <span className="gd-guide-line" dir="ltr">{guide.email}</span>}
                    {guide.phone && (
                      <a className="gd-guide-line" href={telHref(guide.phone)} dir="ltr">{guide.phone}</a>
                    )}
                  </div>
                </div>
              </div>
            )}
          </section>
        )}

        {/* Group members. */}
        <section className={`gd-card gd-collapsible-card ${openCards.members ? 'is-open' : ''}`}>
          <button
            type="button"
            className="gd-card-heading-row gd-card-toggle"
            onClick={() => toggleCard('members')}
            aria-expanded={openCards.members}
            aria-controls="gd-members-details"
          >
            <div>
              <h2 className="gd-card-title">
                חברי הקבוצה
                <span className="gd-card-count">{volunteers.length}</span>
              </h2>
            </div>
            <span className="gd-card-toggle-meta">
              <span className="gd-card-toggle-text">
                {openCards.members ? 'סגור' : 'פתח'}
              </span>
              <span className="gd-card-chevron" aria-hidden="true" />
            </span>
          </button>

          {openCards.members && (
            <div id="gd-members-details" className="gd-card-panel">
              {volunteers.length > 0 ? (
                <ul className="gd-members">
                  {volunteers.map((volunteer) => {
                    const name = getPersonName(volunteer);

                    // A short "age · school · day" sub-line (drops the empty parts).
                    const sub = [
                      volunteer.age ? `גיל ${volunteer.age}` : '',
                      volunteer.school || '',
                      volunteer.day ? `יום פעילות: ${volunteer.day}` : '',
                    ].filter(Boolean).join(' · ') || '—';

                    return (
                      <li className="gd-member" key={volunteer.id}>
                        <span className="gd-member-avatar">{getInitial(name)}</span>
                        <div className="gd-member-info">
                          <span className="gd-member-name">{name}</span>
                          <span className="gd-member-sub">{sub}</span>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <div className="gd-empty">אין מתנדבים בקבוצה זו.</div>
              )}
            </div>
          )}
        </section>

        {/* The group's events (read-only — managed in the events screen). */}
        <section className={`gd-card gd-collapsible-card ${openCards.events ? 'is-open' : ''}`}>
          <button
            type="button"
            className="gd-card-heading-row gd-card-toggle"
            onClick={() => toggleCard('events')}
            aria-expanded={openCards.events}
            aria-controls="gd-events-details"
          >
            <div>
              <h2 className="gd-card-title">
                אירועי הקבוצה
                <span className="gd-card-count">{events.length}</span>
              </h2>
            </div>
            <span className="gd-card-toggle-meta">
              <span className="gd-card-toggle-text">
                {openCards.events ? 'סגור' : 'פתח'}
              </span>
              <span className="gd-card-chevron" aria-hidden="true" />
            </span>
          </button>

          {openCards.events && (
            <div id="gd-events-details" className="gd-card-panel">
              {events.length > 0 ? (
                <ul className="gd-events">
                  {events.map((eventItem) => {
                    // A short "date · location" meta line (drops empty parts).
                    // The date is shown as DD-MM-YYYY; an invalid value falls back
                    // to '' (a raw invalid date is NEVER shown). event.date itself,
                    // sorting, filtering and status are untouched.
                    const meta = [
                      formatDateOnlyForDisplay(eventItem.date, { fallback: '' }),
                      eventItem.location || '',
                    ].filter(Boolean).join(' · ') || '—';

                    return (
                      <li className="gd-event" key={eventItem.id}>
                        <div className="gd-event-info">
                          <span className="gd-event-name">{eventItem.name || 'ללא שם'}</span>
                          <span className="gd-event-meta">{meta}</span>
                        </div>
                        {eventItem.status && <span className="gd-event-status">{eventItem.status}</span>}
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <div className="gd-empty">אין אירועים משויכים לקבוצה זו.</div>
              )}
            </div>
          )}
        </section>
      </div>
    </div>
  );
};

export default GroupDetails;
