// The REAL Firestore writer for one imported group. Kept in its own module (not
// inside the React component) so the emulator integration test can import and
// exercise the exact same write — never a duplicate of the logic.
//
// One group = one atomic writeBatch: the group document + (optional) the guide
// back-reference + one update per assigned volunteer. The whole unit commits or
// nothing does. It writes ONLY the existing schema fields and the back-references
// already used by GroupManagement — no excelRow / operationCount / new fields.

import { collection, doc, writeBatch } from 'firebase/firestore';

import { groupPlanOperationCount } from './groupImport.js';


// Commit ONE group plan atomically against the given Firestore instance.
// Resolves with the new group's id; rejects (leaving nothing written) on any
// failure, including a planned/actual operation-count mismatch caught BEFORE the
// batch is committed.
export async function commitOneGroup(db, plan) {
  // Fail-closed before Firebase: the plan must describe exactly the writes we
  // are about to perform.
  const actualOperationCount = groupPlanOperationCount(plan);
  if (actualOperationCount !== plan.operationCount) {
    throw new Error(
      `אי-התאמה ב-operationCount (תוכנית ${plan.operationCount}, בפועל ${actualOperationCount}) — השורה נחסמה לפני כתיבה`,
    );
  }

  const batch = writeBatch(db);

  // 1) The new group document (a fresh id; createdAt added at write time).
  const newGroupRef = doc(collection(db, 'groups'));
  batch.set(newGroupRef, {
    ...plan.groupDoc,
    createdAt: new Date(),
  });

  // 2) The guide's back-reference mapping (guides/{uid}), if a guide is linked.
  if (plan.guideId) {
    batch.set(
      doc(db, 'guides', plan.guideId),
      { groupId: newGroupRef.id, groupName: plan.groupDoc.groupName },
      { merge: true },
    );
  }

  // 3) Each volunteer's back-reference. update() (not set) keeps the existing
  //    contract — a missing volunteer fails the whole batch (atomicity).
  for (const volunteerId of plan.volunteerIds) {
    batch.update(
      doc(db, 'volunteers', volunteerId),
      { groupId: newGroupRef.id, groupName: plan.groupDoc.groupName },
    );
  }

  await batch.commit();
  return newGroupRef.id;
}
