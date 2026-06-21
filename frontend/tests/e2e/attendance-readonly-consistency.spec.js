import { test, expect } from '@playwright/test';
import { loginAs, credentialsAvailable } from './helpers/auth.js';
import { collectRuntimeErrors } from './helpers/runtime-errors.js';

// Read-only cross-role consistency: the guide and the admin must resolve the
// SAME group. Manually created contexts do NOT inherit the project's baseURL or
// viewport, so both are applied explicitly. Every comparison that involves the
// live group name is reduced to a boolean / count / index, so a failure can
// never print a group name. Nothing is written; no attendance control is touched.
test('guide and admin resolve the same group (read-only, no writes)', async ({ browser }) => {
  test.skip(
    !credentialsAvailable('guide') || !credentialsAvailable('admin'),
    'guide and admin E2E credentials not set',
  );

  // Manual contexts inherit nothing — apply the active project's baseURL +
  // viewport explicitly (project-level use for the viewport, global use for the
  // baseURL).
  const projectUse = test.info().project.use || {};
  const configUse = test.info().config.use || {};
  const baseURL = projectUse.baseURL ?? configUse.baseURL;
  const viewport = projectUse.viewport ?? configUse.viewport;

  // Both manual contexts are always closed — including on assertion failure.
  // Each is nulled right after a normal close so the finally never double-closes,
  // and the finally tolerates a context that was never created.
  let guideContext = null;
  let adminContext = null;

  try {
    // ----- A. Guide context -----
    guideContext = await browser.newContext({ baseURL, viewport });
    const guidePage = await guideContext.newPage();
    const guideErrors = collectRuntimeErrors(guidePage);
    await loginAs(guidePage, 'guide');

    // The context viewport must actually match the project viewport.
    const guideViewport = await guidePage.evaluate(
      () => ({ width: window.innerWidth, height: window.innerHeight }),
    );
    expect(guideViewport.width).toBe(viewport.width);
    expect(guideViewport.height).toBe(viewport.height);

    await expect(guidePage.locator('.guide-dashboard-container')).toBeVisible();
    // Wait for the guide data (and the group pill) to finish loading.
    await expect(guidePage.locator('.guide-group-pill strong')).toBeVisible();
    const groupName = ((await guidePage.locator('.guide-group-pill strong').textContent()) || '').trim();
    expect(groupName.length).toBeGreaterThan(0);

    await guidePage.locator('.guide-action-card', { hasText: 'סימון נוכחות' }).click();
    await expect(guidePage.locator('.attendance-page')).toBeVisible();
    const guideRosterRows = await guidePage.locator('.att-list .att-row').count();
    expect(guideErrors.pageErrors).toEqual([]);
    expect(guideErrors.referenceErrors).toEqual([]);

    await guideContext.close();
    guideContext = null;

    // ----- B. Admin context -----
    adminContext = await browser.newContext({ baseURL, viewport });
    const adminPage = await adminContext.newPage();
    const adminErrors = collectRuntimeErrors(adminPage);
    await loginAs(adminPage, 'admin');

    const adminViewport = await adminPage.evaluate(
      () => ({ width: window.innerWidth, height: window.innerHeight }),
    );
    expect(adminViewport.width).toBe(viewport.width);
    expect(adminViewport.height).toBe(viewport.height);

    // Navigate to the admin attendance tracking screen via the real nav drawer.
    await adminPage.click('.admin-nav-toggle');
    await expect(adminPage.locator('.admin-sidebar.is-open')).toBeVisible();
    await adminPage.locator('.admin-nav-item', { hasText: 'מעקב נוכחות' }).click();
    await expect(adminPage.locator('.adm-att-title')).toBeVisible();
    // Wait for the group cards to finish loading (async getDocs) before reading.
    await expect(adminPage.locator('.adm-att-group-card').first()).toBeVisible();

    // Privacy-safe match: compare names in memory, assert a single match by COUNT,
    // then select by INDEX. No assertion carries the group name.
    const cardNames = (await adminPage.locator('.adm-att-group-card .adm-att-group-name').allTextContents())
      .map((text) => text.trim());
    const matchIndexes = cardNames
      .map((name, index) => (name === groupName ? index : -1))
      .filter((index) => index >= 0);
    expect(matchIndexes.length).toBe(1);

    await adminPage.locator('.adm-att-group-card').nth(matchIndexes[0]).click();
    await expect(adminPage.locator('.adm-week-board')).toBeVisible();

    // The review title should contain the same group — reduced to a boolean.
    const reviewTitle = adminPage.locator('.adm-att-review-card h2');
    const titleMatchesGroup = async () => ((await reviewTitle.textContent()) || '').includes(groupName);
    expect(await titleMatchesGroup()).toBe(true);

    // Previous-week navigation renders, then returning to the original week renders.
    const weekSwitcher = adminPage.locator('.adm-att-week-switcher');
    await weekSwitcher.getByRole('button', { name: 'קודם' }).click();
    await expect(adminPage.locator('.adm-week-board')).toBeVisible();
    expect(await titleMatchesGroup()).toBe(true);
    await weekSwitcher.getByRole('button', { name: 'שבוע הבא' }).click();
    await expect(adminPage.locator('.adm-week-board')).toBeVisible();
    expect(await titleMatchesGroup()).toBe(true);

    expect(adminErrors.pageErrors).toEqual([]);
    expect(adminErrors.referenceErrors).toEqual([]);

    await adminContext.close();
    adminContext = null;

    // Non-sensitive recorded facts (no names, no statuses).
    expect(guideRosterRows).toBeGreaterThanOrEqual(0);
  } finally {
    // Close whatever is still open (only on a failure path); at most once each.
    if (guideContext) await guideContext.close().catch(() => {});
    if (adminContext) await adminContext.close().catch(() => {});
  }
});
