// Unit tests for the pure volunteer-import preparation + preflight.
import { describe, it, expect } from 'vitest';

// Real Excel engine — used to build genuine worksheets for the row-number and
// file-detection tests (so `__rowNum__` and header extraction are exercised).
import * as XLSX from 'xlsx';

import {
  prepareVolunteerImportRow,
  preflightVolunteerImport,
  detectImportFileType,
  resolveVolunteerImport,
  commitVolunteerChunks,
} from '../src/utils/volunteerImport.js';


// Build a raw row using the template's Hebrew header keys.
function row(overrides = {}) {
  return {
    'שם פרטי *': 'אבי',
    'שם משפחה *': 'כהן',
    ...overrides,
  };
}


describe('prepareVolunteerImportRow — names', () => {
  it('builds the full name from first + last', () => {
    const result = prepareVolunteerImportRow(row());
    expect(result.ok).toBe(true);
    expect(result.fields.name).toBe('אבי כהן');
  });

  it('treats an entirely empty row as blank (skipped, not an error)', () => {
    expect(prepareVolunteerImportRow({})).toEqual({ ok: true, blank: true });
  });

  it('rejects a row that has data but no name', () => {
    const result = prepareVolunteerImportRow({ 'טלפון': '0501234567' });
    expect(result.ok).toBe(false);
    expect(result.errors).toContain('חסר שם מתנדב');
  });
});


describe('prepareVolunteerImportRow — blank vs content', () => {
  it('treats {} as a blank row', () => {
    expect(prepareVolunteerImportRow({})).toEqual({ ok: true, blank: true });
  });

  it('treats a whitespace-only row as blank', () => {
    expect(prepareVolunteerImportRow({ 'שם פרטי *': '   ', 'טלפון': '  ' }))
      .toEqual({ ok: true, blank: true });
  });

  it('does NOT treat a numeric 0 phone as blank (rejects: missing name + bad phone)', () => {
    const result = prepareVolunteerImportRow({ 'טלפון': 0 });
    expect(result.ok).toBe(false);
    const reasons = result.errors.join(' ');
    expect(reasons).toMatch(/חסר שם/);
    expect(reasons).toMatch(/טלפון/);
  });

  it('does NOT treat a numeric 0 ID as blank (rejected, not skipped)', () => {
    const result = prepareVolunteerImportRow({ 'תעודת זהות': 0 });
    expect(result.ok).toBe(false);
    expect(result.errors.join(' ')).toMatch(/תעודת זהות/);
  });

  it('treats a row carrying only __rowNum__ as blank', () => {
    expect(prepareVolunteerImportRow({ __rowNum__: 4 })).toEqual({ ok: true, blank: true });
  });

  it('does NOT treat a value in an UNKNOWN column as blank (rejected: missing name)', () => {
    const result = prepareVolunteerImportRow({ 'עמודה לא מוכרת': 'ערך' });
    expect(result.ok).toBe(false);
    expect(result.errors).toContain('חסר שם מתנדב');
  });

  it('counts a typed 0 in an unknown column as content (not blank)', () => {
    const result = prepareVolunteerImportRow({ 'עמודה לא מוכרת': 0 });
    expect(result.ok).toBe(false); // not blank → validated → missing name
    expect(result.errors).toContain('חסר שם מתנדב');
  });

  it('rejects a row whose headers collide after normalization (no silent overwrite)', () => {
    const bom = String.fromCharCode(0xFEFF);
    const result = prepareVolunteerImportRow({
      'שם פרטי *': 'אבי',
      [bom + 'שם פרטי *']: 'דנה', // collapses to the same header
    });
    expect(result.ok).toBe(false);
    expect(result.errors.join(' ')).toMatch(/כותרות כפולות/);
  });
});


describe('prepareVolunteerImportRow — phone', () => {
  const accepted = ['0501234567', '050-123-4567', '+972501234567', '00972501234567'];

  it('accepts the supported phone shapes and normalizes to 05XXXXXXXX', () => {
    for (const phone of accepted) {
      const result = prepareVolunteerImportRow(row({ 'טלפון': phone }));
      expect(result.ok).toBe(true);
      expect(result.fields.phone).toBe('0501234567');
    }
  });

  it('accepts an empty phone (optional field)', () => {
    const result = prepareVolunteerImportRow(row({ 'טלפון': '' }));
    expect(result.ok).toBe(true);
    expect(result.fields.phone).toBe('');
  });

  it('rejects too-short / too-long phones', () => {
    expect(prepareVolunteerImportRow(row({ 'טלפון': '12345' })).ok).toBe(false);
    expect(prepareVolunteerImportRow(row({ 'טלפון': '050123456789' })).ok).toBe(false);
  });

  it('rejects a phone containing letters and masks it in the reason', () => {
    const result = prepareVolunteerImportRow(row({ 'טלפון': '050-12a-4567' }));
    expect(result.ok).toBe(false);
    const reason = result.errors.join(' ');
    expect(reason).toMatch(/טלפון/);
    expect(reason).toMatch(/\*/);            // masked
    expect(reason).not.toContain('12a4567'); // never the raw value
  });

  it('restores a numeric mobile that lost its leading 0, rejects an ambiguous numeric', () => {
    expect(prepareVolunteerImportRow(row({ 'טלפון': 501234567 })).fields.phone).toBe('0501234567');
    expect(prepareVolunteerImportRow(row({ 'טלפון': 81234567 })).ok).toBe(false);
  });
});


