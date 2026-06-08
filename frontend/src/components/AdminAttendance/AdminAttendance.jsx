// AdminAttendance — attendance tracking for admins. Lists every group with its
// guide, and for the group's most recent attendance day shows each volunteer
// and whether the guide marked them as arrived. Volunteers the guide didn't
// mark show as "not marked".

// React hooks for state, effects and derived values.
import { useEffect, useMemo, useState } from 'react';

// Firestore helpers for reading the collections.
import { collection, getDocs } from 'firebase/firestore';

// Our Firestore database instance.
import { db } from '../../firebase';

// Styles for this screen.
import './AdminAttendance.css';


// Best available display name for a person.
function getName(person) {
  return (
    person.name ||
    [person.firstName, person.lastName].filter(Boolean).join(' ').trim() ||
    person.volunteerName ||
    'מתנדב ללא שם'
  );
}


// Parse a date-ish value (string / Timestamp / Date / { seconds }) into a
// day descriptor { time, key, label }, or null when it can't be parsed.
function parseDay(value) {
  // Resolve whatever shape we got into a real Date.
  let date = null;

  if (!value) {
    date = null;
  } else if (typeof value === 'string') {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) date = parsed;
  } else if (typeof value.toDate === 'function') {
    date = value.toDate();
  } else if (value instanceof Date) {
    date = value;
  } else if (typeof value.seconds === 'number') {
    date = new Date(value.seconds * 1000);
  }

  // No usable date.
  if (!date) return null;

  return {
    time: date.getTime(),
    // Day-level key so all records from that day group together.
    key: `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`,
    // Readable Hebrew label.
    label: date.toLocaleDateString('he-IL', { day: 'numeric', month: 'long', year: 'numeric' }),
  };
}


// Was this volunteer marked present? The guide's marking stores a boolean,
// but stay lenient and accept Hebrew / English text forms too.
function isPresent(record) {
  const value = record.status ?? record.present ?? record.isPresent;

  if (value === true) return true;
  if (value === false) return false;

  return ['present', 'true', '1', 'נוכח', 'כן'].includes(String(value || '').trim().toLowerCase());
}


// Hebrew label for each attendance state.
function stateLabel(state) {
  if (state === 'present') return 'נוכח/ת';
  if (state === 'absent') return 'נעדר/ת';
  return 'לא סומן';
}


