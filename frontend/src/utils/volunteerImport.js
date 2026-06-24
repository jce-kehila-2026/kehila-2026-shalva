// Pure preparation + preflight for the VOLUNTEER Excel import (no React, no
// Firebase). Each raw row is turned into either a validated set of fields or a
// list of Hebrew rejection reasons. Group/program matching and duplicate
// detection are intentionally NOT done here — they stay in the component and are
// handled in a later batch.

import {
  normalizeImportedActivityDay,
  normalizeImportedActivityTime,
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

function dayReason() {
  // The only remaining rejection is an unrecognized weekday (Saturday is allowed
  // now and normalizes like any other day).
  return 'יום פעילות לא מזוהה';
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
  const rawActivityTime = firstDefined(row, ['זמן פעילות', 'activityTime']);

  // Age is a COMPATIBILITY PLACEHOLDER: never read from the file, never typed,
  // never computed here — birth date is the source of truth. It is kept as '' so
  // the document schema stays the same for current consumers (VolunteerDetails,
  // the age-range filter, search) until a separate refactor makes them all
  // compute age from birthDate. No migration of existing records.
  const age = '';

  // Free-text passthrough fields.
  const notes = asText(row['הערות'] || row['notes']);
  const address = asText(row['כתובת'] || row['address']);
  const email = asText(row['אימייל'] || row['דוא"ל'] || row['email']);
  const experience = asText(row['ניסיון קודם'] || row['ניסיון'] || row['experience']);
  const school = asText(row['בית ספר'] || row['school']);
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

  // Activity day — optional, short/full normalized (Saturday included now); an
  // unrecognized value is rejected.
  const dayResult = normalizeImportedActivityDay(rawDay);
  let day = '';
  if (dayResult.ok) {
    day = dayResult.value;
  } else {
    errors.push(dayReason());
  }

  // Activity time — optional; if present must be a canonical GROUP_TIMES value.
  const timeResult = normalizeImportedActivityTime(rawActivityTime);
  let activityTime = '';
  if (timeResult.ok) {
    activityTime = timeResult.value;
  } else {
    errors.push('זמן פעילות לא מזוהה — יש לבחור ערך מהרשימה (בוקר / צהריים / ערב)');
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

  // Identity metadata for duplicate detection — computed even when the row is
  // rejected, so a valid row that collides with a rejected one is still caught.
  // idKey/phoneKey hold the full id/phone but only IN MEMORY during
  // preflight/resolution: they are not shown in messages, not logged, and not
  // added to the document as metadata. (The canonical idNumber/phone fields are
  // still written as part of the volunteer schema, unchanged.) Each key is null
  // unless its value is valid.
  const identity = {
    idKey: idResult.ok && idResult.value ? idResult.value : null,
    phoneKey: phoneKeyOf(rawPhone),
    nameNorm: normalizeMatchName(name),
    birthDate: dateResult.ok ? dateResult.value : '',
  };
  identity.nameBirthKey = identity.nameNorm && identity.birthDate
    ? `${identity.nameNorm}|${identity.birthDate}`
    : null;

  if (errors.length > 0) {
    return { ok: false, errors, identity };
  }

  return {
    ok: true,
    identity,
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
  // Identity of EVERY non-blank row (valid AND rejected), so the resolver can
  // detect a duplicate even when its twin was rejected for an unrelated reason.
  const identities = [];
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

    identities.push({ excelRow, ...result.identity });

    if (result.ok) {
      valid.push({ excelRow, fields: result.fields });
    } else {
      rejected.push({ excelRow, reasons: result.errors });
    }
  });

  return { valid, rejected, blankSkipped, identities };
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


// ---------------------------------------------------------------------------
// Duplicate detection + group/program matching (pure)
// ---------------------------------------------------------------------------

// Name used for case/whitespace-insensitive matching (English case folded;
// Hebrew is unaffected). Collapses runs of whitespace to a single space.
function normalizeMatchName(value) {
  return String(value ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
}

// A volunteer's display name from either field shape.
function existingName(volunteer) {
  return (
    volunteer.name ||
    [volunteer.firstName, volunteer.lastName].filter(Boolean).join(' ').trim()
  );
}

// Canonical phone key for comparison: the local 05XXXXXXXX form, or null when
// the value can't be normalized (so non-normalizable numbers never match and
// are never altered).
function phoneKeyOf(value) {
  const result = normalizeImportedMobilePhone(value, { required: false });
  return result.ok && result.value ? result.value : null;
}

// Normalized birth-date key for an EXISTING volunteer record, used only for
// duplicate matching. By contract only STRINGS are normalized: a non-string
// (number / Date / { y, m, d } / Firestore Timestamp-like / any object) returns
// null and never matches — nothing is guessed. For strings it reuses
// parseImportedDate (no separate parser, no new Date('YYYY-MM-DD')), accepting
// strict YYYY-MM-DD and normalizing strict DD-MM-YYYY → YYYY-MM-DD; empty or
// invalid → null. The stored record is never modified.
function existingBirthDateKey(value) {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  if (trimmed === '') {
    return null;
  }

  const result = parseImportedDate(trimmed);
  return result.ok && result.value ? result.value : null;
}

// Push a value onto a Map<key, array>.
function pushTo(map, key, value) {
  if (!map.has(key)) {
    map.set(key, []);
  }
  map.get(key).push(value);
}

// Resolve a group name against the live groups list / the locked group.
// Returns { ok: true, groupId, groupName } or { ok: false, reason }.
function resolveGroup(rawName, groups, passedGroup) {
  const name = asText(rawName);

  if (passedGroup) {
    const lockedId = passedGroup.id ? String(passedGroup.id).trim() : '';
    const lockedName = (passedGroup.groupName || passedGroup.name || '').trim();

    // Empty cell uses the locked group; a name that matches it is also fine.
    if (name === '' || normalizeMatchName(name) === normalizeMatchName(lockedName)) {
      // Integrity: the locked group must carry a real id AND name.
      if (!lockedId || !lockedName) {
        return { ok: false, reason: 'הקבוצה הנעולה חסרה מזהה או שם תקין' };
      }
      return { ok: true, groupId: lockedId, groupName: lockedName };
    }

    // Any other name is a conflict (the file may not silently move a volunteer).
    return { ok: false, reason: 'שם הקבוצה אינו תואם לקבוצה הנעולה — לא ניתן לשנות קבוצה דרך הקובץ' };
  }

  // No locked group: empty is allowed.
  if (name === '') {
    return { ok: true, groupId: '', groupName: '' };
  }

  const matches = groups.filter(
    (group) => normalizeMatchName(group.groupName || group.name || '') === normalizeMatchName(name),
  );

  if (matches.length === 0) {
    return { ok: false, reason: 'קבוצה לא נמצאה' };
  }
  if (matches.length > 1) {
    return { ok: false, reason: 'שם קבוצה עמום — נמצאו כמה קבוצות תואמות' };
  }

  // Integrity: a matched group must carry a real id AND canonical name — never
  // store a name with an empty id.
  const group = matches[0];
  const groupId = group.id ? String(group.id).trim() : '';
  const groupName = (group.groupName || group.name || '').trim();
  if (!groupId || !groupName) {
    return { ok: false, reason: 'רשומת הקבוצה חסרה מזהה או שם תקין' };
  }
  return { ok: true, groupId, groupName };
}

// Resolve a program name against the live programs list.
// Returns { ok: true, programId, programName } or { ok: false, reason }.
function resolveProgram(rawName, programs) {
  const name = asText(rawName);

  // Empty is allowed.
  if (name === '') {
    return { ok: true, programId: '', programName: '' };
  }

  const matches = programs.filter(
    (program) => normalizeMatchName(program.name || '') === normalizeMatchName(name),
  );

  if (matches.length === 0) {
    return { ok: false, reason: 'תוכנית לא נמצאה' };
  }
  if (matches.length > 1) {
    return { ok: false, reason: 'שם תוכנית עמום — נמצאו כמה תוכניות תואמות' };
  }

  // Integrity: a matched program must carry a real id AND canonical name.
  const program = matches[0];
  const programId = program.id ? String(program.id).trim() : '';
  const programName = (program.name || '').trim();
  if (!programId || !programName) {
    return { ok: false, reason: 'רשומת התוכנית חסרה מזהה או שם תקין' };
  }
  return { ok: true, programId, programName };
}

// Identity keys for one prepared row (recomputed from its validated fields,
// matching preflight). idKey/phoneKey hold full values in memory only — not
// shown in messages, not logged, and not added to the document as metadata.
// (The canonical idNumber/phone are still written as usual.)
function computeRowIdentity(fields) {
  const idResult = prepareIdNumber(fields.idNumber);
  const idKey = idResult.ok && idResult.value ? idResult.value : null;
  const phoneKey = phoneKeyOf(fields.phone);
  const nameNorm = normalizeMatchName(fields.name);
  const birthDate = fields.birthDate || '';
  const nameBirthKey = nameNorm && birthDate ? `${nameNorm}|${birthDate}` : null;
  return { idKey, phoneKey, nameNorm, birthDate, nameBirthKey };
}

// Apply duplicate/conflict rules + group/program matching to preflight-validated
// rows. PURE: no Firebase, no alert, no React. Existing volunteers are read-only
// (never updated). `allRowIdentities` (from preflight) lets duplicate detection
// see EVERY non-blank row — including ones preflight rejected — so a valid row
// that shares an identity with a rejected row is still rejected. Returns:
//   { readyToWrite: [{ excelRow, payload }],  rejected: [{ excelRow, reasons }] }
// The idKey/phoneKey used for matching live in memory only — not in a reason,
// a log, or added to a document as metadata. (The canonical idNumber/phone are
// still written as part of the volunteer schema.)
export function resolveVolunteerImport(validRows, {
  existingVolunteers = [],
  groups = [],
  programs = [],
  passedGroup = null,
  allRowIdentities = null,
} = {}) {
  const rows = Array.isArray(validRows) ? validRows : [];

  // --- index the existing records (read-only) ---
  const existingById = new Map();          // idKey -> existing volunteer
  const existingPhoneIds = new Map();      // phoneKey -> Set(idKey | '')
  const existingNameBirth = new Set();     // "name|birthDate"

  for (const volunteer of existingVolunteers) {
    const idKey = asText(volunteer.idNumber) || null;
    if (idKey && !existingById.has(idKey)) {
      existingById.set(idKey, volunteer);
    }

    const phoneKey = phoneKeyOf(volunteer.phone);
    if (phoneKey) {
      if (!existingPhoneIds.has(phoneKey)) {
        existingPhoneIds.set(phoneKey, new Set());
      }
      existingPhoneIds.get(phoneKey).add(idKey || '');
    }

    const nameNorm = normalizeMatchName(existingName(volunteer));
    const birthKey = existingBirthDateKey(volunteer.birthDate);
    if (nameNorm && birthKey) {
      existingNameBirth.add(`${nameNorm}|${birthKey}`);
    }
  }

  // Identity of each VALID row (used for its own checks).
  const validMeta = rows.map(({ fields }) => computeRowIdentity(fields));

  // Within-file duplicate index: built from ALL non-blank rows when the caller
  // provides them (so a valid row colliding with a preflight-REJECTED row is
  // caught), otherwise from the valid rows alone.
  const indexSource = Array.isArray(allRowIdentities) && allRowIdentities.length > 0
    ? allRowIdentities
    : rows.map((row, index) => ({ excelRow: row.excelRow, ...validMeta[index] }));

  const idCounts = new Map();              // idKey -> count
  const phoneIdLists = new Map();          // phoneKey -> [idKey | null]
  const nameBirthCounts = new Map();       // nameBirthKey -> count

  for (const entry of indexSource) {
    if (entry.idKey) {
      idCounts.set(entry.idKey, (idCounts.get(entry.idKey) || 0) + 1);
    }
    if (entry.phoneKey) {
      pushTo(phoneIdLists, entry.phoneKey, entry.idKey || null);
    }
    if (entry.nameBirthKey) {
      nameBirthCounts.set(entry.nameBirthKey, (nameBirthCounts.get(entry.nameBirthKey) || 0) + 1);
    }
  }

  const readyToWrite = [];
  const rejected = [];

  rows.forEach(({ excelRow, fields }, index) => {
    const m = validMeta[index];
    const reasons = [];

    // ----- ID identity -----
    if (m.idKey) {
      // Duplicate across all non-blank rows (every sharing row is rejected).
      if ((idCounts.get(m.idKey) || 0) > 1) {
        reasons.push('תעודת זהות כפולה בקובץ — כל השורות עם תעודת זהות זו נדחו');
      }
      // Against Firestore.
      const existing = existingById.get(m.idKey);
      if (existing) {
        const sameName = normalizeMatchName(existingName(existing)) === m.nameNorm;
        const samePhone = phoneKeyOf(existing.phone) === m.phoneKey;
        if (!sameName || !samePhone) {
          reasons.push('התנגשות: תעודת זהות זהה עם שם או טלפון שונה במערכת');
        } else {
          reasons.push('תעודת זהות כבר קיימת במערכת');
        }
      }
    }

    // ----- Phone identity (suspicion only — never an auto-merge) -----
    if (m.phoneKey) {
      const ids = phoneIdLists.get(m.phoneKey) || [];
      if (ids.length > 1) {
        // Distinct non-empty IDs sharing one phone is a conflict; otherwise a
        // plain duplicate-suspicion.
        const distinctIds = new Set(ids.filter(Boolean));
        if (distinctIds.size > 1) {
          reasons.push('התנגשות: אותו טלפון עם תעודות זהות שונות בקובץ');
        } else {
          reasons.push('טלפון כפול בקובץ — חשד לכפילות; נדרשת בדיקה ידנית');
        }
      }

      const existingIds = existingPhoneIds.get(m.phoneKey);
      if (existingIds) {
        const differentId = m.idKey
          ? [...existingIds].some((id) => id && id !== m.idKey)
          : false;
        if (differentId) {
          reasons.push('התנגשות: אותו טלפון עם תעודת זהות שונה במערכת');
        } else {
          reasons.push('טלפון זהה לרשומה קיימת — חשד לכפילות; נדרשת בדיקה ידנית');
        }
      }
    }

    // ----- name + birthDate (suspicion only) -----
    if (m.nameBirthKey) {
      if ((nameBirthCounts.get(m.nameBirthKey) || 0) > 1) {
        reasons.push('שם ותאריך לידה זהים בין שורות בקובץ — חשד לכפילות; נדרשת בדיקה ידנית');
      }
      if (existingNameBirth.has(m.nameBirthKey)) {
        reasons.push('שם ותאריך לידה זהים לרשומה קיימת — חשד לכפילות; נדרשת בדיקה ידנית');
      }
    }

    // ----- group / program matching -----
    const groupResult = resolveGroup(fields.groupNameRaw, groups, passedGroup);
    if (!groupResult.ok) {
      reasons.push(groupResult.reason);
    }

    const programResult = resolveProgram(fields.programNameRaw, programs);
    if (!programResult.ok) {
      reasons.push(programResult.reason);
    }

    if (reasons.length > 0) {
      rejected.push({ excelRow, reasons });
      return;
    }

    // Build the document payload (same schema; createdAt is added at the write
    // boundary by the caller, never here).
    readyToWrite.push({
      excelRow,
      payload: {
        name: fields.name,
        firstName: fields.firstName,
        lastName: fields.lastName,
        idNumber: fields.idNumber,
        phone: fields.phone,
        birthDate: fields.birthDate,
        age: fields.age,
        address: fields.address,
        email: fields.email,
        experience: fields.experience,
        school: fields.school,
        notes: fields.notes,
        activityTime: fields.activityTime,
        day: fields.day,
        programId: programResult.programId,
        programName: programResult.programName,
        groupId: groupResult.groupId,
        groupName: groupResult.groupName,
      },
    });
  });

  return { readyToWrite, rejected };
}
