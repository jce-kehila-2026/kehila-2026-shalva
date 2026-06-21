import { test, expect } from '@playwright/test';
import { loginAs, credentialsAvailable } from './helpers/auth.js';
import { collectRuntimeErrors, assertNoRuntimeErrors } from './helpers/runtime-errors.js';

// Read-only authenticated smoke test for the guide flow. Signs in as the
// disposable guide, confirms the assigned group resolves, and opens both the
// "My Group" and the attendance screens WITHOUT touching any mark/save control.
// The group name is kept only in test memory (never logged or reported).
test('guide sees assigned group, My Group, and attendance screen (no writes)', async ({ page }) => {
  test.skip(!credentialsAvailable('guide'), 'guide E2E credentials not set');

  const collected = collectRuntimeErrors(page);
  await loginAs(page, 'guide');

  // Guide dashboard + role.
  await expect(page.locator('.guide-dashboard-container')).toBeVisible();
  await expect(page.locator('.guide-role-badge')).toHaveText('מדריך/ה');

  // Assigned to a valid group: the pill shows a <strong> name (the unassigned
  // state renders plain text with no <strong>). Kept only in test memory.
  const pill = page.locator('.guide-group-pill');
  await expect(pill).toBeVisible();
  await expect(pill.locator('strong')).toHaveCount(1);
  const groupName = ((await pill.locator('strong').textContent()) || '').trim();
  if (!groupName) {
    throw new Error('Guide is not assigned to a usable group');
  }

  // ----- "הקבוצה שלי" (My Group) -----
  await page.locator('.guide-action-card', { hasText: 'הקבוצה שלי' }).click();
  await expect(page.locator('.gd-page')).toBeVisible();

  // The displayed group matches the dashboard group — reduced to a boolean so a
  // failure never prints the live group name.
  const heroTitle = ((await page.locator('.gd-hero-title').textContent()) || '').trim();
  expect(heroTitle === groupName).toBe(true);

  // The weekly attendance section renders.
  await expect(page.getByRole('heading', { name: 'נוכחות השבוע' })).toBeVisible();

  // Roster rows or an explicit empty state: the members card always shows a
  // valid non-negative count (0 ⇒ empty state, >0 ⇒ rows).
  const membersCountText = ((await page
    .locator('[aria-controls="gd-members-details"] .gd-card-count')
    .textContent()) || '').trim();
  // Reject empty/non-numeric text first — Number('') === 0 would otherwise pass.
  expect(membersCountText).toMatch(/^\d+$/);
  expect(Number.isInteger(Number(membersCountText))).toBe(true);
  expect(Number(membersCountText)).toBeGreaterThanOrEqual(0);

  await assertNoRuntimeErrors(page, collected);

  // Return through the real UI.
  await page.locator('.gd-back').click();
  await expect(page.locator('.guide-dashboard-container')).toBeVisible();

  // ----- "סימון נוכחות" (attendance screen, READ-ONLY) -----
  await page.locator('.guide-action-card', { hasText: 'סימון נוכחות' }).click();
  await expect(page.locator('.attendance-page')).toBeVisible();

  // The locked group matches the assigned group — reduced to a boolean so a
  // failure never prints the live group name.
  await expect(page.locator('.attendance-sub')).toBeVisible();
  const subText = (await page.locator('.attendance-sub').textContent()) || '';
  expect(subText.includes(groupName)).toBe(true);

  // The current-date banner renders.
  await expect(page.locator('.att-today-banner')).toBeVisible();

  // Roster with summary, OR an explicit empty state. On a day with no scheduled
  // volunteers the screen shows the empty note instead of the summary (see the
  // Saturday/date limitation in the report). Either is a valid render.
  const rosterRows = await page.locator('.att-list .att-row').count();
  if (rosterRows > 0) {
    await expect(page.locator('.att-summary')).toBeVisible();
  } else {
    await expect(page.locator('.att-note')).toBeVisible();
  }

  // No mark/save controls are interacted with anywhere in this test.
  await assertNoRuntimeErrors(page, collected);
});
