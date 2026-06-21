// Pure preparation + preflight for the VOLUNTEER Excel import (no React, no
// Firebase). Each raw row is turned into either a validated set of fields or a
// list of Hebrew rejection reasons. Group/program matching and duplicate
// detection are intentionally NOT done here — they stay in the component and are
// handled in a later batch.

import {
  normalizeImportedActivityDay,
  normalizeImportedMobilePhone,
  parseImportedDate,
  maskPhoneForError,
} from './importValidation.js';


// Return the first non-empty value among the given keys, preserving its original
// TYPE (number stays a number) — important for phone / date / id validation.
function firstDefined(row, keys) {
  for (const key of keys) {
    const value = row[key];
    if (value !== undefined && value !== null && value !== '') {
      return value;
    }
  }
  return '';
}


// Trim any value to a plain string (for free-text passthrough fields).
function asText(value) {
  return String(value ?? '').trim();
}


// True for an "empty" Excel cell: null/undefined, or a whitespace-only string.
// A number (including 0), a boolean, or any other typed value counts as CONTENT
// — so a stray 0 is validated/rejected, never silently skipped.
function isEmptyCell(value) {
  if (value === null || value === undefined) {
    return true;
  }
  if (typeof value === 'string') {
    return value.trim() === '';
  }
  return false;
}


// Normalize a header/key: coerce to string, trim, strip a leading BOM (U+FEFF)
// that Excel/CSV sometimes prepends, then trim again.
function normalizeHeader(header) {
  let text = String(header ?? '').trim();
  if (text.charCodeAt(0) === 0xFEFF) {
    text = text.slice(1).trim();
  }
  return text;
}


// Build a view of the row keyed by NORMALIZED column names (so a BOM or spaces
// in a header can't hide the data). Cell VALUES are left untouched, and
// SheetJS's `__rowNum__` is preserved as-is (not normalized). If two different
// original headers collapse to the same normalized name, `collision` is true so
// the caller can reject rather than silently overwrite one value.
function normalizeRowKeys(rawRow) {
  const row = {};
  let collision = false;

  for (const key of Object.keys(rawRow)) {
    if (key === '__rowNum__') {
      row.__rowNum__ = rawRow.__rowNum__;
      continue;
    }

    const normalizedKey = normalizeHeader(key);
    if (Object.prototype.hasOwnProperty.call(row, normalizedKey)) {
      collision = true;
    }
    row[normalizedKey] = rawRow[key];
  }

  return { row, collision };
}


// ID rule: accept ONLY a string (trimmed, leading zeros preserved) or empty.
// A numeric cell may already have dropped a leading zero (ID_NUMERIC); any other
// type — boolean / Date / object / array — is rejected (ID_TYPE) and is NEVER
// coerced with String(...). The original value is never echoed back.
function prepareIdNumber(raw) {
  if (raw === null || raw === undefined || raw === '') {
    return { ok: true, value: '' };
  }
  if (typeof raw === 'string') {
    return { ok: true, value: raw.trim() };
  }
  if (typeof raw === 'number') {
    return { ok: false, code: 'ID_NUMERIC' };
  }
  return { ok: false, code: 'ID_TYPE' };
}


// --- Hebrew reason builders (domain messages, kept testable) ---

function phoneReason(code, masked) {
  switch (code) {
    case 'TOO_SHORT':
      return `מספר טלפון קצר מדי (${masked})`;
    case 'TOO_LONG':
      return `מספר טלפון ארוך מדי (${masked})`;
    case 'NOT_MOBILE':
      return `המספר אינו טלפון נייד (${masked})`;
    case 'NUMERIC_AMBIGUOUS':
      return `טלפון כתא מספרי שאיבד מידע (${masked})`;
    case 'ILLEGAL_CHARS':
      return `מספר טלפון מכיל תווים לא חוקיים (${masked})`;
    default:
      return `מספר טלפון לא תקין (${masked})`;
  }
}

function dateReason(code) {
  switch (code) {
    case 'SLASH':
      return 'תאריך לידה בפורמט עם לוכסן (/) — יש להשתמש ב-YYYY-MM-DD או DD-MM-YYYY';
    case 'INVALID_DATE':
      return 'תאריך לידה לא קיים בלוח השנה';
    case 'EXCEL_FAKE_LEAP':
      return 'תאריך לידה לא תקין (29-02-1900 הדמיוני של Excel)';
    default:
      return 'תאריך לידה בפורמט לא מזוהה';
  }
}

