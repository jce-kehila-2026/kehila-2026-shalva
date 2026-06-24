// AdminAttendance — attendance tracking for admins. Lists every group with its
// guide, and allows clicking a group to view a full weekly attendance table.

// React hooks for state, effects and derived values.
import { useEffect, useMemo, useState } from 'react';

// Firestore helpers: read the collections, and write/delete a one-time cell mark.
import { collection, deleteDoc, doc, getDocs, setDoc } from 'firebase/firestore';

// Our Firestore database instance.
import { db } from '../../firebase';

// Shared attendance normalization (one definition across all screens).
import { normalizeAttendanceStatus, getRecordStatus } from '../../utils/attendance';

// Canonical attendance document id (groupId_dateKey_volunteerId), reused so a
// one-time admin mark uses the same id shape as the guide flow.
import { buildAttendanceId } from '../../utils/dateKey';

// Display-only date formatter: a 'YYYY-MM-DD' string -> 'DD-MM-YYYY'.
import { formatDateOnlyForDisplay } from '../../utils/dateDisplay';

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


// Start of the week (Sunday) containing a given date.
function getStartOfWeek(date) {
  const d = new Date(date);
  const day = d.getDay(); // 0 is Sunday, 1 is Monday, etc.
  d.setDate(d.getDate() - day);
  d.setHours(0, 0, 0, 0);
  return d;
}


// Generate the attendance days of the week (Sunday-Saturday). Saturday is a
// regular activity day now, so the week shows all seven days.
function getWeekDays(sunday) {
  const days = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(sunday);
    d.setDate(sunday.getDate() + i);
    days.push(d);
  }
  return days;
}


// Format a Date object to YYYY-MM-DD.
function getDayKey(date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
}


// Build a local Date at noon from a 'YYYY-MM-DD' key (noon avoids any DST edge).
// Used as the `date` timestamp on a one-time cell write; `dateKey` stays the
// source of truth for which day the record belongs to.
function dateFromDayKey(dayKey) {
  const [year, month, day] = String(dayKey).split('-').map(Number);
  return new Date(year, month - 1, day, 12, 0, 0);
}


// Formats a Sunday date into a DD-MM-YYYY range string (e.g.
// "07-06-2026 – 13-06-2026"). The two endpoints are turned into canonical
// 'YYYY-MM-DD' keys via getDayKey (no new Date('YYYY-MM-DD')) and only the
// DISPLAY is formatted — the dateKeys driving grouping/filtering are untouched.
function getWeekRangeLabel(sunday) {
  const saturday = new Date(sunday);
  saturday.setDate(sunday.getDate() + 6);

  return `${formatDateOnlyForDisplay(getDayKey(sunday))} – ${formatDateOnlyForDisplay(getDayKey(saturday))}`;
}


function getStatusLabel(status) {
  if (status === 'present') return 'נוכח';
  if (status === 'absent') return 'חסר';
  if (status === 'not-scheduled') return 'לא משובץ ליום זה';
  return 'לא סומן';
}


