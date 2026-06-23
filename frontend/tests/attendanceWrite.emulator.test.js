// Attendance write-strategy integration test (EMULATOR ONLY, project demo-kehila).
//
// Proves the guide attendance writer's INDEPENDENT-WRITES strategy against the
// REAL firestore.rules: a group of 25 volunteers is saved as 25 separate
// setDoc/deleteDoc requests run through the SAME runWithConcurrency helper the
// screen uses — NOT one writeBatch — so no per-request Rules document-access
// limit is hit. Also proves partial-failure isolation. This is NOT a React UI
// E2E test (no component is mounted); it exercises the write strategy + Rules.
//
// EXCLUDED from the default vitest run (needs the emulator). Run with:
//   firebase emulators:exec --only firestore,storage --project demo-kehila \
//     "cd frontend && npx vitest run tests/attendanceWrite.emulator.test.js"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { runWithConcurrency } from '../src/utils/concurrency.js';

const firestoreRulesPath = fileURLToPath(new URL('../../firestore.rules', import.meta.url));
const storageRulesPath = fileURLToPath(new URL('../../storage.rules', import.meta.url));

let testEnv;

const DATEKEY = '2026-06-12'; // a Friday (real, non-Saturday)
const N = 25;

function payload(i, status = true) {
  return {
    groupId: 'groupA', group: 'קבוצה א', groupName: 'קבוצה א',
    date: new Date(), dateKey: DATEKEY, status,
    volunteerId: 'vol' + i, volunteerName: 'מתנדב ' + i,
  };
}

const docId = (i) => 'groupA_' + DATEKEY + '_vol' + i;

// Independent executor (compat API), exactly mirroring AttendanceScreen's
// executeOperation: one setDoc or deleteDoc per operation, never a batch.
function makeExecutor(db) {
  return (operation) => {
    const ref = db.collection('attendance').doc(operation.attendanceId);
    return operation.type === 'delete' ? ref.delete() : ref.set(operation.payload);
  };
}

const guideDb = () => testEnv.authenticatedContext('guide1').firestore();

async function attendanceCount() {
  // withSecurityRulesDisabled resolves to void, so capture via an outer variable.
  let size = 0;
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const snapshot = await ctx.firestore().collection('attendance').get();
    size = snapshot.size;
  });
  return size;
}

// Read every attendance document into a Map (id -> data), so tests can assert
// the EXACT final state (which ids exist, and each status) — not just a count.
async function readAttendance() {
  const byId = new Map();
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const snapshot = await ctx.firestore().collection('attendance').get();
    snapshot.forEach((document) => byId.set(document.id, document.data()));
  });
  return byId;
}

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'demo-kehila',
    firestore: { rules: readFileSync(firestoreRulesPath, 'utf8') },
    storage: { rules: readFileSync(storageRulesPath, 'utf8') },
  });
});

afterAll(async () => {
  await testEnv.cleanup();
});

// Seed a guide, group and N own-group volunteers. seedRecords also seeds N
// canonical attendance records (for update / mixed scenarios).
beforeEach(async () => {
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await db.collection('users').doc('guide1').set({ role: 'guide' });
    await db.collection('guides').doc('guide1').set({ groupId: 'groupA' });
    await db.collection('groups').doc('groupA').set({ groupName: 'קבוצה א' });
    await db.collection('groups').doc('groupB').set({ groupName: 'קבוצה ב' });
    for (let i = 0; i < N; i += 1) {
      await db.collection('volunteers').doc('vol' + i).set({ name: 'מתנדב ' + i, groupId: 'groupA' });
    }
    // One volunteer that belongs to ANOTHER group (the partial-failure attacker).
    await db.collection('volunteers').doc('volBad').set({ name: 'זר', groupId: 'groupB' });
  });
});

