// AttendanceScreen — mark and save TODAY'S attendance for a group's volunteers.
// The group can be chosen from a dropdown, or locked to one group when opened
// from the guide dashboard. Only the current day is shown and editable —
// previous days are never displayed, so a guide cannot change past records.

// React hooks for state, effects, memoization, stable callbacks and refs.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

// Firestore helpers. Each attendance change is an INDEPENDENT setDoc/deleteDoc
// (no writeBatch — a batch evaluates the per-volunteer Rules for every document
// in one request and hits the document-access limit); deterministic ids keep a
// create idempotent. Reads are GROUP-SCOPED: a locked (guide) screen reads only
// its one group via getDoc, and volunteers/attendance are queried by groupId.
import { collection, deleteDoc, doc, getDoc, getDocs, query, setDoc, where } from 'firebase/firestore';

// Our Firestore database instance.
import { db } from '../../firebase';

// Shared display-name helper.
import { getDisplayName } from '../../utils/people';

// Saturday is not an activity day — used to block attendance on Saturdays.
import { isSaturdayDateValue } from '../../utils/activityDays';

// Canonical attendance-day key + Hebrew weekday, both resolved in Asia/Jerusalem.
import { getJerusalemDateKey, getJerusalemWeekdayName } from '../../utils/dateKey';

// Display formatter for the day-only heading (DD-MM-YYYY).
import { formatDateOnlyForDisplay } from '../../utils/dateDisplay';

// Bounded-concurrency runner (independent writes, never a writeBatch).
import { runWithConcurrency } from '../../utils/concurrency';

// Pure attendance-write planning + result reconciliation. attendanceStateFromRecord
// maps a saved record to its 'present' | 'absent' | 'unmarked' toggle state.
import { attendanceStateFromRecord, buildAttendanceOperations, reconcileAttendanceResults } from '../../utils/attendanceWriter';

// Stale-result guard for the volunteer/attendance load.
import { createRequestGuard } from '../../utils/requestGuard';

// Styles for this screen.
import './AttendanceScreen.css';


// A volunteer's display name (this screen's fallback wording).
const getVolunteerName = (volunteer) => getDisplayName(volunteer, 'מתנדב ללא שם');


// First character of a name, used for the round avatar.
function getInitial(name) {
  const trimmed = (name || '').trim();
  return trimmed ? trimmed[0] : '?';
}


