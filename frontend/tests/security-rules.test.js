// Security-rules tests — run every role against every sensitive operation in
// the Firebase Emulator, proving firestore.rules / storage.rules actually
// enforce what the UI promises. Run via `npm run test:rules` from the repo
// root (it starts the emulators, runs this file, and shuts them down).

// Vitest test API.
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';

// The official rules testing harness: spins up isolated per-user contexts
// against the emulator and asserts whether the rules allow each operation.
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from '@firebase/rules-unit-testing';

// Node helpers for reading the rules files from the repo root.
// (import.meta.url because this project is ES modules — no __dirname here.)
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Absolute paths to the two rules files at the repo root.
const firestoreRulesPath = fileURLToPath(new URL('../../firestore.rules', import.meta.url));
const storageRulesPath = fileURLToPath(new URL('../../storage.rules', import.meta.url));


// The shared emulator environment for the whole file.
let testEnv;

// Test identities — one per role the app knows.
const ADMIN_UID = 'admin1';
const GUIDE_UID = 'guide1';
const VIEWER_UID = 'viewer1';
const DISABLED_UID = 'disabled1';

// A valid attendance payload for the guide's own group (groupA / vol1).
// Uses ONLY the fields firestore.rules whitelists for guide writes.
const ownGroupAttendance = () => ({
  groupId: 'groupA',
  group: 'קבוצה א',
  groupName: 'קבוצה א',
  date: new Date(),
  dateKey: '2026-06-12',
  status: true,
  volunteerId: 'vol1',
  volunteerName: 'דני כהן',
});

// A valid public registration, matching the field whitelist in the rules.
const validRegistrant = () => ({
  firstName: 'דנה',
  lastName: 'לוי',
  email: 'dana@example.com',
  phone: '0521234567',
  age: 20,
  birthDate: '2006-01-01',
  status: 'ממתין לאישור',
  createdAt: new Date(),
});

// A valid public signed volunteer form, including the generated PDF reference.
const validSignedForm = (formId = 'formA') => ({
  registrantId: 'reg1',
  fullName: 'דנה לוי',
  firstName: 'דנה',
  lastName: 'לוי',
  idNumber: '123456789',
  age: 20,
  birthDateGreg: '2006-01-01',
  birthDateHeb: '',
  address: 'רחוב הדוגמה 1',
  phone: '0521234567',
  email: 'dana@example.com',
  school: 'בית ספר לדוגמה',
  shirtSize: 'M',
  groupName: 'נועם',
  activityDays: ['ראשון'],
  agreed: true,
  signature: 'data:image/png;base64,abc',
  pdfStoragePath: `signedForms/${formId}/shalva-signed-form-${formId}.pdf`,
  pdfFileName: `shalva-signed-form-${formId}.pdf`,
  createdAt: new Date(),
});


// Start the emulator test environment once, loading both rules files.
beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'demo-kehila',
    firestore: {
      rules: readFileSync(firestoreRulesPath, 'utf8'),
    },
    storage: {
      rules: readFileSync(storageRulesPath, 'utf8'),
    },
  });
});

// Wipe and re-seed Firestore before EVERY test, so tests never depend on
// each other's leftovers. Seeding runs with rules disabled (it's setup, not
// the thing under test).
beforeEach(async () => {
  await testEnv.clearFirestore();

  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();

    // One user profile per role; the disabled doc models a removed guide.
    await db.collection('users').doc(ADMIN_UID).set({ role: 'admin' });
    await db.collection('users').doc(GUIDE_UID).set({ role: 'guide' });
    await db.collection('users').doc(VIEWER_UID).set({ role: 'viewer' });
    await db.collection('users').doc(DISABLED_UID).set({ role: 'guide', disabled: true });

    // The guide is assigned to groupA.
    await db.collection('guides').doc(GUIDE_UID).set({ groupId: 'groupA' });

    // Two groups and one volunteer in each.
    await db.collection('groups').doc('groupA').set({ groupName: 'קבוצה א' });
    await db.collection('groups').doc('groupB').set({ groupName: 'קבוצה ב' });
    await db.collection('volunteers').doc('vol1').set({ name: 'דני כהן', groupId: 'groupA' });
    await db.collection('volunteers').doc('vol2').set({ name: 'רן לוי', groupId: 'groupB' });

    // One existing attendance record per group (for update/steal tests).
    await db.collection('attendance').doc('att-own').set({
      groupId: 'groupA', group: 'קבוצה א', groupName: 'קבוצה א',
      date: new Date(), dateKey: '2026-06-11',
      status: true, volunteerId: 'vol1', volunteerName: 'דני כהן',
    });
    await db.collection('attendance').doc('att-other').set({
      groupId: 'groupB', group: 'קבוצה ב', groupName: 'קבוצה ב',
      date: new Date(), dateKey: '2026-06-11',
      status: true, volunteerId: 'vol2', volunteerName: 'רן לוי',
    });

    // One event.
    await db.collection('events').doc('event1').set({ title: 'מפגש' });
  });
});

