// Pure preparation + preflight + resolution for the GROUP Excel import (no
// React, no Firebase, no alert, no console). Each raw row becomes either a
// normalized set of group fields + an assignment PLAN (guideId / volunteerIds /
// planned write count) or a list of Hebrew rejection reasons. Nothing here
// writes Firestore or finalizes the document schema.

import {
  normalizeImportedActivityDay,
  normalizeImportedActivityTime,
} from './importValidation.js';


// --- small pure helpers (kept local to this module) ---

// Normalize a header/key: string, trim, strip a leading BOM, trim again.
function normalizeHeader(header) {
  let text = String(header ?? '').trim();
  if (text.charCodeAt(0) === 0xFEFF) {
    text = text.slice(1).trim();
  }
  return text;
}

// Columns that mean the SAME field under different (current + legacy) names.
// A single member of a family is fine (incl. the old alias); two different
// members in the same file are ambiguous — we must not pick one with `||` /
// firstDefined. Members are written in their already-normalized form.
const HEADER_ALIAS_FAMILIES = [
  ['שם קבוצה *', 'שם קבוצה'],
  ['מתנדבים משויכים (שמות, מופרדים בפסיק)', 'מתנדבים משויכים'],
];

// True if any alias family has MORE THAN ONE of its members present among the
// given already-normalized header/key names.
function hasAmbiguousAliasFamily(normalizedKeys) {
  const present = new Set(normalizedKeys);
  return HEADER_ALIAS_FAMILIES.some(
    (family) => family.filter((member) => present.has(member)).length > 1,
  );
}

// True for an empty cell: null/undefined or a whitespace-only string. A number
// (incl. 0), boolean, or any other typed value counts as content.
function isEmptyCell(value) {
  if (value === null || value === undefined) {
    return true;
  }
  if (typeof value === 'string') {
    return value.trim() === '';
  }
  return false;
}

// Trim any value to a plain string.
function asText(value) {
  return String(value ?? '').trim();
}

// Trim + collapse internal runs of whitespace to a single space.
function collapseSpaces(value) {
  return asText(value).replace(/\s+/g, ' ');
}

// Case/whitespace-insensitive key for matching (English case folded; Hebrew is
// unaffected).
function normalizeMatchName(value) {
  return collapseSpaces(value).toLowerCase();
}

// First non-empty value among the given keys (preserves the original type).
function firstDefined(row, keys) {
  for (const key of keys) {
    const value = row[key];
    if (value !== undefined && value !== null && value !== '') {
      return value;
    }
  }
  return '';
}

// View of the row keyed by NORMALIZED column names (cell values untouched,
// __rowNum__ preserved). `collision` is true if two different headers collapse
// to the same name.
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

// Display name + id helpers for the live guides / volunteers lists.
function guideDisplayName(guide) {
  return (
    guide.name ||
    [guide.firstName, guide.lastName].filter(Boolean).join(' ').trim() ||
    guide.email ||
    ''
  );
}

function guideIdOf(guide) {
  if (guide.id) return String(guide.id).trim();
  if (guide.uid) return String(guide.uid).trim();
  return '';
}

function volunteerDisplayName(volunteer) {
  return (
    volunteer.name ||
    [volunteer.firstName, volunteer.lastName].filter(Boolean).join(' ').trim()
  );
}


// ---------------------------------------------------------------------------
// Header analysis (run on the raw header row BEFORE object parsing)
// ---------------------------------------------------------------------------