function AttendanceScreen({ initialGroupId = '', initialGroupName = '', lockGroup = false, onBack }) {
  // The available groups.
  const [groups, setGroups] = useState([]);

  // The currently selected group (id + name).
  const [selectedGroupId, setSelectedGroupId] = useState(initialGroupId);
  const [selectedGroupName, setSelectedGroupName] = useState(initialGroupName);

  // The selected group's volunteers.
  const [volunteers, setVolunteers] = useState([]);

  // Today's already-saved attendance records (at most one per volunteer).
  const [attendanceRecords, setAttendanceRecords] = useState([]);

  // The current marking choice per volunteer: 'present' | 'absent' | 'unmarked'.
  const [marks, setMarks] = useState({});
  const [hasEditedMarks, setHasEditedMarks] = useState(false);
  const [touchedVolunteerIds, setTouchedVolunteerIds] = useState({});

  // True while volunteers load; true while a save is in flight.
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  // Brief "saved" confirmation flag.
  const [justSaved, setJustSaved] = useState(false);

  // Refs for the day-rollover listener, so it doesn't re-subscribe on every edit
  // and doesn't fire twice for the same rollover (focus + visibilitychange).
  const hasEditedRef = useRef(false);
  const handledDayKeyRef = useRef('');

  // True while a save is in flight (synchronous mirror of `saving`), so handlers
  // bail out immediately even if called directly during a save.
  const savingRef = useRef(false);

  // Set when a day rollover is detected DURING a save — handled once the save
  // finishes (we never reset the screen mid-write).
  const pendingRolloverRef = useRef(false);

  // Guards the volunteer/attendance load against stale (superseded) responses.
  const loadGuardRef = useRef(createRequestGuard());

  // The "${canonicalGroupId}|${loadedDateKey}" context that was successfully
  // loaded. Empty until a load completes; reset on every group / day change.
  // Marking + saving require it to match the current group + day.
  const loadedContextRef = useRef('');

  // The instant the screen loaded its day from. Kept as STATE (not useMemo([]))
  // so it can be reset to reload the new day after the clock rolls past midnight.
  const [loadedInstant, setLoadedInstant] = useState(() => new Date());

  // The loaded activity day, resolved in Asia/Jerusalem — the canonical dateKey
  // every record is keyed by (NOT the process/browser timezone).
  const loadedDateKey = useMemo(() => getJerusalemDateKey(loadedInstant), [loadedInstant]);

  // Saturday is not an activity day — marking is blocked (screen stays open).
  const isSaturday = useMemo(() => isSaturdayDateValue(loadedDateKey), [loadedDateKey]);

  // The Hebrew weekday of the loaded day, resolved in Asia/Jerusalem. Drives both
  // the "scheduled today" filter and the heading (never getDay() of local time).
  const loadedWeekday = useMemo(() => getJerusalemWeekdayName(loadedInstant), [loadedInstant]);

  // The loaded day for the heading: "יום ראשון, 14-06-2026" — Jerusalem weekday
  // plus the day-only date as DD-MM-YYYY (no timezone-naive locale call).
  const todayLabel = useMemo(() => {
    const dateLabel = formatDateOnlyForDisplay(loadedDateKey);
    if (loadedWeekday && dateLabel) {
      return `${loadedWeekday}, ${dateLabel}`;
    }
    return dateLabel || loadedWeekday;
  }, [loadedWeekday, loadedDateKey]);

  // The full group object matching the current selection.
  // The canonical group object is resolved STRICTLY by id — never by name — so
  // two groups sharing a groupName can never change which group is selected.
  const selectedGroup = useMemo(() => (
    selectedGroupId ? groups.find((group) => group.id === selectedGroupId) || null : null
  ), [groups, selectedGroupId]);

  // The canonical group document id — NEVER a name fallback. Empty when the
  // selection can't be resolved to a real group document (then saving is blocked).
  const canonicalGroupId = useMemo(() => selectedGroup?.id || '', [selectedGroup]);

  // The canonical group name, from the group document. `groupName` is what every
  // group writer sets; `name` is only a defensive fallback.
  const canonicalGroupName = useMemo(() => selectedGroup?.groupName || selectedGroup?.name || '', [selectedGroup]);

  // The group name to show in the header (display only).
  const activeGroupName = selectedGroup?.groupName || selectedGroup?.name || selectedGroupName;

  // Load the groups that back the screen.
  //
  // A LOCKED (guide) screen reads ONLY its one assigned group document — never
  // the whole groups collection — and fails closed (empty) when the id is
  // missing or the document doesn't exist. There is no fallback to loading all
  // groups. An unlocked (admin / viewer) screen still loads the full list for
  // the picker.
  const fetchGroups = useCallback(async () => {
    try {
      if (lockGroup) {
        // No id to lock onto: nothing to load (fail closed).
        if (!initialGroupId) {
          setGroups([]);
          return;
        }

        // Read just this one group document.
        const groupSnap = await getDoc(doc(db, 'groups', initialGroupId));

        // Missing document: fail closed — do NOT widen to the whole collection.
        if (!groupSnap.exists()) {
          setGroups([]);
          return;
        }

        setGroups([{ id: groupSnap.id, ...groupSnap.data() }]);
        return;
      }

      // Admin / viewer path: the full live list backs the picker (unchanged).
      const snapshot = await getDocs(collection(db, 'groups'));
      const groupsData = snapshot.docs.map((documentSnapshot) => ({
        id: documentSnapshot.id,
        ...documentSnapshot.data(),
      }));

      setGroups(groupsData);
    } catch (error) {
      console.error('Error loading groups:', error);
    }
  }, [lockGroup, initialGroupId]);

  // Load the selected group's volunteers, pre-filled with today's saved marks.
  const fetchVolunteersByGroup = useCallback(async () => {
    // Claim this load's id BEFORE anything else, so even the "no group" path
    // supersedes any older in-flight load.
    const requestId = loadGuardRef.current.next();
    const requestContext = `${canonicalGroupId}|${loadedDateKey}`;

    // No canonical group resolved: clear and stop.
    if (!canonicalGroupId) {
      setVolunteers([]);
      setAttendanceRecords([]);
      setLoading(false);
      return;
    }

    setLoading(true);

    try {
      // Fetch volunteers and today's attendance in parallel — BOTH scoped to the
      // canonical group on the SERVER (where('groupId', ...)), not just filtered
      // in the browser. The guide read Rules require this: an unscoped query, or
      // an attendance query by dateKey alone, would be denied.
      const [volunteersSnap, attendanceSnap] = await Promise.all([
        getDocs(query(
          collection(db, 'volunteers'),
          where('groupId', '==', canonicalGroupId),
        )),
        getDocs(query(
          collection(db, 'attendance'),
          where('groupId', '==', canonicalGroupId),
          where('dateKey', '==', loadedDateKey),
        )),
      ]);

      // A newer load superseded this one while awaiting — drop the stale result.
      if (!loadGuardRef.current.isCurrent(requestId)) {
        return;
      }

      // The loaded weekday, resolved in Asia/Jerusalem (never getDay() of local).
      const todayHebrewDay = getJerusalemWeekdayName(loadedInstant);

      // Marking list: volunteers of THIS group by canonical groupId ONLY (never
      // by group name), scheduled for the loaded weekday.
      const volunteersData = volunteersSnap.docs
        .map((documentSnapshot) => ({ id: documentSnapshot.id, ...documentSnapshot.data() }))
        .filter((volunteer) => volunteer.groupId === canonicalGroupId)
        .filter((volunteer) => {
          if (volunteer.day && volunteer.day.trim() !== '') {
            return volunteer.day.trim() === todayHebrewDay;
          }
          return true;
        });

      // Today's saved records for THIS group (by canonical groupId), so an
      // existing record's real document id can be reused on update / delete.
      const attendanceData = attendanceSnap.docs
        .map((documentSnapshot) => ({ id: documentSnapshot.id, ...documentSnapshot.data() }))
        .filter((record) => record.groupId === canonicalGroupId);

      setVolunteers(volunteersData);
      setAttendanceRecords(attendanceData);
      // Record the successfully-loaded context (group + day).
      loadedContextRef.current = requestContext;
    } catch (error) {
      // Only the current (non-superseded) load reports a failure.
      if (loadGuardRef.current.isCurrent(requestId)) {
        console.error('Error loading volunteers and attendance:', error);
        alert('אירעה שגיאה בטעינת הנתונים');
      }
    } finally {
      // Only the current load clears the loading flag.
      if (loadGuardRef.current.isCurrent(requestId)) {
        setLoading(false);
      }
    }
  }, [canonicalGroupId, loadedDateKey, loadedInstant]);

  // Load the groups once on mount.
  useEffect(() => {
    fetchGroups();
  }, [fetchGroups]);

  // Reload volunteers whenever the selected group (or loaded day) changes.
  useEffect(() => {
    fetchVolunteersByGroup();
  }, [fetchVolunteersByGroup]);

  // Update the selection when the dropdown changes.
  const handleGroupChange = (event) => {
    // Don't switch group while a save is in flight.
    if (savingRef.current) {
      return;
    }

    const groupId = event.target.value;

    // Re-selecting the same group is a no-op.
    if (groupId === selectedGroupId) {
      return;
    }

    // Confirm before discarding unsaved marks; a cancel leaves everything as is.
    if (hasEditedRef.current) {
      const confirmed = window.confirm('יש סימוני נוכחות שלא נשמרו. מעבר לקבוצה אחרת ימחק אותם. להמשיך?');
      if (!confirmed) {
        return;
      }
    }

    const group = groups.find((item) => item.id === groupId);

    // Cancel any in-flight load and drop stale data, marks and context BEFORE
    // switching. Show the loading state only for a real (resolvable) group.
    loadGuardRef.current.invalidate();
    loadedContextRef.current = '';
    setVolunteers([]);
    setAttendanceRecords([]);
    setMarks({});
    setTouchedVolunteerIds({});
    setHasEditedMarks(false);
    hasEditedRef.current = false;
    setJustSaved(false);
    setLoading(Boolean(groupId && group));

    setSelectedGroupId(groupId);
    setSelectedGroupName(group?.groupName || group?.name || groupId);
  };

  // volunteerId -> today's saved record (keeping the latest if duplicates exist).
  const savedByVolunteer = useMemo(() => {
    const map = {};

    attendanceRecords.forEach((record) => {
      const volunteerId = record.volunteerId;
      if (!volunteerId) {
        return;
      }

      // Keep the most recent record if somehow more than one exists.
      const current = map[volunteerId];
      const recordTime = record.date?.toDate?.()?.getTime() || new Date(record.date).getTime() || 0;
      const currentTime = current?.date?.toDate?.()?.getTime() || new Date(current?.date).getTime() || 0;

      if (!current || recordTime > currentTime) {
        map[volunteerId] = record;
      }
    });

    return map;
  }, [attendanceRecords]);

  // Keep the latest saved-records map in a ref, so the marks initializer can read
  // it WITHOUT re-running every time attendanceRecords changes mid-session (which
  // would wipe a guide's in-progress / partial-retry marks). The initializer
  // below depends ONLY on `volunteers` — i.e. a fresh load — and reads this ref.
  const savedByVolunteerRef = useRef(savedByVolunteer);
  useEffect(() => {
    savedByVolunteerRef.current = savedByVolunteer;
  }, [savedByVolunteer]);

  // On a fresh volunteer load, PRE-FILL each toggle from today's already-saved
  // record, so a guide returning to the screen (e.g. after a reload) sees what
  // they marked. A volunteer with no saved record starts 'unmarked'. These
  // pre-filled marks are NOT treated as edits (hasEditedMarks stays false and
  // nothing is touched), so nothing is re-written until the guide actively
  // changes a mark — no duplicate writes.
  useEffect(() => {
    const saved = savedByVolunteerRef.current;
    const initial = {};
    volunteers.forEach((volunteer) => {
      initial[volunteer.id] = attendanceStateFromRecord(saved[volunteer.id]);
    });
    setMarks(initial);
    setHasEditedMarks(false);
    setTouchedVolunteerIds({});
  }, [volunteers]);

  // Centralized day-change reset: drop unsaved marks, reset every flag + ref
  // (synchronously where a ref is involved) and reload the new day. Shows at most
  // one alert, and only when there were unsaved marks AND notifyUnsaved is true.
  const resetForDayChange = useCallback((now, { notifyUnsaved = true } = {}) => {
    const key = getJerusalemDateKey(now);
    const hadUnsavedMarks = hasEditedRef.current;

    // Cancel any in-flight load and drop stale data + context; the new-day load
    // (triggered by the loadedInstant change) will refill them.
    loadGuardRef.current.invalidate();
    loadedContextRef.current = '';
    setVolunteers([]);
    setAttendanceRecords([]);
    setLoading(true);

    setMarks({});
    setTouchedVolunteerIds({});
    setHasEditedMarks(false);
    hasEditedRef.current = false;
    setJustSaved(false);
    handledDayKeyRef.current = key;
    setLoadedInstant(now);

    if (notifyUnsaved && hadUnsavedMarks) {
      window.alert('התאריך השתנה. הסימונים שלא נשמרו נמחקו כדי שלא יירשמו ביום הלא נכון.');
    }
  }, []);

  // Keep the rollover listener's view of "unsaved edits" current (so it doesn't
  // need hasEditedMarks in its dependency list).
  useEffect(() => {
    hasEditedRef.current = hasEditedMarks;
  }, [hasEditedMarks]);

  // Track the loaded day, so the rollover check has a baseline to compare against.
  useEffect(() => {
    handledDayKeyRef.current = loadedDateKey;
  }, [loadedDateKey]);

  // Auto-detect a Jerusalem day rollover (e.g. Saturday→Sunday) even without a
  // save click: on window focus, when the tab becomes visible again, and on a
  // gentle 60s timer. On a rollover we NEVER write — we drop any unsaved marks
  // (so they can't be recorded on the wrong day) and reload the new day.
  useEffect(() => {
    const handleRollover = () => {
      const now = new Date();
      const currentKey = getJerusalemDateKey(now);
      if (!currentKey || currentKey === handledDayKeyRef.current) {
        return;
      }

      // Never reset the screen in the middle of a save — defer until it finishes.
      if (savingRef.current) {
        pendingRolloverRef.current = true;
        return;
      }

      resetForDayChange(now);
    };

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        handleRollover();
      }
    };

    window.addEventListener('focus', handleRollover);
    document.addEventListener('visibilitychange', handleVisibility);
    const intervalId = window.setInterval(handleRollover, 60000);

    return () => {
      window.removeEventListener('focus', handleRollover);
      document.removeEventListener('visibilitychange', handleVisibility);
      window.clearInterval(intervalId);
    };
  }, [resetForDayChange]);

  // On unmount, invalidate the in-flight load so a late response can't update
  // state after the component is gone.
  useEffect(() => () => {
    loadGuardRef.current.invalidate();
  }, []);

  // Toggle a volunteer's status; clicking the active one clears it.
  const handleStatusSelect = (volunteerId, statusType) => {
    // No marking while saving / loading / on Saturday, or when the shown data is
    // for a different group or day than the current context (stale).
    if (savingRef.current || loading || isSaturday) {
      return;
    }
    if (loadedContextRef.current !== `${canonicalGroupId}|${loadedDateKey}`) {
      return;
    }

    hasEditedRef.current = true;
    setHasEditedMarks(true);
    setTouchedVolunteerIds((prev) => ({ ...prev, [volunteerId]: true }));
    setMarks((prev) => {
      const current = prev[volunteerId] || 'unmarked';
      const next = current === statusType ? 'unmarked' : statusType;
      return { ...prev, [volunteerId]: next };
    });
  };

  const handleMarkAllPresent = () => {
    // No marking while saving / loading / on Saturday, or on a stale context.
    if (savingRef.current || loading || isSaturday) {
      return;
    }
    if (loadedContextRef.current !== `${canonicalGroupId}|${loadedDateKey}`) {
      return;
    }

    hasEditedRef.current = true;
    setHasEditedMarks(true);
    const touched = {};
    volunteers.forEach((volunteer) => {
      touched[volunteer.id] = true;
    });
    setTouchedVolunteerIds(touched);
    setMarks((prev) => {
      const next = { ...prev };
      volunteers.forEach((volunteer) => {
        next[volunteer.id] = 'present';
      });
      return next;
    });
  };

  // Live counts for the summary bar.
  let presentCount = 0;
  let absentCount = 0;
  let unmarkedCount = 0;
  volunteers.forEach((volunteer) => {
    const state = marks[volunteer.id] || 'unmarked';
    if (state === 'present') {
      presentCount++;
    } else if (state === 'absent') {
      absentCount++;
    } else {
      unmarkedCount++;
    }
  });
  const allMarkedPresent = volunteers.length > 0 && presentCount === volunteers.length;

  // Perform ONE attendance change as an independent Firestore request.
  const executeOperation = (operation) => {
    const ref = doc(db, 'attendance', operation.attendanceId);
    if (operation.type === 'delete') {
      return deleteDoc(ref);
    }
    return setDoc(ref, operation.payload);
  };

  // Save today's marks. Each changed volunteer is written as its OWN request
  // (bounded concurrency) — NOT one writeBatch — so a group of any size can be
  // saved without hitting the per-request Rules document-access limit. Partial
  // failures are surfaced and only the failures are kept for the next attempt.
  const handleSaveAttendance = async () => {
    // Prevent re-entry while a save is already in flight.
    if (savingRef.current) {
      return;
    }

    // Fail closed without a canonical group id; never write on Saturday.
    if (!canonicalGroupId) {
      alert('שגיאה: לא נמצא מזהה קבוצה קנוני. לא ניתן לשמור נוכחות.');
      return;
    }
    if (isSaturday) {
      return;
    }
    if (!hasEditedMarks) {
      alert('יש לסמן נוכחות לפני שמירה');
      return;
    }

    // The shown data must be for the current group + day (not a stale load).
    if (loadedContextRef.current !== `${canonicalGroupId}|${loadedDateKey}`) {
      alert('הנתונים עדיין נטענים. נסו שוב בעוד רגע.');
      return;
    }

    // One instant for the whole save; its Asia/Jerusalem day must still match the
    // loaded day — otherwise the clock crossed midnight and we must not record
    // today's marks on a different day.
    const saveInstant = new Date();
    const currentDateKey = getJerusalemDateKey(saveInstant);

    if (!currentDateKey) {
      alert('שגיאה: לא ניתן לחשב את תאריך היום. לא נשמר דבר.');
      return;
    }

    if (currentDateKey !== loadedDateKey) {
      // The day already rolled over BEFORE any write — reset to the new day
      // (resetForDayChange shows the single "date changed" alert).
      resetForDayChange(saveInstant);
      return;
    }

    // Plan every operation up front (no writes yet); an identity mismatch aborts
    // the whole save before anything is written.
    const planned = buildAttendanceOperations({
      volunteers,
      marks,
      touchedVolunteerIds,
      savedByVolunteer,
      canonicalGroupId,
      canonicalGroupName,
      dateKey: currentDateKey,
      saveInstant,
    });

    if (!planned.ok) {
      alert(planned.error);
      return;
    }

    const { operations } = planned;

    // Nothing actually changed (e.g. toggled back) — clear and confirm.
    if (operations.length === 0) {
      setHasEditedMarks(false);
      hasEditedRef.current = false;
      setTouchedVolunteerIds({});
      setJustSaved(true);
      window.setTimeout(() => setJustSaved(false), 2500);
      return;
    }

    savingRef.current = true;
    pendingRolloverRef.current = false;
    setSaving(true);
    try {
      // Independent writes, at most 5 in flight; runWithConcurrency never throws.
      const results = await runWithConcurrency(operations, 5, executeOperation);
      const reconciled = reconcileAttendanceResults(operations, results, attendanceRecords);
      const total = operations.length;

      // The day may have rolled over DURING the writes — detected either by the
      // listener (pendingRolloverRef) OR by comparing the finished instant's
      // Jerusalem day to the loaded day (covers the case with no focus/timer).
      const finishedAt = new Date();
      const finishedDateKey = getJerusalemDateKey(finishedAt);
      const dayChanged = pendingRolloverRef.current || finishedDateKey !== loadedDateKey;

      if (dayChanged) {
        // The writes applied to the SAVED (previous) day; do NOT apply that day's
        // records to the new-day screen. Report, then reset once to the new day.
        if (reconciled.failedCount === 0) {
          alert('הנוכחות נשמרה ליום הקודם. המסך עבר ליום החדש.');
        } else if (reconciled.succeededCount === 0) {
          const code = reconciled.failed[0]?.reason?.code;
          alert(`לא נשמר אף סימון, והתאריך השתנה. הסימונים לא הועברו ליום החדש.${code ? ` (קוד: ${code})` : ''}`);
        } else {
          alert(`נשמרו ${reconciled.succeededCount} מתוך ${total} סימונים. ${reconciled.failedCount} לא נשמרו, והתאריך השתנה — לא ניתן להעבירם אוטומטית ליום החדש.`);
        }
        resetForDayChange(finishedAt, { notifyUnsaved: false });
      } else {
        // Apply ONLY the writes that succeeded to the local baseline.
        setAttendanceRecords(reconciled.nextRecords);

        // Keep only the FAILED volunteers touched, so a retry re-sends just them.
        const failedIds = new Set(reconciled.failed.map((entry) => entry.volunteerId));
        setTouchedVolunteerIds((prev) => {
          const next = {};
          Object.keys(prev).forEach((id) => {
            if (failedIds.has(id)) {
              next[id] = true;
            }
          });
          return next;
        });

        if (reconciled.failedCount === 0) {
          // All succeeded.
          setHasEditedMarks(false);
          hasEditedRef.current = false;
          setJustSaved(true);
          window.setTimeout(() => setJustSaved(false), 2500);
        } else if (reconciled.succeededCount === 0) {
          // Nothing saved — keep every choice for a retry (no false success).
          setJustSaved(false);
          const code = reconciled.failed[0]?.reason?.code;
          alert(`שגיאה: לא נשמר אף סימון מתוך ${total}. ניתן לנסות שוב.${code ? ` (קוד: ${code})` : ''}`);
        } else {
          // Partial — surface exactly what was and wasn't saved.
          setHasEditedMarks(true);
          setJustSaved(false);
          const names = reconciled.failed.length <= 5
            ? ` (${reconciled.failed.map((entry) => entry.volunteerName).join(', ')})`
            : '';
          alert(`נשמרו ${reconciled.succeededCount} מתוך ${total} סימונים. ${reconciled.failedCount} סימונים לא נשמרו וניתן לנסות שוב.${names}`);
        }
      }
    } catch (error) {
      console.error('Error saving attendance:', error);
      alert(`אירעה שגיאה בשמירת הנוכחות: ${error.code || ''} ${error.message || error}`);
    } finally {
      savingRef.current = false;
      setSaving(false);
      pendingRolloverRef.current = false;
    }
  };

  const hasGroup = Boolean(canonicalGroupId);

  return (
    <div className="attendance-page" dir="rtl">
      <div className="attendance-card">

        {/* Header: title + group name, and an optional back button. */}
        <div className="attendance-header-row">
          <div className="attendance-title-block">
            <h1>סימון נוכחות</h1>
            {activeGroupName && <p className="attendance-sub">קבוצת {activeGroupName}</p>}
          </div>
          {typeof onBack === 'function' && (
            <button className="attendance-back-button" onClick={onBack}>חזרה</button>
          )}
        </div>

        {/* Group picker: guides are already locked to the group shown above. */}
        {lockGroup ? (
          !activeGroupName && (
            <div className="locked-group-box">
              קבוצה: <strong>לא שויכה קבוצה</strong>
            </div>
          )
        ) : (
          <select className="att-select" value={selectedGroupId} onChange={handleGroupChange} disabled={saving}>
            <option value="">בחר קבוצה</option>
            {groups.map((group) => (
              <option key={group.id} value={group.id}>{group.groupName || group.name || group.id}</option>
            ))}
          </select>
        )}

        {/* Saturday: not an activity day — the screen stays open, marking is off. */}
        {!loading && hasGroup && isSaturday && (
          <p className="att-note att-note-shabbat">
            שבת אינה יום פעילות — אין סימון נוכחות בשבת. ניתן לצפות במסך, אך הסימון והשמירה אינם זמינים.
          </p>
        )}

        {/* Loading / empty states. */}
        {loading && <p className="att-note">טוען מתנדבים...</p>}

        {!loading && hasGroup && volunteers.length === 0 && (
          <p className="att-note">לא נמצאו מתנדבים בקבוצה זו.</p>
        )}

        {/* The marking UI, once a group with volunteers is loaded. */}
        {!loading && volunteers.length > 0 && (
          <>
            {/* Today banner — the only day this screen marks. */}
            <div className="att-today-banner">
              <span className="att-today-eyebrow">סימון נוכחות להיום</span>
              <span className="att-today-date">{todayLabel}</span>
            </div>

            {/* Live summary: present / absent / unmarked. */}
            <div className="att-summary">
              <div className="att-stat att-stat-present">
                <span className="att-stat-num">{presentCount}</span>
                <span className="att-stat-label">נוכחים</span>
              </div>
              <div className="att-stat att-stat-absent">
                <span className="att-stat-num">{absentCount}</span>
                <span className="att-stat-label">חסרים</span>
              </div>
              <div className="att-stat att-stat-unmarked">
                <span className="att-stat-num">{unmarkedCount}</span>
                <span className="att-stat-label">לא סומנו</span>
              </div>
            </div>

            <div className="att-bulk-actions">
              <button
                type="button"
                className="att-mark-all-present"
                onClick={handleMarkAllPresent}
                disabled={saving || loading || isSaturday || allMarkedPresent}
              >
                {allMarkedPresent ? 'כולם סומנו כנוכחים' : 'סמן את כולם כנוכחים'}
              </button>
            </div>

            {/* One row per volunteer: name on the right, present / absent toggles. */}
            <ul className="att-list">
              {volunteers.map((volunteer) => {
                const name = getVolunteerName(volunteer);
                const status = marks[volunteer.id] || 'unmarked';

                return (
                  <li key={volunteer.id} className={`att-row att-row--${status}`}>
                    <div className="volunteer-name-cell">
                      <span className="att-avatar">{getInitial(name)}</span>
                      <span className="volunteer-name">{name}</span>
                    </div>

                    <div className="att-cell-actions">
                      {/* Present — the check mark is drawn in CSS (see stylesheet). */}
                      <button
                        type="button"
                        className={`att-action-toggle present ${status === 'present' ? 'is-active' : ''}`}
                        onClick={() => handleStatusSelect(volunteer.id, 'present')}
                        disabled={saving || loading || isSaturday}
                        aria-pressed={status === 'present'}
                        aria-label={`סמן ${name} כנוכח`}
                        title="נוכח"
                      />

                      {/* Absent — the X is drawn in CSS (see stylesheet). */}
                      <button
                        type="button"
                        className={`att-action-toggle absent ${status === 'absent' ? 'is-active' : ''}`}
                        onClick={() => handleStatusSelect(volunteer.id, 'absent')}
                        disabled={saving || loading || isSaturday}
                        aria-pressed={status === 'absent'}
                        aria-label={`סמן ${name} כחסר`}
                        title="חסר"
                      />
                    </div>
                  </li>
                );
              })}
            </ul>

            {/* Save. */}
            <button className="att-save" onClick={handleSaveAttendance} disabled={saving || loading || isSaturday}>
              {saving ? 'שומר...' : justSaved ? 'נשמרה הנוכחות' : 'שמירת נוכחות'}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

export default AttendanceScreen;