function dayReason(code) {
  switch (code) {
    case 'SATURDAY':
      return 'יום פעילות שבת אינו מותר';
    default:
      return 'יום פעילות לא מזוהה';
  }
}


// Prepare ONE raw volunteer row.
//   { ok: true, blank: true }          — an entirely empty row (skip silently)
//   { ok: true, fields }               — validated, ready to assemble + write
//   { ok: false, errors: [hebrew…] }   — one or more Hebrew rejection reasons
//
// `fields` carries the normalized in-scope values plus the RAW group / program
// names, so the component can do its existing matching unchanged.
export function prepareVolunteerImportRow(rawRow, { date1904 = false } = {}) {
  // A completely empty row (e.g. a trailing template row) is skipped, not an
  // error. EVERY value is considered (ignoring only SheetJS's __rowNum__): a
  // typed 0 / false, or a value in an unknown column, counts as content.
  const isBlankRow = Object.keys(rawRow)
    .filter((key) => key !== '__rowNum__')
    .every((key) => isEmptyCell(rawRow[key]));

  if (isBlankRow) {
    return { ok: true, blank: true };
  }

  // Normalize the COLUMN KEYS (string, trim, strip BOM) so a BOM/spaces in a
  // header can't hide the data. Cell VALUES are untouched. If two different
  // original headers collapse to the same name, reject rather than silently
  // overwrite one value.
  const { row, collision } = normalizeRowKeys(rawRow);
  if (collision) {
    return { ok: false, errors: ['כותרות כפולות לאחר נרמול — לא ניתן לקבוע חד-משמעית את העמודות'] };
  }

  const firstName = asText(row['שם פרטי *'] || row['שם פרטי'] || row['firstName']);
  const lastName = asText(row['שם משפחה *'] || row['שם משפחה'] || row['lastName']);

  let name = asText(row['שם מלא'] || row['שם'] || row['name']);
  if (!name && (firstName || lastName)) {
    name = `${firstName} ${lastName}`.trim();
  }

  // Raw (typed) values for the validators.
  const rawPhone = firstDefined(row, ['טלפון', 'phone']);
  const rawBirthDate = firstDefined(row, ['תאריך לידה', 'birthDate']);
  const rawId = firstDefined(row, ['תעודת זהות', 'ת.ז', 'idNumber']);
  const rawDay = firstDefined(row, ['יום פעילות', 'יום', 'day']);

  // Free-text passthrough fields.
  const age = asText(row['גיל (אוטומטי)'] || row['גיל'] || row['age']);
  const notes = asText(row['הערות'] || row['notes']);
  const address = asText(row['כתובת'] || row['address']);
  const email = asText(row['אימייל'] || row['דוא"ל'] || row['email']);
  const experience = asText(row['ניסיון קודם'] || row['ניסיון'] || row['experience']);
  const school = asText(row['בית ספר'] || row['school']);
  const activityTime = asText(row['זמן פעילות'] || row['activityTime']);
  const groupNameRaw = asText(row['קבוצה'] || row['group']);
  const programNameRaw = asText(row['תוכנית'] || row['program']);

  const errors = [];

  // Name is required once the row has any content.
  if (!name) {
    errors.push('חסר שם מתנדב');
  }

  // Phone — optional, but if present must normalize to a valid 05XXXXXXXX.
  const phoneResult = normalizeImportedMobilePhone(rawPhone, { required: false });
  let phone = '';
  if (phoneResult.ok) {
    phone = phoneResult.value;
  } else {
    errors.push(phoneReason(phoneResult.code, maskPhoneForError(rawPhone)));
  }

  // Birth date — optional, but if present must parse to YYYY-MM-DD.
  const dateResult = parseImportedDate(rawBirthDate, { date1904 });
  let birthDate = '';
  if (dateResult.ok) {
    birthDate = dateResult.value;
  } else {
    errors.push(dateReason(dateResult.code));
  }

  // Activity day — optional, short/full normalized, Saturday/unknown rejected.
  const dayResult = normalizeImportedActivityDay(rawDay);
  let day = '';
  if (dayResult.ok) {
    day = dayResult.value;
  } else {
    errors.push(dayReason(dayResult.code));
  }

  // ID — string kept verbatim; numeric cell or any non-string type rejected
  // (the original value is never shown in the message).
  const idResult = prepareIdNumber(rawId);
  let idNumber = '';
  if (idResult.ok) {
    idNumber = idResult.value;
  } else if (idResult.code === 'ID_NUMERIC') {
    errors.push('תעודת זהות כתא מספרי — ייתכן שאיבדה אפס מוביל; יש לעצב את העמודה כטקסט');
  } else {
    errors.push('תעודת זהות בפורמט לא תקין — יש להזין אותה כטקסט');
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    fields: {
      name,
      firstName,
      lastName,
      idNumber,
      phone,
      birthDate,
      age,
      address,
      email,
      experience,
      school,
      notes,
      activityTime,
      day,
      groupNameRaw,
      programNameRaw,
    },
  };
}


