// Partial-failure proof through the REAL UI: after the screen has loaded, one of
// the marked volunteers is moved (rules-disabled) to another group, so the guide
// save hits a write the rules reject — exactly ONE of the two writes succeeds.
// Then the volunteer is restored and a retry sends ONLY the failed mark.
import { test, expect } from '@playwright/test';

import { loginAs } from './helpers/emulator-login.js';
import { freezeClock } from './helpers/clock.js';
import { resetAttendance, readAttendance, setVolunteerGroup, cleanupDb } from './emulator-db.js';
import { VOLUNTEERS, GROUPS, FROZEN_DATE_KEY } from './fixtures/seed-data.js';

const VOL_A1 = VOLUNTEERS.find((v) => v.id === 'volA1'); // stays in group A
const VOL_A2 = VOLUNTEERS.find((v) => v.id === 'volA2'); // moved to group B mid-test

const presentToggle = (page, name) => page.locator(`button[aria-label="סמן ${name} כנוכח"]`);

async function openGuideAttendance(page) {
  await expect(page.locator('.authenticated-header')).toBeVisible();
  // Wait for the app to settle into a guide view before deciding to click in.
  await expect(page.locator('.attendance-page, .guide-action-card').first()).toBeVisible();
  if ((await page.locator('.attendance-page').count()) === 0) {
    await page.locator('.guide-action-card', { hasText: 'סימון נוכחות' }).click();
  }
  await expect(page.locator('.attendance-page')).toBeVisible();
  await expect(page.locator('.att-today-banner')).toBeVisible();
}

const groupADay = async () => (await readAttendance())
  .filter((r) => r.groupId === GROUPS.groupA.id && r.dateKey === FROZEN_DATE_KEY);


test.afterAll(async () => {
  await cleanupDb();
});


test.describe('partial save failure via the UI (real E2E)', () => {
  test.beforeEach(async () => {
    await resetAttendance();
    // Make sure A2 starts in group A (a previous test may have moved it).
    await setVolunteerGroup(VOL_A2.id, GROUPS.groupA.id);
  });

  test('1 of 2 saved, failed mark kept, retry then fully succeeds', async ({ page }) => {
    await freezeClock(page);

    // Capture app dialogs (the partial-failure alert is shown via window.alert).
    const dialogs = [];
    page.on('dialog', (dialog) => {
      dialogs.push(dialog.message());
      dialog.accept().catch(() => {});
    });

    await loginAs(page, 'guideA');
    await openGuideAttendance(page);

    // After the screen has loaded its roster, move A2 to group B on the server.
    // The React roster still has A2 (loaded as group A), so the UI will try to
    // write it — and the rules will reject that one write.
    await setVolunteerGroup(VOL_A2.id, GROUPS.groupB.id);

    // Mark BOTH present and save through the UI.
    await presentToggle(page, VOL_A1.name).click();
    await presentToggle(page, VOL_A2.name).click();
    await page.locator('.att-save').click();

    // A partial-failure message appears ("נשמרו 1 מתוך 2 ..."), NOT full success.
    await expect.poll(() => dialogs.length, { timeout: 15000 }).toBeGreaterThan(0);
    expect(dialogs.some((message) => /נשמרו\s*1\s*מתוך\s*2/.test(message))).toBe(true);

    // Data: only the valid write (A1) landed; the rejected one (A2) did not.
    let dayA = await groupADay();
    expect(dayA).toHaveLength(1);
    expect(dayA[0].volunteerId).toBe(VOL_A1.id);

    // The failed mark stays in the UI for a retry (A2 still shown as present).
    await expect(presentToggle(page, VOL_A2.name)).toHaveAttribute('aria-pressed', 'true');

    // ----- Restore A2 to group A, then retry: only the failed mark is re-sent -----
    await setVolunteerGroup(VOL_A2.id, GROUPS.groupA.id);
    dialogs.length = 0;
    await page.locator('.att-save').click();
    await expect(page.locator('.att-save')).toHaveText('נשמרה הנוכחות', { timeout: 15000 });
    expect(dialogs).toEqual([]); // no failure dialog on the successful retry

    // Both records now exist, exactly once each — no duplicate of the A1 write.
    dayA = await groupADay();
    expect(dayA).toHaveLength(2);
    expect(dayA.filter((r) => r.volunteerId === VOL_A1.id)).toHaveLength(1);
    expect(dayA.filter((r) => r.volunteerId === VOL_A2.id)).toHaveLength(1);
  });
});
