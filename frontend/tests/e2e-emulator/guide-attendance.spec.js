// Real UI E2E for the guide attendance flow, through the Firebase emulators.
// EVERY action here is performed via the React UI (login, navigation, marking,
// saving, reload). Firestore is read out-of-band ONLY to verify the documents
// the UI produced — never to perform the writes under test.
import { test, expect } from '@playwright/test';

import { loginAs } from './helpers/emulator-login.js';
import { freezeClock } from './helpers/clock.js';
import { resetAttendance, readAttendance, cleanupDb } from './emulator-db.js';
import { VOLUNTEERS, GROUPS, FROZEN_DATE_KEY } from './fixtures/seed-data.js';
import { collectRuntimeErrors, assertNoRuntimeErrors } from '../e2e/helpers/runtime-errors.js';

// The three group-A volunteers (scheduled today) + the group-B volunteer.
const VOL_A1 = VOLUNTEERS.find((v) => v.id === 'volA1');
const VOL_A2 = VOLUNTEERS.find((v) => v.id === 'volA2');
const VOL_A3 = VOLUNTEERS.find((v) => v.id === 'volA3');
const VOL_B1 = VOLUNTEERS.find((v) => v.id === 'volB1');

// The frozen day's canonical dateKey — the same key the app writes (its clock is
// frozen to the fixed test instant), so the suite is deterministic on any day.
const DATE_KEY = FROZEN_DATE_KEY;
const canonicalId = (volunteerId) => `${GROUPS.groupA.id}_${DATE_KEY}_${volunteerId}`;

// Open the guide's attendance screen (assumes already signed in as guide A).
async function openAttendance(page) {
  await page.locator('.guide-action-card', { hasText: 'סימון נוכחות' }).click();
  await expect(page.locator('.attendance-page')).toBeVisible();
  // Wait for the roster (or empty note) to settle.
  await expect(page.locator('.att-today-banner')).toBeVisible();
}

// After a full reload the app restores the guide's last view from sessionStorage
// — often straight back to the attendance screen. Open it whether we land on the
// menu (click the card) or already on the attendance screen.
async function ensureAttendanceOpen(page) {
  await expect(page.locator('.authenticated-header')).toBeVisible();
  // Wait until the app has SETTLED into a guide view — either the attendance
  // screen (restored from sessionStorage) or the menu with its action cards —
  // before deciding whether to click in. (Otherwise the count check races the
  // post-reload load.)
  await expect(page.locator('.attendance-page, .guide-action-card').first()).toBeVisible();
  if ((await page.locator('.attendance-page').count()) === 0) {
    await page.locator('.guide-action-card', { hasText: 'סימון נוכחות' }).click();
  }
  await expect(page.locator('.attendance-page')).toBeVisible();
  await expect(page.locator('.att-today-banner')).toBeVisible();
}

const presentToggle = (page, name) => page.locator(`button[aria-label="סמן ${name} כנוכח"]`);
const absentToggle = (page, name) => page.locator(`button[aria-label="סמן ${name} כחסר"]`);

// Click the save button and wait for the success state (button -> "נשמרה הנוכחות"),
// which only appears AFTER the writes resolve.
async function saveAndExpectSuccess(page) {
  await page.locator('.att-save').click();
  await expect(page.locator('.att-save')).toHaveText('נשמרה הנוכחות', { timeout: 15000 });
}


test.afterAll(async () => {
  await cleanupDb();
});


