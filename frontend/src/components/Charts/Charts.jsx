// Charts — the admin "סטטיסטיקה" screen: hand-built SVG donut and bar charts
// for event statuses, attendance, volunteer ages, events per month/year and
// volunteers per group. No chart library.
//
// It is interactive. A single control panel (opened from the toolbar OR by
// clicking any donut) lets the admin choose the year, switch the colour
// palette, change the age grouping, and reset everything to defaults. The bar
// charts add their own quick actions: click a year to filter, click a month to
// drill into its events.

// React hooks for state, side effects and derived (memoised) values.
import { useEffect, useMemo, useState } from 'react';

// Firestore helpers for reading collections.
import { collection, getDocs } from 'firebase/firestore';

// Our Firestore database instance.
import { db } from '../../firebase';

// Styles for this screen.
import './Charts.css';

// Shared event date + status helpers.
import { computeEventStatus, parseEventDate } from '../../utils/eventStatus';

// Shared date formatter: render date-only event dates as DD-MM-YYYY.
import { formatDateOnlyForDisplay } from '../../utils/dateDisplay';

// Shared attendance normalization (so charts match the reports screen).
import { normalizeAttendanceStatus, getRecordStatus } from '../../utils/attendance';


// Short Hebrew month labels for the "events per month" bar chart.
const MONTHS_SHORT = ['ינו', 'פבר', 'מרץ', 'אפר', 'מאי', 'יונ', 'יול', 'אוג', 'ספט', 'אוק', 'נוב', 'דצמ'];

// Full Hebrew month names, used in the month drill-down heading.
const MONTHS_LONG = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];

// Sentinel year value meaning "show every year together".
const ALL_YEARS = 'all';

// The event statuses, in the order we want them shown (colours come from the
// active palette, so the same index lines up with the palette's `status` list).
const EVENT_STATUS_ORDER = ['פעיל', 'מתוכנן', 'הסתיים', 'בוטל'];


// ---------- Colour palettes (the "change colours" option) ----------
// Each palette supplies: the bar gradient (two stops), the highlight accent for
// a selected bar, and the donut colours for statuses, attendance and ages.
const PALETTES = {
  brand: {
    label: 'מותג',
    bar: ['#bd329f', '#760963'],
    accent: '#52a7dd',
    status: ['#16a34a', '#4f46e5', '#94a3b8', '#dc2626'],
    attendance: ['#16a34a', '#dc2626'],
    age: ['#f59e0b', '#4f46e5', '#06b6d4', '#ec4899', '#10b981', '#8b5cf6'],
  },
  ocean: {
    label: 'ים',
    bar: ['#0ea5e9', '#075985'],
    accent: '#9333ea',
    status: ['#0ea5e9', '#6366f1', '#94a3b8', '#f43f5e'],
    attendance: ['#0ea5e9', '#f43f5e'],
    age: ['#0ea5e9', '#6366f1', '#14b8a6', '#f59e0b', '#a855f7', '#ec4899'],
  },
  sunset: {
    label: 'שקיעה',
    bar: ['#fb7185', '#be123c'],
    accent: '#9e2188',
    status: ['#f59e0b', '#6366f1', '#94a3b8', '#dc2626'],
    attendance: ['#f59e0b', '#dc2626'],
    age: ['#f97316', '#fb7185', '#f59e0b', '#a855f7', '#ec4899', '#ef4444'],
  },
};


// ---------- Age groupings (the "change ages" option) ----------
// Each mode is a list of buckets; a volunteer falls into the first one whose
// `test` returns true. Colours come from the active palette's `age` list.
const AGE_MODES = {
  standard: {
    label: 'סטנדרטי',
    buckets: [
      { label: 'עד 18', test: (age) => age < 18 },
      { label: '18–25', test: (age) => age >= 18 && age <= 25 },
      { label: '26–40', test: (age) => age >= 26 && age <= 40 },
      { label: 'מעל 40', test: (age) => age > 40 },
    ],
  },
  detailed: {
    label: 'מפורט',
    buckets: [
      { label: 'עד 18', test: (age) => age < 18 },
      { label: '18–24', test: (age) => age >= 18 && age <= 24 },
      { label: '25–34', test: (age) => age >= 25 && age <= 34 },
      { label: '35–49', test: (age) => age >= 35 && age <= 49 },
      { label: '50–64', test: (age) => age >= 50 && age <= 64 },
      { label: 'מעל 65', test: (age) => age >= 65 },
    ],
  },
  simple: {
    label: 'פשוט',
    buckets: [
      { label: 'קטינים (עד 18)', test: (age) => age < 18 },
      { label: 'בוגרים (18+)', test: (age) => age >= 18 },
    ],
  },
};


