import { addDoc, collection } from 'firebase/firestore';

import { db } from '../firebase';
import { GROUP_NAMES } from './groupOptions';

export async function seedGroups() {
  for (const groupName of GROUP_NAMES) {
    await addDoc(collection(db, 'groups'), {
      groupName,
      guideId: '',
      guideName: '',
      time: '',
      createdAt: new Date(),
    });
  }

  alert('כל הקבוצות נוספו בהצלחה');
}
