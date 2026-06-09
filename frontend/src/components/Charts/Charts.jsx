// React hooks for state and side effects.
import { useEffect, useState } from 'react';

// Firestore helpers for reading collections.
import { collection, getDocs } from 'firebase/firestore';

// Our Firestore database instance.
import { db } from '../../firebase';

// Styles for this screen.
import './Charts.css';

// Shared event date + status helpers.
import { computeEventStatus, parseEventDate } from '../../utils/eventStatus';

// Shared attendance normalization (so charts match the reports screen).
import { normalizeAttendanceStatus, getRecordStatus } from '../../utils/attendance';


// Short Hebrew month labels for the "events per month" bar chart.
const MONTHS_SHORT = ['ינו', 'פבר', 'מרץ', 'אפר', 'מאי', 'יונ', 'יול', 'אוג', 'ספט', 'אוק', 'נוב', 'דצמ'];


// The event statuses, in the order we want them shown.
const EVENT_STATUS_ORDER = ['פעיל', 'מתוכנן', 'הסתיים', 'בוטל'];

// Colour for each event status.
const EVENT_STATUS_COLORS = {
  'פעיל': '#16a34a',
  'מתוכנן': '#4f46e5',
  'הסתיים': '#94a3b8',
  'בוטל': '#dc2626',
};


// Current age in whole years from a birth date in any supported format.
// Returns null when there's no usable date, so the volunteer is left out.
function computeAge(birthValue) {
  // No birth value at all.
  if (!birthValue) return null;

  // Resolve the value into a Date, depending on its shape.
  let date = null;
  if (typeof birthValue === 'string') {
    // "YYYY-MM-DD" or other text date.
    date = parseEventDate(birthValue);
  } else if (typeof birthValue.toDate === 'function') {
    // Firestore Timestamp.
    date = birthValue.toDate();
  } else if (birthValue instanceof Date) {
    // Native Date.
    date = birthValue;
  } else if (typeof birthValue.seconds === 'number') {
    // Plain { seconds } shape.
    date = new Date(birthValue.seconds * 1000);
  }

  // Give up if we couldn't build a valid date.
  if (!date || Number.isNaN(date.getTime())) return null;

  // Rough age from the year difference.
  const today = new Date();
  let age = today.getFullYear() - date.getFullYear();

  // Subtract one if this year's birthday hasn't happened yet.
  const monthDiff = today.getMonth() - date.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < date.getDate())) age -= 1;

  return age;
}


// Age groups for the volunteers pie, in display order.
const AGE_BUCKETS = [
  { label: 'עד 18', color: '#f59e0b', test: (age) => age < 18 },
  { label: '18–25', color: '#4f46e5', test: (age) => age >= 18 && age <= 25 },
  { label: '26–40', color: '#06b6d4', test: (age) => age >= 26 && age <= 40 },
  { label: 'מעל 40', color: '#ec4899', test: (age) => age > 40 },
];


// ---------- Reusable chart pieces (plain SVG / CSS) ----------

