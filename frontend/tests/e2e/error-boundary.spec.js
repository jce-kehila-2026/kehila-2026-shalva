import { test, expect } from '@playwright/test';

// The production ErrorBoundary, exercised through a test-only fixture that throws
// on first load and recovers after a real reload. Runs in both Chromium
// projects. No credentials are used.
//
// Note: the fixture deliberately throws once, so the ErrorBoundary's
// componentDidCatch will emit ONE expected console.error — that is intentional
// for this forced-error fixture and is not a production failure.
const FIXTURE = '/tests/e2e/fixtures/error-boundary.html';

// Patterns that must NEVER appear in the visible fallback (stack frames, provider
// names, tokens, emails, raw error types).
const SENSITIVE = /Firebase|token|[\w.%+-]+@[\w.-]+\.[a-z]{2,}|ReferenceError|TypeError|\bError\b|\.jsx|\bat\s+\S/i;

test('ErrorBoundary shows a safe Hebrew fallback and recovers on reload', async ({ page }) => {
  await page.goto(FIXTURE);

  // ----- First load: the fallback is shown -----
  const fallback = page.locator('.error-boundary');
  await expect(fallback).toBeVisible();

  // #root is populated — the page is not blank.
  const root = page.locator('#root');
  await expect(root.locator(':scope > *').first()).toBeVisible();

  // Hebrew heading + message, and an enabled reload button.
  await expect(page.locator('.error-boundary__title')).toHaveText('אירעה שגיאה בלתי צפויה');
  await expect(page.locator('.error-boundary__message')).toBeVisible();
  const reloadButton = page.locator('.error-boundary__reload');
  await expect(reloadButton).toBeVisible();
  await expect(reloadButton).toBeEnabled();

  // The fallback card is fully within the viewport, with no horizontal overflow.
  const layout = await page.evaluate(() => {
    const card = document.querySelector('.error-boundary__card').getBoundingClientRect();
    const innerWidth = window.innerWidth;
    const innerHeight = window.innerHeight;
    return {
      cardWithinViewport:
        card.left >= -1 &&
        card.right <= innerWidth + 1 &&
        card.top >= -1 &&
        card.bottom <= innerHeight + 1,
      noHorizontalOverflow: document.documentElement.scrollWidth <= innerWidth,
    };
  });
  expect(layout.cardWithinViewport).toBe(true);
  expect(layout.noHorizontalOverflow).toBe(true);

  // The sentinel and any internal error details must NOT reach the DOM.
  const bodyText = await page.evaluate(() => document.body.innerText || '');
  expect(bodyText).not.toContain('TEST_INTERNAL_ERROR_SENTINEL');
  expect(bodyText).not.toMatch(SENSITIVE);

  // ----- Reload: the page recovers, with no retry loop -----
  const recovered = page.locator('[data-testid="error-boundary-recovered"]');
  await Promise.all([
    page.waitForEvent('load'), // a real navigation/reload, not a fixed sleep
    reloadButton.click(),
  ]);
  await expect(recovered).toBeVisible();
  await expect(fallback).toHaveCount(0);
});
