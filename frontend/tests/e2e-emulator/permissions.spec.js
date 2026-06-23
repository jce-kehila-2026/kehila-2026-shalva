// Permission isolation through the real UI (emulator-backed). Complements the
// committed Rules-level proofs in tests/security-rules.test.js (guide read-scope,
// single-source-of-authority): here we confirm the UI itself never exposes
// another group's data, and that non-guide / anonymous users can't reach the
// guide flow.
import { test, expect } from '@playwright/test';

import { loginAs } from './helpers/emulator-login.js';
import { freezeClock } from './helpers/clock.js';
import { VOLUNTEERS, GROUPS } from './fixtures/seed-data.js';

const VOL_A_NAMES = VOLUNTEERS.filter((v) => v.groupId === 'groupA').map((v) => v.name);
const VOL_B1 = VOLUNTEERS.find((v) => v.id === 'volB1');


test.describe('permission isolation (real UI via emulators)', () => {
  test('guide B sees ONLY group B — never group A or its volunteers', async ({ page }) => {
    await freezeClock(page);
    await loginAs(page, 'guideB');

    // The dashboard pill resolves to group B.
    await expect(page.locator('.guide-group-pill strong')).toHaveText(GROUPS.groupB.groupName);

    // Open attendance: locked to group B, group A name never appears.
    await page.locator('.guide-action-card', { hasText: 'סימון נוכחות' }).click();
    await expect(page.locator('.attendance-page')).toBeVisible();
    const sub = (await page.locator('.attendance-sub').textContent()) || '';
    expect(sub.includes(GROUPS.groupB.groupName)).toBe(true);
    expect(sub.includes(GROUPS.groupA.groupName)).toBe(false);

    // Only the one group-B volunteer is shown — none of group A's.
    await expect(page.locator('.att-today-banner')).toBeVisible();
    const names = (await page.locator('.att-list .volunteer-name').allTextContents()).map((t) => t.trim());
    expect(names).toContain(VOL_B1.name);
    for (const groupAName of VOL_A_NAMES) {
      expect(names).not.toContain(groupAName);
    }
  });

  test('a role-less (viewer) user does NOT get the guide flow', async ({ page }) => {
    await freezeClock(page);
    await loginAs(page, 'noRole');
    // Authenticated, but as a viewer — never the guide dashboard.
    await expect(page.locator('.auth-role-badge')).toContainText('צופה');
    await expect(page.locator('.guide-dashboard-container')).toHaveCount(0);
  });

  test('an anonymous visitor lands on the public surface, not the guide flow', async ({ page }) => {
    await freezeClock(page);
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    // No authenticated shell, no guide dashboard — just the public landing.
    await expect(page.locator('.authenticated-header')).toHaveCount(0);
    await expect(page.locator('.guide-dashboard-container')).toHaveCount(0);
    await expect(page.locator('#root').locator(':scope > *').first()).toBeVisible();
  });
});
