// Template-to-Firestore integration test (EMULATOR ONLY, project demo-kehila).
//
// The integration test below runs the WHOLE chain end-to-end against the
// emulator, exercising the REAL writer (commitOneGroup) — never a copy:
//   buildGroupsWorkbook → writeBuffer → XLSX.read → raw header analysis
//   → detectGroupImportFileType → analyzeGroupImportHeaders → sheet_to_json
//   → preflightGroupImport → resolveGroupImport → buildGroupImportPlans
//   → commitOneGroup (Firestore emulator, authenticated admin, real rules).
//
// This is NOT a React handler end-to-end test: no component is mounted and no UI
// event is fired. A separate atomicity test proves single-group rollback.
//
// EXCLUDED from the default vitest run (needs the emulators). Run it with the
// full emulator suite up, e.g. from the repo root:
//   firebase emulators:exec --project demo-kehila \
//     "npx vitest run --root frontend tests/groupImport.emulator.test.js"

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, doc, getDoc, getDocs } from 'firebase/firestore';
import * as XLSX from 'xlsx';

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { buildGroupsWorkbook } from '../src/utils/excelTemplates.js';
import {
  analyzeGroupImportHeaders,
  detectGroupImportFileType,
  preflightGroupImport,
  resolveGroupImport,
  buildGroupImportGuides,
  buildGroupImportPlans,
} from '../src/utils/groupImport.js';
import { commitOneGroup } from '../src/utils/groupImportWriter.js';


const firestoreRulesPath = fileURLToPath(new URL('../../firestore.rules', import.meta.url));

const ADMIN_UID = 'admin1';
const GUIDE_UID = 'g1';

let testEnv;

const adminDb = () => testEnv.authenticatedContext(ADMIN_UID).firestore();


beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'demo-kehila',
    firestore: { rules: readFileSync(firestoreRulesPath, 'utf8') },
  });
});

afterAll(async () => {
  if (testEnv) await testEnv.cleanup();
});

// Re-seed before each test with rules disabled (setup, not the thing tested):
// one active admin, one active+free guide (no guides/{uid} link), two free
// volunteers.
beforeEach(async () => {
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await db.collection('users').doc(ADMIN_UID).set({ role: 'admin' });
    await db.collection('users').doc(GUIDE_UID).set({ role: 'guide', name: 'דנה כהן' });
    await db.collection('volunteers').doc('v1').set({ name: 'יוסי לוי', groupId: '', groupName: '' });
    await db.collection('volunteers').doc('v2').set({ name: 'נועה לוי', groupId: '', groupName: '' });
  });
});


describe('template-to-Firestore integration test (emulator, admin context)', () => {
  // The in-memory match sources the screen builds from its four core snapshots.
  const guides = buildGroupImportGuides([{ id: GUIDE_UID, role: 'guide', name: 'דנה כהן' }], []);
  const volunteers = [
    { id: 'v1', name: 'יוסי לוי', groupId: '', groupName: '' },
    { id: 'v2', name: 'נועה לוי', groupId: '', groupName: '' },
  ];

  it('runs the full chain template → … → real writer and persists the group + links atomically', async () => {
    // 1) Build the REAL groups workbook and fill one valid row.
    const workbook = await buildGroupsWorkbook(guides, volunteers);
    const sheet = workbook.getWorksheet('קבוצות');
    sheet.getCell('A2').value = 'קבוצה א';
    sheet.getCell('B2').value = 'בוקר';
    sheet.getCell('C2').value = 'דנה כהן';
    sheet.getCell('D2').value = 'יוסי לוי, נועה לוי';
    sheet.getCell('F2').value = 'יום ראשון';

    // 2) writeBuffer → XLSX.read, exactly as the component does.
    const buffer = await workbook.xlsx.writeBuffer();
    const wb = XLSX.read(new Uint8Array(buffer), { type: 'array' });
    const ws = wb.Sheets[wb.SheetNames[0]];

    // 3) Raw header analysis BEFORE object parsing: file-type + duplicate check.
    const headerRow = XLSX.utils.sheet_to_json(ws, { header: 1 })[0] || [];
    expect(detectGroupImportFileType(headerRow)).toBe('groups');
    expect(analyzeGroupImportHeaders(headerRow)).toEqual({ ok: true });

    // 4) Object parse → preflight → resolve → plans.
    const { valid, identities } = preflightGroupImport(XLSX.utils.sheet_to_json(ws));
    const { ready } = resolveGroupImport(valid, {
      existingGroups: [], guides, volunteers, allRowIdentities: identities,
    });
    const plans = buildGroupImportPlans(ready);
    expect(plans).toHaveLength(1);

    // 5) The REAL writer, against the emulator under an admin context.
    const db = adminDb();
    const newGroupId = await commitOneGroup(db, plans[0]);

    // The group document carries the mapped fields + canonical guideName, and
    // NO internal metadata.
    const groupSnap = await getDoc(doc(db, 'groups', newGroupId));
    const groupData = groupSnap.data();
    expect(groupData.groupName).toBe('קבוצה א');
    expect(groupData.time).toBe('בוקר');            // activityTime → time
    expect(groupData.activityDay).toBe('יום ראשון');
    expect(groupData.guideId).toBe(GUIDE_UID);
    expect(groupData.guideName).toBe('דנה כהן');     // canonical, from the matched record
    expect(groupData).not.toHaveProperty('excelRow');
    expect(groupData).not.toHaveProperty('operationCount');

    // The guide link now points back at the new group.
    const guideLink = await getDoc(doc(db, 'guides', GUIDE_UID));
    expect(guideLink.data()).toMatchObject({ groupId: newGroupId, groupName: 'קבוצה א' });

    // Both volunteers point back at the new group.
    const v1 = await getDoc(doc(db, 'volunteers', 'v1'));
    const v2 = await getDoc(doc(db, 'volunteers', 'v2'));
    expect(v1.data()).toMatchObject({ groupId: newGroupId, groupName: 'קבוצה א' });
    expect(v2.data()).toMatchObject({ groupId: newGroupId, groupName: 'קבוצה א' });
  });
});


describe('group import writer — single-group atomicity (emulator)', () => {
  it('rolls the WHOLE group back when one volunteer link fails', async () => {
    const db = adminDb();

    // A hand-built plan whose second volunteer does not exist → the batch update
    // fails, so NOTHING in the unit may persist. operationCount matches so the
    // writer's guard passes and we genuinely reach the batch.
    const plan = {
      excelRow: 2,
      groupDoc: {
        groupName: 'קבוצה ב', time: 'בוקר', activityDay: '', location: '', notes: '',
        guideId: GUIDE_UID, guideName: 'דנה כהן',
      },
      guideId: GUIDE_UID,
      guideName: 'דנה כהן',
      volunteerIds: ['v1', 'ghost-missing'], // ghost-missing has no document
      operationCount: 4,
    };

    await expect(commitOneGroup(db, plan)).rejects.toBeTruthy();

    // No group created.
    const groupsSnap = await getDocs(collection(db, 'groups'));
    expect(groupsSnap.size).toBe(0);

    // The guide link was NOT written.
    const guideLink = await getDoc(doc(db, 'guides', GUIDE_UID));
    expect(guideLink.exists()).toBe(false);

    // The existing volunteer was NOT modified.
    const v1 = await getDoc(doc(db, 'volunteers', 'v1'));
    expect(v1.data()).toMatchObject({ groupId: '', groupName: '' });
  });
});