// Shut the environment down when the file finishes.
afterAll(async () => {
  await testEnv.cleanup();
});


// Convenience accessors for each identity's Firestore handle.
const anonDb = () => testEnv.unauthenticatedContext().firestore();
const viewerDb = () => testEnv.authenticatedContext(VIEWER_UID).firestore();
const guideDb = () => testEnv.authenticatedContext(GUIDE_UID).firestore();
const disabledDb = () => testEnv.authenticatedContext(DISABLED_UID).firestore();
const adminDb = () => testEnv.authenticatedContext(ADMIN_UID).firestore();


describe('logged-out user (no auth)', () => {
  it('CAN read groups (public showcase)', async () => {
    await assertSucceeds(anonDb().collection('groups').get());
  });

  it('CAN read programs (public showcase)', async () => {
    await assertSucceeds(anonDb().collection('programs').get());
  });

  it('cannot write groups', async () => {
    await assertFails(anonDb().collection('groups').doc('groupA').set({ groupName: 'hack' }));
  });


  it('cannot read volunteers', async () => {
    await assertFails(anonDb().collection('volunteers').get());
  });

  it('cannot read attendance', async () => {
    await assertFails(anonDb().collection('attendance').get());
  });

  it('cannot read users', async () => {
    await assertFails(anonDb().collection('users').get());
  });

  it('cannot read registrants', async () => {
    await assertFails(anonDb().collection('registrants').get());
  });

  it('CAN submit a valid public registration', async () => {
    await assertSucceeds(anonDb().collection('registrants').add(validRegistrant()));
  });

  it('cannot submit a registration with extra fields', async () => {
    await assertFails(
      anonDb().collection('registrants').add({ ...validRegistrant(), role: 'admin' }),
    );
  });

  it('cannot submit a registration that is pre-approved', async () => {
    await assertFails(
      anonDb().collection('registrants').add({ ...validRegistrant(), status: 'מאושר' }),
    );
  });

  it('cannot submit a registration with an invalid email', async () => {
    await assertFails(
      anonDb().collection('registrants').add({ ...validRegistrant(), email: 'not-an-email' }),
    );
  });

  it('CAN submit a valid signed volunteer form with an empty Hebrew date', async () => {
    await assertSucceeds(
      anonDb().collection('signedForms').doc('formA').set(validSignedForm('formA')),
    );
  });

  it('cannot submit a signed volunteer form without the PDF reference', async () => {
    const withoutPdf = validSignedForm('formMissingPdf');
    delete withoutPdf.pdfStoragePath;

    await assertFails(
      anonDb().collection('signedForms').doc('formMissingPdf').set(withoutPdf),
    );
  });
});


describe('viewer (read-only role)', () => {
  it('can read volunteers, attendance, events and programs', async () => {
    await assertSucceeds(viewerDb().collection('volunteers').get());
    await assertSucceeds(viewerDb().collection('attendance').get());
    await assertSucceeds(viewerDb().collection('events').get());
    await assertSucceeds(viewerDb().collection('programs').get());
  });

  it('cannot write volunteers', async () => {
    await assertFails(viewerDb().collection('volunteers').doc('vol1').update({ name: 'אחר' }));
  });

  it('cannot write attendance', async () => {
    await assertFails(viewerDb().collection('attendance').add(ownGroupAttendance()));
  });

  it('cannot write events, groups or programs', async () => {
    await assertFails(viewerDb().collection('events').doc('event1').update({ title: 'x' }));
    await assertFails(viewerDb().collection('groups').doc('groupA').update({ groupName: 'x' }));
    await assertFails(viewerDb().collection('programs').doc('prog1').set({ name: 'x' }));
  });

  it('cannot manage users', async () => {
    await assertFails(viewerDb().collection('users').doc(VIEWER_UID).update({ role: 'admin' }));
  });
});



