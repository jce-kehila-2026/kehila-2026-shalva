// CENTRAL E2E PROOF: a record WRITTEN through the guide UI propagates to the
// admin consumers across THREE states — (A) אבי present + בני absent,
// (B) אבי absent + בני cleared, (C) all cleared — using the SAME records the
// guide UI wrote (no seedAttendance, no reset between guide write and consumer
// checks). Firestore is read out of band only to verify the underlying aggregate.
import { test, expect } from '@playwright/test';

import { loginAs, logout } from './helpers/emulator-login.js';
import { freezeClock } from './helpers/clock.js';
import { resetAttendance, readAttendance, cleanupDb } from './emulator-db.js';
import { VOLUNTEERS, GROUPS, FROZEN_DATE_KEY } from './fixtures/seed-data.js';
import { formatDateOnlyForDisplay } from '../../src/utils/dateDisplay.js';

const VOL_A1 = VOLUNTEERS.find((v) => v.id === 'volA1'); // אבי
const VOL_A2 = VOLUNTEERS.find((v) => v.id === 'volA2'); // בני
const DATE = formatDateOnlyForDisplay(FROZEN_DATE_KEY);   // '23-06-2026'

const presentToggle = (page, name) => page.locator(`button[aria-label="סמן ${name} כנוכח"]`);
const absentToggle = (page, name) => page.locator(`button[aria-label="סמן ${name} כחסר"]`);

async function openGuideAttendance(page) {
  await expect(page.locator('.authenticated-header')).toBeVisible();
  await expect(page.locator('.attendance-page, .guide-action-card').first()).toBeVisible();
  if ((await page.locator('.attendance-page').count()) === 0) {
    await page.locator('.guide-action-card', { hasText: 'סימון נוכחות' }).click();
  }
  await expect(page.locator('.attendance-page')).toBeVisible();
  await expect(page.locator('.att-today-banner')).toBeVisible();
}

async function guideSave(page) {
  await page.locator('.att-save').click();
  await expect(page.locator('.att-save')).toHaveText('נשמרה הנוכחות', { timeout: 15000 });
}

async function openAdminAttendanceGroupA(page) {
  await page.click('.admin-nav-toggle');
  await expect(page.locator('.admin-sidebar.is-open')).toBeVisible();
  await page.locator('.admin-nav-item', { hasText: 'מעקב נוכחות' }).click();
  await expect(page.locator('.adm-att-title')).toBeVisible();
  await page.locator('.adm-att-group-card', { hasText: GROUPS.groupA.groupName }).first().click();
  await expect(page.locator('.adm-week-board')).toBeVisible();
}

async function openAdminGroupDetailsA(page) {
  await page.click('.admin-nav-toggle');
  await expect(page.locator('.admin-sidebar.is-open')).toBeVisible();
  await page.locator('.admin-nav-item', { hasText: 'ניהול קבוצות' }).click();
  const row = page.locator('tr', { hasText: GROUPS.groupA.groupName }).first();
  await expect(row).toBeVisible();
  // Expand the row first — on mobile the row actions are hidden until expanded
  // (harmless on desktop, where they are already shown).
  await row.locator('.mgmt-name-cell').click();
  await row.locator('button', { hasText: 'פרטים' }).click();
  await expect(page.locator('.gd-page')).toBeVisible();
}

async function openAdminReports(page) {
  await page.click('.admin-nav-toggle');
  await expect(page.locator('.admin-sidebar.is-open')).toBeVisible();
  await page.locator('.admin-nav-item', { hasText: 'דוחות' }).click();
  await expect(page.locator('.reports-container')).toBeVisible();
  await page.locator('.reports-tabs button', { hasText: 'דוח נוכחות' }).click();
  await expect(page.locator('.reports-table')).toBeVisible();
}

async function openAdminCharts(page) {
  await page.click('.admin-nav-toggle');
  await expect(page.locator('.admin-sidebar.is-open')).toBeVisible();
  await page.locator('.admin-nav-item', { hasText: 'סטטיסטיקה' }).click();
  await expect(page.locator('.chart-card', { hasText: 'נוכחות (נוכחים מול חסרים)' })).toBeVisible();
}