function AdminAttendance() {
  // The raw collections.
  const [groups, setGroups] = useState([]);
  const [volunteers, setVolunteers] = useState([]);
  const [attendance, setAttendance] = useState([]);

  // Loading + error flags.
  const [loading, setLoading] = useState(true);
  const [hadError, setHadError] = useState(false);

  // Free-text search (by group or guide name).
  const [search, setSearch] = useState('');

  // The group row currently expanded (null when none).
  const [openGroupId, setOpenGroupId] = useState(null);

  // Load groups + volunteers + attendance once when the screen opens.
  useEffect(() => {
    // Guards against state updates after unmount.
    let isMounted = true;

    // Read one collection, returning null on failure (so it can be flagged).
    const fetchDocs = async (name) => {
      try {
        const snapshot = await getDocs(collection(db, name));
        return snapshot.docs.map((documentSnapshot) => ({ id: documentSnapshot.id, ...documentSnapshot.data() }));
      } catch (error) {
        console.error(`שגיאה בטעינת ${name}:`, error);
        return null;
      }
    };

    const load = async () => {
      const [groupsRaw, volunteersRaw, attendanceRaw] = await Promise.all([
        fetchDocs('groups'),
        fetchDocs('volunteers'),
        fetchDocs('attendance'),
      ]);

      if (!isMounted) return;

      setHadError([groupsRaw, volunteersRaw, attendanceRaw].some((value) => value === null));
      setGroups(groupsRaw || []);
      setVolunteers(volunteersRaw || []);
      setAttendance(attendanceRaw || []);
      setLoading(false);
    };

    load();

    return () => {
      isMounted = false;
    };
  }, []);

  // Build one row per group: its guide, its volunteers, and each volunteer's
  // arrived/absent/not-marked state on the group's most recent attendance day.
  const groupRows = useMemo(() => {
    return groups
      .map((group) => {
        const groupName = group.groupName || group.name || 'קבוצה ללא שם';
        const guideName = group.guideName || 'טרם שובץ מדריך';

        // Volunteers that belong to this group.
        const groupVolunteers = volunteers.filter((vol) => (
          vol.groupId === group.id ||
          vol.groupName === groupName ||
          vol.group === groupName
        ));

        // Attendance records for this group.
        const groupAttendance = attendance.filter((rec) => (
          rec.groupId === group.id ||
          rec.groupName === groupName ||
          rec.group === groupName
        ));

        // Find the group's most recent attendance day.
        let latest = null;
        groupAttendance.forEach((rec) => {
          const day = parseDay(rec.date ?? rec.createdAt);
          if (day && (!latest || day.time > latest.time)) latest = day;
        });

        // Map volunteerId -> present? for that latest day.
        const statusByVolunteer = {};
        if (latest) {
          groupAttendance.forEach((rec) => {
            const day = parseDay(rec.date ?? rec.createdAt);
            if (day && day.key === latest.key && rec.volunteerId) {
              statusByVolunteer[rec.volunteerId] = isPresent(rec);
            }
          });
        }

        // Each volunteer with their state (present / absent / unmarked).
        const people = groupVolunteers
          .map((vol) => {
            let state = 'unmarked';
            if (vol.id in statusByVolunteer) {
              state = statusByVolunteer[vol.id] ? 'present' : 'absent';
            }
            return { id: vol.id, name: getName(vol), state };
          })
          .sort((a, b) => a.name.localeCompare(b.name, 'he'));

        // How many were marked present.
        const presentCount = people.filter((person) => person.state === 'present').length;

        return {
          id: group.id,
          groupName,
          guideName,
          dateLabel: latest ? latest.label : null,
          total: people.length,
          presentCount,
          people,
        };
      })
      .sort((a, b) => a.groupName.localeCompare(b.groupName, 'he'));
  }, [groups, volunteers, attendance]);

  // Apply the search filter.
  const visibleGroups = useMemo(() => {
    const text = search.trim().toLowerCase();
    if (!text) return groupRows;
    return groupRows.filter((group) => (
      group.groupName.toLowerCase().includes(text) ||
      group.guideName.toLowerCase().includes(text)
    ));
  }, [groupRows, search]);

  // Toggle a group open/closed.
  const toggleGroup = (id) => setOpenGroupId((current) => (current === id ? null : id));

  return (
    <section className="adm-att" dir="rtl" aria-label="מעקב נוכחות">

      {/* Warning shown when the data failed to load. */}
      {hadError && (
        <div className="adm-att-note" role="status">
          חלק מהנתונים לא נטענו (ייתכן שאין הרשאת קריאה).
        </div>
      )}

      {/* Search by group or guide. */}
      <div className="adm-att-filters">
        <input
          type="search"
          className="adm-att-search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="🔍 חיפוש לפי קבוצה או מדריך..."
        />
      </div>

      {/* Loading / empty / the group list. */}
      {loading ? (
        <div className="adm-att-empty">טוען נתונים...</div>
      ) : visibleGroups.length === 0 ? (
        <div className="adm-att-empty">אין קבוצות להצגה.</div>
      ) : (
        <div className="adm-att-list">
          {visibleGroups.map((group) => {
            // Is this group expanded?
            const isOpen = openGroupId === group.id;

            return (
              <div className={`adm-att-meeting ${isOpen ? 'is-open' : ''}`} key={group.id}>

                {/* Group header: name, guide + date, present/total, chevron. */}
                <button
                  type="button"
                  className="adm-att-meeting-head"
                  onClick={() => toggleGroup(group.id)}
                  aria-expanded={isOpen}
                >
                  <span className="adm-att-meeting-main">
                    <span className="adm-att-meeting-group">{group.groupName}</span>
                    <span className="adm-att-meeting-date">
                      מדריך/ה: {group.guideName}
                      {group.dateLabel ? ` · נוכחות ל-${group.dateLabel}` : ' · טרם סומנה נוכחות'}
                    </span>
                  </span>

                  <span className="adm-att-badges">
                    <span className="adm-att-badge is-present">
                      נוכחים {group.presentCount}/{group.total}
                    </span>
                  </span>

                  <span className="adm-att-chevron" aria-hidden="true">{isOpen ? '▲' : '▼'}</span>
                </button>

                {/* Expanded volunteer list (only when open). */}
                {isOpen && (
                  <ul className="adm-att-people">
                    {group.people.length > 0 ? (
                      group.people.map((person) => (
                        <li className="adm-att-person" key={person.id}>
                          <span className="adm-att-person-name">{person.name}</span>
                          <span className={`adm-att-person-status is-${person.state}`}>
                            {stateLabel(person.state)}
                          </span>
                        </li>
                      ))
                    ) : (
                      <li className="adm-att-person">
                        <span className="adm-att-person-name">אין מתנדבים בקבוצה זו.</span>
                      </li>
                    )}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

export default AdminAttendance;