test.describe('guide A attendance flow (real UI via emulators)', () => {
  test.beforeEach(async () => {
    // Each run starts from an empty attendance collection (seed is untouched).
    await resetAttendance();
  });

  test('scope, mark, save, verify, persistence, update/delete', async ({ page }, testInfo) => {
    // Freeze the browser clock to the fixed (non-Saturday) test instant before
    // the app loads, so "today" is deterministic on any calendar day.
    await freezeClock(page);
    const collected = collectRuntimeErrors(page);

    // Surface any app dialog (an error alert would fail the success flow).
    const dialogs = [];
    page.on('dialog', (dialog) => {
      dialogs.push(dialog.type());
      dialog.accept().catch(() => {});
    });

    // ----- A. Sign in as guide A + open attendance -----
    await loginAs(page, 'guideA');
    await expect(page.locator('.guide-role-badge')).toHaveText('מדריך/ה');
    await openAttendance(page);

    // Scope: the locked group is group A, never group B.
    const sub = (await page.locator('.attendance-sub').textContent()) || '';
    expect(sub.includes(GROUPS.groupA.groupName)).toBe(true);
    expect(sub.includes(GROUPS.groupB.groupName)).toBe(false);

    // Exactly the three group-A volunteers are shown — not the group-B one.
    await expect(page.locator('.att-list .att-row')).toHaveCount(3);
    const names = (await page.locator('.att-list .volunteer-name').allTextContents()).map((t) => t.trim());
    expect(names).toContain(VOL_A1.name);
    expect(names).toContain(VOL_A2.name);
    expect(names).toContain(VOL_A3.name);
    expect(names).not.toContain(VOL_B1.name);

    // The header date is DD-MM-YYYY.
    const dateLabel = (await page.locator('.att-today-date').textContent()) || '';
    expect(dateLabel).toMatch(/\b\d{2}-\d{2}-\d{4}\b/);

    // ----- B. Mark: A1 present, A2 absent (A3 left unmarked) -----
    await presentToggle(page, VOL_A1.name).click();
    await absentToggle(page, VOL_A2.name).click();
    await saveAndExpectSuccess(page);

    await assertNoRuntimeErrors(page, collected);
    expect(collected.consoleErrors, 'no console.error during the flow').toEqual([]);

    // ----- C. Verify the Firestore documents the UI wrote -----
    let records = await readAttendance();
    expect(records).toHaveLength(2);

    const a1 = records.find((r) => r.volunteerId === VOL_A1.id);
    const a2 = records.find((r) => r.volunteerId === VOL_A2.id);

    // Canonical id, group, strict dateKey, boolean status — no duplicates.
    expect(a1).toBeTruthy();
    expect(a1.id).toBe(canonicalId(VOL_A1.id));
    expect(a1.groupId).toBe(GROUPS.groupA.id);
    expect(a1.dateKey).toBe(DATE_KEY);
    expect(a1.dateKey).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(typeof a1.status).toBe('boolean');
    expect(a1.status).toBe(true);

    expect(a2).toBeTruthy();
    expect(a2.id).toBe(canonicalId(VOL_A2.id));
    expect(a2.groupId).toBe(GROUPS.groupA.id);
    expect(a2.status).toBe(false);

    // No record for the untouched A3, and none for any other group.
    expect(records.some((r) => r.volunteerId === VOL_A3.id)).toBe(false);
    expect(records.every((r) => r.groupId === GROUPS.groupA.id)).toBe(true);

    // ----- D. Persistence: full reload, re-open, marks still shown -----
    await page.reload({ waitUntil: 'domcontentloaded' });
    await ensureAttendanceOpen(page);
    await expect(presentToggle(page, VOL_A1.name)).toHaveAttribute('aria-pressed', 'true');
    await expect(absentToggle(page, VOL_A2.name)).toHaveAttribute('aria-pressed', 'true');

    // Screenshot: guide screen after reload with saved marks.
    await page.screenshot({ path: testInfo.outputPath('guide-after-reload.png'), fullPage: true });

    // ----- E. Update + delete: A1 present->absent, clear A2 -----
    await absentToggle(page, VOL_A1.name).click();   // A1 -> absent (update same doc)
    await absentToggle(page, VOL_A2.name).click();   // A2 absent -> unmarked (delete)
    await saveAndExpectSuccess(page);
    await assertNoRuntimeErrors(page, collected);

    records = await readAttendance();
    // A1 updated IN PLACE (same canonical id), A2's record removed -> only 1 left.
    expect(records).toHaveLength(1);
    const a1Updated = records.find((r) => r.volunteerId === VOL_A1.id);
    expect(a1Updated.id).toBe(canonicalId(VOL_A1.id)); // not duplicated
    expect(a1Updated.status).toBe(false);              // present -> absent
    expect(records.some((r) => r.volunteerId === VOL_A2.id)).toBe(false); // deleted

    // ----- F. Reload again, confirm the post-update state -----
    await page.reload({ waitUntil: 'domcontentloaded' });
    await ensureAttendanceOpen(page);
    await expect(absentToggle(page, VOL_A1.name)).toHaveAttribute('aria-pressed', 'true');
    await expect(presentToggle(page, VOL_A2.name)).toHaveAttribute('aria-pressed', 'false');
    await expect(absentToggle(page, VOL_A2.name)).toHaveAttribute('aria-pressed', 'false');

    // Only benign dialogs (none expected on the success paths).
    expect(dialogs).toEqual([]);
  });
});