// Inspect the raw header array (e.g. sheet_to_json(ws, { header: 1 })[0] || []).
// Each header is normalized (string → trim → strip BOM → trim); empty headers
// are ignored. Two fail-closed results, each with a stable code:
//   - 'DUPLICATE_HEADERS'  — two non-empty headers collapse to the SAME name.
//   - 'AMBIGUOUS_HEADERS'  — two DIFFERENT headers from the same alias family
//                            (e.g. 'שם קבוצה *' + 'שם קבוצה') both appear, so we
//                            can't pick one field value safely.
// This runs BEFORE object-mode parsing, where SheetJS would silently rename the
// exact duplicates (the per-row guards remain only as a fallback). No UI text,
// no XLSX dependency.
export function analyzeGroupImportHeaders(headerRow = []) {
  const normalized = (Array.isArray(headerRow) ? headerRow : [])
    .map(normalizeHeader)
    .filter((header) => header !== '');

  const seen = new Set();
  for (const header of normalized) {
    if (seen.has(header)) {
      return { ok: false, code: 'DUPLICATE_HEADERS' };
    }
    seen.add(header);
  }

  // Two different names for the same field is just as unsafe as a literal dup.
  if (hasAmbiguousAliasFamily(normalized)) {
    return { ok: false, code: 'AMBIGUOUS_HEADERS' };
  }

  return { ok: true };
}


// ---------------------------------------------------------------------------
// Per-row preparation
// ---------------------------------------------------------------------------

// Prepare ONE raw group row.
//   { ok: true, blank: true }                          — an empty row (skipped)
//   { ok: true, fields, refs, identity }               — normalized + match inputs
//   { ok: false, errors: [hebrew…], identity }         — rejection reasons
//
// `fields` = the group's own normalized fields (no final doc, no schema mapping).
// `refs`   = the guide / volunteer NAME references to be matched in resolve.
export function prepareGroupImportRow(rawRow) {
  // Truly empty row → skipped (every value except __rowNum__ is empty).
  const isBlankRow = Object.keys(rawRow)
    .filter((key) => key !== '__rowNum__')
    .every((key) => isEmptyCell(rawRow[key]));

  if (isBlankRow) {
    return { ok: true, blank: true };
  }

  // Normalize column keys; duplicate headers after normalization block the row.
  const { row, collision } = normalizeRowKeys(rawRow);
  if (collision) {
    return {
      ok: false,
      errors: ['כותרות כפולות לאחר נרמול — לא ניתן לקבוע חד-משמעית את העמודות'],
      identity: { groupNameKey: null, guideNameKey: null, volunteerNameKeys: [] },
    };
  }

  // Depth guard: if the header analyzer was NOT run and this row carries two
  // aliases of the same field, reject — never silently keep one value (no
  // `||` / firstDefined first-wins here).
  if (hasAmbiguousAliasFamily(Object.keys(row))) {
    return {
      ok: false,
      errors: ['נמצאו שתי כותרות שונות לאותו שדה (alias) — לא ניתן לקבוע חד-משמעית את הערך'],
      identity: { groupNameKey: null, guideNameKey: null, volunteerNameKeys: [] },
    };
  }

  const groupName = collapseSpaces(row['שם קבוצה *'] || row['שם קבוצה']);
  const rawActivityTime = firstDefined(row, ['זמן פעילות']);
  const rawDay = firstDefined(row, ['יום פעילות']);
  const guideNameRaw = collapseSpaces(row['מדריך אחראי']);
  const location = asText(row['מיקום / חדר']);
  const notes = asText(row['הערות']);

  // Volunteer cell — read with firstDefined so a typed 0 / false is NOT lost to
  // `||`. Empty string → no volunteers; a string → split on commas; any other
  // typed value (number / boolean) is an invalid reference (rejected, never a
  // silent empty assignment).
  const rawVolunteers = firstDefined(row, [
    'מתנדבים משויכים (שמות, מופרדים בפסיק)', 'מתנדבים משויכים',
  ]);

  const errors = [];

  // Group name is required.
  if (!groupName) {
    errors.push('חסר שם קבוצה');
  }

  // Activity time — optional; if present must be a canonical GROUP_TIMES value.
  const timeResult = normalizeImportedActivityTime(rawActivityTime);
  let activityTime = '';
  if (timeResult.ok) {
    activityTime = timeResult.value;
  } else {
    errors.push('זמן פעילות לא מזוהה — יש לבחור ערך מהרשימה (בוקר / צהריים / ערב)');
  }

  // Activity day — optional; short/full normalized to the canonical full form,
  // Saturday and unknown rejected.
  const dayResult = normalizeImportedActivityDay(rawDay);
  let activityDay = '';
  if (dayResult.ok) {
    activityDay = dayResult.value;
  } else if (dayResult.code === 'SATURDAY') {
    errors.push('יום פעילות שבת אינו מותר');
  } else {
    errors.push('יום פעילות לא מזוהה');
  }

  // Volunteer name references (comma-separated). A name repeated WITHIN one row
  // is a malformed row (the file references the same person twice). A non-string
  // typed cell (0 / false / etc.) is an invalid reference.
  let volunteerNames = [];
  if (rawVolunteers === '') {
    // No volunteers assigned — allowed.
  } else if (typeof rawVolunteers === 'string') {
    volunteerNames = rawVolunteers.split(',').map(collapseSpaces).filter(Boolean);
    const seen = new Set();
    let duplicateInRow = false;
    for (const name of volunteerNames) {
      const key = normalizeMatchName(name);
      if (seen.has(key)) {
        duplicateInRow = true;
      }
      seen.add(key);
    }
    if (duplicateInRow) {
      errors.push('שם מתנדב מופיע יותר מפעם אחת באותה שורה');
    }
  } else {
    errors.push('עמודת המתנדבים המשויכים מכילה ערך לא תקין — יש להזין שמות מופרדים בפסיק');
  }

  // In-memory identity for cross-row reuse detection (group/guide/volunteer
  // names). Computed even when the row is rejected; never shown or written.
  const identity = {
    groupNameKey: groupName ? normalizeMatchName(groupName) : null,
    guideNameKey: guideNameRaw ? normalizeMatchName(guideNameRaw) : null,
    volunteerNameKeys: [...new Set(volunteerNames.map(normalizeMatchName))],
  };

  if (errors.length > 0) {
    return { ok: false, errors, identity };
  }

  return {
    ok: true,
    identity,
    fields: { groupName, activityTime, activityDay, location, notes },
    refs: { guideNameRaw, volunteerNames },
  };
}