describe('prepareVolunteerImportRow — birth date', () => {
  it('decodes Excel serials in the 1900 and 1904 systems', () => {
    expect(prepareVolunteerImportRow(row({ 'תאריך לידה': 36326 })).fields.birthDate).toBe('1999-06-15');
    expect(
      prepareVolunteerImportRow(row({ 'תאריך לידה': 34864 }), { date1904: true }).fields.birthDate,
    ).toBe('1999-06-15');
  });

  it('accepts YYYY-MM-DD and day-first DD-MM-YYYY', () => {
    expect(prepareVolunteerImportRow(row({ 'תאריך לידה': '2026-06-27' })).fields.birthDate).toBe('2026-06-27');
    expect(prepareVolunteerImportRow(row({ 'תאריך לידה': '27-06-2026' })).fields.birthDate).toBe('2026-06-27');
  });

  it('rejects slash and impossible dates', () => {
    expect(prepareVolunteerImportRow(row({ 'תאריך לידה': '06/07/2026' })).ok).toBe(false);
    expect(prepareVolunteerImportRow(row({ 'תאריך לידה': '2026-02-29' })).ok).toBe(false);
  });

  it('accepts a Saturday birth date (no Saturday rule on dates)', () => {
    // 2026-06-27 is a Saturday — a birth date may fall on any day.
    const result = prepareVolunteerImportRow(row({ 'תאריך לידה': '2026-06-27' }));
    expect(result.ok).toBe(true);
    expect(result.fields.birthDate).toBe('2026-06-27');
  });
});


describe('prepareVolunteerImportRow — activity day', () => {
  it('normalizes a short day to the canonical full form', () => {
    expect(prepareVolunteerImportRow(row({ 'יום פעילות': 'ראשון' })).fields.day).toBe('יום ראשון');
  });

  it('accepts an empty day', () => {
    expect(prepareVolunteerImportRow(row({ 'יום פעילות': '' })).fields.day).toBe('');
  });
});


describe('prepareVolunteerImportRow — activity time', () => {
  it('accepts a canonical GROUP_TIMES value', () => {
    expect(prepareVolunteerImportRow(row({ 'זמן פעילות': 'בוקר' })).fields.activityTime).toBe('בוקר');
  });

  it('normalizes surrounding whitespace', () => {
    expect(prepareVolunteerImportRow(row({ 'זמן פעילות': '  בוקר  ' })).fields.activityTime).toBe('בוקר');
  });

  it('accepts an empty activity time', () => {
    expect(prepareVolunteerImportRow(row({ 'זמן פעילות': '' })).fields.activityTime).toBe('');
  });

  it('rejects an unknown activity time', () => {
    const result = prepareVolunteerImportRow(row({ 'זמן פעילות': 'morning' }));
    expect(result.ok).toBe(false);
    expect(result.errors.join(' ')).toMatch(/זמן פעילות/);
  });
});


describe('prepareVolunteerImportRow — age is a compatibility placeholder', () => {
  it('never reads an imported age; keeps fields.age = "" and birthDate intact', () => {
    const result = prepareVolunteerImportRow(row({ 'גיל (אוטומטי)': '99', 'תאריך לידה': '2000-01-02' }));
    expect(result.ok).toBe(true);
    expect(result.fields.age).toBe('');            // the file's 99 is ignored
    expect(result.fields.birthDate).toBe('2000-01-02');
  });
});


