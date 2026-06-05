// One-time database seed helper. Populates the "groups" collection with the
// default group names. A manual developer utility (not wired into the UI) —
// import and call it once to bootstrap an empty database. Running it more than
// once will create duplicate groups.

// Firestore helpers for adding documents.
import { addDoc, collection } from 'firebase/firestore';

// Our Firestore database instance.
import { db } from '../firebase';

// The default group names.
import { GROUP_NAMES } from './groupOptions';


export async function seedGroups() {
  // Create one group document per default name.
  for (const groupName of GROUP_NAMES) {
    await addDoc(collection(db, 'groups'), {
      groupName,
      guideId: '',
      guideName: '',
      time: '',
      createdAt: new Date(),
    });
  }

  // Let the developer know it finished.
  alert('כל הקבוצות נוספו בהצלחה');
}
