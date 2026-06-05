// BirthDatePicker — a friendly day / month / year selector used wherever a
// birth (or event) date is entered. Emits a "YYYY-MM-DD" string via onChange
// (or "" while incomplete). Pass a changing `key` to re-initialise it.

// React state hook.
import { useState } from 'react';

// Styles for this widget.
import './BirthDatePicker.css';


// Month names in Hebrew, indexed 0 (January) to 11 (December).
const HEBREW_MONTHS = [
  'ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני',
  'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר',
];

// This year, used as the reference point for the year list.
const CURRENT_YEAR = new Date().getFullYear();


// Build the year option list. Defaults to the last 100 years (birth dates); pass
// `futureYears` to also offer upcoming years (e.g. for event dates). The currently
// selected year is always included so editing an out-of-range record still works.
function buildYears(pastYears, futureYears, selectedYear) {
  // Count down from the furthest future year to the earliest past year.
  const years = [];
  for (let year = CURRENT_YEAR + futureYears; year >= CURRENT_YEAR - pastYears; year -= 1) {
    years.push(year);
  }

  // Make sure the selected year is present even if it's out of range.
  const selected = Number(selectedYear);
  if (selected && !years.includes(selected)) {
    years.push(selected);
    years.sort((left, right) => right - left);
  }

  return years;
}


// How many days a given month has (handles leap years).
function daysInMonth(year, monthIndex) {
  return new Date(year, monthIndex + 1, 0).getDate();
}


// Current age in whole years, accounting for whether the birthday already passed.
function computeAge(birthDate, today) {
  let age = today.getFullYear() - birthDate.getFullYear();
  const monthDiff = today.getMonth() - birthDate.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) age -= 1;
  return age;
}


// Parse a "YYYY-MM-DD" string into { day, month, year } (blanks if invalid).
function parseValue(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value || '');
  if (!match) return { day: '', month: '', year: '' };
  return { year: Number(match[1]), month: Number(match[2]) - 1, day: Number(match[3]) };
}


function BirthDatePicker({ value = '', onChange, id, required = false, showPreview = false, pastYears = 100, futureYears = 0 }) {
  // The selected day / month / year (initialised from `value`).
  const [parts, setParts] = useState(() => parseValue(value));

  // True once all three parts are filled in.
  const complete = parts.day !== '' && parts.month !== '' && parts.year !== '';

  // The year options to show.
  const years = buildYears(pastYears, futureYears, parts.year);

  // Update one part, fix an out-of-range day, and emit the new value.
  const update = (part, raw) => {
    // Apply the change (blank stays blank, otherwise a number).
    const next = { ...parts, [part]: raw === '' ? '' : Number(raw) };

    // Keep the day valid for the chosen month/year (e.g. no 31 in February).
    if (next.day !== '' && next.month !== '' && next.year !== '') {
      const maxDay = daysInMonth(next.year, next.month);
      if (Number(next.day) > maxDay) next.day = maxDay;
    }

    setParts(next);

    // Emit the full date when complete, otherwise an empty string.
    if (next.day !== '' && next.month !== '' && next.year !== '') {
      onChange(`${next.year}-${String(Number(next.month) + 1).padStart(2, '0')}-${String(next.day).padStart(2, '0')}`);
    } else {
      onChange('');
    }
  };

  // How many day options to offer for the chosen month/year.
  const dayCount = (parts.month !== '' && parts.year !== '') ? daysInMonth(parts.year, parts.month) : 31;

  // Optional "🎂 day month year · age" preview line.
  let preview = null;
  if (showPreview && complete) {
    const age = computeAge(new Date(Number(parts.year), Number(parts.month), Number(parts.day)), new Date());
    preview = `🎂 ${parts.day} ב${HEBREW_MONTHS[parts.month]} ${parts.year} · גיל ${age}`;
  }

  return (
    <div className="birth-date-picker">
      <div className="bdp-selects">

        {/* Day dropdown. */}
        <select
          id={id}
          className="bdp-select"
          value={parts.day}
          onChange={(event) => update('day', event.target.value)}
          required={required}
          aria-label="יום"
        >
          <option value="">יום</option>
          {Array.from({ length: dayCount }, (_, index) => index + 1).map((dayOption) => (
            <option key={dayOption} value={dayOption}>{dayOption}</option>
          ))}
        </select>

        {/* Month dropdown. */}
        <select
          className="bdp-select"
          value={parts.month}
          onChange={(event) => update('month', event.target.value)}
          required={required}
          aria-label="חודש"
        >
          <option value="">חודש</option>
          {HEBREW_MONTHS.map((label, index) => (
            <option key={label} value={index}>{label}</option>
          ))}
        </select>

        {/* Year dropdown. */}
        <select
          className="bdp-select"
          value={parts.year}
          onChange={(event) => update('year', event.target.value)}
          required={required}
          aria-label="שנה"
        >
          <option value="">שנה</option>
          {years.map((yearOption) => (
            <option key={yearOption} value={yearOption}>{yearOption}</option>
          ))}
        </select>
      </div>

      {/* Optional preview line. */}
      {preview && <div className="bdp-preview">{preview}</div>}
    </div>
  );
}

export default BirthDatePicker;