// Preflight every parsed row BEFORE matching. Returns valid rows (with their
// normalized fields + match refs), rejected rows (Hebrew reasons), the count of
// blank rows skipped, and per-row identities (for cross-row group-name dedupe —
// including rows rejected for other reasons). Excel row = SheetJS `__rowNum__`
// + 1 when present, else array index + 2.
export function preflightGroupImport(jsonRows) {
  const valid = [];
  const rejected = [];
  const identities = [];
  let blankSkipped = 0;

  jsonRows.forEach((rawRow, index) => {
    const excelRow = Number.isInteger(rawRow?.__rowNum__)
      ? rawRow.__rowNum__ + 1
      : index + 2;

    const result = prepareGroupImportRow(rawRow);

    if (result.blank) {
      blankSkipped += 1;
      return;
    }

    identities.push({ excelRow, ...result.identity });

    if (result.ok) {
      valid.push({ excelRow, fields: result.fields, refs: result.refs });
    } else {
      rejected.push({ excelRow, reasons: result.errors });
    }
  });

  return { valid, rejected, blankSkipped, identities };
}


// ---------------------------------------------------------------------------
// Resolution (name matching + duplicate/conflict rules) — pure
// ---------------------------------------------------------------------------

// Match group rows against the live groups / guides / volunteers (all read-only,
// never modified). Returns:
//   { ready:    [{ excelRow, fields, guideId, volunteerIds, operationCount }],
//     rejected: [{ excelRow, reasons }] }
//
// No first-match: an ambiguous name (more than one match) is always rejected.
// No silent reassignment: a guide already leading a group (via an existing group
// OR the guide record's own groupId, or an inconsistent groupName-without-id),
// or a volunteer already in a group, is rejected. `allRowIdentities` (from
// preflight) lets the cross-row group-name / guide / volunteer reuse checks see
// EVERY non-blank row by NAME, including rows rejected for other reasons.
export function resolveGroupImport(validRows, {
  existingGroups = [],
  guides = [],
  volunteers = [],
  allRowIdentities = null,
} = {}) {
  const rows = Array.isArray(validRows) ? validRows : [];

  // Existing-state indexes (read-only).
  const existingGroupNames = new Set(
    existingGroups.map((g) => normalizeMatchName(g.groupName || g.name || '')).filter(Boolean),
  );
  const guideAlreadyAssigned = new Set(
    existingGroups.map((g) => (g.guideId ? String(g.guideId).trim() : '')).filter(Boolean),
  );

  // Recompute a row's reuse keys (group / guide / volunteer names) from its
  // normalized fields + refs — used for the fallback index when no
  // allRowIdentities is supplied.
  const keysForRow = ({ excelRow, fields, refs }) => ({
    excelRow,
    groupNameKey: normalizeMatchName(fields.groupName),
    guideNameKey: refs.guideNameRaw ? normalizeMatchName(refs.guideNameRaw) : null,
    volunteerNameKeys: [...new Set(refs.volunteerNames.map(normalizeMatchName))],
  });

  // Cross-row index — ALL non-blank rows (incl. preflight-rejected) when the
  // caller passes allRowIdentities; otherwise just the valid rows. Reuse is
  // keyed by NORMALIZED NAME (not by matched id), so a valid row colliding with
  // a REJECTED row — which never got matched to an id — is still caught.
  const nameIndexSource = Array.isArray(allRowIdentities) && allRowIdentities.length > 0
    ? allRowIdentities
    : rows.map(keysForRow);

  const groupNameCounts = new Map();
  const guideNameCounts = new Map();
  const volunteerNameKeyCounts = new Map();
  for (const entry of nameIndexSource) {
    if (entry.groupNameKey) {
      groupNameCounts.set(entry.groupNameKey, (groupNameCounts.get(entry.groupNameKey) || 0) + 1);
    }
    if (entry.guideNameKey) {
      guideNameCounts.set(entry.guideNameKey, (guideNameCounts.get(entry.guideNameKey) || 0) + 1);
    }
    for (const key of entry.volunteerNameKeys || []) {
      volunteerNameKeyCounts.set(key, (volunteerNameKeyCounts.get(key) || 0) + 1);
    }
  }

  // Phase 1: per-row guide + volunteer matching (collect ids + reasons).
  const perRow = rows.map(({ excelRow, fields, refs }) => {
    const reasons = [];
    const guideNameKey = refs.guideNameRaw ? normalizeMatchName(refs.guideNameRaw) : null;
    const volunteerNameKeys = [...new Set(refs.volunteerNames.map(normalizeMatchName))];

    // ----- responsible guide -----
    let guideId = '';
    if (refs.guideNameRaw) {
      const matches = guides.filter(
        (g) => normalizeMatchName(guideDisplayName(g)) === guideNameKey,
      );
      if (matches.length === 0) {
        reasons.push('מדריך אחראי לא נמצא');
      } else if (matches.length > 1) {
        reasons.push('שם מדריך אחראי עמום — נמצאו כמה מדריכים תואמים');
      } else {
        const matched = matches[0];
        const id = guideIdOf(matched);
        const name = guideDisplayName(matched).trim();
        if (!id || !name) {
          reasons.push('רשומת המדריך חסרה מזהה או שם תקין');
        } else {
          guideId = id;
          // Fail-closed in BOTH directions, no reassignment: assigned via an
          // existing group, OR the guide record itself already carries a
          // groupId. A groupName WITHOUT a groupId is an inconsistent record —
          // block it too, never assume the guide is free.
          const guideGroupId = matched.groupId ? String(matched.groupId).trim() : '';
          const guideGroupName = matched.groupName ? String(matched.groupName).trim() : '';
          if (guideAlreadyAssigned.has(id) || guideGroupId) {
            reasons.push('המדריך כבר משויך לקבוצה אחרת — אין לשייך אותו דרך הקובץ');
          } else if (guideGroupName) {
            reasons.push('רשומת המדריך אינה עקבית (שם קבוצה ללא מזהה) — חסום עד לתיקון ידני');
          }
        }
      }
    }

    // ----- assigned volunteers -----
    const volunteerIds = [];
    for (const name of refs.volunteerNames) {
      const matches = volunteers.filter(
        (v) => normalizeMatchName(volunteerDisplayName(v)) === normalizeMatchName(name),
      );
      if (matches.length === 0) {
        reasons.push(`מתנדב לא נמצא: ${name}`);
        continue;
      }
      if (matches.length > 1) {
        reasons.push(`שם מתנדב עמום: ${name}`);
        continue;
      }
      const id = matches[0].id ? String(matches[0].id).trim() : '';
      if (!id) {
        reasons.push(`רשומת המתנדב חסרה מזהה: ${name}`);
        continue;
      }
      // Fail-closed both ways (same rule as the guide): a non-empty groupId is
      // already assigned; a groupName WITHOUT a groupId is inconsistent — block
      // it, never assume the volunteer is free. No clearing / migration here.
      const volunteerGroupId = matches[0].groupId ? String(matches[0].groupId).trim() : '';
      const volunteerGroupName = matches[0].groupName ? String(matches[0].groupName).trim() : '';
      if (volunteerGroupId) {
        reasons.push(`המתנדב כבר משויך לקבוצה: ${name}`);
        continue;
      }
      if (volunteerGroupName) {
        reasons.push(`רשומת המתנדב אינה עקבית (שם קבוצה ללא מזהה): ${name}`);
        continue;
      }
      volunteerIds.push(id);
    }

    return {
      excelRow,
      fields,
      reasons,
      guideId,
      volunteerIds,
      groupNameKey: normalizeMatchName(fields.groupName),
      guideNameKey,
      volunteerNameKeys,
    };
  });

  // Cross-row reuse counts are name-based (built above from nameIndexSource), so
  // a collision with a preflight-rejected row is caught — no separate id pass.

  // Phase 3: assemble final reasons + the write plan.
  const ready = [];
  const rejected = [];

  for (const r of perRow) {
    const reasons = [...r.reasons];

    // Group-name duplicate (in-file or vs existing).
    if ((groupNameCounts.get(r.groupNameKey) || 0) > 1) {
      reasons.push('שם קבוצה כפול בקובץ — כל השורות עם שם זה נדחו');
    }
    if (existingGroupNames.has(r.groupNameKey)) {
      reasons.push('שם קבוצה כבר קיים במערכת');
    }

    // Same guide name in two file rows (including a row rejected by preflight).
    if (r.guideNameKey && (guideNameCounts.get(r.guideNameKey) || 0) > 1) {
      reasons.push('אותו מדריך שובץ לכמה קבוצות בקובץ');
    }

    // Same volunteer name in two file rows (including a rejected row).
    if (r.volunteerNameKeys.some((key) => (volunteerNameKeyCounts.get(key) || 0) > 1)) {
      reasons.push('אותו מתנדב שובץ לכמה קבוצות בקובץ');
    }

    if (reasons.length > 0) {
      rejected.push({ excelRow: r.excelRow, reasons });
      continue;
    }

    // Atomic unit (future): group set + (guide link) + one update per volunteer.
    const operationCount = 1 + (r.guideId ? 1 : 0) + r.volunteerIds.length;

    ready.push({
      excelRow: r.excelRow,
      fields: r.fields,
      guideId: r.guideId,
      volunteerIds: r.volunteerIds,
      operationCount,
    });
  }

  return { ready, rejected };
}