// A donut (ring) chart with a legend, drawn from a list of segments.
function Donut({ segments }) {
  // Sum of all segment values (also shown in the center).
  const total = segments.reduce((sum, segment) => sum + segment.value, 0);

  // No data: show a clean placeholder instead of an empty gray ring.
  if (total <= 0) {
    return <div className="chart-empty">אין נתונים להצגה</div>;
  }

  // Geometry for the SVG ring.
  const size = 160;
  const stroke = 28;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;

  // Running start position for the next segment along the ring.
  let offset = 0;

  return (
    <div className="chart-donut-wrap">

      {/* The SVG ring itself. */}
      <svg className="chart-donut" viewBox={`0 0 ${size} ${size}`} role="img" aria-label="תרשים עוגה">

        {/* Rotate so the ring starts at the top instead of the right. */}
        <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>

          {/* Faint background track behind the coloured segments. */}
          <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="var(--surface-2)" strokeWidth={stroke} />

          {/* One arc per non-empty segment. */}
          {total > 0 && segments.map((segment) => {
            // Skip empty segments.
            if (segment.value <= 0) return null;

            // Arc length for this segment's share of the total.
            const length = (segment.value / total) * circumference;

            // Draw the arc using dash length + dash offset.
            const node = (
              <circle
                key={segment.label}
                cx={size / 2}
                cy={size / 2}
                r={radius}
                fill="none"
                stroke={segment.color}
                strokeWidth={stroke}
                strokeDasharray={`${length} ${circumference - length}`}
                strokeDashoffset={-offset}
              />
            );

            // Advance the start position for the next arc.
            offset += length;
            return node;
          })}
        </g>

        {/* The total count shown in the middle of the ring. */}
        <text x={size / 2} y={size / 2} className="chart-donut-center" textAnchor="middle" dominantBaseline="central">
          {total}
        </text>
      </svg>

      {/* Legend listing each segment's colour, label and value. */}
      <ul className="chart-legend">
        {segments.map((segment) => (
          <li key={segment.label}>
            <span className="chart-legend-dot" style={{ background: segment.color }} />
            <span className="chart-legend-label">{segment.label}</span>
            <span className="chart-legend-value">{segment.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}


// A simple vertical bar chart drawn from a list of bars.
function Bars({ bars }) {
  // If every bar is zero, show an empty message instead.
  const hasData = bars.some((bar) => bar.value > 0);
  if (!hasData) return <div className="chart-empty">אין נתונים להצגה</div>;

  // Tallest value sets the 100% height (at least 1 to avoid divide-by-zero).
  const max = Math.max(1, ...bars.map((bar) => bar.value));

  return (
    <div className="chart-bars">
      {bars.map((bar) => (

        // One column per bar.
        <div className="chart-bar-col" key={bar.label}>

          {/* Track that the fill grows inside. */}
          <div className="chart-bar-track">

            {/* Filled portion, scaled to its share of the max. */}
            <div className="chart-bar-fill" style={{ height: `${Math.round((bar.value / max) * 100)}%` }}>
              {bar.value > 0 && <span className="chart-bar-value">{bar.value}</span>}
            </div>
          </div>

          {/* Label under the bar. */}
          <span className="chart-bar-label">{bar.label}</span>
        </div>
      ))}
    </div>
  );
}


function Charts() {
  // The loaded raw data (null until the first fetch finishes).
  const [data, setData] = useState(null);

  // True if any collection failed to load.
  const [hadError, setHadError] = useState(false);

  useEffect(() => {
    // Guards against setting state after the component unmounts.
    let isMounted = true;

    // Read one collection, returning null on failure (so it can be flagged).
    const fetchDocs = async (collectionName) => {
      try {
        const snapshot = await getDocs(collection(db, collectionName));
        return snapshot.docs.map((documentSnapshot) => documentSnapshot.data());
      } catch (error) {
        console.error(`שגיאה בטעינת ${collectionName}:`, error);
        return null;
      }
    };

    // Load every collection we need in parallel, then store the results.
    const load = async () => {
      // Fetch all three at once.
      const [events, volunteers, attendance] = await Promise.all([
        fetchDocs('events'),
        fetchDocs('volunteers'),
        fetchDocs('attendance'),
      ]);

      // Bail out if we unmounted while waiting.
      if (!isMounted) return;

      // Flag an error if any collection came back null.
      setHadError([events, volunteers, attendance].some((value) => value === null));

      // Store the data, treating a failed read as an empty list.
      setData({
        events: events || [],
        volunteers: volunteers || [],
        attendance: attendance || [],
      });
    };

    load();

    // Cleanup: mark as unmounted.
    return () => {
      isMounted = false;
    };
  }, []);

  // While loading, show a placeholder.
  if (!data) {
    return (
      <section className="charts-screen" dir="rtl" aria-label="תרשימים">
        <div className="chart-empty">טוען נתונים...</div>
      </section>
    );
  }

  // ----- Events by status (date-derived) -----

  // Tally events by their computed status.
  const statusCounts = {};
  data.events.forEach((event) => {
    const status = computeEventStatus(event);
    statusCounts[status] = (statusCounts[status] || 0) + 1;
  });

  // Build the donut segments in the preferred status order.
  const eventSegments = EVENT_STATUS_ORDER.map((status) => ({
    label: status,
    color: EVENT_STATUS_COLORS[status],
    value: statusCounts[status] || 0,
  }));

  // ----- Attendance (present vs absent) -----

  // Count present and absent attendance records, normalizing every status
  // shape (boolean, or Hebrew / English strings) the same way reports do.
  let present = 0;
  let absent = 0;
  data.attendance.forEach((record) => {
    const status = normalizeAttendanceStatus(getRecordStatus(record));
    if (status === 'present') {
      present += 1;
    } else if (status === 'absent') {
      absent += 1;
    }
  });

  // Two donut segments: present vs absent.
  const attendanceSegments = [
    { label: 'נוכחים', color: '#16a34a', value: present },
    { label: 'נעדרים', color: '#dc2626', value: absent },
  ];

  // ----- Events per month -----

  // Count events per calendar month.
  const monthCounts = Array(12).fill(0);
  data.events.forEach((event) => {
    const date = parseEventDate(event.date);
    if (date) monthCounts[date.getMonth()] += 1;
  });

  // One bar per month.
  const eventMonthBars = MONTHS_SHORT.map((label, index) => ({ label, value: monthCounts[index] }));

  // ----- Volunteers by age group -----

  // Count volunteers into each age bucket.
  const ageCounts = AGE_BUCKETS.map(() => 0);
  data.volunteers.forEach((volunteer) => {
    // Compute the volunteer's age (skip if unknown / invalid).
    const age = computeAge(volunteer.birthDate || volunteer.birthday || volunteer.dateOfBirth);
    if (age === null || age < 0) return;

    // Drop them into the first matching bucket.
    const index = AGE_BUCKETS.findIndex((bucket) => bucket.test(age));
    if (index >= 0) ageCounts[index] += 1;
  });

  // Donut segments for the age buckets.
  const ageSegments = AGE_BUCKETS.map((bucket, index) => ({
    label: bucket.label,
    color: bucket.color,
    value: ageCounts[index],
  }));

  // ----- Volunteers per group (top 10) -----

  // Count volunteers per group name.
  const groupCounts = {};
  data.volunteers.forEach((volunteer) => {
    const groupName = volunteer.groupName || 'ללא קבוצה';
    groupCounts[groupName] = (groupCounts[groupName] || 0) + 1;
  });

  // Keep the 10 biggest groups as bars.
  const volunteerGroupBars = Object.entries(groupCounts)
    .sort((first, second) => second[1] - first[1])
    .slice(0, 10)
    .map(([label, value]) => ({ label, value }));

  return (
    <section className="charts-screen" dir="rtl" aria-label="תרשימים">

      {/* Warning shown when some data failed to load. */}
      {hadError && (
        <div className="charts-note" role="status">
          חלק מהנתונים לא נטענו (ייתכן שאין הרשאת קריאה). התרשימים עשויים להיות חלקיים.
        </div>
      )}

      {/* The grid of chart cards. */}
      <div className="charts-grid">

        {/* Events by status. */}
        <div className="chart-card">
          <h3>אירועים לפי סטטוס</h3>
          <Donut segments={eventSegments} />
        </div>

        {/* Attendance present vs absent. */}
        <div className="chart-card">
          <h3>נוכחות (נוכחים מול נעדרים)</h3>
          <Donut segments={attendanceSegments} />
        </div>

        {/* Volunteer age distribution. */}
        <div className="chart-card">
          <h3>התפלגות גילאי מתנדבים</h3>
          <Donut segments={ageSegments} />
        </div>

        {/* Events per month (full-width). */}
        <div className="chart-card chart-card-wide">
          <h3>אירועים לפי חודש</h3>
          <Bars bars={eventMonthBars} />
        </div>

        {/* Volunteers per group (full-width). */}
        <div className="chart-card chart-card-wide">
          <h3>מתנדבים לפי קבוצה</h3>
          <Bars bars={volunteerGroupBars} />
        </div>
      </div>
    </section>
  );
}

export default Charts;
