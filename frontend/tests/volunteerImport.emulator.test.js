// Template-to-Firestore integration test for VOLUNTEERS (EMULATOR ONLY,
// project demo-kehila).
//
// Each test drives the real import pipeline against the Firestore emulator,
// exercising the REAL writer (commitVolunteerChunk) — never a copy:
//   seed groups/programs/admin → buildVolunteersWorkbook → writeBuffer
//   → XLSX.read → detectImportFileType → sheet_to_json → preflightVolunteerImport
//   → resolveVolunteerImport → commitVolunteerChunks(+ real commitVolunteerChunk)
//   → Firestore emulator.
//
// This is a template-to-Firestore INTEGRATION test. It is explicitly NOT a
// React / UI end-to-end test: no component is mounted and handleFileUpload was
// NOT triggered through a file input. Firebase Rules are exercised via an
// AUTHENTICATED ADMIN context (the real firestore.rules are loaded and enforced).
//
// EXCLUDED from the default vitest run (needs the emulators). Run it with the
// full emulator suite up, e.g. from the repo root:
//   firebase emulators:exec --project demo-kehila \
//     "npx vitest run --root frontend tests/volunteerImport.emulator.test.js"
//
// Privacy: only counts, masked reasons and demo ids are asserted/printed — never
// a full phone or full id from a person record.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, getDocs } from 'firebase/firestore';
import * as XLSX from 'xlsx';

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { buildVolunteersWorkbook } from '../src/utils/excelTemplates.js';
import {
  detectImportFileType,
  preflightVolunteerImport,
  resolveVolunteerImport,
  commitVolunteerChunks,
} from '../src/utils/volunteerImport.js';
import { commitVolunteerChunk } from '../src/utils/volunteerImportWriter.js';


const firestoreRulesPath = fileURLToPath(new URL('../../firestore.rules', import.meta.url));

const ADMIN_UID = 'admin1';

let testEnv;

const adminDb = () => testEnv.authenticatedContext(ADMIN_UID).firestore();

// Load the resolver's match sources (groups + programs) FROM the emulator, the
// same way the screen builds them from its snapshots — proving the canonical
// references come from Firestore, not from local test constants.
async function readVolunteerImportReferences(db) {
  const [groupsSnap, programsSnap] = await Promise.all([
    getDocs(collection(db, 'groups')),
    getDocs(collection(db, 'programs')),
  ]);
  return {
    groups: groupsSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
    programs: programsSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
  };
}

// Read the live volunteers snapshot back from the emulator, shaped like the
// component's state (id + data).
async function readVolunteers(db) {
  const snap = await getDocs(collection(db, 'volunteers'));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

// Build the real volunteers workbook from the LOADED references, fill row 2,
// read it back with SheetJS, and return the parsed rows + raw header.
async function buildAndParseVolunteerRow(refs, fill) {
  const workbook = await buildVolunteersWorkbook(refs.groups, refs.programs);
  fill(workbook.getWorksheet('מתנדבים'));
  const buffer = await workbook.xlsx.writeBuffer();
  const wb = XLSX.read(new Uint8Array(buffer), { type: 'array' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  return {
    headerRow: XLSX.utils.sheet_to_json(ws, { header: 1 })[0] || [],
    jsonRows: XLSX.utils.sheet_to_json(ws),
    date1904: Boolean(wb.Workbook?.WBProps?.date1904),
  };
}

// Run the pure pipeline → itemsToWrite, using the emulator-loaded references.
// createdAt is added at the write boundary, exactly as the component does.
function pipelineToItems(jsonRows, date1904, existingVolunteers, refs) {
  const { valid, rejected: pre, identities } = preflightVolunteerImport(jsonRows, { date1904 });
  const { readyToWrite, rejected: res } = resolveVolunteerImport(valid, {
    existingVolunteers,
    groups: refs.groups,
    programs: refs.programs,
    allRowIdentities: identities,
  });
  const items = readyToWrite.map(({ excelRow, payload }) => ({
    excelRow,
    payload: { ...payload, createdAt: new Date() },
  }));
  return { items, readyToWrite, rejected: [...pre, ...res] };
}


beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'demo-kehila',
    firestore: { rules: readFileSync(firestoreRulesPath, 'utf8') },
  });
});

afterAll(async () => {
  if (testEnv) await testEnv.cleanup();
});

// Seed (rules disabled — this is setup, not the thing under test): an active
// admin, one canonical group and one canonical program. The group/program are
// later read back THROUGH the resolver path so the test proves Firestore-sourced
// references, not local constants.
beforeEach(async () => {
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await db.collection('users').doc(ADMIN_UID).set({ role: 'admin' });
    await db.collection('groups').doc('g1').set({ groupName: 'תותים' });
    await db.collection('programs').doc('p1').set({ name: 'תוכנית א' });
  });
});


