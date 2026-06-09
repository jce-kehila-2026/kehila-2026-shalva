// Shared "people" helpers — a person's display name, birth-date parsing, and
// age. These were duplicated (slightly differently) across several screens;
// keeping one copy here avoids them drifting apart.

// Field names that might hold a birth date across the different collections.
const BIRTH_DATE_FIELDS = ['birthDate', 'birthday', 'dob', 'dateOfBirth', 'birth_date'];


// Best available display name for a person, with graceful fallbacks. The
// `fallback` is a parameter so each screen keeps its own wording (e.g.
// "מתנדב ללא שם" vs "חבר/ת קהילה") — same behaviour as before, one definition.
export function getDisplayName(person, fallback = 'חבר/ת קהילה') {
  if (!person) {
    return fallback;
  }

  return (
    person.name ||
    [person.firstName, person.lastName].filter(Boolean).join(' ').trim() ||
    person.email ||
    fallback
  );
}


// Parse a birth date from any of the supported field names / value shapes
// (text string, Firestore Timestamp, native Date, or a { seconds } object).
export function parseBirthDate(person) {
  if (!person) {
    return null;
  }

  for (const field of BIRTH_DATE_FIELDS) {
    const value = person[field];

    // Skip empty fields.
    if (!value) {
      continue;
    }

    // Resolve the value into a Date depending on its shape.
    let date = null;

    if (typeof value === 'string') {
      const parsed = new Date(value);
      if (!Number.isNaN(parsed.getTime())) {
        date = parsed;
      }
    } else if (typeof value.toDate === 'function') {
      date = value.toDate();
    } else if (value instanceof Date) {
      date = value;
    } else if (typeof value.seconds === 'number') {
      date = new Date(value.seconds * 1000);
    }

    // Return the first valid date we manage to build.
    if (date && !Number.isNaN(date.getTime())) {
      return date;
    }
  }

  // No usable birth date.
  return null;
}


// Current age in whole years, accounting for whether this year's birthday has
// already happened.
export function computeAge(birthDate, today = new Date()) {
  // Rough age from the year difference.
  let age = today.getFullYear() - birthDate.getFullYear();

  // Subtract one if this year's birthday hasn't happened yet.
  const monthDiff = today.getMonth() - birthDate.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
    age -= 1;
  }

  return age;
}