describe('prepareVolunteerImportRow — ID number', () => {
  it('keeps a string ID verbatim, preserving leading zeros', () => {
    expect(prepareVolunteerImportRow(row({ 'תעודת זהות': '012345678' })).fields.idNumber).toBe('012345678');
  });

  it('rejects a numeric ID cell (may have already dropped a leading zero)', () => {
    const result = prepareVolunteerImportRow(row({ 'תעודת זהות': 12345678 }));
    expect(result.ok).toBe(false);
    const reason = result.errors.join(' ');
    expect(reason).toMatch(/תעודת זהות/);
    expect(reason).not.toContain('12345678'); // never the raw ID
  });

  it('rejects a boolean ID without coercing it to "true"', () => {
    const result = prepareVolunteerImportRow(row({ 'תעודת זהות': true }));
    expect(result.ok).toBe(false);
    expect(result).not.toHaveProperty('value');
    expect(result.fields).toBeUndefined();
    const reason = result.errors.join(' ');
    expect(reason).toMatch(/תעודת זהות/);
    expect(reason).not.toContain('true');
  });

  it('rejects a Date / object / array ID and never String()-coerces it', () => {
    for (const bad of [new Date(), {}, []]) {
      const result = prepareVolunteerImportRow(row({ 'תעודת זהות': bad }));
      expect(result.ok).toBe(false);
      expect(result).not.toHaveProperty('value');
      expect(result.fields).toBeUndefined();
      const reason = result.errors.join(' ');
      expect(reason).toMatch(/תעודת זהות/);
      expect(reason).not.toContain('object'); // no "[object Object]" leakage
    }
  });
});


describe('preflightVolunteerImport', () => {
  it('separates valid, rejected and blank rows with Excel row numbers', () => {
    const rows = [
      row({ 'טלפון': '0501234567' }),                  // excel row 2 — valid
      { 'שם פרטי *': 'בת', 'יום פעילות': 'מחרתיים' },   // excel row 3 — rejected (bad day)
      {},                                              // excel row 4 — blank
      row({ 'תעודת זהות': 999999999 }),               // excel row 5 — rejected (numeric ID)
    ];

    const { valid, rejected, blankSkipped } = preflightVolunteerImport(rows);

    expect(valid).toHaveLength(1);
    expect(valid[0].excelRow).toBe(2);

    expect(blankSkipped).toBe(1);

    expect(rejected.map((r) => r.excelRow)).toEqual([3, 5]);
    expect(rejected[0].reasons.join(' ')).toMatch(/יום פעילות/);
  });

  it('keeps a corrupted row out of the write list entirely', () => {
    const rows = [row({ 'טלפון': '050-12a-4567' })];
    const { valid, rejected } = preflightVolunteerImport(rows);

    expect(valid).toHaveLength(0);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].excelRow).toBe(2);
  });

  it('passes the date1904 flag through to row parsing', () => {
    const rows = [row({ 'תאריך לידה': 34864 })];
    const { valid } = preflightVolunteerImport(rows, { date1904: true });

    expect(valid).toHaveLength(1);
    expect(valid[0].fields.birthDate).toBe('1999-06-15');
  });

  it('uses the TRUE Excel row number from a real worksheet (gap-aware)', () => {
    // Header row 1, valid row 2, EMPTY row 3, bad row 4 (invalid day).
    const aoa = [
      ['שם פרטי *', 'שם משפחה *', 'יום פעילות'],
      ['אבי', 'כהן', 'ראשון'],
      [],
      ['גד', 'מזרחי', 'מחרתיים'],
    ];
    const worksheet = XLSX.utils.aoa_to_sheet(aoa);
    const jsonRows = XLSX.utils.sheet_to_json(worksheet);

    const { valid, rejected } = preflightVolunteerImport(jsonRows);

    expect(valid).toHaveLength(1);
    expect(valid[0].excelRow).toBe(2);

    // The bad row must be reported as row 4 — NOT 3 (the empty row was skipped).
    expect(rejected).toHaveLength(1);
    expect(rejected[0].excelRow).toBe(4);
  });

  it('does not lose data when headers carry a BOM or surrounding spaces', () => {
    const bom = String.fromCharCode(0xFEFF);
    // First header has a leading BOM; "שם משפחה *" has surrounding spaces.
    const aoa = [
      [bom + 'שם פרטי *', '  שם משפחה *  ', 'טלפון'],
      ['אבי', 'כהן', '0501234567'],
    ];
    const worksheet = XLSX.utils.aoa_to_sheet(aoa);
    const jsonRows = XLSX.utils.sheet_to_json(worksheet);

    const { valid, rejected } = preflightVolunteerImport(jsonRows);

    expect(rejected).toHaveLength(0);
    expect(valid).toHaveLength(1);
    expect(valid[0].fields.name).toBe('אבי כהן');
    expect(valid[0].fields.phone).toBe('0501234567');
    expect(valid[0].excelRow).toBe(2);
  });
});