// Resolve any supported date shape (string, Date, Firestore Timestamp, or a
// plain { seconds } object) into a real Date — or null when it can't be parsed.
function toDate(value) {
  if (!value) {
    return null;
  }

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  if (typeof value.toDate === 'function') {
    return value.toDate();
  }

  if (typeof value.seconds === 'number') {
    return new Date(value.seconds * 1000);
  }

  if (typeof value === 'string') {
    return parseEventDate(value);
  }

  return null;
}


// Current age in whole years from a birth date in any supported format.
// Returns null when there's no usable date, so the volunteer is left out.
function computeAge(birthValue) {
  const date = toDate(birthValue);

  if (!date || Number.isNaN(date.getTime())) {
    return null;
  }

  // Rough age from the year difference.
  const today = new Date();
  let age = today.getFullYear() - date.getFullYear();

  // Subtract one if this year's birthday hasn't happened yet.
  const monthDiff = today.getMonth() - date.getMonth();

  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < date.getDate())) {
    age -= 1;
  }

  return age;
}


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

  // Each segment's arc length, then its start offset as a running total of the
  // lengths before it. Computed up front (no mutation during render) so the
  // arcs line up around the ring without reassigning an outer variable.
  const lengths = segments.map((segment) => (
    segment.value > 0 ? (segment.value / total) * circumference : 0
  ));
  const offsets = lengths.map((_, index) => (
    lengths.slice(0, index).reduce((sum, value) => sum + value, 0)
  ));

  return (
    <div className="chart-donut-wrap">

      {/* The SVG ring itself. */}
      <svg className="chart-donut" viewBox={`0 0 ${size} ${size}`} role="img" aria-label="תרשים עוגה">

        {/* Rotate so the ring starts at the top instead of the right. */}
        <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>

          {/* Faint background track behind the coloured segments. */}
          <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="var(--surface-2)" strokeWidth={stroke} />

          {/* One arc per non-empty segment. */}
          {segments.map((segment, index) => {
            // Skip empty segments.
            if (segment.value <= 0) {
              return null;
            }

            // This segment's arc length + where it starts on the ring.
            const length = lengths[index];
            const offset = offsets[index];

            return (
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


// A vertical bar chart drawn from a list of bars. When `onSelect` is given each
// bar becomes a button: clicking it calls onSelect(key) (or onSelect(null) when
// it's already the selected one — a toggle), and the selected bar is highlighted.
function Bars({ bars, onSelect = null, selectedKey = null }) {
  // If every bar is zero, show an empty message instead.
  const hasData = bars.some((bar) => bar.value > 0);

  if (!hasData) {
    return <div className="chart-empty">אין נתונים להצגה</div>;
  }

  // Tallest value sets the 100% height (at least 1 to avoid divide-by-zero).
  const max = Math.max(1, ...bars.map((bar) => bar.value));

  // Whether the chart reacts to clicks.
  const isInteractive = typeof onSelect === 'function';

  return (
    <div className="chart-bars">
      {bars.map((bar) => {
        // Each bar carries its own key for selection (falls back to its label).
        const key = bar.key ?? bar.label;
        const isSelected = isInteractive && selectedKey === key;
        const heightPercent = Math.round((bar.value / max) * 100);

        // The visual contents are the same whether or not the bar is clickable.
        const inner = (
          <>
            {/* Track that the fill grows inside. */}
            <div className="chart-bar-track">

              {/* Filled portion, scaled to its share of the max. */}
              <div className="chart-bar-fill" style={{ height: `${heightPercent}%` }}>
                {bar.value > 0 && <span className="chart-bar-value">{bar.value}</span>}
              </div>
            </div>

            {/* Label under the bar. */}
            <span className="chart-bar-label">{bar.label}</span>
          </>
        );

        // Interactive: render a real button so it's keyboard-accessible.
        if (isInteractive) {
          return (
            <button
              type="button"
              key={key}
              className={`chart-bar-col chart-bar-col--btn ${isSelected ? 'is-selected' : ''}`}
              onClick={() => onSelect(isSelected ? null : key)}
              aria-pressed={isSelected}
              title={`${bar.label}: ${bar.value}`}
            >
              {inner}
            </button>
          );
        }

        // Static: a plain column.
        return (
          <div className="chart-bar-col" key={key} title={`${bar.label}: ${bar.value}`}>
            {inner}
          </div>
        );
      })}
    </div>
  );
}


// A "big number + label" KPI card. The whole card is a button that opens this
// metric's detail popup (the "פירוט" affordance hints at that).
function KpiButton({ value, label, hint, onClick }) {
  return (
    <button type="button" className="charts-kpi charts-kpi--btn" onClick={onClick}>
      <span className="charts-kpi-num">{value}</span>
      <span className="charts-kpi-label">{label}</span>
      {hint && <span className="charts-kpi-hint">{hint}</span>}

      {/* "details ›" cue at the bottom of the card. */}
      <span className="charts-kpi-more">
        פירוט
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M15 18l-6-6 6-6" />
        </svg>
      </span>
    </button>
  );
}


// A pill segmented control reused for every choice in the options panel.
function Segmented({ options, value, onChange, ariaLabel }) {
  return (
    <div className="charts-seg" role="group" aria-label={ariaLabel}>
      {options.map((option) => (
        <button
          key={String(option.value)}
          type="button"
          className={`charts-seg-btn ${option.value === value ? 'is-active' : ''}`}
          aria-pressed={option.value === value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}


// A popup dialog: a dimmed backdrop with a centered card. Closes on the X, on a
// backdrop click, or on Escape. The card stops click propagation so clicking
// INSIDE it doesn't bubble up to the backdrop and close it.
function Modal({ title, onClose, children }) {
  // Close when Escape is pressed (set up once while the modal is mounted).
  useEffect(() => {
    const handleKey = (event) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('keydown', handleKey);

    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose]);

  return (
    <div className="charts-modal-backdrop" onClick={onClose}>
      <div
        className="charts-modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        dir="rtl"
        onClick={(event) => event.stopPropagation()}
      >
        {/* Header: title + close button. */}
        <div className="charts-modal-head">
          <h3 className="charts-modal-title">{title}</h3>
          <button type="button" className="charts-modal-close" onClick={onClose} aria-label="סגירה">
            ✕
          </button>
        </div>

        {/* The supplied body. */}
        <div className="charts-modal-body">
          {children}
        </div>
      </div>
    </div>
  );
}


// One "label … value" row inside a detail popup.
function StatRow({ label, value }) {
  return (
    <div className="charts-stat-row">
      <span className="charts-stat-label">{label}</span>
      <span className="charts-stat-value">{value}</span>
    </div>
  );
}


// A titled breakdown list (e.g. "by status", "by group") with optional colour
// dots. Shows a friendly note when there's nothing to list.
function Breakdown({ title, items }) {
  return (
    <div className="charts-breakdown">
      <h4 className="charts-breakdown-title">{title}</h4>

      {items.length > 0 ? (
        <ul className="charts-breakdown-list">
          {items.map((item) => (
            <li key={item.label}>
              {item.color && <span className="chart-legend-dot" style={{ background: item.color }} />}
              <span className="charts-breakdown-label">{item.label}</span>
              <span className="charts-breakdown-value">{item.value}</span>
            </li>
          ))}
        </ul>
      ) : (
        <div className="charts-breakdown-empty">אין נתונים להצגה</div>
      )}
    </div>
  );
}


// A donut wrapped in a card. The whole card is a button that opens the options
// panel — that's the "click a chart to do things" behaviour.
function DonutCard({ title, segments, onOpenOptions }) {
  return (
    <div
      className="chart-card chart-card--clickable"
      role="button"
      tabIndex={0}
      onClick={onOpenOptions}
      onKeyDown={(event) => {
        // Enter / Space act like a click (keyboard accessibility).
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onOpenOptions();
        }
      }}
    >
      <div className="chart-card-head">
        <h3>{title}</h3>
        <span className="chart-card-hint">לחצו לאפשרויות</span>
      </div>

      <Donut segments={segments} />
    </div>
  );
}


function Charts() {
  // The loaded raw data (null until the first fetch finishes).
  const [data, setData] = useState(null);

  // True if any collection failed to load.
  const [hadError, setHadError] = useState(false);

  // The chosen year: null means "use the default" (the current year). The user
  // can also pick a specific year or ALL_YEARS. Keeping null as the default lets
  // "reset" simply clear it back to the current year.
  const [selectedYear, setSelectedYear] = useState(null);

  // The month (0–11) drilled into on the "events per month" chart, or null.
  const [selectedMonth, setSelectedMonth] = useState(null);

  // The active colour palette + age grouping (the "change colours / ages" opts).
  const [palette, setPalette] = useState('brand');
  const [ageMode, setAgeMode] = useState('standard');

  // Which popup is open: 'options' (the settings panel) or one of the KPI ids
  // ('events' / 'volunteers' / 'groups' / 'attendance'). null means none.
  const [modal, setModal] = useState(null);

  // On phones the KPI summary (the four number cards) is collapsible to save
  // space; on desktop it's always shown. `isMobile` tracks the phone breakpoint
  // (the same 600px used in the CSS); the lazy initialiser reads the current
  // width up front so it renders in the right mode with no flicker.
  const [isMobile, setIsMobile] = useState(
    () => window.matchMedia('(max-width: 600px)').matches,
  );

  // Whether the KPI summary is expanded. Only matters on phones (desktop always
  // shows it). Starts CLOSED so the phone view opens compact.
  const [kpisOpen, setKpisOpen] = useState(false);

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
      const [events, volunteers, attendance] = await Promise.all([
        fetchDocs('events'),
        fetchDocs('volunteers'),
        fetchDocs('attendance'),
      ]);

      if (!isMounted) {
        return;
      }

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

    return () => {
      isMounted = false;
    };
  }, []);

  // Keep `isMobile` in sync with the viewport width, so the KPI summary switches
  // between "collapsible" (phone) and "always shown" (desktop) on resize/rotate.
  useEffect(() => {
    const query = window.matchMedia('(max-width: 600px)');

    const sync = () => setIsMobile(query.matches);
    sync();

    query.addEventListener('change', sync);
    return () => query.removeEventListener('change', sync);
  }, []);

  // The list of years that appear in the data, newest first — built once per
  // load. Drives the year picker and the "events per year" chart.
  const years = useMemo(() => {
    if (!data) {
      return [];
    }

    const found = new Set();

    data.events.forEach((event) => {
      const date = toDate(event.date);

      if (date) {
        found.add(date.getFullYear());
      }
    });

    data.attendance.forEach((record) => {
      const date = toDate(record.dateKey || record.date);

      if (date) {
        found.add(date.getFullYear());
      }
    });

    return [...found].sort((first, second) => second - first);
  }, [data]);

  // While loading, show a placeholder.
  if (!data) {
    return (
      <section className="charts-screen" dir="rtl" aria-label="סטטיסטיקה">
        <div className="chart-empty">טוען נתונים...</div>
      </section>
    );
  }

  // Resolve the active year. The default (when nothing is chosen) is the current
  // calendar year if it has data, otherwise the most recent year, otherwise all.
  const currentYear = new Date().getFullYear();
  const defaultYear = years.includes(currentYear) ? currentYear : (years[0] ?? ALL_YEARS);
  const year = selectedYear !== null ? selectedYear : defaultYear;

  // True when a single year is in focus (vs. "all years" together).
  const isYearFocused = year !== ALL_YEARS;

  // Human label for the current scope.
  const scopeLabel = isYearFocused ? `שנת ${year}` : 'כל השנים';

  // The active palette + age buckets.
  const activePalette = PALETTES[palette] || PALETTES.brand;
  const ageBuckets = (AGE_MODES[ageMode] || AGE_MODES.standard).buckets;

  // CSS variables that recolour the bar charts to match the palette.
  const paletteVars = {
    '--chart-bar-a': activePalette.bar[0],
    '--chart-bar-b': activePalette.bar[1],
    '--chart-accent': activePalette.accent,
  };

  // Switch to a year (or back to "all") and drop any open month drill-down.
  const changeYear = (value) => {
    setSelectedYear(value);
    setSelectedMonth(null);
  };

  // Restore every display choice to its default.
  const resetAll = () => {
    setSelectedYear(null);
    setSelectedMonth(null);
    setPalette('brand');
    setAgeMode('standard');
  };

  // Options for each segmented control in the panel.
  const yearOptions = [
    { value: ALL_YEARS, label: 'כל השנים' },
    ...years.map((value) => ({ value, label: String(value) })),
  ];
  const paletteOptions = Object.entries(PALETTES).map(([value, config]) => ({ value, label: config.label }));
  const ageOptions = Object.entries(AGE_MODES).map(([value, config]) => ({ value, label: config.label }));

  // ----- Events scoped to the active year -----
  const scopedEvents = data.events.filter((event) => {
    if (!isYearFocused) {
      return true;
    }

    const date = toDate(event.date);
    return date && date.getFullYear() === year;
  });

  // ----- Attendance scoped to the active year -----
  const scopedAttendance = data.attendance.filter((record) => {
    if (!isYearFocused) {
      return true;
    }

    const date = toDate(record.dateKey || record.date);
    return date && date.getFullYear() === year;
  });

  // ----- Events by status (within the scope) -----
  const statusCounts = {};
  scopedEvents.forEach((event) => {
    const status = computeEventStatus(event);
    statusCounts[status] = (statusCounts[status] || 0) + 1;
  });

  const eventSegments = EVENT_STATUS_ORDER.map((status, index) => ({
    label: status,
    color: activePalette.status[index],
    value: statusCounts[status] || 0,
  }));

  // ----- Attendance (present vs absent, within the scope) -----
  let present = 0;
  let absent = 0;
  scopedAttendance.forEach((record) => {
    const status = normalizeAttendanceStatus(getRecordStatus(record));

    if (status === 'present') {
      present += 1;
    } else if (status === 'absent') {
      absent += 1;
    }
  });

  const attendanceSegments = [
    { label: 'נוכחים', color: activePalette.attendance[0], value: present },
    { label: 'חסרים', color: activePalette.attendance[1], value: absent },
  ];

  // Attendance rate as a whole percent (or a dash when there are no records).
  const ratedRecords = present + absent;
  const attendanceRate = ratedRecords > 0 ? `${Math.round((present / ratedRecords) * 100)}%` : '—';

  // ----- Volunteers by age group (active mode + palette) -----
  const ageCounts = ageBuckets.map(() => 0);
  data.volunteers.forEach((volunteer) => {
    const age = computeAge(volunteer.birthDate || volunteer.birthday || volunteer.dateOfBirth);

    if (age === null || age < 0) {
      return;
    }

    const index = ageBuckets.findIndex((bucket) => bucket.test(age));

    if (index >= 0) {
      ageCounts[index] += 1;
    }
  });

  const ageSegments = ageBuckets.map((bucket, index) => ({
    label: bucket.label,
    color: activePalette.age[index % activePalette.age.length],
    value: ageCounts[index],
  }));

  // ----- Events per month (within the scope) -----
  const monthCounts = Array(12).fill(0);
  scopedEvents.forEach((event) => {
    const date = toDate(event.date);

    if (date) {
      monthCounts[date.getMonth()] += 1;
    }
  });

  const eventMonthBars = MONTHS_SHORT.map((label, index) => ({
    key: index,
    label,
    value: monthCounts[index],
  }));

  // ----- Events per year (always across all years) -----
  const yearCounts = {};
  data.events.forEach((event) => {
    const date = toDate(event.date);

    if (date) {
      yearCounts[date.getFullYear()] = (yearCounts[date.getFullYear()] || 0) + 1;
    }
  });

  const eventYearBars = [...years]
    .sort((first, second) => first - second)
    .map((value) => ({ key: value, label: String(value), value: yearCounts[value] || 0 }));

  // ----- Month drill-down: the scoped events in the selected month -----
  const monthEvents = selectedMonth === null
    ? []
    : scopedEvents
      .filter((event) => {
        const date = toDate(event.date);
        return date && date.getMonth() === selectedMonth;
      })
      .sort((first, second) => {
        const firstDate = toDate(first.date);
        const secondDate = toDate(second.date);
        return (firstDate?.getTime() || 0) - (secondDate?.getTime() || 0);
      });

  // ----- Volunteers per group (top 10, not year-bound) -----
  const groupCounts = {};
  data.volunteers.forEach((volunteer) => {
    const groupName = volunteer.groupName || 'ללא קבוצה';
    groupCounts[groupName] = (groupCounts[groupName] || 0) + 1;
  });

  const volunteerGroupBars = Object.entries(groupCounts)
    .sort((first, second) => second[1] - first[1])
    .slice(0, 10)
    .map(([label, value]) => ({ label, value }));

  // ----- KPI strip: distinct group names across volunteers + events -----
  const distinctGroups = new Set();
  data.volunteers.forEach((volunteer) => {
    if (volunteer.groupName) {
      distinctGroups.add(volunteer.groupName);
    }
  });
  data.events.forEach((event) => {
    if (event.assignedGroup) {
      distinctGroups.add(event.assignedGroup);
    }
  });

  // ----- Detail data for the KPI popups -----

  // Scoped events per group (for the groups + events popups).
  const eventsPerGroup = {};
  scopedEvents.forEach((event) => {
    const groupName = event.assignedGroup || 'ללא שיוך';
    eventsPerGroup[groupName] = (eventsPerGroup[groupName] || 0) + 1;
  });

  // One row per group with its volunteer + (scoped) event counts, busiest first.
  const groupRows = [...distinctGroups]
    .map((name) => ({
      label: name,
      volunteers: data.volunteers.filter((volunteer) => volunteer.groupName === name).length,
      events: eventsPerGroup[name] || 0,
    }))
    .sort((first, second) => second.volunteers - first.volunteers);

  // Only the months that actually have events (for the events popup).
  const eventMonthsDetail = MONTHS_LONG
    .map((label, index) => ({ label, value: monthCounts[index] }))
    .filter((item) => item.value > 0);

  // Open the options popup (passed to every donut card + the toolbar button).
  const openOptions = () => setModal('options');

  // The title shown at the top of whichever popup is open.
  const modalTitles = {
    options: 'אפשרויות תצוגה',
    events: 'אירועים — פירוט',
    volunteers: 'מתנדבים — פירוט',
    groups: 'קבוצות — פירוט',
    attendance: 'נוכחות — פירוט',
  };

  // Build the body for the open popup.
  const renderModalBody = () => {
    switch (modal) {

      // The settings panel: year + colours + ages + reset.
      case 'options':
        return (
          <div className="charts-options-body">
            <div className="charts-panel-row">
              <span className="charts-panel-label">שנה</span>
              <Segmented options={yearOptions} value={year} onChange={changeYear} ariaLabel="בחירת שנה" />
            </div>

            <div className="charts-panel-row">
              <span className="charts-panel-label">ערכת צבעים</span>
              <Segmented options={paletteOptions} value={palette} onChange={setPalette} ariaLabel="בחירת ערכת צבעים" />
            </div>

            <div className="charts-panel-row">
              <span className="charts-panel-label">קבוצות גיל</span>
              <Segmented options={ageOptions} value={ageMode} onChange={setAgeMode} ariaLabel="בחירת קבוצות גיל" />
            </div>

            <div className="charts-options-foot">
              <button type="button" className="charts-panel-reset" onClick={resetAll}>
                איפוס להגדרות ברירת מחדל
              </button>
            </div>
          </div>
        );

      // Events: totals + breakdowns by status and by month.
      case 'events':
        return (
          <>
            <StatRow label={`סך אירועים (${scopeLabel})`} value={scopedEvents.length} />
            <Breakdown title="לפי סטטוס" items={eventSegments} />
            <Breakdown title="לפי חודש" items={eventMonthsDetail} />
          </>
        );

      // Volunteers: total + breakdowns by age and by group.
      case 'volunteers':
        return (
          <>
            <StatRow label="סך מתנדבים" value={data.volunteers.length} />
            <Breakdown title={`לפי גיל (${(AGE_MODES[ageMode] || AGE_MODES.standard).label})`} items={ageSegments} />
            <Breakdown
              title="לפי קבוצה"
              items={volunteerGroupBars.map((bar) => ({ label: bar.label, value: bar.value }))}
            />
          </>
        );

      // Groups: total + a per-group table of volunteers and events.
      case 'groups':
        return (
          <>
            <StatRow label="סך קבוצות" value={distinctGroups.size} />

            <div className="charts-grouptable">
              <div className="charts-grouptable-head">
                <span>קבוצה</span>
                <span>מתנדבים</span>
                <span>אירועים</span>
              </div>

              {groupRows.length > 0 ? (
                groupRows.map((row) => (
                  <div className="charts-grouptable-row" key={row.label}>
                    <span className="charts-grouptable-name">{row.label}</span>
                    <span>{row.volunteers}</span>
                    <span>{row.events}</span>
                  </div>
                ))
              ) : (
                <div className="charts-breakdown-empty">אין קבוצות להצגה</div>
              )}
            </div>
          </>
        );

      // Attendance: rate + present / absent / total record counts.
      case 'attendance':
        return (
          <>
            <StatRow label={`אחוז נוכחות (${scopeLabel})`} value={attendanceRate} />
            <StatRow label="נוכחים" value={present} />
            <StatRow label="חסרים" value={absent} />
            <StatRow label="סך רשומות נוכחות" value={present + absent} />
          </>
        );

      default:
        return null;
    }
  };

  return (
    <section className="charts-screen" dir="rtl" aria-label="סטטיסטיקה" style={paletteVars}>

      {/* Page heading. */}
      <header className="charts-head">
        <span className="charts-eyebrow">מרכז ניהול</span>
        <h2 className="charts-title">סטטיסטיקה</h2>
        <p className="charts-subtitle">
          תמונת מצב של אירועים, נוכחות ומתנדבים — לפי חודש ולאורך השנים.
        </p>
      </header>

      {/* Warning shown when some data failed to load. */}
      {hadError && (
        <div className="charts-note" role="status">
          חלק מהנתונים לא נטענו (ייתכן שאין הרשאת קריאה). הסטטיסטיקה עשויה להיות חלקית.
        </div>
      )}

      {/* Toolbar: the active scope + the button that opens the options popup. */}
      <div className="charts-toolbar">
        <span className="charts-scope">
          מציג: <strong>{scopeLabel}</strong>
        </span>

        <button
          type="button"
          className="charts-options-btn"
          onClick={openOptions}
          aria-haspopup="dialog"
        >
          {/* Sliders icon. */}
          <svg className="charts-options-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <line x1="4" y1="21" x2="4" y2="14" />
            <line x1="4" y1="10" x2="4" y2="3" />
            <line x1="12" y1="21" x2="12" y2="12" />
            <line x1="12" y1="8" x2="12" y2="3" />
            <line x1="20" y1="21" x2="20" y2="16" />
            <line x1="20" y1="12" x2="20" y2="3" />
            <line x1="1" y1="14" x2="7" y2="14" />
            <line x1="9" y1="8" x2="15" y2="8" />
            <line x1="17" y1="16" x2="23" y2="16" />
          </svg>
          אפשרויות
        </button>
      </div>

      {/* KPI strip: the four number cards, each opening its own detail popup.
          On phones it's collapsible (starts closed); on desktop it's always
          shown. The cards themselves are identical in both modes. */}
      {(() => {
        const kpiCards = (
          <div className="charts-kpis" id="charts-kpis">
            <KpiButton value={scopedEvents.length} label="אירועים" hint={scopeLabel} onClick={() => setModal('events')} />
            <KpiButton value={data.volunteers.length} label="מתנדבים" hint="בסך הכול" onClick={() => setModal('volunteers')} />
            <KpiButton value={distinctGroups.size} label="קבוצות" hint="בסך הכול" onClick={() => setModal('groups')} />
            <KpiButton value={attendanceRate} label="אחוז נוכחות" hint={scopeLabel} onClick={() => setModal('attendance')} />
          </div>
        );

        // Desktop: show the cards directly, no toggle.
        if (!isMobile) {
          return kpiCards;
        }

        // Phone: a header button that opens/closes the summary.
        return (
          <div className={`charts-kpis-collapse ${kpisOpen ? 'is-open' : 'is-closed'}`}>
            <button
              type="button"
              className="charts-kpis-toggle"
              onClick={() => setKpisOpen((open) => !open)}
              aria-expanded={kpisOpen}
              aria-controls="charts-kpis"
            >
              <span className="charts-kpis-toggle-title">סיכום מספרי</span>

              {/* Chevron points down when open, sideways when collapsed. */}
              <span className={`charts-kpis-chevron ${kpisOpen ? 'is-open' : ''}`} aria-hidden="true">
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M6 9l6 6 6-6" />
                </svg>
              </span>
            </button>

            {/* The cards, shown only when expanded. */}
            {kpisOpen && kpiCards}
          </div>
        );
      })()}

      {/* Donuts on TOP — their own grid so the three cards fill the row evenly
          (no empty trailing column). Clicking any of them opens the options. */}
      <div className="charts-donuts">
        <DonutCard title="אירועים לפי סטטוס" segments={eventSegments} onOpenOptions={openOptions} />
        <DonutCard title="נוכחות (נוכחים מול חסרים)" segments={attendanceSegments} onOpenOptions={openOptions} />
        <DonutCard title="התפלגות גילאי מתנדבים" segments={ageSegments} onOpenOptions={openOptions} />
      </div>

      {/* Bar charts BELOW — stacked, each full width. */}
      <div className="charts-bars-stack">

        {/* Events per month (interactive drill-down). */}
        <div className="chart-card">
          <div className="chart-card-head">
            <h3>אירועים לפי חודש</h3>
            <span className="chart-card-hint">{scopeLabel} · לחצו על חודש לפירוט</span>
          </div>

          <Bars bars={eventMonthBars} onSelect={setSelectedMonth} selectedKey={selectedMonth} />

          {/* Drill-down: the events behind the selected month. */}
          {selectedMonth !== null && (
            <div className="chart-drill">
              <div className="chart-drill-head">
                <span>אירועי {MONTHS_LONG[selectedMonth]} {isYearFocused ? year : ''}</span>
                <button type="button" className="chart-drill-close" onClick={() => setSelectedMonth(null)}>
                  סגירה
                </button>
              </div>

              {monthEvents.length > 0 ? (
                <ul className="chart-drill-list">
                  {monthEvents.map((event, index) => (
                    <li key={event.id || `${event.name}-${index}`} className="chart-drill-item">
                      <span className="chart-drill-name">{event.name || 'אירוע ללא שם'}</span>
                      <span className="chart-drill-meta">
                        {formatDateOnlyForDisplay(event.date, { fallback: '' })}
                        {event.assignedGroup ? ` · ${event.assignedGroup}` : ''}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="chart-drill-empty">אין אירועים בחודש זה.</div>
              )}
            </div>
          )}
        </div>

        {/* Events per year (click a year to filter everything). */}
        <div className="chart-card">
          <div className="chart-card-head">
            <h3>אירועים לפי שנה</h3>
            <span className="chart-card-hint">לחצו על שנה כדי לסנן</span>
          </div>

          <Bars
            bars={eventYearBars}
            onSelect={(key) => changeYear(key === null ? ALL_YEARS : Number(key))}
            selectedKey={isYearFocused ? year : null}
          />
        </div>

        {/* Volunteers per group. */}
        <div className="chart-card">
          <h3>מתנדבים לפי קבוצה</h3>
          <Bars bars={volunteerGroupBars} />
        </div>
      </div>

      {/* The active popup (options or a KPI detail), rendered above everything. */}
      {modal && (
        <Modal title={modalTitles[modal]} onClose={() => setModal(null)}>
          {renderModalBody()}
        </Modal>
      )}
    </section>
  );
}

export default Charts;
