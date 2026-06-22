// The REAL Firestore writer for ONE chunk of imported volunteers. Kept in its
// own module (not inline in VolunteersManagement) so the emulator integration
// test can import and exercise the exact same write — never a duplicate.
//
// Each payload already carries the full volunteer schema + createdAt (added at
// the write boundary by the caller) and NO internal metadata (no excelRow /
// idKey / phoneKey / nameBirthKey). One fresh document id per volunteer, all in
// a single atomic batch. The chunking + partial-failure accounting stays in the
// pure commitVolunteerChunks orchestrator.

import { collection, doc, writeBatch } from 'firebase/firestore';


// Write one chunk of volunteer payloads as a single atomic writeBatch.
export async function commitVolunteerChunk(db, payloads) {
  const batch = writeBatch(db);

  for (const payload of payloads) {
    batch.set(doc(collection(db, 'volunteers')), payload);
  }

  await batch.commit();
}