describe('detectImportFileType', () => {
  // Build a worksheet's header row exactly as the component reads it.
  function headerOf(aoa) {
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    return XLSX.utils.sheet_to_json(ws, { header: 1 })[0] || [];
  }

  it('detects a volunteers template', () => {
    const header = headerOf([['שם פרטי *', 'שם משפחה *', 'תעודת זהות', 'יום פעילות']]);
    expect(detectImportFileType(header)).toBe('volunteers');
  });

  it('detects a groups template WITH data rows', () => {
    const header = headerOf([
      ['שם קבוצה *', 'זמן פעילות', 'מדריך אחראי'],
      ['תותים', 'בוקר', 'דנה כהן'],
    ]);
    expect(detectImportFileType(header)).toBe('groups');
  });

  it('detects an EMPTY groups template (header only, no data rows)', () => {
    const header = headerOf([['שם קבוצה *', 'זמן פעילות', 'מדריך אחראי']]);
    expect(detectImportFileType(header)).toBe('groups');
  });

  it('returns unknown for an unrecognized file', () => {
    expect(detectImportFileType(headerOf([['foo', 'bar']]))).toBe('unknown');
    expect(detectImportFileType([])).toBe('unknown');
  });
});


describe('commitVolunteerChunks', () => {
  it('commits all chunks when every commit succeeds', async () => {
    const items = Array.from({ length: 5 }, (_, i) => ({ excelRow: i + 2, payload: { i } }));
    let calls = 0;

    const result = await commitVolunteerChunks(items, async () => { calls += 1; }, 2);

    expect(result.written).toBe(5);
    expect(result.failedInCurrentBatch).toBe(0);
    expect(result.notAttempted).toBe(0);
    expect(result.error).toBeNull();
    expect(calls).toBe(3); // 2 + 2 + 1
  });

  it('stops at the first failing chunk and reports accurate counts', async () => {
    // 1000 items, chunk 450 → batch1 ok, batch2 fails, batch3 never runs.
    const items = Array.from({ length: 1000 }, (_, i) => ({ excelRow: i + 2, payload: { i } }));
    let calls = 0;

    const commitChunk = async (payloads) => {
      // The Excel row number must NOT be part of the written payload.
      payloads.forEach((p) => expect(p).not.toHaveProperty('excelRow'));
      calls += 1;
      if (calls === 2) {
        throw new Error('emulated commit failure');
      }
    };

    const result = await commitVolunteerChunks(items, commitChunk, 450);

    expect(result.written).toBe(450);
    expect(result.failedInCurrentBatch).toBe(450);
    expect(result.notAttempted).toBe(100);
    expect(calls).toBe(2);               // the third commit was never attempted
    expect(result.error).toBeInstanceOf(Error);
    expect(result.failedRows).toHaveLength(450);
    expect(result.failedRows[0]).toBe(452); // first row of the failed slice
  });
});


describe('detectImportFileType — aliases & edge cases', () => {
  // Build the byte-order mark at runtime so the source stays pure ASCII.
  const BOM = String.fromCharCode(0xFEFF);

  it('accepts a file with only a full-name column', () => {
    expect(detectImportFileType(['שם מלא'])).toBe('volunteers');
    expect(detectImportFileType(['שם'])).toBe('volunteers');
  });

  it('accepts an English firstName + lastName file', () => {
    expect(detectImportFileType(['firstName', 'lastName'])).toBe('volunteers');
    expect(detectImportFileType(['name'])).toBe('volunteers');
  });

  it('tolerates a leading BOM and surrounding spaces in the header', () => {
    expect(detectImportFileType([BOM + 'שם פרטי *', '  שם משפחה *  '])).toBe('volunteers');
    expect(detectImportFileType([BOM + 'שם קבוצה *'])).toBe('groups');
  });

  it('returns ambiguous for a mixed file (group + volunteer headers)', () => {
    expect(detectImportFileType(['שם קבוצה *', 'שם פרטי *'])).toBe('ambiguous');
  });

  it('returns unknown when no known header is present', () => {
    expect(detectImportFileType(['foo', 'bar'])).toBe('unknown');
  });
});


describe('detectImportFileType — duplicate headers (real worksheet)', () => {
  const bom = String.fromCharCode(0xFEFF);

  // Read the header ROW exactly as the component does (header:1 keeps every cell,
  // including duplicates — unlike object mode, which renames duplicate keys).
  function headerOf(aoa) {
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    return XLSX.utils.sheet_to_json(ws, { header: 1 })[0] || [];
  }

  it('blocks two identical headers', () => {
    const header = headerOf([['שם פרטי *', 'שם פרטי *', 'טלפון']]);
    expect(detectImportFileType(header)).toBe('duplicate-headers');
  });

  it('blocks headers that collide only after BOM / trim', () => {
    expect(detectImportFileType(headerOf([[bom + 'שם פרטי *', 'שם פרטי *']]))).toBe('duplicate-headers');
    expect(detectImportFileType(headerOf([[' שם פרטי * ', 'שם פרטי *']]))).toBe('duplicate-headers');
  });

  it('blocks at the header stage even when only one duplicate column has data', () => {
    const header = headerOf([
      ['שם פרטי *', 'שם פרטי *', 'טלפון'],
      ['אבי', '', '0501234567'],
    ]);
    expect(detectImportFileType(header)).toBe('duplicate-headers');
  });
});


