// Helpers for one-tap WhatsApp messaging (client-side wa.me links).

// The association name used in the message templates.
const ORG_NAME = 'עמותת שלווה';


// Turn any Israeli phone into WhatsApp format ("972XXXXXXXXX"), or null.
export function normalizeIsraeliPhone(raw) {
  // Nothing to normalise.
  if (!raw) return null;

  // Strip everything except digits.
  let digits = String(raw).replace(/\D/g, '');

  // Bail out if there were no digits.
  if (!digits) return null;

  // Drop a leading country code if present.
  if (digits.startsWith('972')) {
    digits = digits.slice(3);
  }

  // Drop the local trunk "0" (e.g. 052… → 52…).
  digits = digits.replace(/^0+/, '');

  // A valid IL subscriber number is 8–9 digits at this point.
  if (digits.length < 8 || digits.length > 9) return null;

  // Re-attach the country code.
  return `972${digits}`;
}


// True when `raw` can be turned into a valid IL WhatsApp number.
export function hasValidPhone(raw) {
  // Valid if normalisation produced a number.
  return normalizeIsraeliPhone(raw) !== null;
}


// Build a `wa.me` link (to the person if we have a number, else the picker).
export function buildWhatsAppUrl(phone, text) {
  // Normalise the phone.
  const intl = normalizeIsraeliPhone(phone);

  // Encode the optional pre-filled message.
  const query = text ? `?text=${encodeURIComponent(text)}` : '';

  // Link to the person, or open the contact picker when there's no number.
  return intl ? `https://wa.me/${intl}${query}` : `https://wa.me/${query}`;
}


// Templates are emoji-free so WhatsApp Desktop on Windows doesn't garble them.

// A warm, generic hello the admin can edit before sending.
export function greetingMessage(name) {
  // Optional " name" suffix.
  const who = name ? ` ${name}` : '';

  // Build the greeting text.
  return `היי${who}!\nכאן ${ORG_NAME}. רצינו לבדוק מה שלומך ואם הכול בסדר.`;
}


// A birthday wish, ready to send straight from the birthdays screen.
export function birthdayMessage(name) {
  // Optional " name" suffix.
  const who = name ? ` ${name}` : '';

  // Build the birthday text.
  return `יום הולדת שמח${who}!\nכל צוות ${ORG_NAME} מאחל לך שנה מלאה בבריאות, שמחה ואהבה. תודה שאת/ה חלק מהקהילה שלנו.`;
}


// An event reminder; only the provided fields are woven in.
export function eventReminderMessage({ name, eventName, date, time, location } = {}) {
  // Optional " name" suffix.
  const who = name ? ` ${name}` : '';

  // Start with the greeting + opener lines.
  const lines = [`היי${who}!`, `תזכורת מ${ORG_NAME}:`];

  // Combine the date and time into one "when" string.
  const when = [date, time].filter(Boolean).join(' בשעה ');

  // Add only the fields we were given.
  if (eventName) lines.push(`אירוע: ${eventName}`);
  if (when) lines.push(`מתי: ${when}`);
  if (location) lines.push(`מיקום: ${location}`);

  // Add the sign-off and join into one message.
  lines.push('נשמח לראות אותך!');
  return lines.join('\n');
}