describe('guide (scoped to their own group)', () => {
  it('CAN create attendance for their own group', async () => {
    await assertSucceeds(
      guideDb().collection('attendance').doc('groupA_2026-06-12_vol1').set(ownGroupAttendance()),
    );
  });

  it('CAN update their own group\'s attendance record', async () => {
    await assertSucceeds(
      guideDb().collection('attendance').doc('att-own').set({ ...ownGroupAttendance(), status: false }),
    );
  });

  it('cannot create attendance for another group', async () => {
    await assertFails(
      guideDb().collection('attendance').add({
        ...ownGroupAttendance(),
        groupId: 'groupB',
        volunteerId: 'vol2',
      }),
    );
  });

  it('cannot point own-group attendance at another group\'s volunteer', async () => {
    await assertFails(
      guideDb().collection('attendance').add({ ...ownGroupAttendance(), volunteerId: 'vol2' }),
    );
  });

  it('cannot sneak extra fields into an attendance record', async () => {
    await assertFails(
      guideDb().collection('attendance').add({ ...ownGroupAttendance(), role: 'admin' }),
    );
  });

  it('cannot "steal" another group\'s record by rewriting its groupId', async () => {
    await assertFails(
      guideDb().collection('attendance').doc('att-other').set(ownGroupAttendance()),
    );
  });

  it('cannot delete another group\'s attendance record', async () => {
    await assertFails(guideDb().collection('attendance').doc('att-other').delete());
  });

  it('CAN delete their own group\'s attendance record', async () => {
    await assertSucceeds(guideDb().collection('attendance').doc('att-own').delete());
  });

  it('CAN create attendance for a volunteer matched by groupName/group only', async () => {
    // Seed a volunteer that only has groupName matching, no groupId.
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await db.collection('volunteers').doc('vol-name-only').set({
        name: 'שם זמני',
        groupName: 'קבוצה א',
      });
    });

    await assertSucceeds(
      guideDb().collection('attendance').doc('groupA_2026-06-12_vol-name-only').set({
        ...ownGroupAttendance(),
        volunteerId: 'vol-name-only',
        volunteerName: 'שם זמני',
      }),
    );
  });

  it('cannot edit volunteers, groups or users', async () => {
    await assertFails(guideDb().collection('volunteers').doc('vol1').update({ name: 'x' }));
    await assertFails(guideDb().collection('groups').doc('groupA').update({ groupName: 'x' }));
    await assertFails(guideDb().collection('users').doc(GUIDE_UID).update({ role: 'admin' }));
  });
});


describe('disabled user (removed guide)', () => {
  it('can still read their own profile (the app gate needs it)', async () => {
    await assertSucceeds(disabledDb().collection('users').doc(DISABLED_UID).get());
  });

  it('cannot read volunteers or attendance', async () => {
    await assertFails(disabledDb().collection('volunteers').get());
    await assertFails(disabledDb().collection('attendance').get());
  });

  it('cannot write attendance even for their old group', async () => {
    await assertFails(disabledDb().collection('attendance').add(ownGroupAttendance()));
  });

  it('cannot re-enable themselves', async () => {
    await assertFails(
      disabledDb().collection('users').doc(DISABLED_UID).update({ disabled: false }),
    );
  });
});


describe('admin (full management, with self-guards)', () => {
  it('can manage volunteers, groups, events, programs and attendance', async () => {
    await assertSucceeds(adminDb().collection('volunteers').add({ name: 'חדש', groupId: 'groupA' }));
    await assertSucceeds(adminDb().collection('groups').doc('groupA').update({ groupName: 'שם חדש' }));
    await assertSucceeds(adminDb().collection('events').doc('event1').update({ title: 'עודכן' }));
    await assertSucceeds(adminDb().collection('programs').doc('prog1').set({ name: 'עודכן' }));
    await assertSucceeds(adminDb().collection('attendance').doc('att-other').delete());
  });


  it('can create users and change another user\'s role', async () => {
    await assertSucceeds(adminDb().collection('users').doc('newguide').set({ role: 'guide' }));
    await assertSucceeds(adminDb().collection('users').doc(VIEWER_UID).update({ role: 'guide' }));
  });

  it('can manage registrants', async () => {
    await assertSucceeds(adminDb().collection('registrants').get());
  });

  it('cannot change their OWN role', async () => {
    await assertFails(adminDb().collection('users').doc(ADMIN_UID).update({ role: 'viewer' }));
  });

  it('cannot disable themselves', async () => {
    await assertFails(adminDb().collection('users').doc(ADMIN_UID).update({ disabled: true }));
  });

  it('cannot delete their own account', async () => {
    await assertFails(adminDb().collection('users').doc(ADMIN_UID).delete());
  });

  it('CAN delete another user', async () => {
    await assertSucceeds(adminDb().collection('users').doc(VIEWER_UID).delete());
  });
});