describe('resolveVolunteerImport', () => {
  // A preflight-validated row: { excelRow, fields }. Fields default to a named
  // volunteer with everything else empty; override per test.
  function vRow(excelRow, overrides = {}) {
    return {
      excelRow,
      fields: {
        name: 'אבי כהן', firstName: 'אבי', lastName: 'כהן',
        idNumber: '', phone: '', birthDate: '', age: '',
        address: '', email: '', experience: '', school: '', notes: '',
        activityTime: '', day: '', groupNameRaw: '', programNameRaw: '',
        ...overrides,
      },
    };
  }

  // ----- duplicate ID -----
  it('rejects BOTH rows that share an ID in the file (no first-wins)', () => {
    const rows = [vRow(2, { idNumber: '012345678' }), vRow(3, { idNumber: '012345678' })];
    const { readyToWrite, rejected } = resolveVolunteerImport(rows, {});

    expect(readyToWrite).toHaveLength(0);
    expect(rejected.map((r) => r.excelRow)).toEqual([2, 3]);
    // Never echo the raw ID.
    expect(rejected[0].reasons.join(' ')).not.toContain('012345678');
  });

  it('rejects a row whose ID already exists in Firestore', () => {
    const rows = [vRow(2, { idNumber: '012345678' })];
    const existingVolunteers = [{ idNumber: '012345678', name: 'אבי כהן', phone: '' }];
    const { readyToWrite, rejected } = resolveVolunteerImport(rows, { existingVolunteers });

    expect(readyToWrite).toHaveLength(0);
    expect(rejected[0].excelRow).toBe(2);
    expect(rejected[0].reasons.join(' ')).not.toContain('012345678');
  });

  it('flags a conflict when the same ID has a different name/phone in Firestore', () => {
    const rows = [vRow(2, { idNumber: '012345678', phone: '0501234567' })];
    const existingVolunteers = [{ idNumber: '012345678', name: 'מישהו אחר', phone: '0509999999' }];
    const { rejected } = resolveVolunteerImport(rows, { existingVolunteers });

    expect(rejected[0].reasons.join(' ')).toMatch(/התנגשות/);
  });

  // ----- same name, different identity -----
  it('allows two rows with the same name but different IDs (no other dup signal)', () => {
    const rows = [vRow(2, { idNumber: '011111111' }), vRow(3, { idNumber: '022222222' })];
    const { readyToWrite, rejected } = resolveVolunteerImport(rows, {});

    expect(readyToWrite).toHaveLength(2);
    expect(rejected).toHaveLength(0);
  });

  it('allows two rows that share ONLY a name (no id/phone/birthDate)', () => {
    const rows = [vRow(2), vRow(3)];
    const { readyToWrite, rejected } = resolveVolunteerImport(rows, {});

    expect(readyToWrite).toHaveLength(2);
    expect(rejected).toHaveLength(0);
  });

  // ----- phone -----
  it('rejects every row sharing a phone across formats (suspicion)', () => {
    const rows = [
      vRow(2, { phone: '050-123-4567' }),
      vRow(3, { phone: '0501234567' }),
      vRow(4, { phone: '+972501234567' }),
    ];
    const { readyToWrite, rejected } = resolveVolunteerImport(rows, {});

    expect(readyToWrite).toHaveLength(0);
    expect(rejected.map((r) => r.excelRow)).toEqual([2, 3, 4]);
    expect(rejected[0].reasons.join(' ')).not.toContain('0501234567');
  });

  it('flags a conflict when the same phone has different IDs', () => {
    const rows = [
      vRow(2, { phone: '0501234567', idNumber: '011111111' }),
      vRow(3, { phone: '0501234567', idNumber: '022222222' }),
    ];
    const { rejected } = resolveVolunteerImport(rows, {});

    expect(rejected).toHaveLength(2);
    expect(rejected[0].reasons.join(' ')).toMatch(/התנגשות/);
  });

  // ----- name + birthDate -----
  it('treats same name + birthDate as a duplicate suspicion', () => {
    const rows = [
      vRow(2, { birthDate: '2000-01-01', idNumber: '011111111' }),
      vRow(3, { birthDate: '2000-01-01', idNumber: '022222222' }),
    ];
    const { readyToWrite, rejected } = resolveVolunteerImport(rows, {});

    expect(readyToWrite).toHaveLength(0);
    expect(rejected).toHaveLength(2);
    expect(rejected[0].reasons.join(' ')).toMatch(/חשד לכפילות/);
  });

  // ----- group matching -----
  const groups = [{ id: 'g1', groupName: 'תותים' }];

  it('rejects an unknown group', () => {
    const { readyToWrite, rejected } = resolveVolunteerImport([vRow(2, { groupNameRaw: 'לא קיימת' })], { groups });
    expect(readyToWrite).toHaveLength(0);
    expect(rejected[0].reasons.join(' ')).toMatch(/קבוצה לא נמצאה/);
  });

  it('rejects an ambiguous group (more than one match)', () => {
    const dupGroups = [{ id: 'g1', groupName: 'תותים' }, { id: 'g2', groupName: 'תותים' }];
    const { rejected } = resolveVolunteerImport([vRow(2, { groupNameRaw: 'תותים' })], { groups: dupGroups });
    expect(rejected[0].reasons.join(' ')).toMatch(/עמום/);
  });

  it('matches a group case/whitespace-insensitively and uses its canonical id + name', () => {
    const enGroups = [{ id: 'g7', groupName: 'Blue Team' }];
    const { readyToWrite } = resolveVolunteerImport([vRow(2, { groupNameRaw: '  blue   team ' })], { groups: enGroups });
    expect(readyToWrite).toHaveLength(1);
    expect(readyToWrite[0].payload.groupId).toBe('g7');
    expect(readyToWrite[0].payload.groupName).toBe('Blue Team');
    // No raw name kept, no excelRow / createdAt leak into the payload.
    expect(readyToWrite[0].payload).not.toHaveProperty('excelRow');
    expect(readyToWrite[0].payload).not.toHaveProperty('createdAt');
  });

  // ----- program matching -----
  const programs = [{ id: 'p1', name: 'תוכנית א' }];

  it('rejects an unknown program', () => {
    const { rejected } = resolveVolunteerImport([vRow(2, { programNameRaw: 'אין כזו' })], { programs });
    expect(rejected[0].reasons.join(' ')).toMatch(/תוכנית לא נמצאה/);
  });

  it('rejects an ambiguous program', () => {
    const dupPrograms = [{ id: 'p1', name: 'תוכנית א' }, { id: 'p2', name: 'תוכנית א' }];
    const { rejected } = resolveVolunteerImport([vRow(2, { programNameRaw: 'תוכנית א' })], { programs: dupPrograms });
    expect(rejected[0].reasons.join(' ')).toMatch(/עמום/);
  });

  it('matches a program case/whitespace-insensitively and uses its canonical id + name', () => {
    const { readyToWrite } = resolveVolunteerImport([vRow(2, { programNameRaw: '  תוכנית   א ' })], { programs });
    expect(readyToWrite).toHaveLength(1);
    expect(readyToWrite[0].payload.programId).toBe('p1');
    expect(readyToWrite[0].payload.programName).toBe('תוכנית א');
  });

  // ----- passedGroup (locked group) -----
  const passedGroup = { id: 'gP', groupName: 'קבוצה נעולה' };

  it('uses the locked group when the row group is empty', () => {
    const { readyToWrite } = resolveVolunteerImport([vRow(2, { groupNameRaw: '' })], { passedGroup });
    expect(readyToWrite[0].payload.groupId).toBe('gP');
    expect(readyToWrite[0].payload.groupName).toBe('קבוצה נעולה');
  });

  it('accepts a row group that matches the locked group', () => {
    const { readyToWrite } = resolveVolunteerImport([vRow(2, { groupNameRaw: 'קבוצה נעולה' })], { passedGroup });
    expect(readyToWrite[0].payload.groupId).toBe('gP');
  });

  it('rejects a different group as a conflict — even if it exists elsewhere', () => {
    const otherGroups = [{ id: 'g2', groupName: 'קבוצה אחרת' }];
    const { readyToWrite, rejected } = resolveVolunteerImport(
      [vRow(2, { groupNameRaw: 'קבוצה אחרת' })],
      { passedGroup, groups: otherGroups },
    );
    expect(readyToWrite).toHaveLength(0);
    expect(rejected[0].reasons.join(' ')).toMatch(/הנעולה/);
  });

  // ----- no mutation of existing records -----
  it('never mutates the existing volunteers it reads', () => {
    const existingVolunteers = [{ idNumber: '012345678', name: 'אבי כהן', phone: '0501234567' }];
    const snapshot = JSON.parse(JSON.stringify(existingVolunteers));

    resolveVolunteerImport([vRow(2, { idNumber: '012345678' })], { existingVolunteers });

    expect(existingVolunteers).toEqual(snapshot);
  });

  // ----- cross-row dedupe vs preflight-REJECTED rows (allRowIdentities) -----
  it('rejects a valid row that shares an ID with a preflight-rejected (bad-day) row', () => {
    const jsonRows = [
      { 'שם פרטי *': 'אבי', 'שם משפחה *': 'כהן', 'תעודת זהות': '012345678' },
      { 'שם פרטי *': 'דנה', 'שם משפחה *': 'לוי', 'תעודת זהות': '012345678', 'יום פעילות': 'מחרתיים' },
    ];
    const { valid, rejected: preflightRejected, identities } = preflightVolunteerImport(jsonRows);

    // The bad-day row's own error is preserved by preflight.
    expect(preflightRejected.map((r) => r.excelRow)).toEqual([3]);

    const { readyToWrite, rejected } = resolveVolunteerImport(valid, { allRowIdentities: identities });
    expect(readyToWrite).toHaveLength(0);
    expect(rejected.map((r) => r.excelRow)).toEqual([2]); // the valid row, now a duplicate
    expect(rejected[0].reasons.join(' ')).not.toContain('012345678');
  });

  it('rejects a valid row that shares a phone with a row rejected for another reason', () => {
    const jsonRows = [
      { 'שם פרטי *': 'אבי', 'שם משפחה *': 'כהן', 'טלפון': '0501234567' },
      // numeric ID → preflight-rejected, but its (valid) phone still indexes.
      { 'שם פרטי *': 'דנה', 'שם משפחה *': 'לוי', 'טלפון': '0501234567', 'תעודת זהות': 12345678 },
    ];
    const { valid, identities } = preflightVolunteerImport(jsonRows);
    const { readyToWrite, rejected } = resolveVolunteerImport(valid, { allRowIdentities: identities });

    expect(readyToWrite).toHaveLength(0);
    expect(rejected[0].reasons.join(' ')).not.toContain('0501234567');
  });

  it('does not write a row whose name+birthDate matches a row rejected for another reason', () => {
    const jsonRows = [
      { 'שם פרטי *': 'אבי', 'שם משפחה *': 'כהן', 'תאריך לידה': '2000-01-01' },
      { 'שם פרטי *': 'אבי', 'שם משפחה *': 'כהן', 'תאריך לידה': '2000-01-01', 'יום פעילות': 'מחרתיים' },
    ];
    const { valid, identities } = preflightVolunteerImport(jsonRows);
    const { readyToWrite } = resolveVolunteerImport(valid, { allRowIdentities: identities });

    expect(readyToWrite).toHaveLength(0);
  });

  // ----- existing-volunteer (Firestore snapshot) checks -----
  it('matches an existing +972 phone against a locally-formatted import phone', () => {
    const existingVolunteers = [{ phone: '+972501234567', name: 'מישהו' }];
    const { readyToWrite, rejected } = resolveVolunteerImport([vRow(2, { phone: '0501234567' })], { existingVolunteers });
    expect(readyToWrite).toHaveLength(0);
    expect(rejected[0].reasons.join(' ')).toMatch(/חשד לכפילות/);
  });

  it('flags a conflict for an existing phone with a different ID', () => {
    const existingVolunteers = [{ phone: '0501234567', idNumber: '011111111' }];
    const { rejected } = resolveVolunteerImport([vRow(2, { phone: '0501234567', idNumber: '022222222' })], { existingVolunteers });
    expect(rejected[0].reasons.join(' ')).toMatch(/התנגשות/);
  });

  it('treats an existing phone with no comparable import ID as a suspicion (not a conflict, not a merge)', () => {
    const existingVolunteers = [{ phone: '0501234567', idNumber: '011111111' }];
    const { readyToWrite, rejected } = resolveVolunteerImport([vRow(2, { phone: '0501234567' })], { existingVolunteers });
    expect(readyToWrite).toHaveLength(0);
    expect(rejected[0].reasons.join(' ')).toMatch(/חשד לכפילות/);
  });

  it('rejects when name + birthDate already exist in Firestore', () => {
    const existingVolunteers = [{ name: 'אבי כהן', birthDate: '2000-01-01' }];
    const { readyToWrite, rejected } = resolveVolunteerImport([vRow(2, { birthDate: '2000-01-01' })], { existingVolunteers });
    expect(readyToWrite).toHaveLength(0);
    expect(rejected[0].reasons.join(' ')).toMatch(/חשד לכפילות/);
  });

  it('allows a row that shares ONLY a name with an existing record', () => {
    const existingVolunteers = [{ name: 'אבי כהן', phone: '', idNumber: '' }];
    const { readyToWrite, rejected } = resolveVolunteerImport([vRow(2)], { existingVolunteers });
    expect(readyToWrite).toHaveLength(1);
    expect(rejected).toHaveLength(0);
  });

  it('does not false-match against a legacy, non-normalizable existing phone', () => {
    const existingVolunteers = [{ phone: '12345', name: 'X' }];
    const { readyToWrite } = resolveVolunteerImport([vRow(2, { phone: '0501234567' })], { existingVolunteers });
    expect(readyToWrite).toHaveLength(1);
  });

  // ----- group / program record integrity -----
  it('rejects a matched group that has no id', () => {
    const { readyToWrite, rejected } = resolveVolunteerImport([vRow(2, { groupNameRaw: 'תותים' })], { groups: [{ groupName: 'תותים' }] });
    expect(readyToWrite).toHaveLength(0);
    expect(rejected[0].reasons.join(' ')).toMatch(/חסרה מזהה/);
  });

  it('rejects a matched program that has no id', () => {
    const { readyToWrite, rejected } = resolveVolunteerImport([vRow(2, { programNameRaw: 'תוכנית א' })], { programs: [{ name: 'תוכנית א' }] });
    expect(readyToWrite).toHaveLength(0);
    expect(rejected[0].reasons.join(' ')).toMatch(/חסרה מזהה/);
  });

  it('rejects when the locked group (passedGroup) has no id', () => {
    const { readyToWrite, rejected } = resolveVolunteerImport([vRow(2, { groupNameRaw: '' })], { passedGroup: { groupName: 'נעולה' } });
    expect(readyToWrite).toHaveLength(0);
    expect(rejected[0].reasons.join(' ')).toMatch(/חסרה מזהה/);
  });

  // ----- existing birthDate normalization for the name+birthDate key -----
  it('rejects an import whose name+birthDate equals an existing strict YYYY-MM-DD record', () => {
    const existingVolunteers = [{ name: 'אבי כהן', birthDate: '2000-01-02' }];
    const { readyToWrite } = resolveVolunteerImport([vRow(2, { birthDate: '2000-01-02' })], { existingVolunteers });
    expect(readyToWrite).toHaveLength(0);
  });

  it('normalizes an existing DD-MM-YYYY birthDate before matching the import', () => {
    const existingVolunteers = [{ name: 'אבי כהן', birthDate: '02-01-2000' }];
    const { readyToWrite, rejected } = resolveVolunteerImport([vRow(2, { birthDate: '2000-01-02' })], { existingVolunteers });
    expect(readyToWrite).toHaveLength(0);
    expect(rejected[0].reasons.join(' ')).toMatch(/חשד לכפילות/);
  });

  it('does not false-match an existing invalid birthDate, and never shifts the written value', () => {
    const existingVolunteers = [{ name: 'אבי כהן', birthDate: 'not-a-date' }];
    const { readyToWrite } = resolveVolunteerImport([vRow(2, { birthDate: '2000-01-02' })], { existingVolunteers });
    expect(readyToWrite).toHaveLength(1);
    expect(readyToWrite[0].payload.birthDate).toBe('2000-01-02');
  });

  it('never normalizes a NON-STRING existing birthDate (Date / serial / parts / Timestamp-like)', () => {
    const nonStringBirthDates = [
      new Date(Date.UTC(2000, 0, 2)),                 // Date
      36528,                                          // Excel-like serial number
      { y: 2000, m: 1, d: 2 },                        // decoded parts object
      { seconds: 946771200, nanoseconds: 0, toDate() { return new Date(Date.UTC(2000, 0, 2)); } }, // Timestamp-like
    ];

    for (const birthDate of nonStringBirthDates) {
      const existingVolunteers = [{ name: 'אבי כהן', birthDate }];
      const { readyToWrite } = resolveVolunteerImport([vRow(2, { birthDate: '2000-01-02' })], { existingVolunteers });
      expect(readyToWrite).toHaveLength(1); // no false name+birthDate match
      expect(readyToWrite[0].payload.birthDate).toBe('2000-01-02'); // import value unchanged
    }
  });

  it('still matches a string existing birthDate in YYYY-MM-DD and DD-MM-YYYY', () => {
    for (const existingBirth of ['2000-01-02', '02-01-2000']) {
      const existingVolunteers = [{ name: 'אבי כהן', birthDate: existingBirth }];
      const { readyToWrite } = resolveVolunteerImport([vRow(2, { birthDate: '2000-01-02' })], { existingVolunteers });
      expect(readyToWrite).toHaveLength(0);
    }
  });

  it('writes the canonical idNumber/phone but no identity-key metadata in the payload', () => {
    const { readyToWrite } = resolveVolunteerImport(
      [vRow(2, { idNumber: '012345678', phone: '0501234567' })],
      {},
    );
    const payload = readyToWrite[0].payload;

    expect(payload.idNumber).toBe('012345678');
    expect(payload.phone).toBe('0501234567');
    expect(payload.age).toBe('');               // compatibility placeholder, kept as ''
    expect(payload).not.toHaveProperty('idKey');
    expect(payload).not.toHaveProperty('phoneKey');
    expect(payload).not.toHaveProperty('nameBirthKey');
  });
});