function AdminAttendance({ registerBack }) {
  // The raw collections.
  const [groups, setGroups] = useState([]);
  const [volunteers, setVolunteers] = useState([]);
  const [attendance, setAttendance] = useState([]);

  // Loading + error flags.
  const [loading, setLoading] = useState(true);
  const [hadError, setHadError] = useState(false);

  // Free-text search (by group or guide name).
  const [search, setSearch] = useState('');

  // The currently selected group to view attendance for.
  const [selectedGroup, setSelectedGroup] = useState(null);

  // The cell whose edit menu is open: `${volunteerId}|${dateKey}` (null = none).
  const [openCellKey, setOpenCellKey] = useState(null);

  // The cell currently being written, so its menu can show a saving state.
  const [savingCellKey, setSavingCellKey] = useState(null);

  // Dashboard back button: the weekly table returns to the group list first.
  useEffect(() => {
    if (!registerBack) return;
    registerBack(() => {
      if (selectedGroup) {
        setSelectedGroup(null);
        return true;
      }
      return false;
    });
  }, [registerBack, selectedGroup]);

  // The active week's Sunday.
  const [currentWeekStart, setCurrentWeekStart] = useState(() => getStartOfWeek(new Date()));

  const weekDays = useMemo(() => getWeekDays(currentWeekStart), [currentWeekStart]);
  const weekDaysKeys = useMemo(() => weekDays.map(getDayKey), [weekDays]);

  // Load groups + volunteers + attendance once when the screen opens.
  useEffect(() => {
    let isMounted = true;

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

  // Filter attendance records to only this week in-memory.
  const weekAttendance = useMemo(() => {
    return attendance.filter((rec) => rec.dateKey && weekDaysKeys.includes(rec.dateKey));
  }, [attendance, weekDaysKeys]);

  // Build one row per group: its guide, its volunteers, and each volunteer's
  // weekly status map (present / absent / unmarked) for the selected week.
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

        // Attendance records for this group and selected week.
        const groupWeekAttendance = weekAttendance.filter((rec) => (
          rec.groupId === group.id ||
          rec.groupName === groupName ||
          rec.group === groupName
        ));

        // Each volunteer with their weekly status.
        const HEBREW_WEEKDAYS = [
          'יום ראשון',
          'יום שני',
          'יום שלישי',
          'יום רביעי',
          'יום חמישי',
          'יום שישי',
          'יום שבת'
        ];

        const people = groupVolunteers
          .map((vol) => {
            const weeklyStatus = {};
            // The latest record per day (or null) — kept so a cell edit can reuse
            // its real document id instead of creating a duplicate.
            const weeklyRecords = {};
            weekDaysKeys.forEach((dKey, index) => {
              const dayObj = weekDays[index];
              const dayName = HEBREW_WEEKDAYS[dayObj.getDay()];
              const isScheduledDay = !vol.day || vol.day.trim() === '' || vol.day.trim() === dayName;

              const recs = groupWeekAttendance.filter((r) => r.volunteerId === vol.id && r.dateKey === dKey);
              if (recs.length > 0) {
                // Get the latest record if duplicates exist.
                let latestRec = recs[0];
                recs.forEach((r) => {
                  const rTime = r.date?.toDate?.()?.getTime() || new Date(r.date).getTime() || 0;
                  const curTime = latestRec.date?.toDate?.()?.getTime() || new Date(latestRec.date).getTime() || 0;
                  if (rTime > curTime) {
                    latestRec = r;
                  }
                });
                const norm = normalizeAttendanceStatus(getRecordStatus(latestRec));
                weeklyStatus[dKey] = norm === 'present' ? 'present' : norm === 'absent' ? 'absent' : 'unmarked';
                weeklyRecords[dKey] = latestRec;
              } else {
                weeklyStatus[dKey] = isScheduledDay ? 'unmarked' : 'not-scheduled';
                weeklyRecords[dKey] = null;
              }
            });
            return {
              id: vol.id,
              name: getName(vol),
              // The canonical name field, written onto a one-time record.
              volunteerName: vol.name || getName(vol),
              day: vol.day || '',
              weeklyStatus,
              weeklyRecords,
            };
          })
          .sort((a, b) => a.name.localeCompare(b.name, 'he'));

        // Calculate this week's present / absent / unmarked marks for the group.
        let totalPresent = 0;
        let totalAbsent = 0;
        let totalUnmarked = 0;
        people.forEach((person) => {
          Object.values(person.weeklyStatus).forEach((status) => {
            if (status === 'present') totalPresent++;
            else if (status === 'absent') totalAbsent++;
            else if (status === 'unmarked') totalUnmarked++;
          });
        });

        return {
          id: group.id,
          groupName,
          guideName,
          total: people.length,
          totalPresent,
          totalAbsent,
          totalUnmarked,
          people,
        };
      })
      .sort((a, b) => a.groupName.localeCompare(b.groupName, 'he'));
  }, [groups, volunteers, weekAttendance, weekDays, weekDaysKeys]);

  // Find the selected group details from the latest computed groupRows.
  const activeSelectedGroup = useMemo(() => {
    if (!selectedGroup) return null;
    return groupRows.find((r) => r.id === selectedGroup.id);
  }, [selectedGroup, groupRows]);

  // Write (or clear) a single attendance cell — this is how an admin records a
  // one-time visit on a day that isn't the volunteer's fixed day. `choice` is
  // 'present' | 'absent' | 'clear'. We reuse an existing record's real id (so an
  // edit never creates a duplicate) and update local state in place.
  const handleCellChoice = async (person, dayKey, choice) => {
    if (!activeSelectedGroup) {
      return;
    }

    const cellKey = `${person.id}|${dayKey}`;
    const existingRecord = person.weeklyRecords[dayKey];

    // Nothing to do: "clear" on an already-empty cell.
    if (choice === 'clear' && !existingRecord) {
      setOpenCellKey(null);
      return;
    }

    setSavingCellKey(cellKey);

    try {
      if (choice === 'clear') {
        // Remove the existing record (by its real id) and drop it from state.
        await deleteDoc(doc(db, 'attendance', existingRecord.id));
        setAttendance((current) => current.filter((record) => record.id !== existingRecord.id));
      } else {
        // Reuse the existing id when editing; otherwise the canonical id.
        const attendanceId = existingRecord
          ? existingRecord.id
          : buildAttendanceId(activeSelectedGroup.id, dayKey, person.id);

        // The full, well-typed record (same 8 fields the guide flow writes).
        const payload = {
          groupId: activeSelectedGroup.id,
          group: activeSelectedGroup.groupName,
          groupName: activeSelectedGroup.groupName,
          date: dateFromDayKey(dayKey),
          dateKey: dayKey,
          status: choice === 'present',
          volunteerId: person.id,
          volunteerName: person.volunteerName,
        };

        await setDoc(doc(db, 'attendance', attendanceId), payload);

        // Replace any record with this id, then add the new one.
        setAttendance((current) => [
          ...current.filter((record) => record.id !== attendanceId),
          { id: attendanceId, ...payload },
        ]);
      }
    } catch (error) {
      console.error('שגיאה בשמירת נוכחות חד-פעמית:', error);
      window.alert('אירעה שגיאה בשמירת הנוכחות. נסו שוב.');
    } finally {
      setSavingCellKey(null);
      setOpenCellKey(null);
    }
  };

  // Apply the search filter.
  const visibleGroups = useMemo(() => {
    const text = search.trim().toLowerCase();
    if (!text) return groupRows;
    return groupRows.filter((group) => (
      group.groupName.toLowerCase().includes(text) ||
      group.guideName.toLowerCase().includes(text)
    ));
  }, [groupRows, search]);

  const goToPrevWeek = () => {
    setCurrentWeekStart((prev) => {
      const d = new Date(prev);
      d.setDate(prev.getDate() - 7);
      return d;
    });
  };

  const goToNextWeek = () => {
    setCurrentWeekStart((prev) => {
      const d = new Date(prev);
      d.setDate(prev.getDate() + 7);
      return d;
    });
  };

  const goToCurrentWeek = () => {
    setCurrentWeekStart(getStartOfWeek(new Date()));
  };

  // View 2: Dedicated Weekly Attendance Table Review for Selected Group
  if (activeSelectedGroup) {
    // Reuse the totals already computed per group, so this view and the list
    // count identically. "Unmarked" counts only days the volunteer is scheduled
    // for — days they're NOT scheduled ('not-scheduled') are never counted.
    const presentCount = activeSelectedGroup.totalPresent;
    const absentCount = activeSelectedGroup.totalAbsent;
    const unmarkedCount = activeSelectedGroup.totalUnmarked;
    const volunteerCount = activeSelectedGroup.people.length;

    return (
      <div className="adm-att" dir="rtl">
        <section className="adm-att-review-card">
          <header className="adm-att-review-head">
            <div className="adm-att-title-block">
              <span className="adm-att-eyebrow">מעקב שבועי</span>
              <h2>נוכחות {activeSelectedGroup.groupName}</h2>
              <p>מדריך/ה: {activeSelectedGroup.guideName}</p>
            </div>

            <button type="button" className="adm-att-back-btn" onClick={() => setSelectedGroup(null)}>
              חזרה לרשימה
            </button>
          </header>

          <div className="adm-att-top-grid">
            <div className="adm-att-week-switcher" aria-label="ניווט שבוע">
              <button type="button" className="week-nav-btn" onClick={goToNextWeek}>
                שבוע הבא
              </button>
              <div className="adm-att-week-label">
                <span>השבוע</span>
                {/* Force this range to read left-to-right: start date (21) on the
                    left, end date (26) on the right. Inside the RTL screen the two
                    date tokens would otherwise swap places and read backwards. */}
                <strong dir="ltr">{getWeekRangeLabel(currentWeekStart)}</strong>
              </div>
              <button type="button" className="week-nav-today-btn" onClick={goToCurrentWeek}>
                הנוכחי
              </button>
              <button type="button" className="week-nav-btn" onClick={goToPrevWeek}>
                קודם
              </button>
            </div>

            <div className="adm-att-summary-row" aria-label="סיכום נוכחות שבועי">
              <div className="adm-att-stat-tile is-volunteers">
                <span>{volunteerCount}</span>
                <p>מתנדבים</p>
              </div>
              <div className="adm-att-stat-tile is-present">
                <span>{presentCount}</span>
                <p>נוכחים</p>
              </div>
              <div className="adm-att-stat-tile is-absent">
                <span>{absentCount}</span>
                <p>חסרים</p>
              </div>
              <div className="adm-att-stat-tile is-unmarked">
                <span>{unmarkedCount}</span>
                <p>לא סומנו</p>
              </div>
            </div>
          </div>

          <div className="adm-att-legend" aria-label="מקרא">
            <span><i className="adm-week-dot is-present" /> נוכח</span>
            <span><i className="adm-week-dot is-absent" /> חסר</span>
            <span><i className="adm-week-dot is-unmarked" /> לא סומן</span>
            <span><span style={{ fontSize: '15px', fontWeight: '800', marginInlineEnd: '3px' }}>—</span> לא משובץ ליום זה</span>
          </div>

          <div className="adm-week-board">
            <div className="adm-week-grid adm-week-grid-head">
              <div className="adm-week-person-head">מתנדב</div>
              {weekDays.map((day) => {
                const dKey = getDayKey(day);
                const dayName = day.toLocaleDateString('he-IL', { weekday: 'short' }).replace('יום ', '');
                // Full date as DD-MM-YYYY (from the canonical dateKey), not "23.6".
                const dateStr = formatDateOnlyForDisplay(dKey);

                return (
                  <div className="adm-week-day-head" key={dKey}>
                    <span>{dayName}</span>
                    <small>{dateStr}</small>
                  </div>
                );
              })}
            </div>

            <div className="adm-week-body">
              {activeSelectedGroup.people.length > 0 ? (
                activeSelectedGroup.people.map((person) => (
                  <div className="adm-week-grid adm-week-row" key={person.id}>
                    <div className="adm-week-person" style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', justifyContent: 'center' }}>
                      <span style={{ fontWeight: '700' }}>{person.name}</span>
                      {person.day && (
                        <small style={{ color: 'var(--brand-600)', fontSize: '10px', fontWeight: '700', marginTop: '1px' }}>
                          {person.day}
                        </small>
                      )}
                    </div>
                    {weekDaysKeys.map((dKey) => {
                      const status = person.weeklyStatus[dKey];
                      const cellKey = `${person.id}|${dKey}`;
                      const isMenuOpen = openCellKey === cellKey;
                      const isSavingCell = savingCellKey === cellKey;

                      return (
                        <div className={`adm-week-cell ${isMenuOpen ? 'is-editing' : ''}`} key={dKey}>
                          {/* The cell is a button: tapping it opens a tiny editor
                              so an admin can record a one-time visit (or fix a
                              mark) on any day — including days the volunteer
                              isn't normally scheduled. */}
                          <button
                            type="button"
                            className="adm-week-cell-btn"
                            onClick={() => setOpenCellKey(isMenuOpen ? null : cellKey)}
                            title={getStatusLabel(status)}
                            aria-label={`${person.name} — ${getStatusLabel(status)}. עריכת נוכחות`}
                            disabled={isSavingCell}
                          >
                            {status === 'not-scheduled' ? (
                              <span className="adm-week-not-scheduled">—</span>
                            ) : (
                              <span className={`adm-week-dot is-${status}`} />
                            )}
                          </button>

                          {/* The editor: present / absent / clear. */}
                          {isMenuOpen && (
                            <div className="adm-week-cell-menu" role="menu">
                              <button type="button" className="is-present" onClick={() => handleCellChoice(person, dKey, 'present')} disabled={isSavingCell}>
                                נוכח
                              </button>
                              <button type="button" className="is-absent" onClick={() => handleCellChoice(person, dKey, 'absent')} disabled={isSavingCell}>
                                חסר
                              </button>
                              <button type="button" className="is-clear" onClick={() => handleCellChoice(person, dKey, 'clear')} disabled={isSavingCell}>
                                ניקוי
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ))
              ) : (
                <div className="adm-att-empty-row">
                  אין מתנדבים בקבוצה זו.
                </div>
              )}
            </div>
          </div>
        </section>
        </div>
    );
  }

  // View 1: Group Selection List View

  // Groups that have at least one absence this week, and the total number of
  // absences — used to surface a shortage at the top, where it can't be missed.
  const groupsWithAbsence = visibleGroups.filter((group) => group.totalAbsent > 0);
  const totalAbsenceCount = groupsWithAbsence.reduce((sum, group) => sum + group.totalAbsent, 0);

  return (
    <section className="adm-att" dir="rtl" aria-label="מעקב נוכחות">

      {/* Title block */}
      <div className="adm-att-title-block">
        <div className="adm-att-eyebrow">מערכת ניהול</div>
        <h1 className="adm-att-title">מעקב נוכחות</h1>
        <p className="adm-att-subtitle">בחר קבוצה להצגת טבלת נוכחות שבועית מלאה.</p>
      </div>

      {/* Shortage alert — a loud, hard-to-miss banner when any group has a
          missing volunteer this week. Hidden entirely when attendance is full. */}
      {!loading && groupsWithAbsence.length > 0 && (
        <div className="adm-att-shortage-banner" role="status">
          <span className="adm-att-shortage-icon" aria-hidden="true">⚠</span>
          <span className="adm-att-shortage-text">
            חוסר בנוכחות: {totalAbsenceCount} חסרים ב־{groupsWithAbsence.length} קבוצות השבוע
          </span>
        </div>
      )}

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

      {/* Loading / empty / the group card grid. */}
      {loading ? (
        <div className="adm-att-empty">טוען נתונים...</div>
      ) : visibleGroups.length === 0 ? (
        <div className="adm-att-empty">אין קבוצות להצגה.</div>
      ) : (
        <>
          {/* Desktop layout: one compact table row per group, so most groups
              fit on a single screen. Clicking a row opens that group's weekly
              attendance table (same action the cards had). */}
          <div className="adm-att-table-wrap">
            <table className="adm-att-table">
              <thead>
                <tr>
                  <th>קבוצה</th>
                  <th>מדריך/ה</th>
                  <th>מתנדבים</th>
                  <th>נוכחים</th>
                  <th>חסרים</th>
                  <th>לא סומנו</th>
                </tr>
              </thead>
              <tbody>
                {visibleGroups.map((group) => (
                  <tr
                    key={group.id}
                    className={`adm-att-row ${group.totalAbsent > 0 ? 'has-absence' : ''}`}
                    onClick={() => setSelectedGroup(group)}
                    onKeyDown={(event) => {
                      // The row acts as a button: Enter or Space opens the group.
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        setSelectedGroup(group);
                      }
                    }}
                    tabIndex={0}
                    role="button"
                    aria-label={`פתח נוכחות שבועית עבור ${group.groupName}`}
                  >
                    <td className="adm-att-cell-name">{group.groupName}</td>
                    <td className="adm-att-cell-guide">{group.guideName}</td>
                    <td className="adm-att-cell-num">{group.total}</td>
                    <td className="adm-att-cell-num is-present">{group.totalPresent}</td>
                    <td className={`adm-att-cell-num is-absent ${group.totalAbsent > 0 ? 'is-flagged' : ''}`}>
                      {group.totalAbsent > 0 && <span className="adm-att-absent-flag" aria-hidden="true">⚠</span>}
                      {group.totalAbsent}
                    </td>
                    <td className="adm-att-cell-num is-unmarked">{group.totalUnmarked}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile layout: the existing cards (one per row) — left unchanged. */}
          <div className="adm-att-grid">
            {visibleGroups.map((group) => (
              <button
                key={group.id}
                type="button"
                className={`adm-att-group-card ${group.totalAbsent > 0 ? 'has-absence' : ''}`}
                onClick={() => setSelectedGroup(group)}
              >
                <div className="adm-att-group-info">
                  <div className="adm-att-group-main">
                    <span className="adm-att-group-name">{group.groupName}</span>
                    <span className="adm-att-volunteers-count">{group.total} מתנדבים</span>
                  </div>
                  <span className="adm-att-group-guide">מדריך/ה: {group.guideName}</span>
                </div>

                {/* This week's attendance breakdown for the group. The absence
                    chip is flagged with a ⚠ when there's a shortage. */}
                <div className="adm-att-group-stats">
                  <span className="adm-att-stat-chip is-present">{group.totalPresent} נוכחים</span>
                  <span className={`adm-att-stat-chip is-absent ${group.totalAbsent > 0 ? 'is-flagged' : ''}`}>
                    {group.totalAbsent > 0 && '⚠ '}{group.totalAbsent} חסרים
                  </span>
                  <span className="adm-att-stat-chip is-unmarked">{group.totalUnmarked} לא סומנו</span>
                </div>
              </button>
            ))}
          </div>
        </>
      )}
    </section>
  );
}

export default AdminAttendance;
