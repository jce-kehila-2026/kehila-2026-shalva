import { test, expect } from '@playwright/test';

// Public, unauthenticated smoke test: the landing page renders cleanly, with no
// runtime errors, no ErrorBoundary fallback, and no horizontal overflow. Runs in
// both the desktop and mobile Chromium projects. No credentials are used.
test('public landing renders without errors or a blank screen', async ({ page }) => {
  // Capture uncaught runtime errors before navigating.
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error));

  await page.goto('/?public=1');

  // #root exists and has at least one rendered child (not blank).
  const root = page.locator('#root');
  await expect(root).toBeAttached();
  await expect(root.locator(':scope > *').first()).toBeVisible();

  // Public application content is visible (the main landmark + the hero heading,
  // both selected structurally rather than by translatable text).
  await expect(page.locator('main.main-content')).toBeVisible();
  await expect(page.locator('#main-hero-title')).toBeVisible();

  // The ErrorBoundary fallback must be absent on a healthy page.
  await expect(page.locator('.error-boundary')).toHaveCount(0);

  // No horizontal page overflow at this viewport.
  const noHorizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth <= window.innerWidth,
  );
  expect(noHorizontalOverflow).toBe(true);

  // No uncaught runtime errors (including ReferenceError) occurred.
  expect(pageErrors.map((error) => error.message)).toEqual([]);
  expect(pageErrors.some((error) => error.name === 'ReferenceError')).toBe(false);
});
