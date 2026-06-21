import { test, expect } from '@playwright/test';
import { loginAs, credentialsAvailable } from './helpers/auth.js';
import { collectRuntimeErrors, assertNoRuntimeErrors } from './helpers/runtime-errors.js';

// Read-only authenticated smoke test for the admin overview. Signs in as the
// disposable admin and verifies the screen renders cleanly with a valid
// missing-attendance count. Writes nothing. Runs in both Chromium projects.
test('admin overview renders cleanly with a valid missing-attendance count', async ({ page }) => {
  test.skip(!credentialsAvailable('admin'), 'admin E2E credentials not set');

  const collected = collectRuntimeErrors(page);
  await loginAs(page, 'admin');

  // Authenticated header — exactly one of each element.
  const header = page.locator('.authenticated-header');
  await expect(header).toBeVisible();
  await expect(header.locator('.auth-user-block')).toHaveCount(1);
  await expect(header.locator('.auth-greeting')).toHaveCount(1);
  await expect(header.locator('.auth-logo')).toHaveCount(1);
  await expect(header.locator('.auth-actions button')).toHaveCount(1);

  // AdminOverview is visible.
  await expect(page.locator('.admin-overview')).toBeVisible();

  // Healthy: no uncaught errors / ReferenceError, no fallback, populated #root.
  await assertNoRuntimeErrors(page, collected);

  // No horizontal page overflow at this viewport.
  const noHorizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth <= window.innerWidth,
  );
  expect(noHorizontalOverflow).toBe(true);

  // The "חסרים בנוכחות" card (the admin overview's own absentees stat card):
  // visible, with a valid non-negative integer value.
  const missingCard = page.locator('.ao-stat-card.is-absent');
  await expect(missingCard).toBeVisible();
  const valueText = ((await missingCard.locator('.ao-stat-num').textContent()) || '').trim();
  // Reject empty/non-numeric text first — Number('') === 0 would otherwise pass.
  expect(valueText).toMatch(/^\d+$/);
  const value = Number(valueText);
  expect(Number.isInteger(value)).toBe(true);
  expect(value).toBeGreaterThanOrEqual(0);
  // NOTE: the value is live "marked-absent-today" data — no exact value asserted.
});
