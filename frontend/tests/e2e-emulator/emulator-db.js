// Direct Firestore-emulator access for the E2E specs — used ONLY to reset and to
// VERIFY data out-of-band (never to perform the writes under test; those go
// through the app UI under the real rules). Runs with security rules disabled,
// because reading/clearing for test orchestration is setup, not the assertion.
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const PROJECT_ID = 'demo-kehila';
const firestoreRulesPath = fileURLToPath(new URL('../../../firestore.rules', import.meta.url));

// One lazily-created test environment per worker process.
let envPromise = null;

function getEnv() {
  if (!envPromise) {
    envPromise = initializeTestEnvironment({
      projectId: PROJECT_ID,
      firestore: { rules: readFileSync(firestoreRulesPath, 'utf8') },
    });
  }
  return envPromise;
}

// Delete every document in the attendance collection (keeps the seed intact), so
// each flow starts from a known-empty attendance state.
export async function resetAttendance() {
  const testEnv = await getEnv();
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const snapshot = await context.firestore().collection('attendance').get();
    for (const document of snapshot.docs) {
      await document.ref.delete();
    }
  });
}

// Move a volunteer to a different group (rules disabled). Used by the partial-
// failure spec to make ONE of the already-loaded volunteers cross-group AFTER the
// screen has rendered, so the UI's save then attempts a write the rules reject.
export async function setVolunteerGroup(volunteerId, groupId) {
  const testEnv = await getEnv();
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await context.firestore().collection('volunteers').doc(volunteerId).update({ groupId });
  });
}

// Read every attendance document as { id, ...data }, rules disabled.
export async function readAttendance() {
  const testEnv = await getEnv();
  let records = [];
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const snapshot = await context.firestore().collection('attendance').get();
    records = snapshot.docs.map((document) => ({ id: document.id, ...document.data() }));
  });
  return records;
}

// Tidy up the worker's test environment.
export async function cleanupDb() {
  if (envPromise) {
    const testEnv = await envPromise;
    await testEnv.cleanup();
    envPromise = null;
  }
}