// Preflight every parsed row BEFORE any write. Returns the valid rows (with their
// Excel row numbers), the rejected rows (with Hebrew reasons), and how many blank
// rows were skipped. The Excel row number comes from SheetJS's `__rowNum__` when
// present (gap-aware), falling back to index + 2 for non-SheetJS callers.
export function preflightVolunteerImport(jsonRows, { date1904 = false } = {}) {
  const valid = [];
  const rejected = [];
  let blankSkipped = 0;

  jsonRows.forEach((rawRow, index) => {
    // Prefer SheetJS's true source row: `__rowNum__` is the 0-based worksheet
    // row, so +1 gives the 1-based Excel row (correct even when blank rows were
    // skipped). Fall back to index + 2 only for non-SheetJS callers (tests).
    const excelRow = Number.isInteger(rawRow?.__rowNum__)
      ? rawRow.__rowNum__ + 1
      : index + 2;

    const result = prepareVolunteerImportRow(rawRow, { date1904 });

    if (result.blank) {
      blankSkipped += 1;
      return;
    }

    if (result.ok) {
      valid.push({ excelRow, fields: result.fields });
    } else {
      rejected.push({ excelRow, reasons: result.errors });
    }
  });

  return { valid, rejected, blankSkipped };
}


// Detect what a parsed worksheet is, from its HEADER row only — so it works even
// for an EMPTY template (headers present, no data rows). Returns one of:
//   'duplicate-headers' — two non-empty headers collapse to the same name
//   'ambiguous'         — both group AND volunteer headers are present
//   'groups'            — a groups file
//   'volunteers'        — a volunteers file
//   'unknown'           — no recognized header
//
// Duplicate headers are detected HERE, on the raw header array, because SheetJS
// renames duplicate keys when it builds row objects — so a post-parse collision
// check alone would miss them.
export function detectImportFileType(headerRow = []) {
  // Normalize each header and drop empty ones.
  const normalized = (Array.isArray(headerRow) ? headerRow : [])
    .map(normalizeHeader)
    .filter((header) => header !== '');

  // Two non-empty headers that normalize to the same name → block the file.
  const seen = new Set();
  for (const header of normalized) {
    if (seen.has(header)) {
      return 'duplicate-headers';
    }
    seen.add(header);
  }

  const has = (name) => seen.has(name);

  const hasGroupHeader = has('שם קבוצה *') || has('שם קבוצה');

  // Every volunteer-name alias the row parser already accepts.
  const hasVolunteerHeader =
    has('שם פרטי *') || has('שם פרטי') || has('firstName') ||
    has('שם משפחה *') || has('שם משפחה') || has('lastName') ||
    has('שם מלא') || has('שם') || has('name');

  // Both header families present → ambiguous. Do NOT auto-pick one; the caller
  // must reject the file before any write.
  if (hasGroupHeader && hasVolunteerHeader) {
    return 'ambiguous';
  }
  if (hasGroupHeader) {
    return 'groups';
  }
  if (hasVolunteerHeader) {
    return 'volunteers';
  }

  return 'unknown';
}


// Commit prepared rows in chunks via an INJECTED commit function (so the
// orchestration can be tested without Firebase). Each item is { excelRow,
// payload }; only `payload` is passed to commitChunk — the Excel row number is
// kept in memory for reporting and is NEVER written. On the first failing chunk
// it stops: that slice counts as failedInCurrentBatch, everything after it as
// notAttempted, and no further chunks are committed.
export async function commitVolunteerChunks(items, commitChunk, chunkSize = 450) {
  let written = 0;
  let failedInCurrentBatch = 0;
  let notAttempted = 0;
  let failedRows = [];
  let error = null;

  for (let start = 0; start < items.length; start += chunkSize) {
    const slice = items.slice(start, start + chunkSize);

    try {
      await commitChunk(slice.map((item) => item.payload));
      written += slice.length;
    } catch (commitError) {
      error = commitError;
      failedInCurrentBatch = slice.length;
      failedRows = slice.map((item) => item.excelRow);
      notAttempted = items.length - (start + slice.length);
      break;
    }
  }

  return { written, failedInCurrentBatch, notAttempted, failedRows, error };
}
