// Unit tests for the pure volunteer-import preparation + preflight.
import { describe, it, expect } from 'vitest';

// Real Excel engine — used to build genuine worksheets for the row-number and
// file-detection tests (so `__rowNum__` and header extraction are exercised).
import * as XLSX from 'xlsx';

import {
  prepareVolunteerImportRow,
  preflightVolunteerImport,
  detectImportFileType,
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

  it('rejects a Saturday activity day (both spellings)', () => {
    expect(prepareVolunteerImportRow(row({ 'יום פעילות': 'שבת' })).ok).toBe(false);
    expect(prepareVolunteerImportRow(row({ 'יום פעילות': 'יום שבת' })).ok).toBe(false);
  });

  it('accepts an empty day', () => {
    expect(prepareVolunteerImportRow(row({ 'יום פעילות': '' })).fields.day).toBe('');
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
      row({ 'טלפון': '0501234567' }),                 // excel row 2 — valid
      { 'שם פרטי *': 'בת', 'יום פעילות': 'שבת' },      // excel row 3 — rejected (Saturday)
      {},                                              // excel row 4 — blank
      row({ 'תעודת זהות': 999999999 }),               // excel row 5 — rejected (numeric ID)
    ];

    const { valid, rejected, blankSkipped } = preflightVolunteerImport(rows);

    expect(valid).toHaveLength(1);
    expect(valid[0].excelRow).toBe(2);

    expect(blankSkipped).toBe(1);

    expect(rejected.map((r) => r.excelRow)).toEqual([3, 5]);
    expect(rejected[0].reasons.join(' ')).toMatch(/שבת/);
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
    // Header row 1, valid row 2, EMPTY row 3, bad row 4 (Saturday).
    const aoa = [
      ['שם פרטי *', 'שם משפחה *', 'יום פעילות'],
      ['אבי', 'כהן', 'ראשון'],
      [],
      ['גד', 'מזרחי', 'שבת'],
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
