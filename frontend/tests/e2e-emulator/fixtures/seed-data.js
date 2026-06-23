// Shared fixtures for the emulator-backed E2E suite.
//
// EMULATOR-ONLY test accounts (project demo-kehila); they never touch live
// Firebase. NO password lives in source — the random emulator password is
// generated at runtime in playwright.emulator.config.js and read from the
// E2E_EMULATOR_PASSWORD environment variable by the setup + login helpers.
import { getJerusalemDateKey } from '../../../src/utils/dateKey.js';

// A FIXED test instant that is NOT a Saturday, so the suite is deterministic on
// ANY calendar day (the browser clock is frozen to it before the app loads).
// 2026-06-23T09:00:00Z == 12:00 Asia/Jerusalem on Tuesday, 2026-06-23.
export const FROZEN_INSTANT_ISO = '2026-06-23T09:00:00Z';
const frozen = new Date(FROZEN_INSTANT_ISO);

// Hebrew weekday name for a date, resolved in Asia/Jerusalem (same logic the app
// uses for "today").
export function jerusalemWeekdayName(date) {
  return new Intl.DateTimeFormat('he-IL', { timeZone: 'Asia/Jerusalem', weekday: 'long' }).format(date);
}

// The frozen day's canonical key + weekday — fixtures are scheduled on this day,
// so they always appear on the attendance screen regardless of the real date.
export const FROZEN_DATE_KEY = getJerusalemDateKey(frozen); // '2026-06-23'
export const FROZEN_WEEKDAY = jerusalemWeekdayName(frozen);  // 'יום שלישי'

// The four sign-in accounts, keyed by role — email / role / name ONLY.
export const TEST_USERS = {
  admin: { email: 'admin@e2e.local', role: 'admin', firstName: 'אדמין' },
  guideA: { email: 'guidea@e2e.local', role: 'guide', firstName: 'מדריך א' },
  guideB: { email: 'guideb@e2e.local', role: 'guide', firstName: 'מדריך ב' },
  noRole: { email: 'norole@e2e.local', role: '', firstName: 'צופה' },
};

// The two groups. groupA belongs to guideA, groupB to guideB.
export const GROUPS = {
  groupA: { id: 'groupA', groupName: 'קבוצה אלף' },
  groupB: { id: 'groupB', groupName: 'קבוצה בית' },
};

// Volunteers: three in group A, one in group B. All scheduled for the frozen
// day's weekday, so they render on the attendance screen.
export const VOLUNTEERS = [
  { id: 'volA1', name: 'אבי כהן', groupId: 'groupA', day: FROZEN_WEEKDAY },
  { id: 'volA2', name: 'בני לוי', groupId: 'groupA', day: FROZEN_WEEKDAY },
  { id: 'volA3', name: 'גדי מזרחי', groupId: 'groupA', day: FROZEN_WEEKDAY },
  { id: 'volB1', name: 'דורון פרץ', groupId: 'groupB', day: FROZEN_WEEKDAY },
];