describe('template-to-Firestore integration test — volunteers (emulator, admin context)', () => {
  it('imports one canonical volunteer using group/program references loaded from Firestore', async () => {
    const db = adminDb();

    // References come from the emulator snapshot (read via the admin context),
    // not from local constants.
    const refs = await readVolunteerImportReferences(db);
    expect(refs.groups).toHaveLength(1);
    expect(refs.programs).toHaveLength(1);

    const { headerRow, jsonRows, date1904 } = await buildAndParseVolunteerRow(refs, (sheet) => {
      sheet.getCell('A2').value = 'אבי';                                 // first name
      sheet.getCell('B2').value = 'כהן';                                 // last name
      sheet.getCell('C2').value = '012345678';                          // ID (text, leading zero)
      sheet.getCell('D2').value = '+972501234567';                      // phone (+972 form)
      sheet.getCell('F2').value = new Date(Date.UTC(1999, 5, 15, 12));  // real Excel date
      sheet.getCell('H2').value = 'תותים';                              // group (from snapshot)
      sheet.getCell('I2').value = 'תוכנית א';                           // program (from snapshot)
      sheet.getCell('J2').value = 'ראשון';                             // short day
      sheet.getCell('K2').value = 'בוקר';                              // activity time
    });

    expect(detectImportFileType(headerRow)).toBe('volunteers');

    const { items } = pipelineToItems(jsonRows, date1904, [], refs);
    expect(items).toHaveLength(1);

    const result = await commitVolunteerChunks(items, (payloads) => commitVolunteerChunk(db, payloads), 450);
    expect(result.written).toBe(1);
    expect(result.error).toBeNull();

    const written = await readVolunteers(db);
    expect(written).toHaveLength(1);
    const v = written[0];

    expect(v.idNumber).toBe('012345678');     // leading zero preserved (string)
    expect(v.phone).toBe('0501234567');       // +972 normalized to local
    expect(v.birthDate).toBe('1999-06-15');   // serial decoded to YYYY-MM-DD
    expect(v.day).toBe('יום ראשון');           // short → canonical full form
    expect(v.activityTime).toBe('בוקר');
    // Canonical references resolved from the FIRESTORE snapshot.
    expect(v.groupId).toBe('g1');
    expect(v.groupName).toBe('תותים');
    expect(v.programId).toBe('p1');
    expect(v.programName).toBe('תוכנית א');
    expect(v.age).toBe('');                    // compatibility placeholder
    // No internal metadata ever reaches the document.
    expect(v).not.toHaveProperty('excelRow');
    expect(v).not.toHaveProperty('idKey');
    expect(v).not.toHaveProperty('phoneKey');
    expect(v).not.toHaveProperty('nameBirthKey');
  });

  it('a rejected row (bad phone) reaches NO writer and writes NO document, with a masked reason', async () => {
    const db = adminDb();
    const refs = await readVolunteerImportReferences(db);

    const { jsonRows, date1904 } = await buildAndParseVolunteerRow(refs, (sheet) => {
      sheet.getCell('A2').value = 'אבי';
      sheet.getCell('B2').value = 'כהן';
      sheet.getCell('D2').value = '050-12a-4567'; // letters in phone
    });

    const { items, readyToWrite, rejected } = pipelineToItems(jsonRows, date1904, [], refs);
    expect(readyToWrite).toHaveLength(0);
    expect(items).toHaveLength(0);

    // The reason mentions a phone problem but never the raw digits.
    const reasons = rejected.flatMap((r) => r.reasons).join(' ');
    expect(reasons).toMatch(/טלפון/);
    expect(reasons).not.toContain('0501');

    // The writer is never invoked, and nothing is written.
    let writerCalls = 0;
    await commitVolunteerChunks(items, (payloads) => { writerCalls += 1; return commitVolunteerChunk(db, payloads); }, 450);
    expect(writerCalls).toBe(0);
    expect(await readVolunteers(db)).toHaveLength(0);
  });

  it('re-importing against the refreshed snapshot rejects duplicates and creates no second document', async () => {
    const db = adminDb();
    const refs = await readVolunteerImportReferences(db);

    // Import one valid volunteer.
    const first = await buildAndParseVolunteerRow(refs, (sheet) => {
      sheet.getCell('A2').value = 'אבי';
      sheet.getCell('B2').value = 'כהן';
      sheet.getCell('C2').value = '012345678';
      sheet.getCell('D2').value = '0501234567';
      sheet.getCell('F2').value = new Date(Date.UTC(1999, 5, 15, 12));
    });
    const firstRun = pipelineToItems(first.jsonRows, first.date1904, [], refs);
    await commitVolunteerChunks(firstRun.items, (payloads) => commitVolunteerChunk(db, payloads), 450);

    // Reload the real volunteers snapshot from Firestore.
    const existing = await readVolunteers(db);
    expect(existing).toHaveLength(1);

    // Same row again → rejected (ID already exists); nothing new written.
    const second = pipelineToItems(first.jsonRows, first.date1904, existing, refs);
    expect(second.readyToWrite).toHaveLength(0);
    let writerCalls = 0;
    await commitVolunteerChunks(second.items, (payloads) => { writerCalls += 1; return commitVolunteerChunk(db, payloads); }, 450);
    expect(writerCalls).toBe(0);
    expect(await readVolunteers(db)).toHaveLength(1); // no second document

    // Duplicate axes resolved against the SAME real snapshot + emulator-loaded refs.
    const resolveRow = (overrides) => {
      const row = { 'שם פרטי *': 'אבי', 'שם משפחה *': 'כהן', ...overrides };
      const { valid, identities } = preflightVolunteerImport([row]);
      return resolveVolunteerImport(valid, {
        existingVolunteers: existing,
        groups: refs.groups,
        programs: refs.programs,
        allRowIdentities: identities,
      });
    };

    // Same phone in a DIFFERENT format (+972), different id → rejected.
    expect(resolveRow({ 'תעודת זהות': '111111111', 'טלפון': '+972501234567' }).readyToWrite).toHaveLength(0);

    // Same name + birthDate, different id/phone → rejected (suspicion).
    expect(resolveRow({ 'תעודת זהות': '222222222', 'תאריך לידה': '1999-06-15' }).readyToWrite).toHaveLength(0);

    // Same NAME only (different id, no phone, no birthDate) → NOT a false duplicate.
    expect(resolveRow({ 'תעודת זהות': '333333333' }).readyToWrite).toHaveLength(1);
  });
});