describe('storage rules (group cover images)', () => {
  // A tiny fake image and an oversized blob for the size-limit test.
  const smallImage = new Uint8Array(1024);
  const oversized = new Uint8Array(6 * 1024 * 1024);

  it('anonymous users cannot upload', async () => {
    const fileRef = testEnv.unauthenticatedContext().storage().ref('groups/groupA/cover.png');
    await assertFails(fileRef.put(smallImage, { contentType: 'image/png' }));
  });

  it('a guide cannot upload (admin only)', async () => {
    const fileRef = testEnv.authenticatedContext(GUIDE_UID).storage().ref('groups/groupA/cover.png');
    await assertFails(fileRef.put(smallImage, { contentType: 'image/png' }));
  });

  it('an admin CAN upload a small image', async () => {
    const fileRef = testEnv.authenticatedContext(ADMIN_UID).storage().ref('groups/groupA/cover.png');
    await assertSucceeds(fileRef.put(smallImage, { contentType: 'image/png' }));
  });

  it('an admin cannot upload a non-image file', async () => {
    const fileRef = testEnv.authenticatedContext(ADMIN_UID).storage().ref('groups/groupA/notes.pdf');
    await assertFails(fileRef.put(smallImage, { contentType: 'application/pdf' }));
  });

  it('an admin cannot upload an image over 5MB', async () => {
    const fileRef = testEnv.authenticatedContext(ADMIN_UID).storage().ref('groups/groupA/big.png');
    await assertFails(fileRef.put(oversized, { contentType: 'image/png' }));
  });

  it('nobody can write outside the groups/ folder (default deny)', async () => {
    const fileRef = testEnv.authenticatedContext(ADMIN_UID).storage().ref('avatars/x.png');
    await assertFails(fileRef.put(smallImage, { contentType: 'image/png' }));
  });
});


describe('storage rules (signed volunteer PDFs)', () => {
  // A tiny fake PDF payload is enough for rules tests; content-type is what the
  // rule validates.
  const smallPdf = new Uint8Array([37, 80, 68, 70]);

  it('anonymous users CAN upload a signed form PDF', async () => {
    const fileRef = testEnv.unauthenticatedContext().storage().ref('signedForms/formA/shalva-signed-form-formA.pdf');
    await assertSucceeds(fileRef.put(smallPdf, { contentType: 'application/pdf' }));
  });

  it('anonymous users cannot upload a signed form with a non-PDF content type', async () => {
    const fileRef = testEnv.unauthenticatedContext().storage().ref('signedForms/formB/shalva-signed-form-formB.pdf');
    await assertFails(fileRef.put(smallPdf, { contentType: 'image/png' }));
  });

  it('anonymous users cannot upload outside the signedForms PDF pattern', async () => {
    const fileRef = testEnv.unauthenticatedContext().storage().ref('signedForms/formC/random.pdf');
    await assertFails(fileRef.put(smallPdf, { contentType: 'application/pdf' }));
  });
});

describe('storage rules (program images)', () => {
  const smallImage = new Uint8Array(1024);
  const oversized = new Uint8Array(6 * 1024 * 1024);

  it('anonymous users cannot upload programs images', async () => {
    const fileRef = testEnv.unauthenticatedContext().storage().ref('programs/prog1/cover.png');
    await assertFails(fileRef.put(smallImage, { contentType: 'image/png' }));
  });

  it('a guide cannot upload programs images', async () => {
    const fileRef = testEnv.authenticatedContext(GUIDE_UID).storage().ref('programs/prog1/cover.png');
    await assertFails(fileRef.put(smallImage, { contentType: 'image/png' }));
  });

  it('an admin CAN upload a programs cover image', async () => {
    const fileRef = testEnv.authenticatedContext(ADMIN_UID).storage().ref('programs/prog1/cover.png');
    await assertSucceeds(fileRef.put(smallImage, { contentType: 'image/png' }));
  });

  it('an admin cannot upload a non-image file for programs', async () => {
    const fileRef = testEnv.authenticatedContext(ADMIN_UID).storage().ref('programs/prog1/notes.pdf');
    await assertFails(fileRef.put(smallImage, { contentType: 'application/pdf' }));
  });

  it('an admin cannot upload a programs image over 5MB', async () => {
    const fileRef = testEnv.authenticatedContext(ADMIN_UID).storage().ref('programs/prog1/big.png');
    await assertFails(fileRef.put(oversized, { contentType: 'image/png' }));
  });
});