// One admin session checking every admin-reachable consumer at exact values.
// `missing` is the marked-absent-today count; present/absent are group A's.
async function verifyAdmin(page, { missing, present, absent }, shot) {
  await loginAs(page, 'admin');

  // AdminOverview missing counter (scoped to ITS card, not ACC).
  await expect(page.locator('.ao-stat-card.is-absent .ao-stat-num')).toHaveText(String(missing));

  // AdminAttendance weekly tracker.
  await openAdminAttendanceGroupA(page);
  await expect(page.locator('.adm-att-stat-tile.is-present span')).toHaveText(String(present));
  await expect(page.locator('.adm-att-stat-tile.is-absent span')).toHaveText(String(absent));

  // GroupDetails (admin path) weekly summary.
  await openAdminGroupDetailsA(page);
  await expect(page.locator('.gd-stat--present .gd-stat-num')).toHaveText(String(present));
  await expect(page.locator('.gd-stat--absent .gd-stat-num')).toHaveText(String(absent));
  if (shot) {
    await assertVisualSmoke(page);
    await page.screenshot({ path: shot.testInfo.outputPath('groupdetails.png'), fullPage: true });
  }

  // Reports — the per-meeting attendance report.
  await openAdminReports(page);
  if (present + absent > 0) {
    const row = page.locator('.reports-table tbody tr')
      .filter({ hasText: GROUPS.groupA.groupName }).filter({ hasText: DATE });
    await expect(row).toHaveCount(1); // exactly one meeting -> no double count
    await expect(row.locator('td[data-label="נוכחים"]')).toHaveText(String(present));
    await expect(row.locator('td[data-label="חסרים"]')).toHaveText(String(absent));
    const rowText = await row.innerText();
    expect(rowText).toContain(DATE);          // 23-06-2026 shown
    expect(rowText).not.toContain('23.6');    // not the dotted form
    expect(rowText).not.toContain(FROZEN_DATE_KEY); // not the raw 2026-06-23 key

    if (shot) {
      // Free-text search: BOTH the canonical key and the display date find the
      // row; the dotted "23.6.2026" intentionally does not.
      const searchBox = page.locator('.reports-search');
      const groupRows = page.locator('.reports-table tbody tr').filter({ hasText: GROUPS.groupA.groupName });
      await searchBox.fill(FROZEN_DATE_KEY);   // 2026-06-23
      await expect(groupRows).toHaveCount(1);
      await searchBox.fill(DATE);              // 23-06-2026
      await expect(groupRows).toHaveCount(1);
      await searchBox.fill('23.6.2026');       // dotted -> no match
      await expect(groupRows).toHaveCount(0);
      await searchBox.fill('');                // clear before the screenshot
    }
  } else {
    await expect(page.locator('.reports-table tbody tr').filter({ hasText: DATE })).toHaveCount(0);
  }
  if (shot) {
    await assertVisualSmoke(page);
    await page.screenshot({ path: shot.testInfo.outputPath('reports.png'), fullPage: true });
  }

  // Charts — the attendance donut's visible aggregate (center total + legend).
  await openAdminCharts(page);
  const chart = page.locator('.chart-card', { hasText: 'נוכחות (נוכחים מול חסרים)' });
  if (present + absent > 0) {
    await expect(chart.locator('.chart-donut-center')).toHaveText(String(present + absent));
    await expect(chart.locator('li', { hasText: 'נוכחים' }).locator('.chart-legend-value')).toHaveText(String(present));
    await expect(chart.locator('li', { hasText: 'חסרים' }).locator('.chart-legend-value')).toHaveText(String(absent));
  } else {
    await expect(chart.locator('.chart-empty')).toBeVisible();
  }
  if (shot) {
    await assertVisualSmoke(page);
    await page.screenshot({ path: shot.testInfo.outputPath('charts.png'), fullPage: true });
  }

  await logout(page);
}

// Visual smoke: no horizontal PAGE overflow and no ErrorBoundary fallback.
async function assertVisualSmoke(page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, 'no horizontal page overflow').toBeLessThanOrEqual(1);
  await expect(page.locator('.error-boundary')).toHaveCount(0);
}

const groupADay = async () => (await readAttendance())
  .filter((r) => r.groupId === GROUPS.groupA.id && r.dateKey === FROZEN_DATE_KEY);


test.afterAll(async () => {
  await cleanupDb();
});


test.describe('propagation: guide UI write -> all reachable consumers (real E2E)', () => {
  test.beforeEach(async () => {
    await resetAttendance();
  });

  test('three states (A present+absent, B updated, C cleared) across consumers', async ({ page }, testInfo) => {
    test.setTimeout(180000); // many login cycles across 3 states.
    await freezeClock(page);

    // ========== STATE A: אבי present, בני absent ==========
    await loginAs(page, 'guideA');
    await openGuideAttendance(page);
    await presentToggle(page, VOL_A1.name).click();
    await absentToggle(page, VOL_A2.name).click();
    await guideSave(page);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await openGuideAttendance(page);
    await expect(presentToggle(page, VOL_A1.name)).toHaveAttribute('aria-pressed', 'true');
    await expect(absentToggle(page, VOL_A2.name)).toHaveAttribute('aria-pressed', 'true');
    await logout(page);

    expect(await groupADay()).toHaveLength(2); // exactly 2 records, no duplicate

    await verifyAdmin(page, { missing: 1, present: 1, absent: 1 }, { testInfo });

    // ========== STATE B: אבי absent (update), בני cleared (delete) ==========
    await loginAs(page, 'guideA');
    await openGuideAttendance(page);
    await absentToggle(page, VOL_A1.name).click(); // אבי present -> absent
    await absentToggle(page, VOL_A2.name).click(); // בני absent -> unmarked
    await guideSave(page);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await openGuideAttendance(page);
    await expect(absentToggle(page, VOL_A1.name)).toHaveAttribute('aria-pressed', 'true');
    await expect(absentToggle(page, VOL_A2.name)).toHaveAttribute('aria-pressed', 'false');
    await logout(page);

    const dayB = await groupADay();
    expect(dayB).toHaveLength(1);            // בני deleted, אבי updated in place
    expect(dayB[0].volunteerId).toBe(VOL_A1.id);
    expect(dayB[0].status).toBe(false);

    await verifyAdmin(page, { missing: 1, present: 0, absent: 1 });

    // ========== STATE C: אבי cleared too -> zero ==========
    await loginAs(page, 'guideA');
    await openGuideAttendance(page);
    await absentToggle(page, VOL_A1.name).click(); // אבי absent -> unmarked
    await guideSave(page);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await openGuideAttendance(page);
    await expect(absentToggle(page, VOL_A1.name)).toHaveAttribute('aria-pressed', 'false');
    await expect(presentToggle(page, VOL_A1.name)).toHaveAttribute('aria-pressed', 'false');
    await logout(page);

    expect(await groupADay()).toHaveLength(0); // zero records

    await verifyAdmin(page, { missing: 0, present: 0, absent: 0 });
  });
});
