// Real template → import round-trip for the VOLUNTEERS template.
// Builds the actual workbook with the existing template code (no DOM), reads it
// back with SheetJS exactly as the component does, and pushes it through the
// pure preflight + resolve pipeline.
import { describe, it, expect } from 'vitest';

import * as XLSX from 'xlsx';

import { buildVolunteersWorkbook } from '../src/utils/excelTemplates.js';
import {
  preflightVolunteerImport,
  resolveVolunteerImport,
} from '../src/utils/volunteerImport.js';

// Shared sources — the test compares the template's dropdowns against THESE,
// rather than re-listing the values.
import { ACTIVITY_DAYS } from '../src/utils/activityDays.js';
import { GROUP_TIMES } from '../src/utils/groupOptions.js';


const groups = [{ id: 'g1', groupName: 'תותים' }];
const programs = [{ id: 'p1', name: 'תוכנית א' }];

// Build the real template, fill row 2 via the callback, return the SheetJS read.
async function buildAndRead(fill) {
  const workbook = await buildVolunteersWorkbook(groups, programs);
  fill(workbook.getWorksheet('מתנדבים'));
  const buffer = await workbook.xlsx.writeBuffer();
  const wb = XLSX.read(new Uint8Array(buffer), { type: 'array' }); // exactly like the component
  return { workbook, wb };
}

const EXPECTED_HEADERS = [
  'שם פרטי *', 'שם משפחה *', 'תעודת זהות', 'טלפון', 'אימייל',
  'תאריך לידה', 'גיל (אוטומטי)', 'קבוצה', 'תוכנית', 'יום פעילות', 'זמן פעילות',
  'כתובת', 'בית ספר', 'ניסיון קודם', 'הערות',
];


