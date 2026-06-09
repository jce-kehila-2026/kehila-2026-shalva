// One-time database seed helper. Populates the "groups" collection with the
// default group names. A manual developer utility (not wired into the UI) —
// import and call it once to bootstrap an empty database. It is now idempotent:
// re-running it skips names that already exist instead of creating duplicates.

// Firestore helpers for reading + adding documents.
import { addDoc, collection, getDocs } from 'firebase/firestore';

// Our Firestore database instance.
import { db } from '../firebase';

// The default group names.
import { GROUP_NAMES } from './groupOptions';


export async function seedGroups() {
  // Read the groups that already exist so we never add a name twice.
  const snapshot = await getDocs(collection(db, 'groups'));
  const existingNames = new Set(
    snapshot.docs.map((documentSnapshot) => {
      const data = documentSnapshot.data();
      return (data.groupName || data.name || '').trim();
    }),
  );

  // Create a document only for names that aren't already there.
  let added = 0;
  for (const groupName of GROUP_NAMES) {
    if (existingNames.has(groupName)) {
      continue;
    }

    await addDoc(collection(db, 'groups'), {
      groupName,
      guideId: '',
      guideName: '',
      time: '',
      createdAt: new Date(),
    });
    added += 1;
  }

  // Let the developer know what happened.
  alert(`נוספו ${added} קבוצות חדשות (דילגתי על קבוצות שכבר קיימות).`);
}
