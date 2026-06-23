// Playwright global setup for the emulator-backed E2E suite.
//
// Runs ONCE before the specs, against the local emulators that `firebase
// emulators:exec` has already started (project demo-kehila). It:
//   1. clears + creates the Auth accounts (Auth emulator REST API), capturing
//      each account's uid;
//   2. clears + seeds Firestore (users / guides / groups / volunteers) with
//      security rules DISABLED — seeding is setup, not the thing under test.
// The app itself (run in `--mode emulator`) then performs every WRITE through
// the REAL committed rules, as the signed-in user, during the tests.
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { TEST_USERS, GROUPS, VOLUNTEERS } from './fixtures/seed-data.js';

const PROJECT_ID = 'demo-kehila';
const AUTH_HOST = '127.0.0.1:9099';
const FAKE_API_KEY = 'fake-api-key';

// The committed rules at the repo root (frontend/tests/e2e-emulator -> up 3).
const firestoreRulesPath = fileURLToPath(new URL('../../../firestore.rules', import.meta.url));


// Wipe every Auth emulator account so a re-run starts clean.
async function clearAuthAccounts() {
  await fetch(
    `http://${AUTH_HOST}/emulator/v1/projects/${PROJECT_ID}/accounts`,
    { method: 'DELETE' },
  );
}

// Create ONE email/password account in the Auth emulator and return its uid.
async function createAuthUser(email, password) {
  const response = await fetch(
    `http://${AUTH_HOST}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=${FAKE_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, returnSecureToken: true }),
    },
  );

  if (!response.ok) {
    throw new Error(`Auth emulator signUp failed for a test account (status ${response.status})`);
  }

  const data = await response.json();
  return data.localId;
}


export default async function globalSetup() {
  // The ephemeral emulator password comes ONLY from the environment (set in
  // playwright.emulator.config.js). Fail with a value-free message if missing.
  const password = globalThis.process?.env?.E2E_EMULATOR_PASSWORD;
  if (!password) {
    throw new Error('Missing E2E_EMULATOR_PASSWORD environment variable (set by playwright.emulator.config.js).');
  }

  // ----- 1. Auth accounts -----
  await clearAuthAccounts();

  // Create each account and remember its uid (keyed by the role key).
  const uidByRole = {};
  for (const [roleKey, user] of Object.entries(TEST_USERS)) {
    uidByRole[roleKey] = await createAuthUser(user.email, password);
  }

  // ----- 2. Firestore seed (rules disabled) -----
  const testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { rules: readFileSync(firestoreRulesPath, 'utf8') },
  });

  await testEnv.clearFirestore();

  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();

    // users/{uid}: role drives the app gate. A role-less doc models a user with
    // NO access (the gate signs them out — there is no read-only viewer tier).
    await db.collection('users').doc(uidByRole.admin).set({ role: 'admin', firstName: TEST_USERS.admin.firstName });
    await db.collection('users').doc(uidByRole.guideA).set({ role: 'guide', firstName: TEST_USERS.guideA.firstName });
    await db.collection('users').doc(uidByRole.guideB).set({ role: 'guide', firstName: TEST_USERS.guideB.firstName });
    await db.collection('users').doc(uidByRole.noRole).set({ firstName: TEST_USERS.noRole.firstName });

    // guides/{uid}: the canonical group mapping (groupId is the single authority).
    await db.collection('guides').doc(uidByRole.guideA).set({ groupId: GROUPS.groupA.id, groupName: GROUPS.groupA.groupName });
    await db.collection('guides').doc(uidByRole.guideB).set({ groupId: GROUPS.groupB.id, groupName: GROUPS.groupB.groupName });

    // groups: also carry the legacy guideId (kept consistent with the mapping).
    await db.collection('groups').doc(GROUPS.groupA.id).set({ groupName: GROUPS.groupA.groupName, guideId: uidByRole.guideA });
    await db.collection('groups').doc(GROUPS.groupB.id).set({ groupName: GROUPS.groupB.groupName, guideId: uidByRole.guideB });

    // volunteers (3 in A, 1 in B), all scheduled for today.
    for (const volunteer of VOLUNTEERS) {
      await db.collection('volunteers').doc(volunteer.id).set({
        name: volunteer.name,
        groupId: volunteer.groupId,
        day: volunteer.day,
      });
    }
  });

  await testEnv.cleanup();

  // A non-secret progress line (no emails, no passwords, no uids).
  globalThis.process?.stdout?.write('[e2e global-setup] seeded Auth + Firestore for demo-kehila\n');
}
