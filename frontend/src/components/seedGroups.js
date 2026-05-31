import { db } from "./firebase";
import { collection, addDoc } from "firebase/firestore";

const groups = [
  "תותים",
  "דובדבן",
  "אתרוג",
  "ניצן",
  "רימונים",
  "תאנים",
  "גפן",
  "רותם",
  "אלמוג",
  "הדרים",
  "אגוז",
  "ארז",
  "דולב",
  "שקדיה",
  "אלה",
  "אלונים",
  "אורנים",
  "דקל",
  "עמית",
  "נעם",
  "איתן",
  "לביא",
];

export async function seedGroups() {
  for (const groupName of groups) {
    await addDoc(collection(db, "groups"), {
      groupName: groupName,
      guideId: "",
      guideName: "",
      time: "",
      createdAt: new Date(),
    });
  }

  alert("כל הקבוצות נוספו בהצלחה");
}