describe('volunteers template → import round-trip', () => {
  it('has the expected sheet structure and headers (including זמן פעילות)', async () => {
    const workbook = await buildVolunteersWorkbook(groups, programs);

    // Sheet order: data sheet first, hidden lists second (veryHidden).
    expect(workbook.worksheets.map((ws) => ws.name)).toEqual(['מתנדבים', 'רשימות']);
    expect(workbook.worksheets[0].name).toBe('מתנדבים');
    expect(workbook.getWorksheet('רשימות').state).toBe('veryHidden');

    const buffer = await workbook.xlsx.writeBuffer();
    const wb = XLSX.read(new Uint8Array(buffer), { type: 'array' });
    const header = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1 })[0];

    for (const expected of EXPECTED_HEADERS) {
      expect(header).toContain(expected);
    }
  });

  it('round-trips a valid row with an empty age placeholder and no internal keys', async () => {
    const { wb } = await buildAndRead((sheet) => {
      sheet.getCell('A2').value = 'אבי';
      sheet.getCell('B2').value = 'כהן';
      sheet.getCell('C2').value = '012345678';                       // ID (text column)
      sheet.getCell('D2').value = '0501234567';                      // phone (text column)
      sheet.getCell('F2').value = new Date(Date.UTC(1999, 5, 15, 12)); // real Excel date (1900 system)
      sheet.getCell('H2').value = 'תותים';                            // group
      sheet.getCell('I2').value = 'תוכנית א';                         // program
      sheet.getCell('J2').value = 'יום ראשון';                        // activity day
      sheet.getCell('K2').value = 'בוקר';                             // activity time
    });

    const ws = wb.Sheets[wb.SheetNames[0]];
    const jsonRows = XLSX.utils.sheet_to_json(ws);
    const date1904 = Boolean(wb.Workbook?.WBProps?.date1904);

    const { valid, identities } = preflightVolunteerImport(jsonRows, { date1904 });
    const { readyToWrite } = resolveVolunteerImport(valid, { groups, programs, allRowIdentities: identities });

    expect(readyToWrite).toHaveLength(1);
    const payload = readyToWrite[0].payload;

    expect(payload.idNumber).toBe('012345678');     // leading zero kept
    expect(payload.phone).toBe('0501234567');       // leading zero kept
    expect(payload.birthDate).toBe('1999-06-15');   // 1900-system serial decoded
    expect(payload.day).toBe('יום ראשון');
    expect(payload.activityTime).toBe('בוקר');
    expect(payload.groupId).toBe('g1');
    expect(payload.programId).toBe('p1');

    expect(payload.age).toBe('');               // compatibility placeholder, kept as ''
    expect(payload).not.toHaveProperty('excelRow');
    expect(payload).not.toHaveProperty('idKey');
    expect(payload).not.toHaveProperty('phoneKey');
    expect(payload).not.toHaveProperty('nameBirthKey');
  });

  it('keeps ID and phone as TEXT cells — leading zeros preserved, not numbers', async () => {
    const { wb } = await buildAndRead((sheet) => {
      sheet.getCell('A2').value = 'אבי';
      sheet.getCell('B2').value = 'כהן';
      sheet.getCell('C2').value = '012345678';
      sheet.getCell('D2').value = '0501234567';
    });

    const ws = wb.Sheets[wb.SheetNames[0]];
    expect(ws.C2.t).toBe('s'); // string cell type
    expect(ws.D2.t).toBe('s');
    expect(ws.C2.v).toBe('012345678');
    expect(ws.D2.v).toBe('0501234567');
  });

  it('reads a DD-MM-YYYY birth-date string day-first (no day/month swap)', async () => {
    const { wb } = await buildAndRead((sheet) => {
      sheet.getCell('A2').value = 'אבי';
      sheet.getCell('B2').value = 'כהן';
      sheet.getCell('F2').value = '06-07-2026'; // DD-MM-YYYY → 6 July 2026
    });

    const jsonRows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
    const { valid } = preflightVolunteerImport(jsonRows);
    const { readyToWrite } = resolveVolunteerImport(valid, {});

    expect(readyToWrite[0].payload.birthDate).toBe('2026-07-06');
  });

  it('rejects a Saturday activity day but accepts a Saturday birth date', async () => {
    // Saturday in the activity-day column → rejected.
    const sat = await buildAndRead((sheet) => {
      sheet.getCell('A2').value = 'אבי';
      sheet.getCell('B2').value = 'כהן';
      sheet.getCell('J2').value = 'שבת';
    });
    const satPre = preflightVolunteerImport(XLSX.utils.sheet_to_json(sat.wb.Sheets[sat.wb.SheetNames[0]]));
    expect(satPre.valid).toHaveLength(0);
    expect(satPre.rejected[0].reasons.join(' ')).toMatch(/שבת/);

    // A Saturday calendar BIRTH date (2026-06-27) → accepted.
    const bday = await buildAndRead((sheet) => {
      sheet.getCell('A2').value = 'אבי';
      sheet.getCell('B2').value = 'כהן';
      sheet.getCell('F2').value = '2026-06-27';
    });
    const { valid } = preflightVolunteerImport(XLSX.utils.sheet_to_json(bday.wb.Sheets[bday.wb.SheetNames[0]]));
    const { readyToWrite } = resolveVolunteerImport(valid, {});
    expect(readyToWrite[0].payload.birthDate).toBe('2026-06-27');
  });

  it('still imports an OLD file with no זמן פעילות column (activityTime → "")', () => {
    // Header-name based import — an old export simply has no 'זמן פעילות' key.
    const jsonRows = [{ 'שם פרטי *': 'אבי', 'שם משפחה *': 'כהן' }];
    const { valid } = preflightVolunteerImport(jsonRows);
    const { readyToWrite } = resolveVolunteerImport(valid, {});

    expect(readyToWrite).toHaveLength(1);
    expect(readyToWrite[0].payload.activityTime).toBe('');
  });

  it('defines the column formats + validations in the TEMPLATE (verified via an ExcelJS reload)', async () => {
    // Dynamic import inside the test only — the app path keeps exceljs lazy.
    const ExcelJS = (await import('exceljs')).default;

    const workbook = await buildVolunteersWorkbook(groups, programs);
    const buffer = await workbook.xlsx.writeBuffer();

    const reloaded = new ExcelJS.Workbook();
    await reloaded.xlsx.load(buffer);
    const sheet = reloaded.getWorksheet('מתנדבים');

    // ID + phone columns are TEXT (@) — proven by the template, not by what the
    // test wrote — so leading zeros survive.
    expect(sheet.getCell('C2').numFmt).toBe('@');
    expect(sheet.getCell('D2').numFmt).toBe('@');

    // Birth date is a real date displayed dd-mm-yyyy, with a dash example (no slash).
    expect(sheet.getCell('F2').numFmt).toBe('dd-mm-yyyy');
    const dateVal = sheet.getCell('F2').dataValidation;
    expect(dateVal.type).toBe('date');
    expect(dateVal.error).toContain('15-06-1999');
    expect(dateVal.error).not.toContain('15/06/1999');

    // Activity-day dropdown = canonical Sun–Fri (from the shared source), no שבת.
    const dayVal = sheet.getCell('J2').dataValidation;
    expect(dayVal.type).toBe('list');
    expect(dayVal.formulae[0]).toBe(`"${ACTIVITY_DAYS.join(',')}"`);
    expect(dayVal.formulae[0]).not.toContain('שבת');

    // Activity-time dropdown = exactly GROUP_TIMES (no extra/missing value).
    const timeVal = sheet.getCell('K2').dataValidation;
    expect(timeVal.type).toBe('list');
    expect(timeVal.formulae[0]).toBe(`"${GROUP_TIMES.join(',')}"`);
  });

  it('rejects an unknown activity time through the full pipeline', async () => {
    const { wb } = await buildAndRead((sheet) => {
      sheet.getCell('A2').value = 'אבי';
      sheet.getCell('B2').value = 'כהן';
      sheet.getCell('K2').value = 'זמן לא קיים';
    });

    const jsonRows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
    const { valid, rejected, identities } = preflightVolunteerImport(jsonRows);

    expect(valid).toHaveLength(0);
    expect(rejected.map((r) => r.excelRow)).toEqual([2]);
    expect(rejected[0].reasons.join(' ')).toMatch(/זמן פעילות/);

    const { readyToWrite } = resolveVolunteerImport(valid, { allRowIdentities: identities });
    expect(readyToWrite).toHaveLength(0);
    // The raw value never reaches a written payload.
    expect(JSON.stringify(readyToWrite)).not.toContain('זמן לא קיים');
  });

  // Note: the 1904 date system is covered by the serial unit tests in
  // importValidation.test.js / volunteerImport.test.js (serial 34864 → 1999-06-15);
  // exceljs does not let us write a 1904 workbook reliably, so it is not built here.
});
