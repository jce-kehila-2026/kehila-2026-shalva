// Security-rules tests — run every role against every sensitive operation in
// the Firebase Emulator, proving firestore.rules / storage.rules actually
// enforce what the UI promises. Run via `npm run test:rules` from the repo
// root (it starts the emulators, runs this file, and shuts them down).

// Vitest test API.
import { afterAll, beforeAll, beforeEach, describe, it, expect } from 'vitest';

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
const NOROLE_UID = 'norole1';
const UNKNOWN_UID = 'unknown1';

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
    await db.collection('users').doc(NOROLE_UID).set({});                 // active, no role
    await db.collection('users').doc(UNKNOWN_UID).set({ role: 'banana' }); // active, unknown role

    // The guide is assigned to groupA.
    await db.collection('guides').doc(GUIDE_UID).set({ groupId: 'groupA' });
    // A SECOND guide mapping (another uid → groupB), so a guide listing the
    // whole guides collection has a foreign doc it must not be able to read.
    await db.collection('guides').doc('guide2').set({ groupId: 'groupB' });

    // Two groups and one volunteer in each.
    await db.collection('groups').doc('groupA').set({ groupName: 'קבוצה א' });
    await db.collection('groups').doc('groupB').set({ groupName: 'קבוצה ב' });
    // groupC shares groupA's NAME on purpose (same-name attack scenario).
    await db.collection('groups').doc('groupC').set({ groupName: 'קבוצה א' });
    await db.collection('volunteers').doc('vol1').set({ name: 'דני כהן', groupId: 'groupA' });
    await db.collection('volunteers').doc('vol2').set({ name: 'רן לוי', groupId: 'groupB' });
    // A second real groupA volunteer (for the volunteerId-immutability test).
    await db.collection('volunteers').doc('vol1b').set({ name: 'מתנדב שני', groupId: 'groupA' });
    // A groupB volunteer whose groupName matches groupA (name-match attack).
    await db.collection('volunteers').doc('volBname').set({ name: 'רן', groupId: 'groupB', groupName: 'קבוצה א' });
    // A volunteer with NO canonical groupId, groupName matching groupA.
    await db.collection('volunteers').doc('volNoId').set({ name: 'נועם', groupName: 'קבוצה א' });
    // A groupC volunteer (same-name group) — belongs to groupC, not groupA.
    await db.collection('volunteers').doc('volC').set({ name: 'גיא', groupId: 'groupC', groupName: 'קבוצה א' });

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

    // groupA records with a Saturday / missing / malformed dateKey (delete tests).
    await db.collection('attendance').doc('att-sat').set({
      groupId: 'groupA', group: 'קבוצה א', groupName: 'קבוצה א',
      date: new Date(), dateKey: '2026-06-20', // 2026-06-20 is a Saturday
      status: true, volunteerId: 'vol1', volunteerName: 'דני כהן',
    });
    await db.collection('attendance').doc('att-nodate').set({
      groupId: 'groupA', group: 'קבוצה א', groupName: 'קבוצה א',
      date: new Date(), status: true, volunteerId: 'vol1', volunteerName: 'דני כהן',
    });
    await db.collection('attendance').doc('att-baddate').set({
      groupId: 'groupA', group: 'קבוצה א', groupName: 'קבוצה א',
      date: new Date(), dateKey: 'garbage',
      status: true, volunteerId: 'vol1', volunteerName: 'דני כהן',
    });
    // A LEGACY record with NO canonical groupId (groupName only) — used to prove
    // a guide cannot read a record that isn't keyed to their group by groupId.
    await db.collection('attendance').doc('att-nogroup').set({
      group: 'קבוצה א', groupName: 'קבוצה א',
      date: new Date(), dateKey: '2026-06-11',
      status: true, volunteerId: 'vol1', volunteerName: 'דני כהן',
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
const noRoleDb = () => testEnv.authenticatedContext(NOROLE_UID).firestore();
const unknownRoleDb = () => testEnv.authenticatedContext(UNKNOWN_UID).firestore();
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

  it('CAN update their own group\'s attendance record (status only, identity unchanged)', async () => {
    // att-own was seeded with dateKey 2026-06-11 — keep the identity and flip status.
    await assertSucceeds(
      guideDb().collection('attendance').doc('att-own').set({ ...ownGroupAttendance(), dateKey: '2026-06-11', status: false }),
    );
  });

  it('CAN update an existing record with a NON-canonical document id (legacy), identity unchanged', async () => {
    // att-own's document id ('att-own') is not canonical; updating it in place is allowed.
    await assertSucceeds(
      guideDb().collection('attendance').doc('att-own').set({ ...ownGroupAttendance(), dateKey: '2026-06-11', status: true }),
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

  it('cannot create attendance for a volunteer matched by name only (no canonical groupId)', async () => {
    await assertFails(
      guideDb().collection('attendance').doc('groupA_2026-06-12_volNoId').set({
        ...ownGroupAttendance(),
        volunteerId: 'volNoId',
        volunteerName: 'נועם',
      }),
    );
  });

  it('cannot edit volunteers, groups or users', async () => {
    await assertFails(guideDb().collection('volunteers').doc('vol1').update({ name: 'x' }));
    await assertFails(guideDb().collection('groups').doc('groupA').update({ groupName: 'x' }));
    await assertFails(guideDb().collection('users').doc(GUIDE_UID).update({ role: 'admin' }));
  });
});


describe('guide attendance — strict validation (9ב)', () => {
  // A valid own-group payload, with overrides. canonId derives the canonical id.
  const guideAtt = (over = {}) => ({ ...ownGroupAttendance(), ...over });
  const canonId = (data) => `${data.groupId}_${data.dateKey}_${data.volunteerId}`;

  // ---- allowed ----
  it('ALLOWS a valid create with the canonical document id', async () => {
    const data = guideAtt();
    await assertSucceeds(guideDb().collection('attendance').doc(canonId(data)).set(data));
  });

  it('ALLOWS flipping the boolean status on the same record', async () => {
    const data = guideAtt();
    await assertSucceeds(guideDb().collection('attendance').doc(canonId(data)).set(data));
    await assertSucceeds(guideDb().collection('attendance').doc(canonId(data)).set({ ...data, status: false }));
  });

  it('ALLOWS deleting a valid own-group record', async () => {
    await assertSucceeds(guideDb().collection('attendance').doc('att-own').delete());
  });

  it('DENIES a guide deleting a Saturday record', async () => {
    await assertFails(guideDb().collection('attendance').doc('att-sat').delete());
  });

  it('DENIES a guide deleting a record with a missing dateKey', async () => {
    await assertFails(guideDb().collection('attendance').doc('att-nodate').delete());
  });

  it('DENIES a guide deleting a record with a malformed dateKey', async () => {
    await assertFails(guideDb().collection('attendance').doc('att-baddate').delete());
  });

  it('ALLOWS admin to delete Saturday / missing / malformed dateKey records', async () => {
    await assertSucceeds(adminDb().collection('attendance').doc('att-sat').delete());
    await assertSucceeds(adminDb().collection('attendance').doc('att-nodate').delete());
    await assertSucceeds(adminDb().collection('attendance').doc('att-baddate').delete());
  });

  it('ALLOWS a valid leap day that is not a Saturday (2024-02-29, Thursday)', async () => {
    const data = guideAtt({ dateKey: '2024-02-29' });
    await assertSucceeds(guideDb().collection('attendance').doc(canonId(data)).set(data));
  });

  // ---- denied: cross-group / spoofing (the probe attacks) ----
  it('DENIES a volunteer from another group even when groupName matches (name-match attack)', async () => {
    const data = guideAtt({ volunteerId: 'volBname', volunteerName: 'רן' });
    await assertFails(guideDb().collection('attendance').doc(canonId(data)).set(data));
  });

  it('DENIES a same-name-group volunteer (two groups share a name)', async () => {
    const data = guideAtt({ volunteerId: 'volC', volunteerName: 'גיא' });
    await assertFails(guideDb().collection('attendance').doc(canonId(data)).set(data));
  });

  it('DENIES a wrong (non-canonical) document id on create', async () => {
    await assertFails(guideDb().collection('attendance').doc('wrong-id').set(guideAtt()));
  });

  // ---- denied: identity mutation on update ----
  it('DENIES changing groupId on an existing record', async () => {
    await assertFails(
      guideDb().collection('attendance').doc('att-own').set({ ...guideAtt({ dateKey: '2026-06-11' }), groupId: 'groupB' }),
    );
  });

  it('DENIES changing volunteerId on an existing record', async () => {
    await assertFails(
      guideDb().collection('attendance').doc('att-own').set({ ...guideAtt({ dateKey: '2026-06-11' }), volunteerId: 'vol1b', volunteerName: 'מתנדב שני' }),
    );
  });

  it('DENIES changing dateKey on an existing record', async () => {
    await assertFails(
      guideDb().collection('attendance').doc('att-own').set(guideAtt({ dateKey: '2026-06-12' })),
    );
  });

  // ---- denied: schema / types ----
  it('DENIES status as a string', async () => {
    const data = guideAtt({ status: 'נוכח' });
    await assertFails(guideDb().collection('attendance').doc(canonId(data)).set(data));
  });

  it('DENIES status as an object', async () => {
    const data = guideAtt({ status: { x: 1 } });
    await assertFails(guideDb().collection('attendance').doc(canonId(data)).set(data));
  });

  it('DENIES a missing status / date / dateKey / volunteerName', async () => {
    for (const field of ['status', 'date', 'dateKey', 'volunteerName']) {
      const data = guideAtt();
      delete data[field];
      await assertFails(guideDb().collection('attendance').doc('groupA_2026-06-12_vol1').set(data));
    }
  });

  it('DENIES an extra (ninth) field', async () => {
    const data = guideAtt({ extra: 'x' });
    await assertFails(guideDb().collection('attendance').doc(canonId(data)).set(data));
  });

  // ---- denied: dateKey value ----
  it('DENIES a malformed dateKey', async () => {
    const data = guideAtt({ dateKey: 'not-a-date' });
    await assertFails(guideDb().collection('attendance').doc('groupA_not-a-date_vol1').set(data));
  });

  it('DENIES an impossible date (2026-02-30)', async () => {
    const data = guideAtt({ dateKey: '2026-02-30' });
    await assertFails(guideDb().collection('attendance').doc(canonId(data)).set(data));
  });

  it('DENIES a non-leap Feb 29 (2026-02-29)', async () => {
    const data = guideAtt({ dateKey: '2026-02-29' });
    await assertFails(guideDb().collection('attendance').doc(canonId(data)).set(data));
  });

  it('DENIES a Saturday dateKey (2026-06-20)', async () => {
    const data = guideAtt({ dateKey: '2026-06-20' });
    await assertFails(guideDb().collection('attendance').doc(canonId(data)).set(data));
  });

  // ---- denied: name mismatches ----
  it('DENIES group / groupName that do not match the group document', async () => {
    const data = guideAtt({ group: 'שם שגוי', groupName: 'שם שגוי' });
    await assertFails(guideDb().collection('attendance').doc(canonId(data)).set(data));
  });

  it('DENIES volunteerName that does not match the volunteer document', async () => {
    const data = guideAtt({ volunteerName: 'שם אחר' });
    await assertFails(guideDb().collection('attendance').doc(canonId(data)).set(data));
  });

  it('DENIES a volunteer without a canonical groupId', async () => {
    const data = guideAtt({ volunteerId: 'volNoId', volunteerName: 'נועם' });
    await assertFails(guideDb().collection('attendance').doc(canonId(data)).set(data));
  });

  // ---- denied: non-guide writers ----
  it('DENIES viewer / role-less / unknown-role / disabled / anonymous writes', async () => {
    const data = guideAtt();
    const id = canonId(data);
    await assertFails(viewerDb().collection('attendance').doc(id).set(data));
    await assertFails(noRoleDb().collection('attendance').doc(id).set(data));
    await assertFails(unknownRoleDb().collection('attendance').doc(id).set(data));
    await assertFails(disabledDb().collection('attendance').doc(id).set(data));
    await assertFails(anonDb().collection('attendance').doc(id).set(data));
  });
});


describe('guide read-scope — guides / volunteers / attendance (9ג)', () => {
  // ---- guides mapping: own document only ----
  it('guide CAN read their OWN guides document', async () => {
    await assertSucceeds(guideDb().collection('guides').doc(GUIDE_UID).get());
  });

  it('guide CANNOT read another guide\'s mapping document', async () => {
    await assertFails(guideDb().collection('guides').doc('guide2').get());
  });

  it('guide CANNOT list the whole guides collection', async () => {
    await assertFails(guideDb().collection('guides').get());
  });

  // ---- groups: PUBLIC by design (deliberate deviation — see firestore.rules) ----
  it('guide CAN still read any group (groups are public whole documents by existing product decision)', async () => {
    await assertSucceeds(guideDb().collection('groups').doc('groupB').get());
    await assertSucceeds(guideDb().collection('groups').get());
  });

  // ---- volunteers: own group only ----
  it('guide CAN read a volunteer in their own group (direct get)', async () => {
    await assertSucceeds(guideDb().collection('volunteers').doc('vol1').get());
  });

  it('guide CANNOT read a volunteer from another group (direct get)', async () => {
    await assertFails(guideDb().collection('volunteers').doc('vol2').get());
  });

  it('guide CANNOT read a volunteer with no canonical groupId', async () => {
    await assertFails(guideDb().collection('volunteers').doc('volNoId').get());
  });

  it('guide CAN list volunteers scoped to their group — and gets ONLY that group', async () => {
    const snapshot = await assertSucceeds(
      guideDb().collection('volunteers').where('groupId', '==', 'groupA').get(),
    );
    // Only the two real groupA volunteers (vol1, vol1b) — never groupB/C/no-id.
    expect(snapshot.size).toBe(2);
    snapshot.forEach((document) => expect(document.data().groupId).toBe('groupA'));
  });

  it('guide CANNOT run an unscoped volunteers query', async () => {
    await assertFails(guideDb().collection('volunteers').get());
  });

  it('guide CANNOT query volunteers of another group', async () => {
    await assertFails(guideDb().collection('volunteers').where('groupId', '==', 'groupB').get());
  });

  // ---- attendance: own group only, query must carry groupId ----
  it('guide CAN read an attendance record of their own group (direct get)', async () => {
    await assertSucceeds(guideDb().collection('attendance').doc('att-own').get());
  });

  it('guide CANNOT read an attendance record of another group (direct get)', async () => {
    await assertFails(guideDb().collection('attendance').doc('att-other').get());
  });

  it('guide CANNOT read a legacy attendance record with no canonical groupId', async () => {
    await assertFails(guideDb().collection('attendance').doc('att-nogroup').get());
  });

  it('guide CAN query attendance scoped by groupId + dateKey — and gets ONLY that group', async () => {
    const snapshot = await assertSucceeds(
      guideDb().collection('attendance')
        .where('groupId', '==', 'groupA')
        .where('dateKey', '==', '2026-06-11')
        .get(),
    );
    // Only att-own matches (att-nogroup has no groupId; att-other is groupB).
    expect(snapshot.size).toBe(1);
    snapshot.forEach((document) => expect(document.data().groupId).toBe('groupA'));
  });

  it('guide CANNOT query attendance by dateKey ALONE (no groupId scope)', async () => {
    await assertFails(
      guideDb().collection('attendance').where('dateKey', '==', '2026-06-11').get(),
    );
  });

  it('guide CANNOT run an unscoped attendance query', async () => {
    await assertFails(guideDb().collection('attendance').get());
  });

  it('guide CANNOT query attendance of another group', async () => {
    await assertFails(guideDb().collection('attendance').where('groupId', '==', 'groupB').get());
  });
});


describe('read-scope role matrix — broad reads (9ג)', () => {
  it('admin CAN read all volunteers and attendance (unscoped)', async () => {
    await assertSucceeds(adminDb().collection('volunteers').get());
    await assertSucceeds(adminDb().collection('attendance').get());
    await assertSucceeds(adminDb().collection('guides').get());
  });

  it('explicit viewer CAN read all volunteers and attendance (unscoped)', async () => {
    await assertSucceeds(viewerDb().collection('volunteers').get());
    await assertSucceeds(viewerDb().collection('attendance').get());
    await assertSucceeds(viewerDb().collection('guides').get());
  });

  it('role-less (missing role) user CAN read broadly — viewer-compatible per App.jsx', async () => {
    await assertSucceeds(noRoleDb().collection('volunteers').get());
    await assertSucceeds(noRoleDb().collection('attendance').get());
    await assertSucceeds(noRoleDb().collection('guides').get());
  });

  it('UNKNOWN role CANNOT read volunteers / attendance / guides', async () => {
    await assertFails(unknownRoleDb().collection('volunteers').get());
    await assertFails(unknownRoleDb().collection('attendance').get());
    await assertFails(unknownRoleDb().collection('guides').get());
  });

  it('disabled and anonymous CANNOT read volunteers / attendance', async () => {
    await assertFails(disabledDb().collection('volunteers').get());
    await assertFails(disabledDb().collection('attendance').get());
    await assertFails(anonDb().collection('volunteers').get());
    await assertFails(anonDb().collection('attendance').get());
  });
});


// NOTE: these prove the Firestore QUERY SHAPE + Rules only — NOT React. They run
// the exact queries the screens issue and assert allow/deny + scoping. React
// state / rendering is proven separately by UI E2E in step 9ה.
describe('Firestore query shape (emulator, not React) — the real screen reads (9ג)', () => {
  // The exact week window GroupDetails builds, containing att-own's 2026-06-11.
  const weekKeys = [
    '2026-06-07', '2026-06-08', '2026-06-09', '2026-06-10',
    '2026-06-11', '2026-06-12', '2026-06-13',
  ];

  it('AttendanceScreen guide reads succeed and return only their group', async () => {
    // volunteers by groupId
    const volunteers = await assertSucceeds(
      guideDb().collection('volunteers').where('groupId', '==', 'groupA').get(),
    );
    expect(volunteers.size).toBe(2);

    // attendance by groupId + dateKey
    const attendance = await assertSucceeds(
      guideDb().collection('attendance')
        .where('groupId', '==', 'groupA')
        .where('dateKey', '==', '2026-06-11')
        .get(),
    );
    expect(attendance.size).toBe(1);
  });

  it('GroupDetails guide reads succeed (volunteers + weekly attendance by groupId)', async () => {
    const volunteers = await assertSucceeds(
      guideDb().collection('volunteers').where('groupId', '==', 'groupA').get(),
    );
    expect(volunteers.size).toBe(2);

    const weeklyAttendance = await assertSucceeds(
      guideDb().collection('attendance')
        .where('groupId', '==', 'groupA')
        .where('dateKey', 'in', weekKeys)
        .get(),
    );
    // Only att-own (2026-06-11) falls in this window for groupA.
    expect(weeklyAttendance.size).toBe(1);
    weeklyAttendance.forEach((document) => expect(document.data().groupId).toBe('groupA'));
  });

  it('the same screens\' UNSCOPED queries are denied for a guide', async () => {
    await assertFails(guideDb().collection('volunteers').get());
    await assertFails(guideDb().collection('attendance').where('dateKey', 'in', weekKeys).get());
  });

  it('admin still reads the same collections without scoping', async () => {
    await assertSucceeds(adminDb().collection('volunteers').get());
    await assertSucceeds(adminDb().collection('attendance').where('dateKey', 'in', weekKeys).get());
  });
});


describe('guide authority — single source of truth (9ג fix)', () => {
  // Re-seed specific docs with rules DISABLED to model each conflict, on top of
  // the default beforeEach seed (guides/guide1 = groupA, groupA has no guideId).
  async function reseed(mutate) {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await mutate(context.firestore());
    });
  }

  // A fully-valid groupB attendance payload (so the ONLY possible denial reason
  // is authorization, not schema) + its canonical id.
  const groupBAttendance = () => ({
    groupId: 'groupB', group: 'קבוצה ב', groupName: 'קבוצה ב',
    date: new Date(), dateKey: '2026-06-12',
    status: true, volunteerId: 'vol2', volunteerName: 'רן לוי',
  });

  // א. canonical mapping = groupA, AND a STALE legacy link groups/groupB.guideId
  //    = guide1. The stale link must grant NOTHING.
  describe('א. canonical groupA + stale groups/groupB.guideId = guide1', () => {
    beforeEach(async () => {
      await reseed(async (db) => {
        await db.collection('groups').doc('groupB').set({ guideId: GUIDE_UID }, { merge: true });
      });
    });

    it('reads of groupA are ALLOWED', async () => {
      await assertSucceeds(guideDb().collection('volunteers').doc('vol1').get());
      await assertSucceeds(guideDb().collection('attendance').doc('att-own').get());
      await assertSucceeds(guideDb().collection('volunteers').where('groupId', '==', 'groupA').get());
    });

    it('reads of groupB are DENIED despite the stale legacy link', async () => {
      await assertFails(guideDb().collection('volunteers').doc('vol2').get());
      await assertFails(guideDb().collection('attendance').doc('att-other').get());
      await assertFails(guideDb().collection('volunteers').where('groupId', '==', 'groupB').get());
      await assertFails(guideDb().collection('attendance').where('groupId', '==', 'groupB').get());
    });

    it('writes to groupB are DENIED despite the stale legacy link', async () => {
      await assertFails(
        guideDb().collection('attendance').doc('groupB_2026-06-12_vol2').set(groupBAttendance()),
      );
      await assertFails(guideDb().collection('attendance').doc('att-other').delete());
      await assertFails(
        guideDb().collection('attendance').doc('att-other').set({ ...groupBAttendance(), dateKey: '2026-06-11' }),
      );
    });
  });

  // ב. canonical mapping = groupA, but groupA.guideId is MISSING / points to
  //    another guide. The canonical mapping still wins → groupA allowed.
  describe('ב. canonical groupA, but groupA.guideId points elsewhere', () => {
    beforeEach(async () => {
      await reseed(async (db) => {
        await db.collection('groups').doc('groupA').set({ guideId: 'someOtherGuide' }, { merge: true });
      });
    });

    it('groupA stays ALLOWED — the guides mapping is authoritative', async () => {
      await assertSucceeds(guideDb().collection('volunteers').doc('vol1').get());
      await assertSucceeds(guideDb().collection('attendance').doc('att-own').get());
      await assertSucceeds(guideDb().collection('volunteers').where('groupId', '==', 'groupA').get());
    });
  });

  // ג. NO canonical mapping (guides/guide1 missing, or its groupId empty), AND
  //    groups/groupA.guideId = guide1 → legacy fallback applies → groupA allowed.
  describe('ג. no canonical mapping + legacy groups/groupA.guideId = guide1', () => {
    it('allows groupA via legacy fallback when guides/guide1 is MISSING', async () => {
      await reseed(async (db) => {
        await db.collection('guides').doc(GUIDE_UID).delete();
        await db.collection('groups').doc('groupA').set({ guideId: GUIDE_UID }, { merge: true });
      });
      await assertSucceeds(guideDb().collection('volunteers').doc('vol1').get());
      await assertSucceeds(guideDb().collection('attendance').doc('att-own').get());
      await assertSucceeds(guideDb().collection('volunteers').where('groupId', '==', 'groupA').get());
    });

    it('allows groupA via legacy fallback when guides/guide1.groupId is EMPTY', async () => {
      await reseed(async (db) => {
        await db.collection('guides').doc(GUIDE_UID).set({ groupId: '' });
        await db.collection('groups').doc('groupA').set({ guideId: GUIDE_UID }, { merge: true });
      });
      await assertSucceeds(guideDb().collection('volunteers').doc('vol1').get());
      await assertSucceeds(guideDb().collection('attendance').doc('att-own').get());
    });
  });

  // ד. NO canonical mapping AND no group points to the guide → denied everywhere.
  describe('ד. no canonical mapping AND no group points to the guide', () => {
    beforeEach(async () => {
      await reseed(async (db) => {
        await db.collection('guides').doc(GUIDE_UID).delete();
        // groupA still has NO guideId (default seed) — nothing points to guide1.
      });
    });

    it('reads and writes are DENIED', async () => {
      await assertFails(guideDb().collection('volunteers').doc('vol1').get());
      await assertFails(guideDb().collection('attendance').doc('att-own').get());
      await assertFails(guideDb().collection('volunteers').where('groupId', '==', 'groupA').get());
      await assertFails(
        guideDb().collection('attendance').doc('groupA_2026-06-12_vol1').set(ownGroupAttendance()),
      );
    });
  });
});


describe('GroupDetails legacy compatibility — admin/viewer vs guide (9ג)', () => {
  // att-nogroup + volNoId carry NO canonical groupId — they model legacy data
  // that the admin/viewer GroupDetails path can still surface (by name), while a
  // guide cannot read them at all. (The client read-strategy branch is selected
  // by the guideScopedRead prop; here we prove the Rules-level access gap.)
  it('legacy no-groupId records are readable by admin/viewer but NOT by a guide', async () => {
    await assertSucceeds(adminDb().collection('attendance').doc('att-nogroup').get());
    await assertSucceeds(viewerDb().collection('attendance').doc('att-nogroup').get());
    await assertSucceeds(adminDb().collection('volunteers').doc('volNoId').get());
    await assertSucceeds(viewerDb().collection('volunteers').doc('volNoId').get());

    await assertFails(guideDb().collection('attendance').doc('att-nogroup').get());
    await assertFails(guideDb().collection('volunteers').doc('volNoId').get());
  });
});


describe('GroupDetails full read sequence — guide identity = current uid (9ג)', () => {
  // Proves the Firestore reads + Rules ONLY (NOT React): the WHOLE ordered guide
  // sequence GroupDetails issues — the group doc, the guide's OWN guides/{uid} +
  // users/{uid} (BY the current uid, never groups/{}.guideId), then the scoped
  // volunteers + weekly attendance.
  const weekKeys = [
    '2026-06-07', '2026-06-08', '2026-06-09', '2026-06-10',
    '2026-06-11', '2026-06-12', '2026-06-13',
  ];

  async function reseed(mutate) {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await mutate(context.firestore());
    });
  }

  // The guide's own GroupDetails sequence for groupA — every step must succeed.
  async function expectGuideGroupAFullSequenceSucceeds() {
    await assertSucceeds(guideDb().collection('groups').doc('groupA').get());
    await assertSucceeds(guideDb().collection('guides').doc(GUIDE_UID).get());
    await assertSucceeds(guideDb().collection('users').doc(GUIDE_UID).get());
    await assertSucceeds(guideDb().collection('volunteers').where('groupId', '==', 'groupA').get());
    await assertSucceeds(
      guideDb().collection('attendance')
        .where('groupId', '==', 'groupA')
        .where('dateKey', 'in', weekKeys)
        .get(),
    );
  }

  it('א: groups/groupA.guideId = guide2 — guide1 full sequence succeeds; guides/guide2 is DENIED', async () => {
    await reseed(async (db) => {
      await db.collection('groups').doc('groupA').set({ guideId: 'guide2' }, { merge: true });
    });

    await expectGuideGroupAFullSequenceSucceeds();
    // The guide reads ONLY their OWN guides doc — never the foreign one the stale
    // groups/groupA.guideId points at.
    await assertFails(guideDb().collection('guides').doc('guide2').get());
  });

  it('ב: groupA.guideId missing — guide1 full sequence succeeds', async () => {
    // The default seed already has groupA with no guideId.
    await expectGuideGroupAFullSequenceSucceeds();
  });

  it('ג: no canonical mapping + legacy groups/groupA.guideId = guide1 — full sequence succeeds', async () => {
    await reseed(async (db) => {
      await db.collection('guides').doc(GUIDE_UID).delete();
      await db.collection('groups').doc('groupA').set({ guideId: GUIDE_UID }, { merge: true });
    });

    await expectGuideGroupAFullSequenceSucceeds();
  });

  it('ד: guide1 is DENIED volunteers / attendance of groupB', async () => {
    await assertFails(guideDb().collection('volunteers').where('groupId', '==', 'groupB').get());
    await assertFails(guideDb().collection('attendance').where('groupId', '==', 'groupB').get());
    await assertFails(guideDb().collection('volunteers').doc('vol2').get());
    await assertFails(guideDb().collection('attendance').doc('att-other').get());
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