describe('attendance write strategy (emulator)', () => {
  it('A) 25 independent creates all succeed and produce exactly 25 documents', async () => {
    const exec = makeExecutor(guideDb());
    const ops = Array.from({ length: N }, (unused, i) => ({ type: 'set', attendanceId: docId(i), payload: payload(i) }));

    const results = await runWithConcurrency(ops, 5, exec);

    expect(results.every((r) => r.status === 'fulfilled')).toBe(true);
    expect(await attendanceCount()).toBe(N);
  });

  it('B) 25 independent updates flip status with no extra documents', async () => {
    const exec = makeExecutor(guideDb());

    // Create the baseline; every create must succeed.
    const createResults = await runWithConcurrency(
      Array.from({ length: N }, (unused, i) => ({ type: 'set', attendanceId: docId(i), payload: payload(i, true) })),
      5,
      exec,
    );
    expect(createResults.every((r) => r.status === 'fulfilled')).toBe(true);

    // Before the update: exactly 25 docs, every one status:true.
    const before = await readAttendance();
    expect(before.size).toBe(N);
    for (let i = 0; i < N; i += 1) {
      expect(before.get(docId(i)).status).toBe(true);
    }

    // Update each to status:false.
    const results = await runWithConcurrency(
      Array.from({ length: N }, (unused, i) => ({ type: 'set', attendanceId: docId(i), payload: payload(i, false) })),
      5,
      exec,
    );
    expect(results.every((r) => r.status === 'fulfilled')).toBe(true);

    // After: still exactly 25 docs, every one status:false.
    const after = await readAttendance();
    expect(after.size).toBe(N);
    for (let i = 0; i < N; i += 1) {
      expect(after.get(docId(i)).status).toBe(false);
    }
  });

  it('C) mixed set + delete reaches the exact final state', async () => {
    const exec = makeExecutor(guideDb());
    // Create 20 first.
    await runWithConcurrency(
      Array.from({ length: 20 }, (unused, i) => ({ type: 'set', attendanceId: docId(i), payload: payload(i, true) })),
      5,
      exec,
    );

    // Update the first 10, delete the next 10.
    const mixed = [];
    for (let i = 0; i < 10; i += 1) {
      mixed.push({ type: 'set', attendanceId: docId(i), payload: payload(i, false) });
    }
    for (let i = 10; i < 20; i += 1) {
      mixed.push({ type: 'delete', attendanceId: docId(i) });
    }
    const results = await runWithConcurrency(mixed, 5, exec);
    expect(results.every((r) => r.status === 'fulfilled')).toBe(true);

    // Docs 0–9 exist with status:false; docs 10–19 do NOT exist (count alone
    // is not enough — assert each id explicitly).
    const finalState = await readAttendance();
    expect(finalState.size).toBe(10);
    for (let i = 0; i < 10; i += 1) {
      expect(finalState.has(docId(i))).toBe(true);
      expect(finalState.get(docId(i)).status).toBe(false);
    }
    for (let i = 10; i < 20; i += 1) {
      expect(finalState.has(docId(i))).toBe(false);
    }
  });

  it('D) partial failure: 9 valid succeed, 1 cross-group is rejected and not written', async () => {
    const exec = makeExecutor(guideDb());
    const ops = [];
    for (let i = 0; i < 9; i += 1) {
      ops.push({ type: 'set', attendanceId: docId(i), payload: payload(i) });
    }
    // The malicious op: groupId=groupA but volunteer belongs to groupB.
    ops.push({
      type: 'set',
      attendanceId: 'groupA_' + DATEKEY + '_volBad',
      payload: { ...payload('Bad'), volunteerId: 'volBad', volunteerName: 'זר' },
    });

    const results = await runWithConcurrency(ops, 5, exec);

    const fulfilled = results.filter((r) => r.status === 'fulfilled').length;
    const rejected = results.filter((r) => r.status === 'rejected').length;
    expect(fulfilled).toBe(9);
    expect(rejected).toBe(1);

    // All nine valid IDs exist; the forbidden cross-group ID does not.
    const state = await readAttendance();
    expect(state.size).toBe(9);
    for (let i = 0; i < 9; i += 1) {
      expect(state.has(docId(i))).toBe(true);
    }
    expect(state.has('groupA_' + DATEKEY + '_volBad')).toBe(false);
  });
});
